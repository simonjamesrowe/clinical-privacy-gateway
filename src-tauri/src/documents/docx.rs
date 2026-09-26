use super::cancelled;
use clinicians_veil_core::{
    documents::*,
    privacy::{PrivacyResult, MAX_CHARACTERS},
};
use quick_xml::{events::Event, Reader};
use std::{
    collections::BTreeSet,
    io::{Cursor, Read},
    sync::atomic::AtomicBool,
};
const ERROR: &str = "The Word document could not be read. Save it as .docx and try again.";
const LIMIT: &str = "The Word document is too complex or expands beyond 100 MiB.";

pub fn extract(bytes: &[u8], cancel: &AtomicBool) -> PrivacyResult<ExtractedDocument> {
    let mut archive = zip::ZipArchive::new(Cursor::new(bytes)).map_err(|_| ERROR)?;
    if archive.len() > 10_000
        || archive
            .decompressed_size()
            .is_none_or(|size| size > MAX_EXPANDED_BYTES as u128)
    {
        return Err(LIMIT);
    }
    let mut parts = Vec::new();
    let mut warnings = BTreeSet::new();
    let mut expanded = 0u64;
    let mut names = BTreeSet::new();
    for index in 0..archive.len() {
        cancelled(cancel)?;
        let mut file = archive.by_index(index).map_err(|_| ERROR)?;
        let name = file.name().to_owned();
        if !names.insert(name.clone()) || file.enclosed_name().is_none() {
            return Err(ERROR);
        }
        if name.starts_with("word/comments") {
            warnings.insert(
                "Comments are not included in the extracted text or simplified preview.".to_owned(),
            );
        }
        if name.starts_with("word/media/") || name.starts_with("word/embeddings/") {
            warnings.insert("Images and embedded objects are not extracted or displayed in the simplified preview.".to_owned());
        }
        // Read with an actual byte limit as well as checking ZIP metadata. Never unpack to disk.
        let mut data = Vec::new();
        file.by_ref()
            .take(MAX_EXPANDED_BYTES - expanded + 1)
            .read_to_end(&mut data)
            .map_err(|_| ERROR)?;
        expanded += data.len() as u64;
        if expanded > MAX_EXPANDED_BYTES {
            return Err(LIMIT);
        }
        if name == "word/document.xml"
            || name == "word/footnotes.xml"
            || name == "word/endnotes.xml"
            || ((name.starts_with("word/header") || name.starts_with("word/footer"))
                && name.ends_with(".xml"))
        {
            parts.push((name, data));
        }
    }
    if !parts.iter().any(|(name, _)| name == "word/document.xml") {
        return Err(ERROR);
    }
    parts.sort_by_key(|(name, _)| (name != "word/document.xml", name.clone()));
    let mut blocks = Vec::new();
    let mut characters = 0;
    for (name, xml) in parts {
        if name != "word/document.xml" {
            let label = if name.contains("header") {
                "Header"
            } else if name.contains("footer") {
                "Footer"
            } else if name.contains("footnotes") {
                "Footnotes"
            } else {
                "Endnotes"
            };
            blocks.push(DocumentBlock::Heading { text: label.into() });
        }
        parse(&xml, cancel, &mut blocks, &mut warnings, &mut characters)?;
    }
    ExtractedDocument::from_blocks(blocks, warnings.into_iter().collect())
}

fn parse(
    xml: &[u8],
    cancel: &AtomicBool,
    blocks: &mut Vec<DocumentBlock>,
    warnings: &mut BTreeSet<String>,
    characters: &mut usize,
) -> PrivacyResult<()> {
    let mut reader = Reader::from_reader(xml);
    reader.config_mut().expand_empty_elements = true;
    let mut depth = 0usize;
    let mut skip = None;
    let mut text_depth = None;
    let mut paragraph = String::new();
    let mut heading = false;
    let mut list = false;
    let mut table_depth = 0;
    let mut rows = Vec::new();
    let mut row = Vec::new();
    let mut cell = String::new();
    let mut root_seen = false;
    let mut events = 0;
    loop {
        cancelled(cancel)?;
        events += 1;
        if events > 1_000_000 {
            return Err(LIMIT);
        }
        match reader.read_event().map_err(|_| ERROR)? {
            Event::Start(e) => {
                depth += 1;
                if depth > 128 {
                    return Err(LIMIT);
                }
                let name = e.local_name();
                if !root_seen {
                    root_seen = true;
                    if !matches!(
                        name.as_ref(),
                        b"document" | b"hdr" | b"ftr" | b"footnotes" | b"endnotes"
                    ) {
                        return Err(ERROR);
                    }
                }
                if skip.is_some() {
                    continue;
                }
                match name.as_ref() {
                    b"del" | b"moveFrom" => {
                        skip = Some(depth);
                        warnings.insert("Tracked changes use the current revision: inserted text is included and deleted text is omitted.".into());
                    }
                    b"ins" | b"moveTo" => {
                        warnings.insert("Tracked changes use the current revision: inserted text is included and deleted text is omitted.".into());
                    }
                    b"drawing" | b"pict" | b"object" | b"altChunk" => {
                        skip = Some(depth);
                        warnings.insert("Images, text boxes and embedded content may be omitted. Check the extracted text before continuing.".into());
                    }
                    b"p" => {
                        paragraph.clear();
                        heading = false;
                        list = false;
                    }
                    b"pStyle" => {
                        for attr in e.attributes() {
                            let attr = attr.map_err(|_| ERROR)?;
                            if attr.key.local_name().as_ref() == b"val" {
                                let value = attr
                                    .decode_and_unescape_value(reader.decoder())
                                    .map_err(|_| ERROR)?;
                                heading = value.to_ascii_lowercase().starts_with("heading")
                                    || value == "Title";
                            }
                        }
                    }
                    b"numPr" => list = true,
                    b"t" => text_depth = Some(depth),
                    b"tab" => paragraph.push('\t'),
                    b"br" | b"cr" => paragraph.push('\n'),
                    b"tbl" => {
                        table_depth += 1;
                        if table_depth > 1 {
                            return Err("Nested Word tables are unsupported. Simplify the document and try again.");
                        }
                    }
                    b"tr" => row.clear(),
                    b"tc" => cell.clear(),
                    _ => {}
                }
            }
            Event::Text(e) if skip.is_none() && text_depth.is_some() => {
                let text = e.xml_content().map_err(|_| ERROR)?;
                *characters += text.chars().count();
                if *characters > MAX_CHARACTERS {
                    return Err("Use at most 100,000 characters.");
                }
                paragraph.push_str(&text);
            }
            Event::GeneralRef(e) if skip.is_none() && text_depth.is_some() => {
                let name = e.decode().map_err(|_| ERROR)?;
                let escaped = format!("&{name};");
                let text = quick_xml::escape::unescape(&escaped).map_err(|_| ERROR)?;
                paragraph.push_str(&text);
                *characters += text.chars().count();
                if *characters > MAX_CHARACTERS {
                    return Err("Use at most 100,000 characters.");
                }
            }
            Event::End(e) => {
                if skip == Some(depth) {
                    skip = None;
                } else if skip.is_none() {
                    match e.local_name().as_ref() {
                        b"t" => text_depth = None,
                        b"p" => {
                            let text = std::mem::take(&mut paragraph);
                            if table_depth > 0 {
                                if !cell.is_empty() {
                                    cell.push('\n');
                                }
                                cell.push_str(&text);
                            } else {
                                blocks.push(if heading {
                                    DocumentBlock::Heading { text }
                                } else if list {
                                    DocumentBlock::ListItem { text }
                                } else {
                                    DocumentBlock::Paragraph { text }
                                });
                            }
                        }
                        b"tc" => row.push(std::mem::take(&mut cell)),
                        b"tr" => rows.push(std::mem::take(&mut row)),
                        b"tbl" => {
                            table_depth -= 1;
                            blocks.push(DocumentBlock::Table {
                                rows: std::mem::take(&mut rows),
                            });
                        }
                        _ => {}
                    }
                }
                depth = depth.checked_sub(1).ok_or(ERROR)?;
            }
            Event::DocType(_) | Event::CData(_) => return Err(ERROR),
            Event::Eof => break,
            _ => {}
        }
    }
    if depth != 0 || !root_seen {
        return Err(ERROR);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    fn fixture(parts: &[(&str, &str)]) -> Vec<u8> {
        let mut zip = zip::ZipWriter::new(Cursor::new(Vec::new()));
        for (name, data) in parts {
            zip.start_file(*name, zip::write::SimpleFileOptions::default())
                .unwrap();
            zip.write_all(data.as_bytes()).unwrap();
        }
        zip.finish().unwrap().into_inner()
    }
    #[test]
    fn extracts_structure_supplementary_parts_and_current_revision() {
        let bytes = fixture(&[
            (
                "word/document.xml",
                r#"<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Synthetic &amp; review</w:t></w:r></w:p><w:p><w:del><w:r><w:delText>deleted-secret</w:delText></w:r></w:del><w:ins><w:r><w:t>current</w:t></w:r></w:ins></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Dose</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>10 mg</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>"#,
            ),
            (
                "word/header1.xml",
                "<hdr><p><r><t>Header text</t></r></p></hdr>",
            ),
            (
                "word/footnotes.xml",
                "<footnotes><footnote><p><r><t>Footnote text</t></r></p></footnote></footnotes>",
            ),
            ("word/comments.xml", "omitted"),
        ]);
        let result = extract(&bytes, &AtomicBool::new(false)).unwrap();
        assert!(result
            .text
            .contains("Synthetic & review\ncurrent\nDose\t10 mg"));
        assert!(result.text.contains("Header text"));
        assert!(result.text.contains("Footnote text"));
        assert!(!result.text.contains("deleted-secret"));
        assert_eq!(result.warnings.len(), 2);
        assert!(matches!(result.blocks[0], DocumentBlock::Heading { .. }));
        assert!(matches!(result.blocks[2], DocumentBlock::Table { .. }));
    }
    #[test]
    fn bounds_expansion_depth_and_extracted_characters() {
        let oversized = format!("<document><p><t>{}</t></p></document>", "x".repeat(100_001));
        assert!(extract(
            &fixture(&[("word/document.xml", &oversized)]),
            &AtomicBool::new(false)
        )
        .is_err());
        let deep = format!(
            "<document>{}{}</document>",
            "<p>".repeat(130),
            "</p>".repeat(130)
        );
        assert!(extract(
            &fixture(&[("word/document.xml", &deep)]),
            &AtomicBool::new(false)
        )
        .is_err());
        let mut archive = zip::ZipWriter::new(Cursor::new(Vec::new()));
        archive
            .start_file(
                "word/document.xml",
                zip::write::SimpleFileOptions::default()
                    .compression_method(zip::CompressionMethod::Deflated),
            )
            .unwrap();
        let chunk = vec![b' '; 1024 * 1024];
        for _ in 0..101 {
            archive.write_all(&chunk).unwrap();
        }
        let bytes = archive.finish().unwrap().into_inner();
        assert_eq!(extract(&bytes, &AtomicBool::new(false)).err(), Some(LIMIT));
    }
    #[test]
    fn rejects_malformed_entities_and_honours_cancellation() {
        for xml in ["broken", "<!DOCTYPE document [<!ENTITY x SYSTEM 'file:///private'>]><document><p><t>&x;</t></p></document>", "<document><p>"] {
            assert!(extract(&fixture(&[("word/document.xml",xml)]), &AtomicBool::new(false)).is_err());
        }
        assert!(extract(
            &fixture(&[("word/document.xml", "<document/>")]),
            &AtomicBool::new(true)
        )
        .is_err());
    }
}
