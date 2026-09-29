use clinicians_veil_core::documents::{DocumentFormat, DocumentMetadata, OriginalDocument};
mod usage;

use clinicians_veil_core::document_usage::{document_model, UsageSummary, DEFAULT_DOCUMENT_MODEL};
use clinicians_veil_core::{
    document_generation::{
        ClinicianProfile, DocumentBody, DocumentTemplate, PatientDocument, PreparedSubmission,
        SubmissionNote,
    },
    privacy::{Category, PrivacyResult},
};
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
const OPENAI_KEYCHAIN_ACCOUNT: &str = "openai-api-key";
const STORAGE_ERROR: &str =
    "The encrypted note library is unavailable. Reopen the app and try again.";
const STORAGE_CONFLICT: &str = "A redaction with that phrase and category already exists.";
const PATIENT_CONFLICT: &str = "A patient with that name already exists.";
const PATIENT_UNAVAILABLE: &str = "This patient is no longer available.";
const REDACTION_UNAVAILABLE: &str = "This redaction is no longer available.";
const TEMPLATE_UNAVAILABLE: &str = "This document prompt template is no longer available.";
const DOCUMENT_UNAVAILABLE: &str = "This document is no longer available.";

#[derive(Clone)]
pub struct Storage {
    path: PathBuf,
    key: Arc<[u8; 32]>,
    gate: Arc<Mutex<()>>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteSummary {
    pub document: Option<DocumentMetadata>,
    pub id: i64,
    pub patient_id: Option<i64>,
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
    pub note_count: i64,
    pub redaction_count: i64,
    pub document_count: i64,
}

/// Patient columns in the order `patient_view` reads them. The counts drive the
/// patient table and the patient workspace tab labels.
const PATIENT_COLUMNS: &str = "patients.id, patients.name, patients.patient_reference,
    (SELECT COUNT(*) FROM notes WHERE notes.patient_id = patients.id),
    (SELECT COUNT(*) FROM patient_mappings WHERE patient_mappings.patient_id = patients.id),
    (SELECT COUNT(*) FROM patient_documents WHERE patient_documents.patient_id = patients.id)";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteView {
    pub document: Option<DocumentMetadata>,
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
pub struct DocumentSummary {
    pub usage: UsageSummary,
    pub id: i64,
    pub patient_id: i64,
    pub title: String,
    pub template_name: String,
    pub revision: i64,
    pub reviewed: bool,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClinicianProfileView {
    pub display_name: String,
    pub role: String,
    pub qualifications: String,
    pub has_signature: bool,
    pub signature_png: Option<String>,
    pub openai_model: String,
    pub clinical_sending_enabled: bool,
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
               revision INTEGER NOT NULL DEFAULT 1,
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
             CREATE TABLE IF NOT EXISTS document_templates (
               id INTEGER PRIMARY KEY,
               version INTEGER NOT NULL,
               name TEXT NOT NULL,
               description TEXT NOT NULL,
               instructions TEXT NOT NULL,
               archived INTEGER NOT NULL DEFAULT 0,
               created_at INTEGER NOT NULL,
               updated_at INTEGER NOT NULL
             );
             CREATE TABLE IF NOT EXISTS clinician_profile (
               singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
               display_name TEXT NOT NULL DEFAULT '',
               role TEXT NOT NULL DEFAULT '',
               qualifications TEXT NOT NULL DEFAULT '',
               signature BLOB,
               openai_model TEXT NOT NULL DEFAULT '',
               clinical_sending_enabled INTEGER NOT NULL DEFAULT 0
             );
             CREATE TABLE IF NOT EXISTS patient_documents (
               id INTEGER PRIMARY KEY,
               patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
               title TEXT NOT NULL,
               template_id INTEGER NOT NULL,
               template_name TEXT NOT NULL,
               template_version INTEGER NOT NULL,
               body TEXT NOT NULL,
               revision INTEGER NOT NULL,
               reviewed INTEGER NOT NULL,
               include_signature INTEGER NOT NULL,
               clinician_snapshot TEXT,
               signature_snapshot BLOB,
               created_at INTEGER NOT NULL,
               updated_at INTEGER NOT NULL
             );
             CREATE TABLE IF NOT EXISTS document_sources (
               document_id INTEGER NOT NULL REFERENCES patient_documents(id) ON DELETE CASCADE,
               note_id INTEGER REFERENCES notes(id) ON DELETE SET NULL,
               note_created_at INTEGER NOT NULL,
               deleted_warning INTEGER NOT NULL DEFAULT 0,
               PRIMARY KEY(document_id, note_id)
             );
             CREATE TABLE IF NOT EXISTS prepared_submissions (
               id TEXT PRIMARY KEY,
               document_id INTEGER REFERENCES patient_documents(id) ON DELETE CASCADE,
               template_id INTEGER NOT NULL,
               template_version INTEGER NOT NULL,
               model TEXT NOT NULL,
               destination TEXT NOT NULL,
               purpose TEXT NOT NULL,
               instructions TEXT NOT NULL,
               input TEXT NOT NULL,
               payload_digest TEXT NOT NULL,
               restoration_json TEXT NOT NULL,
               created_at INTEGER NOT NULL,
               consumed_at INTEGER
             );
             CREATE TABLE IF NOT EXISTS submission_outcomes (
               id INTEGER PRIMARY KEY,
               preparation_id TEXT NOT NULL REFERENCES prepared_submissions(id) ON DELETE CASCADE,
               attempted_at INTEGER NOT NULL,
               destination TEXT NOT NULL,
               purpose TEXT NOT NULL,
               payload_digest TEXT NOT NULL,
               outcome TEXT NOT NULL
             );
             CREATE TRIGGER IF NOT EXISTS detach_deleted_note_documents
             BEFORE DELETE ON notes BEGIN
               UPDATE document_sources SET deleted_warning = 1 WHERE note_id = OLD.id;
               DELETE FROM prepared_submissions
                 WHERE document_id IN (SELECT document_id FROM document_sources WHERE note_id = OLD.id);
             END;
             INSERT OR IGNORE INTO clinician_profile(singleton) VALUES (1);
             INSERT OR IGNORE INTO schema_migrations(version) VALUES (1);"
        ).map_err(|_| STORAGE_ERROR)?;
        seed_templates(&mut connection)?;
        usage::migrate(&mut connection)?;
        connection
            .execute(
                "UPDATE clinician_profile SET openai_model = ?1 WHERE openai_model = ''",
                [DEFAULT_DOCUMENT_MODEL],
            )
            .map_err(|_| STORAGE_ERROR)?;
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
        // Additive, transactional migration. The primary key enforces one original per note.
        let transaction = connection.transaction().map_err(|_| STORAGE_ERROR)?;
        let migrated: bool = transaction
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version = 2)",
                [],
                |row| row.get(0),
            )
            .map_err(|_| STORAGE_ERROR)?;
        if !migrated {
            transaction.execute_batch("CREATE TABLE note_documents (
            note_id INTEGER PRIMARY KEY REFERENCES notes(id) ON DELETE CASCADE,
            name TEXT NOT NULL,
            format TEXT NOT NULL CHECK(format IN ('txt', 'docx', 'pdf')),
            byte_length INTEGER NOT NULL CHECK(byte_length = length(bytes) AND byte_length <= 26214400),
            bytes BLOB NOT NULL
        ); INSERT INTO schema_migrations(version) VALUES (2);").map_err(|_| STORAGE_ERROR)?;
        }
        // A recorded migration with missing columns/table is corruption, not an empty library.
        transaction
            .prepare("SELECT note_id, name, format, byte_length, bytes FROM note_documents LIMIT 0")
            .map_err(|_| STORAGE_ERROR)?;
        transaction.commit().map_err(|_| STORAGE_ERROR)?;
        let has_revision = connection
            .prepare("PRAGMA table_info(notes)")
            .map_err(|_| STORAGE_ERROR)?
            .query_map([], |row| row.get::<_, String>(1))
            .map_err(|_| STORAGE_ERROR)?
            .filter_map(Result::ok)
            .any(|name| name == "revision");
        if !has_revision {
            connection
                .execute(
                    "ALTER TABLE notes ADD COLUMN revision INTEGER NOT NULL DEFAULT 1",
                    [],
                )
                .map_err(|_| STORAGE_ERROR)?;
        }
        task(&mut connection)
    }

    #[cfg(test)]
    pub fn save_note(
        &self,
        patient_id: i64,
        title: &str,
        patient_reference: Option<&str>,
        source_text: &str,
        reviewed_text: &str,
        provenance: &str,
    ) -> PrivacyResult<NoteView> {
        self.save_note_with_document(
            patient_id,
            title,
            patient_reference,
            source_text,
            reviewed_text,
            provenance,
            None,
        )
    }

    pub fn save_note_with_document(
        &self,
        patient_id: i64,
        title: &str,
        patient_reference: Option<&str>,
        source_text: &str,
        reviewed_text: &str,
        provenance: &str,
        document: Option<&OriginalDocument>,
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
            if let Some(document) = document {
                transaction.execute("INSERT INTO note_documents(note_id, name, format, byte_length, bytes) VALUES (?1, ?2, ?3, ?4, ?5)",
                    params![id, document.metadata.name, document.metadata.format.extension(), document.metadata.byte_length as i64, document.bytes]).map_err(|_| STORAGE_ERROR)?;
            }
            transaction.commit().map_err(|_| STORAGE_ERROR)?;
            Ok(NoteView {
                document: document.map(|d| d.metadata.clone()), id, patient_id: Some(patient_id), title: title.to_owned(), patient_name: Some(patient_name), patient_reference, source_text: Some(source_text.to_owned()), reviewed_text: reviewed_text.to_owned(), provenance: provenance.to_owned(), created_at })
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
                    "UPDATE notes SET patient_id = ?1, title = ?2, patient_reference = ?3, source_text = ?4, reviewed_text = ?5, provenance = ?6, revision = revision + 1 WHERE id = ?7",
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
                document: document_metadata(connection, id)?,
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

    /// Searches reviewed notes, optionally within one patient. The patient
    /// reference comes from the patient record so an edited patient number is
    /// shown on every note.
    pub fn search_notes(
        &self,
        query: &str,
        patient_id: Option<i64>,
    ) -> PrivacyResult<Vec<NoteSummary>> {
        self.with_connection(|connection| {
            let mut results = Vec::new();
            if let Some(search) = fts_query(query) {
                let mut statement = connection.prepare(
                    "SELECT notes.id, notes.title, COALESCE(patients.patient_reference, notes.patient_reference), notes.created_at,
                       snippet(note_search, 2, '', '', '…', 12), patients.name, notes.patient_id, note_documents.name, note_documents.format, note_documents.byte_length
                     FROM note_search JOIN notes ON notes.id = note_search.rowid
                     LEFT JOIN patients ON patients.id = notes.patient_id
                     LEFT JOIN note_documents ON note_documents.note_id = notes.id
                     WHERE note_search MATCH ?1 AND (?2 IS NULL OR notes.patient_id = ?2)
                     ORDER BY bm25(note_search), notes.id DESC"
                ).map_err(|_| STORAGE_ERROR)?;
                let rows = statement.query_map(params![search, patient_id], note_summary).map_err(|_| STORAGE_ERROR)?;
                for row in rows { results.push(row.map_err(|_| STORAGE_ERROR)?); }
            } else {
                let mut statement = connection.prepare(
                    "SELECT notes.id, notes.title, COALESCE(patients.patient_reference, notes.patient_reference), notes.created_at,
                       substr(notes.reviewed_text, 1, 180), patients.name, notes.patient_id, note_documents.name, note_documents.format, note_documents.byte_length
                     FROM notes LEFT JOIN patients ON patients.id = notes.patient_id
                     LEFT JOIN note_documents ON note_documents.note_id = notes.id
                     WHERE ?1 IS NULL OR notes.patient_id = ?1
                     ORDER BY notes.id DESC"
                ).map_err(|_| STORAGE_ERROR)?;
                let rows = statement.query_map(params![patient_id], note_summary).map_err(|_| STORAGE_ERROR)?;
                for row in rows { results.push(row.map_err(|_| STORAGE_ERROR)?); }
            }
            Ok(results)
        })
    }

    pub fn note(&self, id: i64) -> PrivacyResult<NoteView> {
        self.with_connection(|connection| connection.query_row(
            "SELECT notes.id, notes.patient_id, notes.title, notes.patient_reference, notes.source_text, notes.reviewed_text, notes.provenance, notes.created_at, patients.name, note_documents.name, note_documents.format, note_documents.byte_length FROM notes LEFT JOIN patients ON patients.id = notes.patient_id LEFT JOIN note_documents ON note_documents.note_id = notes.id WHERE notes.id = ?1", [id], note_view
        ).optional().map_err(|_| STORAGE_ERROR)?.ok_or("This note is no longer available."))
    }

    pub fn document(&self, id: i64) -> PrivacyResult<OriginalDocument> {
        self.with_connection(|connection| {
            let metadata =
                document_metadata(connection, id)?.ok_or("This note has no original document.")?;
            let bytes = connection
                .query_row(
                    "SELECT bytes FROM note_documents WHERE note_id = ?1",
                    [id],
                    |row| row.get(0),
                )
                .map_err(|_| STORAGE_ERROR)?;
            Ok(OriginalDocument { metadata, bytes })
        })
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
                .prepare(&format!(
                    "SELECT {PATIENT_COLUMNS} FROM patients ORDER BY normalized_name"
                ))
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
        let (name, reference) = patient_fields(name, patient_reference)?;
        let timestamp = now()?;
        self.with_connection(|connection| {
            connection.execute("INSERT INTO patients(name, normalized_name, patient_reference, created_at) VALUES (?1, ?2, ?3, ?4)", params![name, lowercase(&name), reference, timestamp]).map_err(|error| if is_unique(&error) { PATIENT_CONFLICT } else { STORAGE_ERROR })?;
            select_patient(connection, connection.last_insert_rowid())
        })
    }

    /// Renames a patient or changes their patient number. Notes, search entries
    /// and redactions stay attached through the patient ID.
    pub fn update_patient(
        &self,
        id: i64,
        name: &str,
        patient_reference: Option<&str>,
    ) -> PrivacyResult<PatientView> {
        let (name, reference) = patient_fields(name, patient_reference)?;
        self.with_connection(|connection| {
            let changed = connection
                .execute(
                    "UPDATE patients SET name = ?1, normalized_name = ?2, patient_reference = ?3 WHERE id = ?4",
                    params![name, lowercase(&name), reference, id],
                )
                .map_err(|error| if is_unique(&error) { PATIENT_CONFLICT } else { STORAGE_ERROR })?;
            if changed == 0 {
                return Err(PATIENT_UNAVAILABLE);
            }
            select_patient(connection, id)
        })
    }

    pub fn patient(&self, id: i64) -> PrivacyResult<PatientView> {
        self.with_connection(|connection| select_patient(connection, id))
    }

    pub fn templates(&self, include_archived: bool) -> PrivacyResult<Vec<DocumentTemplate>> {
        self.with_connection(|connection| {
            let mut statement = connection
                .prepare(
                    "SELECT id, version, name, description, instructions, archived, created_at, updated_at
                     FROM document_templates WHERE ?1 OR archived = 0 ORDER BY archived, name COLLATE NOCASE",
                )
                .map_err(|_| STORAGE_ERROR)?;
            let rows = statement
                .query_map([include_archived], template_view)
                .map_err(|_| STORAGE_ERROR)?;
            rows.map(|row| row.map_err(|_| STORAGE_ERROR)).collect()
        })
    }

    pub fn template(&self, id: i64) -> PrivacyResult<DocumentTemplate> {
        self.with_connection(|connection| {
            connection
                .query_row(
                    "SELECT id, version, name, description, instructions, archived, created_at, updated_at
                     FROM document_templates WHERE id = ?1",
                    [id],
                    template_view,
                )
                .optional()
                .map_err(|_| STORAGE_ERROR)?
                .ok_or(TEMPLATE_UNAVAILABLE)
        })
    }

    pub fn create_template(
        &self,
        name: &str,
        description: &str,
        instructions: &str,
    ) -> PrivacyResult<DocumentTemplate> {
        let (name, description, instructions) = template_fields(name, description, instructions)?;
        let timestamp = now()?;
        self.with_connection(|connection| {
            connection
                .execute(
                    "INSERT INTO document_templates(version, name, description, instructions, archived, created_at, updated_at)
                     VALUES (1, ?1, ?2, ?3, 0, ?4, ?4)",
                    params![name, description, instructions, timestamp],
                )
                .map_err(|_| STORAGE_ERROR)?;
            select_template(connection, connection.last_insert_rowid())
        })
    }

    pub fn update_template(
        &self,
        id: i64,
        name: &str,
        description: &str,
        instructions: &str,
    ) -> PrivacyResult<DocumentTemplate> {
        let (name, description, instructions) = template_fields(name, description, instructions)?;
        let timestamp = now()?;
        self.with_connection(|connection| {
            let changed = connection
                .execute(
                    "UPDATE document_templates SET version = version + 1, name = ?1, description = ?2,
                     instructions = ?3, updated_at = ?4 WHERE id = ?5",
                    params![name, description, instructions, timestamp, id],
                )
                .map_err(|_| STORAGE_ERROR)?;
            if changed == 0 {
                return Err(TEMPLATE_UNAVAILABLE);
            }
            select_template(connection, id)
        })
    }

    pub fn duplicate_template(&self, id: i64) -> PrivacyResult<DocumentTemplate> {
        let source = self.template(id)?;
        self.create_template(
            &format!("{} copy", source.name),
            &source.description,
            &source.instructions,
        )
    }

    pub fn set_template_archived(
        &self,
        id: i64,
        archived: bool,
    ) -> PrivacyResult<DocumentTemplate> {
        let timestamp = now()?;
        self.with_connection(|connection| {
            let changed = connection
                .execute(
                    "UPDATE document_templates SET archived = ?1, updated_at = ?2 WHERE id = ?3",
                    params![archived, timestamp, id],
                )
                .map_err(|_| STORAGE_ERROR)?;
            if changed == 0 {
                return Err(TEMPLATE_UNAVAILABLE);
            }
            select_template(connection, id)
        })
    }

    pub fn clinician_profile(&self) -> PrivacyResult<ClinicianProfileView> {
        self.with_connection(|connection| {
            connection
                .query_row(
                    "SELECT display_name, role, qualifications, signature,
                            openai_model, clinical_sending_enabled
                     FROM clinician_profile WHERE singleton = 1",
                    [],
                    |row| {
                        Ok(ClinicianProfileView {
                            display_name: row.get(0)?,
                            role: row.get(1)?,
                            qualifications: row.get(2)?,
                            has_signature: row.get::<_, Option<Vec<u8>>>(3)?.is_some(),
                            signature_png: row.get::<_, Option<Vec<u8>>>(3)?.map(|bytes| {
                                use base64::Engine;
                                base64::engine::general_purpose::STANDARD.encode(bytes)
                            }),
                            openai_model: row.get(4)?,
                            clinical_sending_enabled: row.get(5)?,
                        })
                    },
                )
                .map_err(|_| STORAGE_ERROR)
        })
    }

    pub fn save_clinician_profile(
        &self,
        display_name: &str,
        role: &str,
        qualifications: &str,
        signature: Option<&[u8]>,
        remove_signature: bool,
        openai_model: &str,
    ) -> PrivacyResult<ClinicianProfileView> {
        let display_name = normalise_limited(
            display_name,
            120,
            "Use at most 120 characters for the display name.",
        )?;
        let role = normalise_limited(role, 120, "Use at most 120 characters for the role.")?;
        let qualifications = normalise_limited(
            qualifications,
            240,
            "Use at most 240 characters for qualifications.",
        )?;
        let openai_model = normalise_limited(
            openai_model,
            120,
            "Use at most 120 characters for the model.",
        )?;
        document_model(&openai_model)?;
        if remove_signature && signature.is_some() {
            return Err("Choose whether to replace or remove the signature.");
        }
        if let Some(bytes) = signature {
            validate_signature(bytes)?;
        }
        self.with_connection(|connection| {
            connection
                .execute(
                    "UPDATE clinician_profile SET display_name = ?1, role = ?2, qualifications = ?3,
                     signature = CASE WHEN ?4 THEN NULL WHEN ?5 IS NOT NULL THEN ?5 ELSE signature END,
                     openai_model = ?6 WHERE singleton = 1",
                    params![display_name, role, qualifications, remove_signature, signature, openai_model],
                )
                .map_err(|_| STORAGE_ERROR)?;
            Ok(())
        })?;
        self.clinician_profile()
    }

    pub fn documents(&self, patient_id: i64) -> PrivacyResult<Vec<DocumentSummary>> {
        self.with_connection(|connection| {
            let mut statement = connection
                .prepare(
                    "SELECT id, patient_id, title, template_name, revision, reviewed, created_at, updated_at
                     FROM patient_documents WHERE patient_id = ?1 ORDER BY updated_at DESC, id DESC",
                )
                .map_err(|_| STORAGE_ERROR)?;
            let rows = statement
                .query_map([patient_id], document_summary)
                .map_err(|_| STORAGE_ERROR)?;
            let mut documents: Vec<DocumentSummary> = rows.map(|row| row.map_err(|_| STORAGE_ERROR)).collect::<PrivacyResult<_>>()?;
            for document in &mut documents {
                document.usage = usage::summary(connection, None, None, Some(document.id))?;
            }
            Ok(documents)
        })
    }

    pub fn patient_document(&self, id: i64) -> PrivacyResult<PatientDocument> {
        self.with_connection(|connection| select_document(connection, id))
    }

    pub fn save_document(
        &self,
        id: Option<i64>,
        patient_id: i64,
        title: &str,
        template_id: i64,
        body: &DocumentBody,
        reviewed: bool,
        include_signature: bool,
        source_note_ids: &[i64],
    ) -> PrivacyResult<PatientDocument> {
        let title = normalise_required(
            title,
            160,
            "Enter a document title.",
            "Use at most 160 characters for the document title.",
        )?;
        body.validate()?;
        if reviewed && body.plain_text().contains("⟪CV_") {
            return Err(
                "Resolve or remove every unknown placeholder before marking the document reviewed.",
            );
        }
        let template = self.template(template_id)?;
        let timestamp = now()?;
        let body_json = serde_json::to_string(body).map_err(|_| STORAGE_ERROR)?;
        self.with_connection(|connection| {
            let transaction = connection.transaction().map_err(|_| STORAGE_ERROR)?;
            let profile: (String, String, String, Option<Vec<u8>>) = transaction
                .query_row(
                    "SELECT display_name, role, qualifications, signature FROM clinician_profile WHERE singleton = 1",
                    [],
                    |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
                )
                .map_err(|_| STORAGE_ERROR)?;
            let clinician = ClinicianProfile {
                display_name: profile.0,
                role: profile.1,
                qualifications: profile.2,
                has_signature: profile.3.is_some(),
            };
            let clinician_json = serde_json::to_string(&clinician).map_err(|_| STORAGE_ERROR)?;
            let document_id = if let Some(id) = id {
                let changed = transaction
                    .execute(
                        "UPDATE patient_documents SET title = ?1, body = ?2, revision = revision + 1,
                         reviewed = ?3, include_signature = ?4,
                         clinician_snapshot = CASE WHEN ?3 THEN ?5 ELSE clinician_snapshot END,
                         signature_snapshot = CASE WHEN ?3 AND ?4 THEN ?6 WHEN ?3 THEN NULL ELSE signature_snapshot END,
                         updated_at = ?7 WHERE id = ?8 AND patient_id = ?9",
                        params![title, body_json, reviewed, include_signature, clinician_json, profile.3, timestamp, id, patient_id],
                    )
                    .map_err(|_| STORAGE_ERROR)?;
                if changed == 0 {
                    return Err(DOCUMENT_UNAVAILABLE);
                }
                id
            } else {
                transaction
                    .execute(
                        "INSERT INTO patient_documents(patient_id, title, template_id, template_name, template_version,
                         body, revision, reviewed, include_signature, clinician_snapshot, signature_snapshot, created_at, updated_at)
                         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1, ?7, ?8, ?9, ?10, ?11, ?11)",
                        params![patient_id, title, template.id, template.name, template.version, body_json, reviewed,
                                include_signature, reviewed.then_some(clinician_json),
                                (reviewed && include_signature).then_some(profile.3).flatten(), timestamp],
                    )
                    .map_err(|_| STORAGE_ERROR)?;
                transaction.last_insert_rowid()
            };
            transaction
                .execute("DELETE FROM document_sources WHERE document_id = ?1", [document_id])
                .map_err(|_| STORAGE_ERROR)?;
            for note_id in source_note_ids {
                let note_created_at: i64 = transaction
                    .query_row(
                        "SELECT created_at FROM notes WHERE id = ?1 AND patient_id = ?2",
                        params![note_id, patient_id],
                        |row| row.get(0),
                    )
                    .optional()
                    .map_err(|_| STORAGE_ERROR)?
                    .ok_or("Select only completed notes belonging to this patient.")?;
                transaction
                    .execute(
                        "INSERT INTO document_sources(document_id, note_id, note_created_at) VALUES (?1, ?2, ?3)",
                        params![document_id, note_id, note_created_at],
                    )
                    .map_err(|_| STORAGE_ERROR)?;
            }
            let document = select_document(&transaction, document_id)?;
            transaction.commit().map_err(|_| STORAGE_ERROR)?;
            Ok(document)
        })
    }

    pub fn delete_document(&self, id: i64) -> PrivacyResult<()> {
        self.with_connection(|connection| {
            let deleted = connection
                .execute("DELETE FROM patient_documents WHERE id = ?1", [id])
                .map_err(|_| STORAGE_ERROR)?;
            if deleted == 0 {
                return Err(DOCUMENT_UNAVAILABLE);
            }
            Ok(())
        })
    }

    /// Builds and persists the exact reviewed payload only after the
    /// governance-backed sending gate passes. The frontend supplies IDs, never
    /// clinical text or provider request fields.
    pub fn prepare_document_submission(
        &self,
        patient_id: i64,
        template_id: i64,
        note_ids: &[i64],
        model: &str,
        title: &str,
        document_id: Option<i64>,
    ) -> PrivacyResult<PreparedSubmission> {
        let profile = self.clinician_profile()?;
        if !profile.clinical_sending_enabled {
            return Err("Clinical sending is not enabled. Complete the information-governance setup requirements first.");
        }
        if !openai_key_configured() {
            return Err("Configure the OpenAI API key in Settings first.");
        }
        document_model(model)?;
        let template = self.template(template_id)?;
        let owned_notes = self.with_connection(|connection| {
            let mut notes = Vec::with_capacity(note_ids.len());
            for id in note_ids {
                let note = connection
                    .query_row(
                        "SELECT id, revision, reviewed_text, provenance, created_at FROM notes WHERE id = ?1 AND patient_id = ?2",
                        params![id, patient_id],
                        |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?, row.get::<_, String>(2)?, row.get::<_, String>(3)?, row.get::<_, i64>(4)?)),
                    )
                    .optional()
                    .map_err(|_| STORAGE_ERROR)?
                    .ok_or("Select only completed notes belonging to this patient.")?;
                notes.push(note);
            }
            notes.sort_by_key(|note| (note.4, note.0));
            notes.dedup_by_key(|note| note.0);
            Ok(notes)
        })?;
        let notes = owned_notes
            .iter()
            .map(|note| SubmissionNote {
                id: note.0,
                revision: note.1,
                reviewed_text: &note.2,
                provenance: &note.3,
            })
            .collect::<Vec<_>>();
        let mut nonce = [0_u8; 16];
        fill(&mut nonce).map_err(|_| STORAGE_ERROR)?;
        let prepared = clinicians_veil_core::document_generation::prepare_submission(
            &hex(&nonce),
            &template,
            model,
            &notes,
        )?;
        let document_id = if let Some(id) = document_id {
            let document = self.patient_document(id)?;
            if document.patient_id != patient_id {
                return Err(DOCUMENT_UNAVAILABLE);
            }
            id
        } else {
            self.save_document(
                None,
                patient_id,
                title,
                template_id,
                &DocumentBody::from_plain_text(""),
                false,
                false,
                note_ids,
            )?
            .id
        };
        let encoded = serde_json::to_string(&prepared).map_err(|_| STORAGE_ERROR)?;
        let created_at = now()?;
        self.with_connection(|connection| {
            connection
                .execute(
                    "INSERT INTO prepared_submissions(id, document_id, template_id, template_version, model,
                     destination, purpose, instructions, input, payload_digest, restoration_json, created_at)
                     VALUES (?1, ?12, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
                    params![prepared.id, prepared.template_id, prepared.template_version, prepared.model,
                            prepared.destination, prepared.purpose, prepared.instructions, prepared.input,
                            prepared.payload_digest, encoded, created_at, document_id],
                )
                .map_err(|_| STORAGE_ERROR)?;
            Ok(())
        })?;
        Ok(prepared)
    }

    pub fn prepared_document_id(&self, preparation_id: &str) -> PrivacyResult<i64> {
        self.with_connection(|connection| {
            connection
                .query_row(
                    "SELECT document_id FROM prepared_submissions WHERE id = ?1",
                    [preparation_id],
                    |row| row.get(0),
                )
                .map_err(|_| STORAGE_ERROR)
        })
    }

    pub fn consume_prepared_submission(&self, id: &str) -> PrivacyResult<PreparedSubmission> {
        self.with_connection(|connection| {
            let transaction = connection.transaction().map_err(|_| STORAGE_ERROR)?;
            let encoded: String = transaction
                .query_row(
                    "SELECT restoration_json FROM prepared_submissions WHERE id = ?1 AND consumed_at IS NULL",
                    [id],
                    |row| row.get(0),
                )
                .optional()
                .map_err(|_| STORAGE_ERROR)?
                .ok_or("Review and prepare this submission again.")?;
            let prepared: PreparedSubmission = serde_json::from_str(&encoded).map_err(|_| STORAGE_ERROR)?;
            let enabled: bool = transaction
                .query_row(
                    "SELECT clinical_sending_enabled FROM clinician_profile WHERE singleton = 1",
                    [],
                    |row| row.get(0),
                )
                .map_err(|_| STORAGE_ERROR)?;
            document_model(&prepared.model)?;
            if !enabled {
                return Err("The sending configuration changed. Review and prepare this submission again.");
            }
            let version: Option<i64> = transaction
                .query_row("SELECT version FROM document_templates WHERE id = ?1 AND archived = 0", [prepared.template_id], |row| row.get(0))
                .optional()
                .map_err(|_| STORAGE_ERROR)?;
            if version != Some(prepared.template_version) {
                return Err("The document prompt template changed. Review and prepare this submission again.");
            }
            for (note_id, revision) in &prepared.source_revisions {
                let current: Option<i64> = transaction
                    .query_row("SELECT revision FROM notes WHERE id = ?1", [note_id], |row| row.get(0))
                    .optional()
                    .map_err(|_| STORAGE_ERROR)?;
                if current != Some(*revision) {
                    return Err("A selected note changed. Review and prepare this submission again.");
                }
            }
            let consumed_at = now()?;
            transaction
                .execute(
                    "UPDATE prepared_submissions SET consumed_at = ?1 WHERE id = ?2 AND consumed_at IS NULL",
                    params![consumed_at, id],
                )
                .map_err(|_| STORAGE_ERROR)?;
            usage::begin_attempt(&transaction, &prepared)?;
            transaction.commit().map_err(|_| STORAGE_ERROR)?;
            Ok(prepared)
        })
    }

    pub fn record_submission_outcome(
        &self,
        prepared: &PreparedSubmission,
        outcome: &str,
    ) -> PrivacyResult<()> {
        let attempted_at = now()?;
        self.with_connection(|connection| {
            connection
                .execute(
                    "INSERT INTO submission_outcomes(preparation_id, attempted_at, destination, purpose, payload_digest, outcome)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                    params![prepared.id, attempted_at, prepared.destination, prepared.purpose, prepared.payload_digest, outcome],
                )
                .map_err(|_| STORAGE_ERROR)?;
            Ok(())
        })
    }

    /// Changes only what an all-patients redaction is replaced with. Its phrase
    /// and category decide what it matches, so they stay fixed; redactions are
    /// created during review and are not deleted from the library.
    pub fn update_mapping_replacement(
        &self,
        id: i64,
        replacement: &str,
    ) -> PrivacyResult<MappingView> {
        let replacement = validate_replacement(replacement)?;
        let timestamp = now()?;
        self.with_connection(|connection| {
            let changed = connection
                .execute(
                    "UPDATE mappings SET replacement = ?1, updated_at = ?2 WHERE id = ?3",
                    params![replacement, timestamp, id],
                )
                .map_err(|_| STORAGE_ERROR)?;
            if changed == 0 {
                return Err(REDACTION_UNAVAILABLE);
            }
            connection
                .query_row(
                    "SELECT id, phrase, category, replacement, created_at, updated_at FROM mappings WHERE id = ?1",
                    [id],
                    mapping_view,
                )
                .map_err(|_| STORAGE_ERROR)
        })
    }

    /// Changes only what one patient's redaction is replaced with.
    pub fn update_patient_mapping_replacement(
        &self,
        patient_id: i64,
        id: i64,
        replacement: &str,
    ) -> PrivacyResult<MappingView> {
        let replacement = validate_replacement(replacement)?;
        let timestamp = now()?;
        self.with_connection(|connection| {
            let changed = connection
                .execute(
                    "UPDATE patient_mappings SET replacement = ?1, updated_at = ?2 WHERE id = ?3 AND patient_id = ?4",
                    params![replacement, timestamp, id, patient_id],
                )
                .map_err(|_| STORAGE_ERROR)?;
            if changed == 0 {
                return Err(REDACTION_UNAVAILABLE);
            }
            connection
                .query_row(
                    "SELECT id, phrase, category, replacement, created_at, updated_at FROM patient_mappings WHERE id = ?1",
                    [id],
                    mapping_view,
                )
                .map_err(|_| STORAGE_ERROR)
        })
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
        note_count: row.get(3)?,
        redaction_count: row.get(4)?,
        document_count: row.get(5)?,
    })
}

fn seed_templates(connection: &mut Connection) -> PrivacyResult<()> {
    let existing: i64 = connection
        .query_row("SELECT COUNT(*) FROM document_templates", [], |row| {
            row.get(0)
        })
        .map_err(|_| STORAGE_ERROR)?;
    if existing != 0 {
        return Ok(());
    }
    let timestamp = now()?;
    let starters = [
        (
            "GP letter",
            "Summarise care for the GP",
            "Write a letter using only the supplied notes. Include presentation, relevant history, progress, and next steps. Use professional British English. Do not invent missing details.",
        ),
        (
            "Referral letter",
            "Present the reason for referral",
            "Write a referral letter using only the supplied notes. Explain the reason for referral, relevant history, current presentation, and requested next steps. Use professional British English. Do not invent missing details.",
        ),
        (
            "Progress report",
            "Summarise progress and next steps",
            "Write a progress report using only the supplied notes. Summarise presentation, work completed, progress, remaining needs, and next steps. Use professional British English. Do not invent missing details.",
        ),
    ];
    for (name, description, instructions) in starters {
        connection
            .execute(
                "INSERT INTO document_templates(version, name, description, instructions, archived, created_at, updated_at)
                 VALUES (1, ?1, ?2, ?3, 0, ?4, ?4)",
                params![name, description, instructions, timestamp],
            )
            .map_err(|_| STORAGE_ERROR)?;
    }
    Ok(())
}

fn template_view(row: &rusqlite::Row<'_>) -> rusqlite::Result<DocumentTemplate> {
    Ok(DocumentTemplate {
        id: row.get(0)?,
        version: row.get(1)?,
        name: row.get(2)?,
        description: row.get(3)?,
        instructions: row.get(4)?,
        archived: row.get(5)?,
        created_at: row.get(6)?,
        updated_at: row.get(7)?,
    })
}

fn select_template(connection: &Connection, id: i64) -> PrivacyResult<DocumentTemplate> {
    connection
        .query_row(
            "SELECT id, version, name, description, instructions, archived, created_at, updated_at
             FROM document_templates WHERE id = ?1",
            [id],
            template_view,
        )
        .optional()
        .map_err(|_| STORAGE_ERROR)?
        .ok_or(TEMPLATE_UNAVAILABLE)
}

fn document_summary(row: &rusqlite::Row<'_>) -> rusqlite::Result<DocumentSummary> {
    Ok(DocumentSummary {
        usage: UsageSummary::default(),
        id: row.get(0)?,
        patient_id: row.get(1)?,
        title: row.get(2)?,
        template_name: row.get(3)?,
        revision: row.get(4)?,
        reviewed: row.get(5)?,
        created_at: row.get(6)?,
        updated_at: row.get(7)?,
    })
}

fn select_document(connection: &Connection, id: i64) -> PrivacyResult<PatientDocument> {
    connection
        .query_row(
            "SELECT id, patient_id, title, template_id, template_name, revision, body,
                    reviewed, include_signature, created_at, updated_at
             FROM patient_documents WHERE id = ?1",
            [id],
            |row| {
                let body: String = row.get(6)?;
                let body =
                    serde_json::from_str(&body).map_err(|_| rusqlite::Error::InvalidQuery)?;
                Ok(PatientDocument {
                    id: row.get(0)?,
                    patient_id: row.get(1)?,
                    title: row.get(2)?,
                    template_id: row.get(3)?,
                    template_name: row.get(4)?,
                    revision: row.get(5)?,
                    body,
                    reviewed: row.get(7)?,
                    include_signature: row.get(8)?,
                    created_at: row.get(9)?,
                    updated_at: row.get(10)?,
                })
            },
        )
        .optional()
        .map_err(|_| STORAGE_ERROR)?
        .ok_or(DOCUMENT_UNAVAILABLE)
}

fn select_patient(connection: &Connection, id: i64) -> PrivacyResult<PatientView> {
    connection
        .query_row(
            &format!("SELECT {PATIENT_COLUMNS} FROM patients WHERE id = ?1"),
            [id],
            patient_view,
        )
        .optional()
        .map_err(|_| STORAGE_ERROR)?
        .ok_or(PATIENT_UNAVAILABLE)
}

fn patient_fields(
    name: &str,
    patient_reference: Option<&str>,
) -> PrivacyResult<(String, Option<String>)> {
    let name = normalise_required(
        name,
        160,
        "Enter a patient name.",
        "Use at most 160 characters for the patient name.",
    )?;
    let reference = normalise_optional(
        patient_reference,
        128,
        "Use at most 128 characters for the patient number.",
    )?;
    Ok((name, reference))
}

fn lowercase(value: &str) -> String {
    value.chars().flat_map(char::to_lowercase).collect()
}

fn read_document_metadata(
    row: &rusqlite::Row<'_>,
    start: usize,
) -> rusqlite::Result<Option<DocumentMetadata>> {
    let name: Option<String> = row.get(start)?;
    name.map(|name| {
        let format: String = row.get(start + 1)?;
        let format =
            DocumentFormat::from_extension(&format).map_err(|_| rusqlite::Error::InvalidQuery)?;
        Ok(DocumentMetadata {
            name,
            format,
            byte_length: row.get::<_, i64>(start + 2)? as usize,
        })
    })
    .transpose()
}
fn document_metadata(connection: &Connection, id: i64) -> PrivacyResult<Option<DocumentMetadata>> {
    connection
        .query_row(
            "SELECT name, format, byte_length FROM note_documents WHERE note_id = ?1",
            [id],
            |row| read_document_metadata(row, 0),
        )
        .optional()
        .map(Option::flatten)
        .map_err(|_| STORAGE_ERROR)
}

fn note_summary(row: &rusqlite::Row<'_>) -> rusqlite::Result<NoteSummary> {
    Ok(NoteSummary {
        document: read_document_metadata(row, 7)?,
        id: row.get(0)?,
        title: row.get(1)?,
        patient_reference: row.get(2)?,
        created_at: row.get(3)?,
        snippet: row.get(4)?,
        patient_name: row.get(5)?,
        patient_id: row.get(6)?,
    })
}
fn note_view(row: &rusqlite::Row<'_>) -> rusqlite::Result<NoteView> {
    Ok(NoteView {
        document: read_document_metadata(row, 9)?,
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

pub fn openai_key_configured() -> bool {
    find_generic_password(None, KEYCHAIN_SERVICE, OPENAI_KEYCHAIN_ACCOUNT).is_ok()
}

pub fn load_openai_key() -> PrivacyResult<Vec<u8>> {
    find_generic_password(None, KEYCHAIN_SERVICE, OPENAI_KEYCHAIN_ACCOUNT)
        .map(|(password, _)| password.as_ref().to_vec())
        .map_err(|_| "Configure the OpenAI API key in Settings first.")
}

pub fn save_openai_key(value: &str) -> PrivacyResult<()> {
    let value = value.trim();
    if value.is_empty() || value.len() > 512 {
        return Err("Enter a valid OpenAI API key.");
    }
    if let Ok((_, mut item)) =
        find_generic_password(None, KEYCHAIN_SERVICE, OPENAI_KEYCHAIN_ACCOUNT)
    {
        item.set_password(value.as_bytes())
            .map_err(|_| "The OpenAI API key could not be saved in Keychain.")?;
    } else {
        let keychain = SecKeychain::default()
            .map_err(|_| "The OpenAI API key could not be saved in Keychain.")?;
        keychain
            .set_generic_password(KEYCHAIN_SERVICE, OPENAI_KEYCHAIN_ACCOUNT, value.as_bytes())
            .map_err(|_| "The OpenAI API key could not be saved in Keychain.")?;
    }
    Ok(())
}

pub fn remove_openai_key() -> PrivacyResult<()> {
    if let Ok((_, item)) = find_generic_password(None, KEYCHAIN_SERVICE, OPENAI_KEYCHAIN_ACCOUNT) {
        item.delete();
    }
    Ok(())
}

fn validate_title(value: &str) -> PrivacyResult<String> {
    normalise_required(
        value,
        160,
        "Enter a note title.",
        "Use at most 160 characters for the note title.",
    )
}
fn template_fields(
    name: &str,
    description: &str,
    instructions: &str,
) -> PrivacyResult<(String, String, String)> {
    Ok((
        normalise_required(
            name,
            120,
            "Enter a template name.",
            "Use at most 120 characters for the template name.",
        )?,
        normalise_required(
            description,
            240,
            "Enter a template description.",
            "Use at most 240 characters for the template description.",
        )?,
        normalise_required(
            instructions,
            8_000,
            "Enter instructions for this document prompt template.",
            "Use at most 8,000 characters for template instructions.",
        )?,
    ))
}
fn validate_signature(bytes: &[u8]) -> PrivacyResult<()> {
    const ERROR: &str = "Use a PNG signature no larger than 1200 by 400 pixels and 2 MiB.";
    if bytes.len() > 2 * 1024 * 1024 {
        return Err(ERROR);
    }
    let mut decoder = png::Decoder::new(std::io::Cursor::new(bytes));
    decoder.set_limits(png::Limits {
        bytes: 2 * 1024 * 1024,
    });
    let mut reader = decoder.read_info().map_err(|_| ERROR)?;
    let info = reader.info();
    if info.width == 0
        || info.height == 0
        || info.width > 1200
        || info.height > 400
        || info.animation_control.is_some()
    {
        return Err(ERROR);
    }
    let mut image = vec![0; reader.output_buffer_size()];
    reader.next_frame(&mut image).map_err(|_| ERROR)?;
    Ok(())
}

fn normalise_limited(value: &str, limit: usize, long: &'static str) -> PrivacyResult<String> {
    let value = value.trim();
    if value.chars().count() > limit {
        return Err(long);
    }
    Ok(value.to_owned())
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
            .upsert_mapping("Alex Morgan", Category::Person, "[CLIENT]")
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
        assert_eq!(store.search_notes("outcome", None).unwrap().len(), 1);
        store.delete_note(note.id).unwrap();
        assert!(store.search_notes("outcome", None).unwrap().is_empty());
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
            .upsert_patient_mapping(patient.id, "Alex Morgan", Category::Person, "[CLIENT]")
            .unwrap();

        store.delete_patient(patient.id).unwrap();

        assert!(store.patients().unwrap().is_empty());
        assert!(store.search_notes("outcome", None).unwrap().is_empty());
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
        assert_eq!(store.search_notes("review", None).unwrap().len(), 1);
        assert_eq!(store.search_notes("SYN-2048", None).unwrap().len(), 1);
        assert_eq!(
            store
                .search_notes("\"clinical outcome\"", None)
                .unwrap()
                .len(),
            1
        );
    }

    #[test]
    fn patient_mapping_overrides_a_global_mapping_for_that_patient() {
        let dir = tempfile::tempdir().unwrap();
        let store = Storage::open_for_test(dir.path().join("notes.sqlite"), [5; 32]).unwrap();
        let patient = store.create_patient("Synthetic Client", None).unwrap();
        store
            .upsert_mapping("Alex Morgan", Category::Person, "[PERSON]")
            .unwrap();
        store
            .upsert_patient_mapping(patient.id, "Alex Morgan", Category::Person, "[CLIENT]")
            .unwrap();
        let matches = store.matches("Alex Morgan", Some(patient.id)).unwrap();
        assert_eq!(matches.last().unwrap().replacement, "[CLIENT]");
    }

    #[test]
    fn redaction_edits_change_only_the_replacement() {
        let dir = tempfile::tempdir().unwrap();
        let store = Storage::open_for_test(dir.path().join("notes.sqlite"), [6; 32]).unwrap();
        let patient = store.create_patient("Synthetic Client", None).unwrap();
        let other = store.create_patient("Other Client", None).unwrap();
        let patient_redaction = store
            .upsert_patient_mapping(patient.id, "Alex Morgan", Category::Person, "[CLIENT]")
            .unwrap();
        let global = store
            .upsert_mapping("Riverside Clinic", Category::Organisation, "[CLINIC]")
            .unwrap();

        let edited = store
            .update_patient_mapping_replacement(patient.id, patient_redaction.id, "[PATIENT]")
            .unwrap();
        assert_eq!(edited.replacement, "[PATIENT]");
        assert_eq!(edited.phrase, "Alex Morgan");
        assert_eq!(edited.category, Category::Person);
        assert_eq!(
            store.matches("Alex Morgan", Some(patient.id)).unwrap()[0].replacement,
            "[PATIENT]"
        );
        let edited = store
            .update_mapping_replacement(global.id, "[SERVICE]")
            .unwrap();
        assert_eq!(edited.replacement, "[SERVICE]");
        assert_eq!(edited.phrase, "Riverside Clinic");

        assert_eq!(
            store
                .update_patient_mapping_replacement(other.id, patient_redaction.id, "[X]")
                .err(),
            Some(REDACTION_UNAVAILABLE)
        );
        assert!(store
            .update_mapping_replacement(global.id, "not a label")
            .is_err());
        assert_eq!(
            store.patient_mappings(patient.id).unwrap()[0].replacement,
            "[PATIENT]"
        );
    }

    #[test]
    fn patients_can_be_renamed_and_carry_note_and_redaction_counts() {
        let dir = tempfile::tempdir().unwrap();
        let store = Storage::open_for_test(dir.path().join("notes.sqlite"), [8; 32]).unwrap();
        let patient = store
            .create_patient("Synthetic Client", Some("SYN-8"))
            .unwrap();
        store.create_patient("Other Client", None).unwrap();
        store
            .save_note(
                patient.id,
                "Synthetic review",
                None,
                "Source",
                "Reviewed outcome",
                "[]",
            )
            .unwrap();
        store
            .upsert_patient_mapping(patient.id, "Alex Morgan", Category::Person, "[CLIENT]")
            .unwrap();

        let updated = store
            .update_patient(patient.id, "  Renamed Client ", Some(" "))
            .unwrap();
        assert_eq!(updated.name, "Renamed Client");
        assert_eq!(updated.patient_reference, None);
        assert_eq!((updated.note_count, updated.redaction_count), (1, 1));
        assert_eq!(
            store.update_patient(patient.id, "other client", None).err(),
            Some(PATIENT_CONFLICT)
        );
        assert_eq!(
            store.update_patient(999, "Missing Client", None).err(),
            Some(PATIENT_UNAVAILABLE)
        );
        assert!(store.update_patient(patient.id, " ", None).is_err());
        let listed = store.patients().unwrap();
        assert_eq!(listed[0].name, "Other Client");
        assert_eq!((listed[0].note_count, listed[0].redaction_count), (0, 0));
    }

    #[test]
    fn note_search_can_be_limited_to_one_patient() {
        let dir = tempfile::tempdir().unwrap();
        let store = Storage::open_for_test(dir.path().join("notes.sqlite"), [4; 32]).unwrap();
        let first = store.create_patient("First Client", Some("SYN-1")).unwrap();
        let second = store.create_patient("Second Client", None).unwrap();
        for patient in [&first, &second] {
            store
                .save_note(
                    patient.id,
                    "Sleep review",
                    None,
                    "Source",
                    "Improved sleep",
                    "[]",
                )
                .unwrap();
        }
        assert_eq!(store.search_notes("sleep", None).unwrap().len(), 2);
        let scoped = store.search_notes("sleep", Some(first.id)).unwrap();
        assert_eq!(scoped.len(), 1);
        assert_eq!(scoped[0].patient_id, Some(first.id));
        assert_eq!(scoped[0].patient_reference.as_deref(), Some("SYN-1"));
        assert_eq!(store.search_notes("", Some(second.id)).unwrap().len(), 1);
        store
            .update_patient(first.id, "First Client", Some("SYN-9"))
            .unwrap();
        assert_eq!(
            store.search_notes("", Some(first.id)).unwrap()[0]
                .patient_reference
                .as_deref(),
            Some("SYN-9")
        );
    }

    #[test]
    fn starter_templates_are_editable_archivable_and_restorable() {
        let dir = tempfile::tempdir().unwrap();
        let store = Storage::open_for_test(dir.path().join("notes.sqlite"), [14; 32]).unwrap();
        let starters = store.templates(false).unwrap();
        assert_eq!(starters.len(), 3);
        assert_eq!(starters[0].name, "GP letter");
        let updated = store
            .update_template(
                starters[0].id,
                "GP update",
                "Synthetic description",
                "Use only supplied synthetic notes.",
            )
            .unwrap();
        assert_eq!(updated.version, 2);
        assert_eq!(updated.name, "GP update");
        assert!(
            store
                .set_template_archived(updated.id, true)
                .unwrap()
                .archived
        );
        assert_eq!(store.templates(false).unwrap().len(), 2);
        assert!(
            !store
                .set_template_archived(updated.id, false)
                .unwrap()
                .archived
        );
        let duplicate = store.duplicate_template(updated.id).unwrap();
        assert_eq!(duplicate.name, "GP update copy");
        assert_eq!(duplicate.version, 1);
    }

    #[test]
    fn documents_are_patient_scoped_and_deleted_with_the_patient() {
        let dir = tempfile::tempdir().unwrap();
        let store = Storage::open_for_test(dir.path().join("notes.sqlite"), [15; 32]).unwrap();
        let patient = store
            .create_patient("Synthetic Client", Some("SYN-15"))
            .unwrap();
        let note = store
            .save_note(patient.id, "Review", None, "Source", "Reviewed", "[]")
            .unwrap();
        let template = store.templates(false).unwrap().remove(0);
        let body = DocumentBody::from_plain_text("Synthetic document body.");
        let document = store
            .save_document(
                None,
                patient.id,
                "Synthetic letter",
                template.id,
                &body,
                false,
                false,
                &[note.id],
            )
            .unwrap();
        assert_eq!(store.documents(patient.id).unwrap().len(), 1);
        assert!(!document.reviewed);

        let reviewed = store
            .save_document(
                Some(document.id),
                patient.id,
                "Synthetic letter",
                template.id,
                &body,
                true,
                false,
                &[note.id],
            )
            .unwrap();
        assert!(reviewed.reviewed);
        assert_eq!(reviewed.revision, 2);
        assert_eq!(store.patient(patient.id).unwrap().document_count, 1);

        store.delete_patient(patient.id).unwrap();
        assert!(store.documents(patient.id).unwrap().is_empty());
        assert_eq!(
            store.patient_document(document.id).err(),
            Some(DOCUMENT_UNAVAILABLE)
        );
    }

    #[test]
    fn unknown_restoration_tokens_block_reviewed_status() {
        let dir = tempfile::tempdir().unwrap();
        let store = Storage::open_for_test(dir.path().join("notes.sqlite"), [16; 32]).unwrap();
        let patient = store.create_patient("Synthetic Client", None).unwrap();
        let template = store.templates(false).unwrap().remove(0);
        let body = DocumentBody::from_plain_text("Dear ⟪CV_unknown_0001⟫");
        assert_eq!(
            store
                .save_document(
                    None,
                    patient.id,
                    "Letter",
                    template.id,
                    &body,
                    true,
                    false,
                    &[]
                )
                .err(),
            Some(
                "Resolve or remove every unknown placeholder before marking the document reviewed."
            )
        );
    }
}

#[cfg(test)]
mod document_tests {
    use super::*;
    fn original() -> OriginalDocument {
        OriginalDocument {
            metadata: DocumentMetadata {
                name: "unsearchablefilename.txt".into(),
                format: DocumentFormat::Txt,
                byte_length: 18,
            },
            bytes: b"unsearchablesource".to_vec(),
        }
    }
    #[test]
    fn originals_survive_restart_edits_and_external_file_removal_but_are_not_indexed() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("library.sqlite");
        let mut original = original();
        original.metadata.byte_length = original.bytes.len();
        let external = dir.path().join("synthetic.txt");
        fs::write(&external, &original.bytes).unwrap();
        let store = Storage::open_for_test(path.clone(), [8; 32]).unwrap();
        let patient = store.create_patient("Synthetic Client", None).unwrap();
        let note = store
            .save_note_with_document(
                patient.id,
                "Reviewed title",
                None,
                "unsearchablesource",
                "Reviewed outcome",
                "{}",
                Some(&original),
            )
            .unwrap();
        fs::remove_file(&external).unwrap();
        drop(store);
        let store = Storage::open_for_test(path.clone(), [8; 32]).unwrap();
        assert_eq!(store.document(note.id).unwrap(), original);
        assert!(store.note(note.id).unwrap().document.is_some());
        assert!(store.search_notes("outcome", None).unwrap()[0]
            .document
            .is_some());
        assert!(store.search_notes("", Some(patient.id)).unwrap()[0]
            .document
            .is_some());
        assert!(store
            .search_notes("unsearchablefilename", None)
            .unwrap()
            .is_empty());
        assert!(store
            .search_notes("unsearchablesource", None)
            .unwrap()
            .is_empty());
        store
            .update_note(
                note.id,
                patient.id,
                "Updated",
                "Edited source",
                "Reviewed updated outcome",
                "{}",
            )
            .unwrap();
        assert_eq!(store.document(note.id).unwrap(), original);
        let encrypted = fs::read(path).unwrap();
        for phrase in [&original.bytes[..], b"unsearchablefilename".as_slice()] {
            assert!(!encrypted
                .windows(phrase.len())
                .any(|window| window == phrase));
        }
        store.delete_note(note.id).unwrap();
        assert!(store.document(note.id).is_err());
        assert!(store.search_notes("outcome", None).unwrap().is_empty());
    }
    #[test]
    fn document_insert_failure_rolls_back_note_and_index_and_patient_delete_cascades() {
        let dir = tempfile::tempdir().unwrap();
        let store = Storage::open_for_test(dir.path().join("library.sqlite"), [4; 32]).unwrap();
        let patient = store.create_patient("Synthetic Client", None).unwrap();
        let mut original = original();
        original.metadata.byte_length = 999;
        assert!(store
            .save_note_with_document(
                patient.id,
                "Test",
                None,
                "source",
                "outcome",
                "{}",
                Some(&original)
            )
            .is_err());
        assert!(store.search_notes("", None).unwrap().is_empty());
        assert!(store.search_notes("outcome", None).unwrap().is_empty());
        original.metadata.byte_length = original.bytes.len();
        let first = store
            .save_note_with_document(
                patient.id,
                "First",
                None,
                "source",
                "outcome",
                "{}",
                Some(&original),
            )
            .unwrap();
        let second = store
            .save_note_with_document(
                patient.id,
                "Second",
                None,
                "source",
                "outcome",
                "{}",
                Some(&original),
            )
            .unwrap();
        store.with_connection(|connection| {
            assert!(connection.execute("INSERT INTO note_documents SELECT * FROM note_documents WHERE note_id = ?1", [first.id]).is_err());
            Ok(())
        }).unwrap();
        assert_eq!(store.search_notes("outcome", None).unwrap().len(), 2);
        store.delete_patient(patient.id).unwrap();
        assert!(store.document(first.id).is_err());
        assert!(store.document(second.id).is_err());
        store
            .with_connection(|connection| {
                assert_eq!(
                    connection
                        .query_row("SELECT count(*) FROM note_documents", [], |r| r
                            .get::<_, i64>(0))
                        .unwrap(),
                    0
                );
                Ok(())
            })
            .unwrap();
    }
    #[test]
    fn additive_migration_preserves_existing_notes() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("library.sqlite");
        let store = Storage::open_for_test(path.clone(), [6; 32]).unwrap();
        let patient = store.create_patient("Synthetic Client", None).unwrap();
        let note = store
            .save_note(
                patient.id,
                "Existing",
                None,
                "source",
                "retained outcome",
                "{}",
            )
            .unwrap();
        store.with_connection(|connection| {
            connection.execute_batch("DROP TABLE note_documents; DELETE FROM schema_migrations WHERE version = 2;").unwrap(); Ok(())
        }).unwrap();
        drop(store);
        let store = Storage::open_for_test(path, [6; 32]).unwrap();
        assert!(store.note(note.id).unwrap().document.is_none());
        assert_eq!(store.search_notes("retained", None).unwrap().len(), 1);
    }
}

#[cfg(test)]
mod signature_tests {
    use super::*;
    fn signature() -> Vec<u8> {
        let mut bytes = Vec::new();
        {
            let mut encoder = png::Encoder::new(&mut bytes, 8, 4);
            encoder.set_color(png::ColorType::Rgba);
            encoder.set_depth(png::BitDepth::Eight);
            encoder
                .write_header()
                .unwrap()
                .write_image_data(&[127; 128])
                .unwrap();
        }
        bytes
    }
    #[test]
    fn signature_round_trips_and_replacement_does_not_rewrite_reviewed_snapshot() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("signatures.sqlite");
        let store = Storage::open_for_test(path.clone(), [74; 32]).unwrap();
        let bytes = signature();
        let profile = store
            .save_clinician_profile(
                "Dr Synthetic",
                "Clinician",
                "Test",
                Some(&bytes),
                false,
                DEFAULT_DOCUMENT_MODEL,
            )
            .unwrap();
        assert!(profile.has_signature);
        assert!(profile.signature_png.is_some());
        let patient = store
            .create_patient("Synthetic Signature Case", None)
            .unwrap();
        let template = store.templates(false).unwrap().remove(0);
        let document = store
            .save_document(
                None,
                patient.id,
                "Synthetic letter",
                template.id,
                &DocumentBody::from_plain_text("Synthetic body"),
                true,
                true,
                &[],
            )
            .unwrap();
        store
            .save_clinician_profile(
                "Dr Synthetic",
                "Clinician",
                "Test",
                None,
                true,
                DEFAULT_DOCUMENT_MODEL,
            )
            .unwrap();
        assert!(!store.clinician_profile().unwrap().has_signature);
        store
            .with_connection(|connection| {
                let saved: Vec<u8> = connection
                    .query_row(
                        "SELECT signature_snapshot FROM patient_documents WHERE id = ?1",
                        [document.id],
                        |row| row.get(0),
                    )
                    .unwrap();
                assert_eq!(saved, bytes);
                Ok(())
            })
            .unwrap();
        store
            .save_clinician_profile(
                "Dr Synthetic",
                "Clinician",
                "Test",
                Some(&bytes),
                false,
                DEFAULT_DOCUMENT_MODEL,
            )
            .unwrap();
        drop(store);
        let reopened = Storage::open_for_test(path, [74; 32]).unwrap();
        assert_eq!(
            reopened.clinician_profile().unwrap().signature_png,
            profile.signature_png
        );
    }
    #[test]
    fn malformed_or_oversized_signatures_cannot_replace_saved_drawing() {
        let dir = tempfile::tempdir().unwrap();
        let store = Storage::open_for_test(dir.path().join("signatures.sqlite"), [75; 32]).unwrap();
        for bytes in [
            b"<svg>synthetic</svg>".to_vec(),
            vec![0; 2 * 1024 * 1024 + 1],
            signature()[..20].to_vec(),
        ] {
            assert!(store
                .save_clinician_profile(
                    "Synthetic",
                    "",
                    "",
                    Some(&bytes),
                    false,
                    DEFAULT_DOCUMENT_MODEL
                )
                .is_err());
        }
        assert!(!store.clinician_profile().unwrap().has_signature);
    }
}
