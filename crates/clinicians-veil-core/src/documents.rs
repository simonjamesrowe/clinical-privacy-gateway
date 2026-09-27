//! Document policy and content-only views. Parsing and native rendering belong to adapters.
use crate::privacy::{validate_source, PrivacyResult};
use serde::{Deserialize, Serialize};

pub const MAX_FILE_BYTES: usize = 25 * 1024 * 1024;
pub const MAX_EXPANDED_BYTES: u64 = 100 * 1024 * 1024;
pub const MAX_PDF_PAGES: usize = 500;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DocumentFormat {
    Txt,
    Docx,
    Pdf,
}
impl DocumentFormat {
    pub fn extension(self) -> &'static str {
        match self {
            Self::Txt => "txt",
            Self::Docx => "docx",
            Self::Pdf => "pdf",
        }
    }
    pub fn from_extension(extension: &str) -> PrivacyResult<Self> {
        match extension.to_ascii_lowercase().as_str() {
            "txt" => Ok(Self::Txt),
            "docx" => Ok(Self::Docx),
            "pdf" => Ok(Self::Pdf),
            _ => Err("Choose a .txt, .docx or .pdf document."),
        }
    }
}

#[derive(Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentMetadata {
    pub name: String,
    pub format: DocumentFormat,
    pub byte_length: usize,
}

/// Deliberately no serialization of original bytes and no content-bearing Debug output.
#[derive(Clone, PartialEq, Eq, Hash)]
pub struct OriginalDocument {
    pub metadata: DocumentMetadata,
    pub bytes: Vec<u8>,
}
impl std::fmt::Debug for OriginalDocument {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("OriginalDocument")
            .field("content", &"[REDACTED]")
            .finish()
    }
}

#[derive(Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum DocumentBlock {
    Paragraph { text: String },
    Heading { text: String },
    ListItem { text: String },
    Table { rows: Vec<Vec<String>> },
}
impl DocumentBlock {
    pub fn text(&self) -> String {
        match self {
            Self::Paragraph { text } | Self::Heading { text } | Self::ListItem { text } => {
                text.clone()
            }
            Self::Table { rows } => rows
                .iter()
                .map(|row| row.join("\t"))
                .collect::<Vec<_>>()
                .join("\n"),
        }
    }
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtractedDocument {
    pub text: String,
    pub blocks: Vec<DocumentBlock>,
    pub warnings: Vec<String>,
    pub page_count: Option<usize>,
}
impl ExtractedDocument {
    pub fn from_blocks(blocks: Vec<DocumentBlock>, warnings: Vec<String>) -> PrivacyResult<Self> {
        let text = blocks
            .iter()
            .map(DocumentBlock::text)
            .collect::<Vec<_>>()
            .join("\n");
        validate_source(&text)?;
        Ok(Self {
            text,
            blocks,
            warnings,
            page_count: None,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn original_equality_is_content_based_and_debug_redacts_everything() {
        let original = OriginalDocument {
            metadata: DocumentMetadata {
                name: "synthetic-private.txt".into(),
                format: DocumentFormat::Txt,
                byte_length: 7,
            },
            bytes: b"private".to_vec(),
        };
        assert_eq!(original, original.clone());
        let mut different = original.clone();
        different.bytes[0] = b'x';
        assert_ne!(original, different);
        let debug = format!("{original:?}");
        assert!(!debug.contains("private"));
        assert!(!debug.contains("112"));
    }
}
