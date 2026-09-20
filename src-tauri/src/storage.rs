use clinicians_veil_core::privacy::{Category, PrivacyResult};
use getrandom::fill;
use rusqlite::{params, Connection, ErrorCode, OpenFlags, OptionalExtension};
use security_framework::os::macos::keychain::SecKeychain;
use security_framework::os::macos::passwords::find_generic_password;
use serde::Serialize;
use std::{
    fs,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::{SystemTime, UNIX_EPOCH},
};

const KEYCHAIN_SERVICE: &str = "dev.simonrowe.cliniciansveil";
const KEYCHAIN_ACCOUNT: &str = "encrypted-note-library-key";
const STORAGE_ERROR: &str =
    "The encrypted note library is unavailable. Reopen the app and try again.";
const STORAGE_CONFLICT: &str = "A mapping with that phrase and category already exists.";

#[derive(Clone)]
pub struct Storage {
    path: PathBuf,
    key: Arc<[u8; 32]>,
    gate: Arc<Mutex<()>>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteSummary {
    pub id: i64,
    pub title: String,
    pub patient_name: Option<String>,
    pub patient_reference: Option<String>,
    pub created_at: i64,
    pub snippet: String,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PatientView {
    pub id: i64,
    pub name: String,
    pub patient_reference: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteView {
    pub id: i64,
    pub patient_id: Option<i64>,
    pub title: String,
    pub patient_name: Option<String>,
    pub patient_reference: Option<String>,
    pub source_text: Option<String>,
    pub reviewed_text: String,
    pub provenance: String,
    pub created_at: i64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MappingView {
    pub id: i64,
    pub phrase: String,
    pub category: Category,
    pub replacement: String,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Clone)]
pub struct LibraryMatch {
    pub start: usize,
    pub end: usize,
    pub category: Category,
    pub replacement: String,
}

impl Storage {
    pub fn open(root: &Path) -> PrivacyResult<Self> {
        fs::create_dir_all(root).map_err(|_| STORAGE_ERROR)?;
        let key = load_or_create_key()?;
        let storage = Self {
            path: root.join("clinicians-veil.sqlite"),
            key: Arc::new(key),
            gate: Arc::new(Mutex::new(())),
        };
        storage.with_connection(|_| Ok(()))?;
        Ok(storage)
    }

    #[cfg(test)]
    pub fn open_for_test(path: PathBuf, key: [u8; 32]) -> PrivacyResult<Self> {
        let storage = Self {
            path,
            key: Arc::new(key),
            gate: Arc::new(Mutex::new(())),
        };
        storage.with_connection(|_| Ok(()))?;
        Ok(storage)
    }

    fn with_connection<T>(
        &self,
        task: impl FnOnce(&mut Connection) -> PrivacyResult<T>,
    ) -> PrivacyResult<T> {
        let _guard = self.gate.lock().map_err(|_| STORAGE_ERROR)?;
        let mut connection = Connection::open_with_flags(
            &self.path,
            OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_CREATE,
        )
        .map_err(|_| STORAGE_ERROR)?;
        connection
            .pragma_update(None, "key", format!("x'{}'", hex(&self.key[..])))
            .map_err(|_| STORAGE_ERROR)?;
        connection.execute_batch(
            "PRAGMA foreign_keys = ON;
             PRAGMA cipher_memory_security = ON;
             CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY);
             CREATE TABLE IF NOT EXISTS notes (
               id INTEGER PRIMARY KEY,
               patient_id INTEGER REFERENCES patients(id),
               title TEXT NOT NULL,
               patient_reference TEXT,
               source_text TEXT,
               reviewed_text TEXT NOT NULL,
               provenance TEXT NOT NULL,
               created_at INTEGER NOT NULL
             );
             CREATE VIRTUAL TABLE IF NOT EXISTS note_search USING fts5(title, patient_reference, reviewed_text);
             CREATE TABLE IF NOT EXISTS patients (
               id INTEGER PRIMARY KEY,
               name TEXT NOT NULL,
               normalized_name TEXT NOT NULL,
               patient_reference TEXT,
               created_at INTEGER NOT NULL,
               UNIQUE(normalized_name)
             );
             CREATE TABLE IF NOT EXISTS patient_mappings (
               id INTEGER PRIMARY KEY,
               patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
               phrase TEXT NOT NULL,
               normalized_phrase TEXT NOT NULL,
               category TEXT NOT NULL,
               replacement TEXT NOT NULL,
               created_at INTEGER NOT NULL,
               updated_at INTEGER NOT NULL,
               UNIQUE(patient_id, normalized_phrase, category)
             );
             CREATE TABLE IF NOT EXISTS mappings (
               id INTEGER PRIMARY KEY,
               phrase TEXT NOT NULL,
               normalized_phrase TEXT NOT NULL,
               category TEXT NOT NULL,
               replacement TEXT NOT NULL,
               created_at INTEGER NOT NULL,
               updated_at INTEGER NOT NULL,
               UNIQUE(normalized_phrase, category)
             );
             INSERT OR IGNORE INTO schema_migrations(version) VALUES (1);"
        ).map_err(|_| STORAGE_ERROR)?;
        let has_patient_id = connection
            .prepare("PRAGMA table_info(notes)")
            .map_err(|_| STORAGE_ERROR)?
            .query_map([], |row| row.get::<_, String>(1))
            .map_err(|_| STORAGE_ERROR)?
            .filter_map(Result::ok)
            .any(|name| name == "patient_id");
        if !has_patient_id {
            connection
                .execute(
                    "ALTER TABLE notes ADD COLUMN patient_id INTEGER REFERENCES patients(id)",
                    [],
                )
                .map_err(|_| STORAGE_ERROR)?;
        }
        let has_source_text = connection
            .prepare("PRAGMA table_info(notes)")
            .map_err(|_| STORAGE_ERROR)?
            .query_map([], |row| row.get::<_, String>(1))
            .map_err(|_| STORAGE_ERROR)?
            .filter_map(Result::ok)
            .any(|name| name == "source_text");
        if !has_source_text {
            connection
                .execute("ALTER TABLE notes ADD COLUMN source_text TEXT", [])
                .map_err(|_| STORAGE_ERROR)?;
        }
        task(&mut connection)
    }

    pub fn save_note(
        &self,
        patient_id: i64,
        title: &str,
        patient_reference: Option<&str>,
        source_text: &str,
        reviewed_text: &str,
        provenance: &str,
    ) -> PrivacyResult<NoteView> {
        let title = validate_title(title)?;
        let patient_reference = normalise_optional(
            patient_reference,
            128,
            "Use at most 128 characters for the patient reference.",
        )?;
        let created_at = now()?;
        self.with_connection(|connection| {
            let (patient_name, stored_reference): (String, Option<String>) = connection
                .query_row("SELECT name, patient_reference FROM patients WHERE id = ?1", [patient_id], |row| Ok((row.get(0)?, row.get(1)?)))
                .optional()
                .map_err(|_| STORAGE_ERROR)?
                .ok_or("This patient is no longer available.")?;
            let patient_reference = patient_reference.or(stored_reference);
            let transaction = connection.transaction().map_err(|_| STORAGE_ERROR)?;
            transaction.execute(
                "INSERT INTO notes(patient_id, title, patient_reference, source_text, reviewed_text, provenance, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![patient_id, title, patient_reference, source_text, reviewed_text, provenance, created_at],
            ).map_err(|_| STORAGE_ERROR)?;
            let id = transaction.last_insert_rowid();
            transaction.execute(
                "INSERT INTO note_search(rowid, title, patient_reference, reviewed_text) VALUES (?1, ?2, ?3, ?4)",
                params![id, title, patient_reference, reviewed_text],
            ).map_err(|_| STORAGE_ERROR)?;
            transaction.commit().map_err(|_| STORAGE_ERROR)?;
            Ok(NoteView { id, patient_id: Some(patient_id), title: title.to_owned(), patient_name: Some(patient_name), patient_reference, source_text: Some(source_text.to_owned()), reviewed_text: reviewed_text.to_owned(), provenance: provenance.to_owned(), created_at })
        })
    }

    pub fn update_note(
        &self,
        id: i64,
        patient_id: i64,
        title: &str,
        source_text: &str,
        reviewed_text: &str,
        provenance: &str,
    ) -> PrivacyResult<NoteView> {
        let title = validate_title(title)?;
        self.with_connection(|connection| {
            let created_at = connection
                .query_row("SELECT created_at FROM notes WHERE id = ?1", [id], |row| row.get(0))
                .optional()
                .map_err(|_| STORAGE_ERROR)?
                .ok_or("This note is no longer available.")?;
            let (patient_name, patient_reference): (String, Option<String>) = connection
                .query_row(
                    "SELECT name, patient_reference FROM patients WHERE id = ?1",
                    [patient_id],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )
                .optional()
                .map_err(|_| STORAGE_ERROR)?
                .ok_or("This patient is no longer available.")?;
            let transaction = connection.transaction().map_err(|_| STORAGE_ERROR)?;
            let changed = transaction
                .execute(
                    "UPDATE notes SET patient_id = ?1, title = ?2, patient_reference = ?3, source_text = ?4, reviewed_text = ?5, provenance = ?6 WHERE id = ?7",
                    params![patient_id, title, patient_reference, source_text, reviewed_text, provenance, id],
                )
                .map_err(|_| STORAGE_ERROR)?;
            debug_assert_eq!(changed, 1);
            transaction
                .execute("DELETE FROM note_search WHERE rowid = ?1", [id])
                .map_err(|_| STORAGE_ERROR)?;
            transaction
                .execute(
                    "INSERT INTO note_search(rowid, title, patient_reference, reviewed_text) VALUES (?1, ?2, ?3, ?4)",
                    params![id, title, patient_reference, reviewed_text],
                )
                .map_err(|_| STORAGE_ERROR)?;
            transaction.commit().map_err(|_| STORAGE_ERROR)?;
            Ok(NoteView {
                id,
                patient_id: Some(patient_id),
                title,
                patient_name: Some(patient_name),
                patient_reference,
                source_text: Some(source_text.to_owned()),
                reviewed_text: reviewed_text.to_owned(),
                provenance: provenance.to_owned(),
                created_at,
            })
        })
    }

    pub fn search_notes(&self, query: &str) -> PrivacyResult<Vec<NoteSummary>> {
        self.with_connection(|connection| {
            let mut results = Vec::new();
            if let Some(search) = fts_query(query) {
                let mut statement = connection.prepare(
                    "SELECT notes.id, notes.title, notes.patient_reference, notes.created_at,
                       snippet(note_search, 2, '[', ']', '…', 12), patients.name
                     FROM note_search JOIN notes ON notes.id = note_search.rowid
                     LEFT JOIN patients ON patients.id = notes.patient_id
                     WHERE note_search MATCH ?1 ORDER BY bm25(note_search), notes.id DESC"
                ).map_err(|_| STORAGE_ERROR)?;
                let rows = statement.query_map([search], note_summary).map_err(|_| STORAGE_ERROR)?;
                for row in rows { results.push(row.map_err(|_| STORAGE_ERROR)?); }
            } else {
                let mut statement = connection.prepare(
                    "SELECT notes.id, notes.title, notes.patient_reference, notes.created_at, substr(notes.reviewed_text, 1, 180), patients.name FROM notes LEFT JOIN patients ON patients.id = notes.patient_id ORDER BY notes.id DESC"
                ).map_err(|_| STORAGE_ERROR)?;
                let rows = statement.query_map([], note_summary).map_err(|_| STORAGE_ERROR)?;
                for row in rows { results.push(row.map_err(|_| STORAGE_ERROR)?); }
            }
            Ok(results)
        })
    }

    pub fn note(&self, id: i64) -> PrivacyResult<NoteView> {
        self.with_connection(|connection| connection.query_row(
            "SELECT notes.id, notes.patient_id, notes.title, notes.patient_reference, notes.source_text, notes.reviewed_text, notes.provenance, notes.created_at, patients.name FROM notes LEFT JOIN patients ON patients.id = notes.patient_id WHERE notes.id = ?1", [id], note_view
        ).optional().map_err(|_| STORAGE_ERROR)?.ok_or("This note is no longer available."))
    }

    pub fn delete_note(&self, id: i64) -> PrivacyResult<()> {
        self.with_connection(|connection| {
            let transaction = connection.transaction().map_err(|_| STORAGE_ERROR)?;
            transaction
                .execute("DELETE FROM note_search WHERE rowid = ?1", [id])
                .map_err(|_| STORAGE_ERROR)?;
            transaction
                .execute("DELETE FROM notes WHERE id = ?1", [id])
                .map_err(|_| STORAGE_ERROR)?;
            transaction.commit().map_err(|_| STORAGE_ERROR)
        })
    }

    /// Deletes the patient, all of their encrypted notes and their
    /// patient-scoped mappings in one transaction. Note search rows are
    /// explicitly removed because FTS5 does not follow SQLite foreign keys.
    pub fn delete_patient(&self, id: i64) -> PrivacyResult<()> {
        self.with_connection(|connection| {
            let transaction = connection.transaction().map_err(|_| STORAGE_ERROR)?;
            transaction
                .execute(
                    "DELETE FROM note_search WHERE rowid IN (SELECT id FROM notes WHERE patient_id = ?1)",
                    [id],
                )
                .map_err(|_| STORAGE_ERROR)?;
            transaction
                .execute("DELETE FROM notes WHERE patient_id = ?1", [id])
                .map_err(|_| STORAGE_ERROR)?;
            let deleted = transaction
                .execute("DELETE FROM patients WHERE id = ?1", [id])
                .map_err(|_| STORAGE_ERROR)?;
            if deleted == 0 {
                return Err("This patient is no longer available.");
            }
            transaction.commit().map_err(|_| STORAGE_ERROR)
        })
    }

    pub fn mappings(&self) -> PrivacyResult<Vec<MappingView>> {
        self.with_connection(|connection| {
            let mut statement = connection.prepare("SELECT id, phrase, category, replacement, created_at, updated_at FROM mappings ORDER BY normalized_phrase, category")
                .map_err(|_| STORAGE_ERROR)?;
            let rows = statement.query_map([], mapping_view).map_err(|_| STORAGE_ERROR)?;
            rows.map(|row| row.map_err(|_| STORAGE_ERROR)).collect()
        })
    }

    pub fn patient_mappings(&self, patient_id: i64) -> PrivacyResult<Vec<MappingView>> {
        self.with_connection(|connection| {
            let mut statement = connection
                .prepare("SELECT id, phrase, category, replacement, created_at, updated_at FROM patient_mappings WHERE patient_id = ?1 ORDER BY normalized_phrase, category")
                .map_err(|_| STORAGE_ERROR)?;
            let rows = statement
                .query_map([patient_id], mapping_view)
                .map_err(|_| STORAGE_ERROR)?;
            rows.map(|row| row.map_err(|_| STORAGE_ERROR)).collect()
        })
    }

    pub fn patients(&self) -> PrivacyResult<Vec<PatientView>> {
        self.with_connection(|connection| {
            let mut statement = connection
                .prepare(
                    "SELECT id, name, patient_reference FROM patients ORDER BY normalized_name",
                )
                .map_err(|_| STORAGE_ERROR)?;
            let rows = statement
                .query_map([], patient_view)
                .map_err(|_| STORAGE_ERROR)?;
            let patients = rows.map(|row| row.map_err(|_| STORAGE_ERROR)).collect();
            patients
        })
    }
    pub fn create_patient(
        &self,
        name: &str,
        patient_reference: Option<&str>,
    ) -> PrivacyResult<PatientView> {
        let name = normalise_required(
            name,
            160,
            "Enter a patient name.",
            "Use at most 160 characters for the patient name.",
        )?;
        let reference = normalise_optional(
            patient_reference,
            128,
            "Use at most 128 characters for the patient reference.",
        )?;
        let timestamp = now()?;
        self.with_connection(|connection| {
            connection.execute("INSERT INTO patients(name, normalized_name, patient_reference, created_at) VALUES (?1, ?2, ?3, ?4)", params![name, name.chars().flat_map(char::to_lowercase).collect::<String>(), reference, timestamp]).map_err(|error| if is_unique(&error) { "A patient with that name already exists." } else { STORAGE_ERROR })?;
            connection.query_row("SELECT id, name, patient_reference FROM patients WHERE id = ?1", [connection.last_insert_rowid()], patient_view).map_err(|_| STORAGE_ERROR)
        })
    }
    pub fn patient(&self, id: i64) -> PrivacyResult<PatientView> {
        self.with_connection(|connection| {
            connection
                .query_row(
                    "SELECT id, name, patient_reference FROM patients WHERE id = ?1",
                    [id],
                    patient_view,
                )
                .optional()
                .map_err(|_| STORAGE_ERROR)?
                .ok_or("This patient is no longer available.")
        })
    }

    pub fn create_mapping(
        &self,
        phrase: &str,
        category: Category,
        replacement: &str,
    ) -> PrivacyResult<MappingView> {
        self.write_mapping(None, phrase, category, replacement)
    }

    pub fn update_mapping(
        &self,
        id: i64,
        phrase: &str,
        category: Category,
        replacement: &str,
    ) -> PrivacyResult<MappingView> {
        self.write_mapping(Some(id), phrase, category, replacement)
    }

    pub fn upsert_mapping(
        &self,
        phrase: &str,
        category: Category,
        replacement: &str,
    ) -> PrivacyResult<MappingView> {
        let normalized = normalise_phrase(phrase)?;
        let existing = self.with_connection(|connection| {
            let existing = connection
                .query_row(
                    "SELECT id FROM mappings WHERE normalized_phrase = ?1 AND category = ?2",
                    params![normalized, category.label()],
                    |row| row.get(0),
                )
                .optional()
                .map_err(|_| STORAGE_ERROR)?;
            Ok(existing)
        })?;
        match existing {
            Some(id) => self.write_mapping(Some(id), phrase, category, replacement),
            None => self.write_mapping(None, phrase, category, replacement),
        }
    }

    pub fn upsert_patient_mapping(
        &self,
        patient_id: i64,
        phrase: &str,
        category: Category,
        replacement: &str,
    ) -> PrivacyResult<MappingView> {
        let phrase = validate_phrase(phrase)?;
        let normalized = normalise_phrase(&phrase)?;
        let replacement = validate_replacement(replacement)?;
        let timestamp = now()?;
        self.with_connection(|connection| {
            let existing = connection.query_row("SELECT id FROM patient_mappings WHERE patient_id = ?1 AND normalized_phrase = ?2 AND category = ?3", params![patient_id, normalized, category.label()], |row| row.get::<_, i64>(0)).optional().map_err(|_| STORAGE_ERROR)?;
            match existing {
                Some(id) => connection.execute("UPDATE patient_mappings SET phrase = ?1, replacement = ?2, updated_at = ?3 WHERE id = ?4", params![phrase, replacement, timestamp, id]).map_err(|_| STORAGE_ERROR)?,
                None => connection.execute("INSERT INTO patient_mappings(patient_id, phrase, normalized_phrase, category, replacement, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)", params![patient_id, phrase, normalized, category.label(), replacement, timestamp]).map_err(|_| STORAGE_ERROR)?,
            };
            let id = existing.unwrap_or_else(|| connection.last_insert_rowid());
            connection.query_row("SELECT id, phrase, category, replacement, created_at, updated_at FROM patient_mappings WHERE id = ?1", [id], mapping_view).map_err(|_| STORAGE_ERROR)
        })
    }

    pub fn create_patient_mapping(
        &self,
        patient_id: i64,
        phrase: &str,
        category: Category,
        replacement: &str,
    ) -> PrivacyResult<MappingView> {
        self.write_patient_mapping(patient_id, None, phrase, category, replacement)
    }

    pub fn update_patient_mapping(
        &self,
        patient_id: i64,
        id: i64,
        phrase: &str,
        category: Category,
        replacement: &str,
    ) -> PrivacyResult<MappingView> {
        self.write_patient_mapping(patient_id, Some(id), phrase, category, replacement)
    }

    fn write_patient_mapping(
        &self,
        patient_id: i64,
        id: Option<i64>,
        phrase: &str,
        category: Category,
        replacement: &str,
    ) -> PrivacyResult<MappingView> {
        let phrase = validate_phrase(phrase)?;
        let normalized = normalise_phrase(&phrase)?;
        let replacement = validate_replacement(replacement)?;
        let timestamp = now()?;
        self.with_connection(|connection| match id {
            Some(id) => {
                let changed = connection.execute(
                    "UPDATE patient_mappings SET phrase = ?1, normalized_phrase = ?2, category = ?3, replacement = ?4, updated_at = ?5 WHERE id = ?6 AND patient_id = ?7",
                    params![phrase, normalized, category.label(), replacement, timestamp, id, patient_id],
                );
                if let Err(error) = changed {
                    return Err(if is_unique(&error) { STORAGE_CONFLICT } else { STORAGE_ERROR });
                }
                connection.query_row(
                    "SELECT id, phrase, category, replacement, created_at, updated_at FROM patient_mappings WHERE id = ?1 AND patient_id = ?2",
                    params![id, patient_id],
                    mapping_view,
                ).optional().map_err(|_| STORAGE_ERROR)?.ok_or("This mapping is no longer available.")
            }
            None => {
                let inserted = connection.execute(
                    "INSERT INTO patient_mappings(patient_id, phrase, normalized_phrase, category, replacement, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)",
                    params![patient_id, phrase, normalized, category.label(), replacement, timestamp],
                );
                if let Err(error) = inserted {
                    return Err(if is_unique(&error) { STORAGE_CONFLICT } else { STORAGE_ERROR });
                }
                let id = connection.last_insert_rowid();
                connection.query_row(
                    "SELECT id, phrase, category, replacement, created_at, updated_at FROM patient_mappings WHERE id = ?1",
                    [id],
                    mapping_view,
                ).map_err(|_| STORAGE_ERROR)
            }
        })
    }

    fn write_mapping(
        &self,
        id: Option<i64>,
        phrase: &str,
        category: Category,
        replacement: &str,
    ) -> PrivacyResult<MappingView> {
        let phrase = validate_phrase(phrase)?;
        let normalized = normalise_phrase(&phrase)?;
        let replacement = validate_replacement(replacement)?;
        let timestamp = now()?;
        self.with_connection(|connection| {
            match id {
                Some(id) => {
                    let changed = connection.execute("UPDATE mappings SET phrase = ?1, normalized_phrase = ?2, category = ?3, replacement = ?4, updated_at = ?5 WHERE id = ?6", params![phrase, normalized, category.label(), replacement, timestamp, id]);
                    if let Err(error) = changed { return Err(if is_unique(&error) { STORAGE_CONFLICT } else { STORAGE_ERROR }); }
                    connection.query_row("SELECT id, phrase, category, replacement, created_at, updated_at FROM mappings WHERE id = ?1", [id], mapping_view).map_err(|_| "This mapping is no longer available.")
                }
                None => {
                    let result = connection.execute("INSERT INTO mappings(phrase, normalized_phrase, category, replacement, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?5)", params![phrase, normalized, category.label(), replacement, timestamp]);
                    if let Err(error) = result { return Err(if is_unique(&error) { STORAGE_CONFLICT } else { STORAGE_ERROR }); }
                    let id = connection.last_insert_rowid();
                    connection.query_row("SELECT id, phrase, category, replacement, created_at, updated_at FROM mappings WHERE id = ?1", [id], mapping_view).map_err(|_| STORAGE_ERROR)
                }
            }
        })
    }

    pub fn delete_mapping(&self, id: i64) -> PrivacyResult<()> {
        self.with_connection(|connection| {
            connection
                .execute("DELETE FROM mappings WHERE id = ?1", [id])
                .map(|_| ())
                .map_err(|_| STORAGE_ERROR)
        })
    }

    pub fn delete_patient_mapping(&self, patient_id: i64, id: i64) -> PrivacyResult<()> {
        self.with_connection(|connection| {
            connection
                .execute(
                    "DELETE FROM patient_mappings WHERE patient_id = ?1 AND id = ?2",
                    params![patient_id, id],
                )
                .map(|_| ())
                .map_err(|_| STORAGE_ERROR)
        })
    }

    pub fn matches(
        &self,
        source: &str,
        patient_id: Option<i64>,
    ) -> PrivacyResult<Vec<LibraryMatch>> {
        let mappings = self.mappings()?;
        let mut matches = Vec::new();
        for mapping in mappings {
            for (start, end) in phrase_matches(source, &mapping.phrase) {
                matches.push(LibraryMatch {
                    start,
                    end,
                    category: mapping.category,
                    replacement: mapping.replacement.clone(),
                });
            }
        }
        if let Some(patient_id) = patient_id {
            let patient_mappings = self.with_connection(|connection| {
                let mut statement = connection.prepare("SELECT id, phrase, category, replacement, created_at, updated_at FROM patient_mappings WHERE patient_id = ?1 ORDER BY normalized_phrase, category").map_err(|_| STORAGE_ERROR)?;
                let rows = statement.query_map([patient_id], mapping_view).map_err(|_| STORAGE_ERROR)?;
                let mappings = rows.map(|row| row.map_err(|_| STORAGE_ERROR)).collect::<PrivacyResult<Vec<_>>>();
                mappings
            })?;
            for mapping in patient_mappings {
                for (start, end) in phrase_matches(source, &mapping.phrase) {
                    matches.push(LibraryMatch {
                        start,
                        end,
                        category: mapping.category,
                        replacement: mapping.replacement.clone(),
                    });
                }
            }
        }
        Ok(matches)
    }
}

fn patient_view(row: &rusqlite::Row<'_>) -> rusqlite::Result<PatientView> {
    Ok(PatientView {
        id: row.get(0)?,
        name: row.get(1)?,
        patient_reference: row.get(2)?,
    })
}

fn note_summary(row: &rusqlite::Row<'_>) -> rusqlite::Result<NoteSummary> {
    Ok(NoteSummary {
        id: row.get(0)?,
        title: row.get(1)?,
        patient_reference: row.get(2)?,
        created_at: row.get(3)?,
        snippet: row.get(4)?,
        patient_name: row.get(5)?,
    })
}
fn note_view(row: &rusqlite::Row<'_>) -> rusqlite::Result<NoteView> {
    Ok(NoteView {
        id: row.get(0)?,
        patient_id: row.get(1)?,
        title: row.get(2)?,
        patient_reference: row.get(3)?,
        source_text: row.get(4)?,
        reviewed_text: row.get(5)?,
        provenance: row.get(6)?,
        created_at: row.get(7)?,
        patient_name: row.get(8)?,
    })
}
fn mapping_view(row: &rusqlite::Row<'_>) -> rusqlite::Result<MappingView> {
    let category: String = row.get(2)?;
    let category = match category.as_str() {
        "PERSON" => Category::Person,
        "LOCATION" => Category::Location,
        "ORGANISATION" => Category::Organisation,
        "MISC" => Category::Misc,
        "EMAIL" => Category::Email,
        "PHONE" => Category::Phone,
        "POSTCODE" => Category::Postcode,
        "NHS_NUMBER" => Category::NhsNumber,
        "NI_NUMBER" => Category::NiNumber,
        "URL" => Category::Url,
        "DATE" => Category::Date,
        "CASE_REFERENCE" => Category::CaseReference,
        "MANUAL" => Category::Manual,
        _ => return Err(rusqlite::Error::InvalidQuery),
    };
    Ok(MappingView {
        id: row.get(0)?,
        phrase: row.get(1)?,
        category,
        replacement: row.get(3)?,
        created_at: row.get(4)?,
        updated_at: row.get(5)?,
    })
}

fn load_or_create_key() -> PrivacyResult<[u8; 32]> {
    if let Ok((password, _)) = find_generic_password(None, KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT) {
        return password.as_ref().try_into().map_err(|_| STORAGE_ERROR);
    }
    let mut key = [0; 32];
    fill(&mut key).map_err(|_| STORAGE_ERROR)?;
    let keychain = SecKeychain::default().map_err(|_| STORAGE_ERROR)?;
    keychain
        .set_generic_password(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT, &key)
        .map_err(|_| STORAGE_ERROR)?;
    Ok(key)
}

fn validate_title(value: &str) -> PrivacyResult<String> {
    normalise_required(
        value,
        160,
        "Enter a note title.",
        "Use at most 160 characters for the note title.",
    )
}
fn validate_phrase(value: &str) -> PrivacyResult<String> {
    normalise_required(
        value,
        160,
        "Enter an identifier.",
        "Use at most 160 characters for an identifier.",
    )
}
fn validate_replacement(value: &str) -> PrivacyResult<String> {
    let value = normalise_required(
        value,
        46,
        "Enter a placeholder such as [CLIENT].",
        "Use at most 46 characters for a placeholder.",
    )?;
    if value.len() < 3
        || !value.starts_with('[')
        || !value.ends_with(']')
        || !value.as_bytes()[1].is_ascii_uppercase()
        || !value[1..value.len() - 1]
            .bytes()
            .all(|byte| byte.is_ascii_uppercase() || byte.is_ascii_digit() || byte == b'_')
    {
        return Err("Use a label such as [PERSON_1]: uppercase letters, digits and underscores in brackets.");
    }
    Ok(value)
}
fn normalise_required(
    value: &str,
    limit: usize,
    blank: &'static str,
    long: &'static str,
) -> PrivacyResult<String> {
    let value = value.trim();
    if value.is_empty() {
        return Err(blank);
    }
    if value.chars().count() > limit {
        return Err(long);
    }
    Ok(value.to_owned())
}
fn normalise_optional(
    value: Option<&str>,
    limit: usize,
    long: &'static str,
) -> PrivacyResult<Option<String>> {
    match value.map(str::trim).filter(|value| !value.is_empty()) {
        Some(value) if value.chars().count() > limit => Err(long),
        Some(value) => Ok(Some(value.to_owned())),
        None => Ok(None),
    }
}
fn normalise_phrase(value: &str) -> PrivacyResult<String> {
    Ok(validate_phrase(value)?
        .chars()
        .flat_map(char::to_lowercase)
        .collect())
}
fn now() -> PrivacyResult<i64> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_secs() as i64)
        .map_err(|_| STORAGE_ERROR)
}
fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}
fn is_unique(error: &rusqlite::Error) -> bool {
    matches!(error, rusqlite::Error::SqliteFailure(code, _) if code.code == ErrorCode::ConstraintViolation)
}
fn is_word(character: char) -> bool {
    character.is_alphanumeric() || character == '_'
}
fn phrase_matches(source: &str, phrase: &str) -> Vec<(usize, usize)> {
    let count = phrase.chars().count();
    if count == 0 {
        return vec![];
    }
    let expected = phrase
        .chars()
        .flat_map(char::to_lowercase)
        .collect::<String>();
    source
        .char_indices()
        .filter_map(|(start, _)| {
            let end = source[start..]
                .char_indices()
                .nth(count)
                .map(|(index, _)| start + index)
                .unwrap_or(source.len());
            let candidate = &source[start..end];
            (candidate.chars().count() == count
                && candidate
                    .chars()
                    .flat_map(char::to_lowercase)
                    .eq(expected.chars())
                && source[..start]
                    .chars()
                    .next_back()
                    .is_none_or(|character| !is_word(character))
                && source[end..]
                    .chars()
                    .next()
                    .is_none_or(|character| !is_word(character)))
            .then_some((start, end))
        })
        .collect()
}
fn fts_query(query: &str) -> Option<String> {
    let trimmed = query.trim();
    if trimmed.is_empty() {
        return None;
    }
    let quoted_phrase = trimmed
        .strip_prefix('"')
        .and_then(|value| value.strip_suffix('"'));
    if let Some(phrase) = quoted_phrase.filter(|value| value.chars().any(char::is_alphanumeric)) {
        return Some(format!("\"{}\"", phrase.replace('"', "")));
    }
    let terms: Vec<_> = trimmed
        .split_whitespace()
        .filter(|term| term.chars().any(char::is_alphanumeric))
        .collect();
    (!terms.is_empty()).then(|| {
        terms
            .into_iter()
            .map(|term| format!("\"{}\"", term.replace('"', "")))
            .collect::<Vec<_>>()
            .join(" AND ")
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn mappings_match_whole_phrases_without_case_sensitivity() {
        let dir = tempfile::tempdir().unwrap();
        let store = Storage::open_for_test(dir.path().join("notes.sqlite"), [7; 32]).unwrap();
        store
            .create_mapping("Alex Morgan", Category::Person, "[CLIENT]")
            .unwrap();
        assert_eq!(
            store
                .matches("ALEX MORGAN met Alex Morganson.", None)
                .unwrap()
                .len(),
            1
        );
    }
    #[test]
    fn deleting_a_note_removes_its_search_match() {
        let dir = tempfile::tempdir().unwrap();
        let store = Storage::open_for_test(dir.path().join("notes.sqlite"), [9; 32]).unwrap();
        let patient = store
            .create_patient("Synthetic Client", Some("SYN-1"))
            .unwrap();
        let note = store
            .save_note(
                patient.id,
                "Synthetic review",
                Some("SYN-1"),
                "Synthetic source text",
                "Synthetic outcome text",
                "[]",
            )
            .unwrap();
        assert_eq!(note.source_text.as_deref(), Some("Synthetic source text"));
        assert_eq!(note.provenance, "[]");
        assert_eq!(store.search_notes("outcome").unwrap().len(), 1);
        store.delete_note(note.id).unwrap();
        assert!(store.search_notes("outcome").unwrap().is_empty());
    }

    #[test]
    fn deleting_a_patient_removes_their_notes_search_entries_and_mappings() {
        let dir = tempfile::tempdir().unwrap();
        let store = Storage::open_for_test(dir.path().join("notes.sqlite"), [12; 32]).unwrap();
        let patient = store
            .create_patient("Synthetic Client", Some("SYN-12"))
            .unwrap();
        store
            .save_note(
                patient.id,
                "Synthetic review",
                Some("SYN-12"),
                "Synthetic source text",
                "Reviewed synthetic outcome",
                "[]",
            )
            .unwrap();
        store
            .create_patient_mapping(patient.id, "Alex Morgan", Category::Person, "[CLIENT]")
            .unwrap();

        store.delete_patient(patient.id).unwrap();

        assert!(store.patients().unwrap().is_empty());
        assert!(store.search_notes("outcome").unwrap().is_empty());
        assert!(store.patient_mappings(patient.id).unwrap().is_empty());
    }

    #[test]
    fn search_includes_title_reference_and_quoted_phrases() {
        let dir = tempfile::tempdir().unwrap();
        let store = Storage::open_for_test(dir.path().join("notes.sqlite"), [3; 32]).unwrap();
        let patient = store
            .create_patient("Synthetic Client", Some("SYN-2048"))
            .unwrap();
        store
            .save_note(
                patient.id,
                "Synthetic review",
                Some("SYN-2048"),
                "Synthetic source text",
                "Reviewed synthetic clinical outcome",
                "[]",
            )
            .unwrap();
        assert_eq!(store.search_notes("review").unwrap().len(), 1);
        assert_eq!(store.search_notes("SYN-2048").unwrap().len(), 1);
        assert_eq!(store.search_notes("\"clinical outcome\"").unwrap().len(), 1);
    }

    #[test]
    fn patient_mapping_overrides_a_global_mapping_for_that_patient() {
        let dir = tempfile::tempdir().unwrap();
        let store = Storage::open_for_test(dir.path().join("notes.sqlite"), [5; 32]).unwrap();
        let patient = store.create_patient("Synthetic Client", None).unwrap();
        store
            .create_mapping("Alex Morgan", Category::Person, "[PERSON]")
            .unwrap();
        store
            .upsert_patient_mapping(patient.id, "Alex Morgan", Category::Person, "[CLIENT]")
            .unwrap();
        let matches = store.matches("Alex Morgan", Some(patient.id)).unwrap();
        assert_eq!(matches.last().unwrap().replacement, "[CLIENT]");
    }

    #[test]
    fn patient_mapping_can_be_edited_and_deleted_from_its_library() {
        let dir = tempfile::tempdir().unwrap();
        let store = Storage::open_for_test(dir.path().join("notes.sqlite"), [6; 32]).unwrap();
        let patient = store.create_patient("Synthetic Client", None).unwrap();
        let mapping = store
            .create_patient_mapping(patient.id, "Alex Morgan", Category::Person, "[CLIENT]")
            .unwrap();
        let edited = store
            .update_patient_mapping(
                patient.id,
                mapping.id,
                "Alex Morgan",
                Category::Person,
                "[PATIENT]",
            )
            .unwrap();
        assert_eq!(edited.replacement, "[PATIENT]");
        store
            .delete_patient_mapping(patient.id, mapping.id)
            .unwrap();
        assert!(store.patient_mappings(patient.id).unwrap().is_empty());
    }
}
