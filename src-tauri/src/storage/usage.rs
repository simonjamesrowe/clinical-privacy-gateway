//! Accounting outlives documents but retains no clinical text or patient link.
use super::*;
use clinicians_veil_core::document_usage::{
    cost_nanos, document_model, DocumentModel, TokenUsage, UsageSummary,
};

pub(super) fn migrate(connection: &mut Connection) -> PrivacyResult<()> {
    let transaction = connection.transaction().map_err(|_| STORAGE_ERROR)?;
    transaction.execute_batch(
        "CREATE TABLE IF NOT EXISTS document_usage_reports (
           id TEXT PRIMARY KEY,
           document_id INTEGER UNIQUE REFERENCES patient_documents(id) ON DELETE SET NULL,
           first_completed_at INTEGER
         );
         CREATE TABLE IF NOT EXISTS document_generation_usage (
           attempt_id TEXT PRIMARY KEY,
           report_id TEXT NOT NULL REFERENCES document_usage_reports(id),
           attempted_at INTEGER NOT NULL,
           requested_model TEXT NOT NULL,
           pricing_json TEXT NOT NULL,
           outcome TEXT NOT NULL CHECK(outcome IN ('started', 'completed', 'failed', 'cancelled')),
           usage_json TEXT,
           cost_nanos INTEGER CHECK(cost_nanos IS NULL OR cost_nanos >= 0)
         );
         CREATE INDEX IF NOT EXISTS document_usage_attempted ON document_generation_usage(attempted_at);
         CREATE INDEX IF NOT EXISTS document_usage_report ON document_generation_usage(report_id);
         INSERT OR IGNORE INTO schema_migrations(version) VALUES (3);"
    ).map_err(|_| STORAGE_ERROR)?;
    transaction.commit().map_err(|_| STORAGE_ERROR)
}

/// Called in the same transaction that consumes the one-shot preparation.
/// A crash/timeout leaves an attempt with unknown cost, never an invented zero.
pub(super) fn begin_attempt(
    connection: &Connection,
    prepared: &PreparedSubmission,
) -> PrivacyResult<()> {
    let document_id: Option<i64> = connection
        .query_row(
            "SELECT document_id FROM prepared_submissions WHERE id = ?1",
            [&prepared.id],
            |row| row.get(0),
        )
        .map_err(|_| STORAGE_ERROR)?;
    let document_id = document_id.ok_or("Prepare this document again before sending.")?;
    let pricing =
        serde_json::to_string(&document_model(&prepared.model)?).map_err(|_| STORAGE_ERROR)?;
    let timestamp = now()?;
    connection
        .execute(
            "INSERT OR IGNORE INTO document_usage_reports(id, document_id) VALUES (?1, ?2)",
            params![prepared.id, document_id],
        )
        .map_err(|_| STORAGE_ERROR)?;
    connection.execute(
        "INSERT INTO document_generation_usage(attempt_id, report_id, attempted_at, requested_model, pricing_json, outcome)
         SELECT ?1, id, ?2, ?3, ?4, 'started' FROM document_usage_reports WHERE document_id = ?5",
        params![prepared.id, timestamp, prepared.model, pricing, document_id]
    ).map_err(|_| STORAGE_ERROR)?;
    Ok(())
}

impl Storage {
    /// Only native response handling can write usage; no IPC accepts prices,
    /// token counts, or successful-report counts from the webview.
    pub fn finish_document_attempt(
        &self,
        attempt_id: &str,
        outcome: &str,
        usage: Option<&TokenUsage>,
    ) -> PrivacyResult<()> {
        if !matches!(outcome, "completed" | "failed" | "cancelled") {
            return Err(STORAGE_ERROR);
        }
        self.with_connection(|connection| {
            let transaction = connection.transaction().map_err(|_| STORAGE_ERROR)?;
            let encoded: String = transaction.query_row(
                "SELECT pricing_json FROM document_generation_usage WHERE attempt_id = ?1", [attempt_id], |row| row.get(0)
            ).map_err(|_| STORAGE_ERROR)?;
            let pricing: DocumentModel = serde_json::from_str(&encoded).map_err(|_| STORAGE_ERROR)?;
            let cost = usage.and_then(|usage| cost_nanos(&pricing, usage)).and_then(|cost| i64::try_from(cost).ok());
            let encoded_usage = usage.map(serde_json::to_string).transpose().map_err(|_| STORAGE_ERROR)?;
            let changed = transaction.execute(
                "UPDATE document_generation_usage SET outcome = ?1, usage_json = ?2, cost_nanos = ?3
                 WHERE attempt_id = ?4 AND outcome = 'started'",
                params![outcome, encoded_usage, cost, attempt_id]
            ).map_err(|_| STORAGE_ERROR)?;
            if changed == 1 && outcome == "completed" {
                transaction.execute(
                    "UPDATE document_usage_reports SET first_completed_at = ?1
                     WHERE id = (SELECT report_id FROM document_generation_usage WHERE attempt_id = ?2)
                     AND first_completed_at IS NULL", params![now()?, attempt_id]
                ).map_err(|_| STORAGE_ERROR)?;
            }
            transaction.commit().map_err(|_| STORAGE_ERROR)
        })
    }

    pub fn document_usage(
        &self,
        from: Option<i64>,
        until: Option<i64>,
        document_id: Option<i64>,
    ) -> PrivacyResult<UsageSummary> {
        if from.is_some_and(|value| value < 0)
            || until.is_some_and(|value| value < 0)
            || matches!((from, until), (Some(start), Some(end)) if start >= end)
        {
            return Err("Choose a valid usage period.");
        }
        self.with_connection(|connection| summary(connection, from, until, document_id))
    }
}

pub(super) fn summary(
    connection: &Connection,
    from: Option<i64>,
    until: Option<i64>,
    document_id: Option<i64>,
) -> PrivacyResult<UsageSummary> {
    let mut summary = connection
        .query_row(
            "SELECT COUNT(*), COALESCE(SUM(cost_nanos), 0), COALESCE(SUM(cost_nanos IS NULL), 0)
         FROM document_generation_usage a JOIN document_usage_reports r ON r.id = a.report_id
         WHERE (?1 IS NULL OR a.attempted_at >= ?1) AND (?2 IS NULL OR a.attempted_at < ?2)
           AND (?3 IS NULL OR r.document_id = ?3)",
            params![from, until, document_id],
            |row| {
                Ok(UsageSummary {
                    generation_attempts: row.get(0)?,
                    known_cost_nanos: row.get(1)?,
                    unknown_cost_attempts: row.get(2)?,
                    ..UsageSummary::default()
                })
            },
        )
        .map_err(|_| STORAGE_ERROR)?;
    summary.reports_created = connection
        .query_row(
            "SELECT COUNT(*) FROM document_usage_reports WHERE first_completed_at IS NOT NULL
         AND (?1 IS NULL OR first_completed_at >= ?1) AND (?2 IS NULL OR first_completed_at < ?2)
         AND (?3 IS NULL OR document_id = ?3)",
            params![from, until, document_id],
            |row| row.get(0),
        )
        .map_err(|_| STORAGE_ERROR)?;
    summary.latest_cost_nanos = connection.query_row(
        "SELECT cost_nanos FROM document_generation_usage a JOIN document_usage_reports r ON r.id = a.report_id
         WHERE (?1 IS NULL OR a.attempted_at >= ?1) AND (?2 IS NULL OR a.attempted_at < ?2)
           AND (?3 IS NULL OR r.document_id = ?3) ORDER BY a.attempted_at DESC, a.rowid DESC LIMIT 1",
        params![from, until, document_id], |row| row.get::<_, Option<i64>>(0)
    ).optional().map_err(|_| STORAGE_ERROR)?.flatten();
    Ok(summary)
}

#[cfg(test)]
mod tests {
    use super::*;
    use clinicians_veil_core::document_usage::DEFAULT_DOCUMENT_MODEL;

    fn document(store: &Storage) -> PatientDocument {
        let patient = store.create_patient("Synthetic Client", None).unwrap();
        let template = store.templates(false).unwrap().remove(0);
        store
            .save_document(
                None,
                patient.id,
                "Synthetic report",
                template.id,
                &DocumentBody::from_plain_text(""),
                false,
                false,
                &[],
            )
            .unwrap()
    }

    fn prepared(store: &Storage, document: &PatientDocument, id: &str, model: &str) {
        let template = store.template(document.template_id).unwrap();
        let preparation = PreparedSubmission {
            id: id.into(),
            template_id: template.id,
            template_version: template.version,
            model: model.into(),
            destination: "https://api.openai.com".into(),
            purpose: "Generate document".into(),
            instructions: "Synthetic instructions".into(),
            input: "Synthetic note".into(),
            payload_digest: id.into(),
            source_revisions: vec![],
            restorations: vec![],
        };
        store.with_connection(|connection| {
            connection.execute("UPDATE clinician_profile SET clinical_sending_enabled = 1 WHERE singleton = 1", []).unwrap();
            connection.execute(
                "INSERT INTO prepared_submissions(id, document_id, template_id, template_version, model,
                 destination, purpose, instructions, input, payload_digest, restoration_json, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, 'https://api.openai.com', 'Generate document', '', '', ?1, ?6, ?7)",
                params![id, document.id, template.id, template.version, model,
                    serde_json::to_string(&preparation).unwrap(), now()?]
            ).unwrap();
            Ok(())
        }).unwrap();
    }

    #[test]
    fn attempts_are_once_only_regenerations_count_one_report_and_deletion_preserves_totals() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("usage.sqlite");
        let store = Storage::open_for_test(path.clone(), [42; 32]).unwrap();
        let doc = document(&store);
        assert_eq!(
            store
                .document_usage(None, None, None)
                .unwrap()
                .reports_created,
            0
        );
        prepared(&store, &doc, "attempt-one", DEFAULT_DOCUMENT_MODEL);
        store.consume_prepared_submission("attempt-one").unwrap();
        assert!(store.consume_prepared_submission("attempt-one").is_err());
        let started = store.document_usage(None, None, None).unwrap();
        assert_eq!(started.generation_attempts, 1);
        assert_eq!(started.unknown_cost_attempts, 1);
        let usage = TokenUsage {
            input_tokens: 1_000,
            cached_input_tokens: 400,
            output_tokens: 500,
        };
        store
            .finish_document_attempt("attempt-one", "completed", Some(&usage))
            .unwrap();
        store
            .finish_document_attempt("attempt-one", "failed", None)
            .unwrap(); // Cannot overwrite a recorded receipt.
                       // A per-document override is accepted without changing the Settings default.
        prepared(&store, &doc, "attempt-two", "gpt-4.1-2025-04-14");
        store.consume_prepared_submission("attempt-two").unwrap();
        store
            .finish_document_attempt("attempt-two", "completed", Some(&usage))
            .unwrap();
        assert_eq!(
            store.clinician_profile().unwrap().openai_model,
            DEFAULT_DOCUMENT_MODEL
        );
        prepared(&store, &doc, "attempt-three", DEFAULT_DOCUMENT_MODEL);
        store.consume_prepared_submission("attempt-three").unwrap();
        store
            .finish_document_attempt("attempt-three", "failed", None)
            .unwrap();
        let totals = store.document_usage(None, None, Some(doc.id)).unwrap();
        assert_eq!(totals.reports_created, 1);
        assert_eq!(totals.generation_attempts, 3);
        assert_eq!(totals.known_cost_nanos, 5_714_000);
        assert_eq!(totals.unknown_cost_attempts, 1);
        assert_eq!(totals.latest_cost_nanos, None);
        store.delete_document(doc.id).unwrap();
        store.delete_patient(doc.patient_id).unwrap();
        drop(store);
        let reopened = Storage::open_for_test(path, [42; 32]).unwrap();
        let totals = reopened.document_usage(None, None, None).unwrap();
        assert_eq!(totals.reports_created, 1);
        assert_eq!(totals.known_cost_nanos, 5_714_000);
        assert_eq!(totals.generation_attempts, 3);
        reopened
            .with_connection(|connection| {
                let links: i64 = connection
                    .query_row(
                        "SELECT COUNT(*) FROM document_usage_reports WHERE document_id IS NOT NULL",
                        [],
                        |row| row.get(0),
                    )
                    .unwrap();
                assert_eq!(links, 0);
                Ok(())
            })
            .unwrap();
    }

    #[test]
    fn failed_billable_output_uses_saved_rates_and_periods_use_half_open_boundaries() {
        let dir = tempfile::tempdir().unwrap();
        let store = Storage::open_for_test(dir.path().join("usage.sqlite"), [43; 32]).unwrap();
        let doc = document(&store);
        prepared(&store, &doc, "billable-failure", DEFAULT_DOCUMENT_MODEL);
        store
            .consume_prepared_submission("billable-failure")
            .unwrap();
        let mut historic = document_model(DEFAULT_DOCUMENT_MODEL).unwrap();
        historic.output_nanos = 800;
        store.with_connection(|connection| {
            connection.execute("UPDATE document_generation_usage SET pricing_json = ?1, attempted_at = 100", [serde_json::to_string(&historic).unwrap()]).unwrap();
            Ok(())
        }).unwrap();
        store
            .finish_document_attempt(
                "billable-failure",
                "failed",
                Some(&TokenUsage {
                    input_tokens: 0,
                    cached_input_tokens: 0,
                    output_tokens: 100,
                }),
            )
            .unwrap();
        let totals = store.document_usage(Some(100), Some(101), None).unwrap();
        assert_eq!(totals.known_cost_nanos, 80_000);
        assert_eq!(totals.reports_created, 0);
        assert_eq!(totals.generation_attempts, 1);
        assert_eq!(
            store
                .document_usage(None, Some(100), None)
                .unwrap()
                .generation_attempts,
            0
        );
        assert_eq!(
            store
                .document_usage(Some(101), None, None)
                .unwrap()
                .generation_attempts,
            0
        );
    }

    #[test]
    fn gated_preparation_never_creates_a_report_or_attempt() {
        let dir = tempfile::tempdir().unwrap();
        let store = Storage::open_for_test(dir.path().join("usage.sqlite"), [44; 32]).unwrap();
        assert!(store
            .prepare_document_submission(
                999,
                999,
                &[999],
                DEFAULT_DOCUMENT_MODEL,
                "Synthetic title",
                None
            )
            .is_err());
        let totals = store.document_usage(None, None, None).unwrap();
        assert_eq!(totals.generation_attempts, 0);
        assert_eq!(totals.reports_created, 0);
    }
}
