//! Content-free model pricing and document-generation accounting.
use crate::privacy::PrivacyResult;
use serde::{Deserialize, Serialize};

pub const DEFAULT_DOCUMENT_MODEL: &str = "gpt-4.1-mini-2025-04-14";
pub const MAX_OUTPUT_TOKENS: u64 = 4_096;
pub const PRICING_CHECKED_AT: &str = "2026-09-28";

/// Integer nanodollars per token avoid rounding away sub-cent generations.
/// Standard processing, text only. Source: official OpenAI model pages.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentModel {
    pub id: String,
    pub name: String,
    pub input_nanos: u64,
    pub cached_input_nanos: u64,
    pub output_nanos: u64,
    pub pricing_checked_at: String,
}

pub fn document_models() -> Vec<DocumentModel> {
    [
        (
            DEFAULT_DOCUMENT_MODEL,
            "GPT-4.1 mini · Lower cost",
            400,
            100,
            1_600,
        ),
        ("gpt-4.1-2025-04-14", "GPT-4.1", 2_000, 500, 8_000),
    ]
    .into_iter()
    .map(
        |(id, name, input_nanos, cached_input_nanos, output_nanos)| DocumentModel {
            id: id.into(),
            name: name.into(),
            input_nanos,
            cached_input_nanos,
            output_nanos,
            pricing_checked_at: PRICING_CHECKED_AT.into(),
        },
    )
    .collect()
}

pub fn document_model(id: &str) -> PrivacyResult<DocumentModel> {
    document_models()
        .into_iter()
        .find(|model| model.id == id)
        .ok_or("Choose a supported document model in Settings or for this document.")
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenUsage {
    pub input_tokens: u64,
    pub cached_input_tokens: u64,
    pub output_tokens: u64,
}

impl TokenUsage {
    pub fn from_response(body: &serde_json::Value) -> Option<Self> {
        let value = body.get("usage")?;
        // Unknown billing categories must not silently produce a lower charge.
        if let Some(writes) = value.pointer("/input_tokens_details/cache_write_tokens") {
            if writes.as_u64()? != 0 {
                return None;
            }
        }
        let usage = Self {
            input_tokens: value.get("input_tokens")?.as_u64()?,
            cached_input_tokens: value
                .pointer("/input_tokens_details/cached_tokens")?
                .as_u64()?,
            output_tokens: value.get("output_tokens")?.as_u64()?,
        };
        usage.validate().ok()?;
        Some(usage)
    }

    pub fn validate(&self) -> PrivacyResult<()> {
        if self.cached_input_tokens > self.input_tokens
            || self.input_tokens > 2_000_000
            || self.output_tokens > 100_000
        {
            return Err("OpenAI returned unavailable usage information.");
        }
        Ok(())
    }
}

pub fn cost_nanos(model: &DocumentModel, usage: &TokenUsage) -> Option<u64> {
    usage.validate().ok()?;
    (usage.input_tokens - usage.cached_input_tokens)
        .checked_mul(model.input_nanos)?
        .checked_add(
            usage
                .cached_input_tokens
                .checked_mul(model.cached_input_nanos)?,
        )?
        .checked_add(usage.output_tokens.checked_mul(model.output_nanos)?)
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CostEstimate {
    pub input_token_allowance: u64,
    pub output_token_allowance: u64,
    pub cost_nanos: u64,
}

/// A deliberately conservative byte-based allowance, not a remote token-count
/// call or a billing quote. Includes an allowance for API message framing.
pub fn estimate(model: &DocumentModel, instructions: &str, input: &str) -> CostEstimate {
    let input_token_allowance = (instructions.len() + input.len()) as u64 + 128;
    CostEstimate {
        input_token_allowance,
        output_token_allowance: MAX_OUTPUT_TOKENS,
        cost_nanos: input_token_allowance * model.input_nanos
            + MAX_OUTPUT_TOKENS * model.output_nanos,
    }
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageSummary {
    pub reports_created: i64,
    pub generation_attempts: i64,
    pub known_cost_nanos: i64,
    pub unknown_cost_attempts: i64,
    pub latest_cost_nanos: Option<i64>,
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn cached_tokens_are_not_charged_twice_and_fractional_cents_survive() {
        let model = document_model(DEFAULT_DOCUMENT_MODEL).unwrap();
        assert_eq!(
            cost_nanos(
                &model,
                &TokenUsage {
                    input_tokens: 1_000,
                    cached_input_tokens: 400,
                    output_tokens: 500
                }
            ),
            Some(1_080_000)
        );
        assert_eq!(
            cost_nanos(
                &model,
                &TokenUsage {
                    input_tokens: 1,
                    cached_input_tokens: 0,
                    output_tokens: 1
                }
            ),
            Some(2_000)
        );
    }
    #[test]
    fn missing_or_invalid_usage_is_unknown_and_reasoning_is_not_added_twice() {
        assert!(TokenUsage::from_response(&serde_json::json!({})).is_none());
        let body = serde_json::json!({"usage": {"input_tokens": 100,
            "input_tokens_details": {"cached_tokens": 20}, "output_tokens": 50,
            "output_tokens_details": {"reasoning_tokens": 30}}});
        assert_eq!(TokenUsage::from_response(&body).unwrap().output_tokens, 50);
        assert!(cost_nanos(
            &document_model(DEFAULT_DOCUMENT_MODEL).unwrap(),
            &TokenUsage {
                input_tokens: 1,
                cached_input_tokens: 2,
                output_tokens: 1
            }
        )
        .is_none());
    }
    #[test]
    fn estimate_covers_unicode_bytes_and_the_output_allowance() {
        let model = document_model(DEFAULT_DOCUMENT_MODEL).unwrap();
        let quote = estimate(&model, "Write", "Zoë");
        assert_eq!(quote.input_token_allowance, 137);
        assert_eq!(quote.output_token_allowance, MAX_OUTPUT_TOKENS);
        assert!(quote.cost_nanos > MAX_OUTPUT_TOKENS * model.output_nanos);
    }
}
