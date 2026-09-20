mod rules;
mod session;

pub use rules::detect_rules;
pub use session::*;

use serde::{Deserialize, Serialize};

pub const MAX_CHARACTERS: usize = 20_000;
pub type PrivacyResult<T> = Result<T, &'static str>;

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum Category {
    Person,
    Location,
    Organisation,
    Misc,
    Email,
    Phone,
    Postcode,
    NhsNumber,
    NiNumber,
    Url,
    Date,
    CaseReference,
    Manual,
}

impl Category {
    pub fn label(self) -> &'static str {
        match self {
            Self::Person => "PERSON",
            Self::Location => "LOCATION",
            Self::Organisation => "ORGANISATION",
            Self::Misc => "MISC",
            Self::Email => "EMAIL",
            Self::Phone => "PHONE",
            Self::Postcode => "POSTCODE",
            Self::NhsNumber => "NHS_NUMBER",
            Self::NiNumber => "NI_NUMBER",
            Self::Url => "URL",
            Self::Date => "DATE",
            Self::CaseReference => "CASE_REFERENCE",
            Self::Manual => "MANUAL",
        }
    }
}

/// UTF-8 byte offsets, always on character boundaries. Converted at the UI boundary.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Span {
    pub start: usize,
    pub end: usize,
}

impl Span {
    pub fn overlaps(&self, other: &Self) -> bool {
        self.start < other.end && other.start < self.end
    }
    pub fn contains(&self, other: &Self) -> bool {
        self.start <= other.start && self.end >= other.end
    }
    pub fn valid_for(&self, text: &str) -> bool {
        self.start < self.end
            && self.end <= text.len()
            && text.is_char_boundary(self.start)
            && text.is_char_boundary(self.end)
    }
}

#[derive(Clone)]
pub struct Evidence {
    pub span: Span,
    pub category: Category,
    pub confidence: f32,
    pub stage: &'static str,
}

pub fn validate_source(text: &str) -> PrivacyResult<()> {
    if text.trim().is_empty() {
        return Err("Enter some source text first.");
    }
    if text.chars().count() > MAX_CHARACTERS {
        return Err("Use at most 20,000 characters.");
    }
    Ok(())
}

pub fn utf16_to_byte(text: &str, offset: usize) -> PrivacyResult<usize> {
    let mut position = 0;
    for (byte, ch) in text.char_indices() {
        if position == offset {
            return Ok(byte);
        }
        position += ch.len_utf16();
    }
    if position == offset {
        Ok(text.len())
    } else {
        Err("Select a complete phrase.")
    }
}

pub fn byte_to_utf16(text: &str, offset: usize) -> usize {
    text[..offset].encode_utf16().count()
}
