//! Local, bounded document adapters. Errors never contain paths or clinical material.
mod docx;
mod pdf;
use clinicians_veil_core::{documents::*, privacy::PrivacyResult};
use std::{
    fs::File,
    io::Read,
    path::Path,
    sync::atomic::{AtomicBool, Ordering},
};

pub fn cancelled(cancel: &AtomicBool) -> PrivacyResult<()> {
    if cancel.load(Ordering::Relaxed) {
        Err("Document processing cancelled.")
    } else {
        Ok(())
    }
}
pub fn read(path: &Path, cancel: &AtomicBool) -> PrivacyResult<OriginalDocument> {
    cancelled(cancel)?;
    let format =
        DocumentFormat::from_extension(path.extension().and_then(|s| s.to_str()).unwrap_or(""))?;
    let file = File::open(path).map_err(|_| "The document could not be read. Choose it again.")?;
    if !file
        .metadata()
        .map_err(|_| "The document could not be read.")?
        .is_file()
    {
        return Err("Choose a regular document file.");
    }
    let mut bytes = Vec::new();
    file.take((MAX_FILE_BYTES + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|_| "The document could not be read.")?;
    cancelled(cancel)?;
    if bytes.len() > MAX_FILE_BYTES {
        return Err("Choose a document smaller than 25 MiB.");
    }
    let name = path
        .file_name()
        .and_then(|s| s.to_str())
        .ok_or("The document name could not be read.")?
        .to_owned();
    Ok(OriginalDocument {
        metadata: DocumentMetadata {
            name,
            format,
            byte_length: bytes.len(),
        },
        bytes,
    })
}
pub fn extract(
    original: &OriginalDocument,
    cancel: &AtomicBool,
    progress: impl Fn(usize, usize),
) -> PrivacyResult<ExtractedDocument> {
    cancelled(cancel)?;
    let extracted = match original.metadata.format {
        DocumentFormat::Txt => {
            let text = decode_text(&original.bytes)?;
            ExtractedDocument::from_blocks(vec![DocumentBlock::Paragraph { text }], vec![])?
        }
        DocumentFormat::Docx => docx::extract(&original.bytes, cancel)?,
        DocumentFormat::Pdf => pdf::extract(&original.bytes, cancel, progress)?,
    };
    cancelled(cancel)?;
    Ok(extracted)
}
fn decode_text(bytes: &[u8]) -> PrivacyResult<String> {
    const ERROR: &str =
        "The text encoding is unsupported. Save the document as UTF-8 and try again.";
    if bytes.starts_with(&[0xff, 0xfe]) || bytes.starts_with(&[0xfe, 0xff]) {
        let little = bytes[0] == 0xff;
        let bytes = &bytes[2..];
        if bytes.len() % 2 != 0 {
            return Err(ERROR);
        }
        let units: Vec<_> = bytes
            .chunks_exact(2)
            .map(|b| {
                if little {
                    u16::from_le_bytes([b[0], b[1]])
                } else {
                    u16::from_be_bytes([b[0], b[1]])
                }
            })
            .collect();
        String::from_utf16(&units).map_err(|_| ERROR)
    } else {
        String::from_utf8(
            bytes
                .strip_prefix(&[0xef, 0xbb, 0xbf])
                .unwrap_or(bytes)
                .to_vec(),
        )
        .map_err(|_| ERROR)
    }
    .and_then(|text| {
        if text.contains('\0') {
            Err(ERROR)
        } else {
            Ok(text)
        }
    })
}
pub use pdf::render_page;

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn import_bounds_file_size_characters_and_never_changes_the_external_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("synthetic.txt");
        let cancel = AtomicBool::new(false);
        for length in [99_999, 100_000, 100_001] {
            std::fs::write(&path, "🩺".repeat(length)).unwrap();
            let original = read(&path, &cancel).unwrap();
            assert_eq!(
                extract(&original, &cancel, |_, _| {}).is_ok(),
                length <= 100_000
            );
            assert_eq!(std::fs::read(&path).unwrap(), original.bytes);
        }
        let file = std::fs::File::create(&path).unwrap();
        file.set_len((MAX_FILE_BYTES + 1) as u64).unwrap();
        assert!(read(&path, &cancel).is_err());
        assert!(read(&dir.path().join("unsupported.doc"), &cancel).is_err());
    }
    #[test]
    fn synthetic_testing_kit_imports_through_native_adapters() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../test-data/synthetic");
        let cancel = AtomicBool::new(false);
        for folder in ["word", "pdf", "notes"] {
            let paths: Vec<_> = std::fs::read_dir(root.join(folder)).unwrap().collect();
            assert_eq!(paths.len(), 10);
            for path in paths {
                let path = path.unwrap().path();
                let original = read(&path, &cancel).unwrap();
                let extracted = extract(&original, &cancel, |_, _| {}).unwrap();
                for expected in ["SYNTHETIC TEST DATA", "Visit 1", "Visit 2", "[CLIENT]"] {
                    assert!(
                        extracted.text.contains(expected),
                        "{}: {expected}",
                        path.display()
                    );
                }
                if path
                    .file_name()
                    .unwrap()
                    .to_string_lossy()
                    .starts_with("06")
                {
                    // PDFKit versions may emit canonically equivalent decomposed accents.
                    // Normalize only this fixture assertion; source text stays untouched.
                    let canonical = extracted
                        .text
                        .replace("e\u{308}", "ë")
                        .replace("e\u{301}", "é");
                    assert!(
                        canonical.contains("Zoë Marlow"),
                        "Unicode patient name missing in {}",
                        path.display()
                    );
                    assert!(
                        canonical.contains("René Marlow"),
                        "Unicode contact name missing in {}",
                        path.display()
                    );
                }
            }
        }
    }

    #[test]
    fn text_encodings_are_strict_and_preserve_unicode() {
        assert_eq!(
            decode_text("🩺 synthetic".as_bytes()).unwrap(),
            "🩺 synthetic"
        );
        assert_eq!(decode_text(b"\xef\xbb\xbfhello").unwrap(), "hello");
        for little in [true, false] {
            let mut bytes = if little {
                vec![255, 254]
            } else {
                vec![254, 255]
            };
            for unit in "🩺 synthetic".encode_utf16() {
                bytes.extend(if little {
                    unit.to_le_bytes()
                } else {
                    unit.to_be_bytes()
                });
            }
            assert_eq!(decode_text(&bytes).unwrap(), "🩺 synthetic");
        }
        assert!(decode_text(&[255, 254, 0]).is_err());
        assert!(decode_text(&[255, 254, 0, 216]).is_err());
        assert!(decode_text(&[255]).is_err());
        assert!(decode_text(b"a\0b").is_err());
    }
}
