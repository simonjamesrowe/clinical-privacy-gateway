//! Local patient-document PDF rendering. No paths or clinical strings enter errors.
use crate::storage::DocumentExport;
use clinicians_veil_core::{
    document_generation::{BlockKind, DocumentRun},
    privacy::PrivacyResult,
};
use genpdf::{elements, fonts, style, Alignment, Element as _};
use std::{io::Cursor, path::Path};

const PDF_ERROR: &str = "The PDF could not be created. Check the document and try again.";

fn font(path: &str) -> PrivacyResult<fonts::FontData> {
    fonts::FontData::load(Path::new(path), None).map_err(|_| PDF_ERROR)
}

fn font_family() -> PrivacyResult<fonts::FontFamily<fonts::FontData>> {
    Ok(fonts::FontFamily {
        regular: font("/System/Library/Fonts/Supplemental/Arial.ttf")?,
        bold: font("/System/Library/Fonts/Supplemental/Arial Bold.ttf")?,
        italic: font("/System/Library/Fonts/Supplemental/Arial Italic.ttf")?,
        bold_italic: font("/System/Library/Fonts/Supplemental/Arial Bold Italic.ttf")?,
    })
}

/// Splits a block's runs into lines at the editor's hard breaks (`\n` inside a
/// run). genpdf does not break lines itself and draws a newline as a missing
/// glyph, so each line becomes its own paragraph.
fn lines(runs: &[DocumentRun]) -> Vec<Vec<(&str, bool)>> {
    let mut lines = vec![Vec::new()];
    for run in runs {
        for (index, piece) in run.text.split('\n').enumerate() {
            if index > 0 {
                lines.push(Vec::new());
            }
            let piece = piece.trim_end_matches('\r');
            if !piece.is_empty() {
                lines
                    .last_mut()
                    .expect("lines starts non-empty")
                    .push((piece, run.bold));
            }
        }
    }
    lines
}

fn paragraph(runs: &[DocumentRun]) -> elements::LinearLayout {
    let mut layout = elements::LinearLayout::vertical();
    for line in lines(runs) {
        if line.is_empty() {
            layout.push(elements::Break::new(1));
            continue;
        }
        let mut paragraph = elements::Paragraph::default();
        for (text, bold) in line {
            if bold {
                paragraph.push_styled(text, style::Style::new().bold());
            } else {
                paragraph.push(text);
            }
        }
        layout.push(paragraph);
    }
    layout
}

fn opaque_signature(bytes: &[u8]) -> PrivacyResult<Vec<u8>> {
    let mut decoder = png::Decoder::new(Cursor::new(bytes));
    decoder.set_transformations(png::Transformations::EXPAND | png::Transformations::STRIP_16);
    decoder.set_limits(png::Limits {
        bytes: 2 * 1024 * 1024,
    });
    let mut reader = decoder.read_info().map_err(|_| PDF_ERROR)?;
    let mut decoded = vec![0; reader.output_buffer_size()];
    let output = reader.next_frame(&mut decoded).map_err(|_| PDF_ERROR)?;
    let decoded = &decoded[..output.buffer_size()];
    let mut rgb = Vec::with_capacity(output.width as usize * output.height as usize * 3);
    match output.color_type {
        png::ColorType::Rgb => rgb.extend_from_slice(decoded),
        png::ColorType::Rgba => {
            for pixel in decoded.chunks_exact(4) {
                let alpha = pixel[3] as u16;
                for channel in &pixel[..3] {
                    rgb.push(((u16::from(*channel) * alpha + 255 * (255 - alpha)) / 255) as u8);
                }
            }
        }
        png::ColorType::Grayscale => {
            for value in decoded {
                rgb.extend_from_slice(&[*value, *value, *value]);
            }
        }
        png::ColorType::GrayscaleAlpha => {
            for pixel in decoded.chunks_exact(2) {
                let alpha = pixel[1] as u16;
                let value = ((u16::from(pixel[0]) * alpha + 255 * (255 - alpha)) / 255) as u8;
                rgb.extend_from_slice(&[value, value, value]);
            }
        }
        png::ColorType::Indexed => return Err(PDF_ERROR),
    }
    let mut encoded = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut encoded, output.width, output.height);
        encoder.set_color(png::ColorType::Rgb);
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder.write_header().map_err(|_| PDF_ERROR)?;
        writer.write_image_data(&rgb).map_err(|_| PDF_ERROR)?;
    }
    Ok(encoded)
}

pub fn render(export: &DocumentExport) -> PrivacyResult<Vec<u8>> {
    let mut pdf = genpdf::Document::new(font_family()?);
    pdf.set_title("Patient document");
    pdf.set_minimal_conformance();
    pdf.set_line_spacing(1.3);
    pdf.set_paper_size(genpdf::PaperSize::A4);
    let mut decorator = genpdf::SimplePageDecorator::new();
    decorator.set_margins(18);
    pdf.set_page_decorator(decorator);

    if !export.clinician.letter_header.is_empty() {
        for line in export.clinician.letter_header.lines() {
            pdf.push(
                elements::Paragraph::new(line)
                    .aligned(Alignment::Center)
                    .styled(style::Style::new().bold().with_font_size(11)),
            );
        }
        pdf.push(elements::Break::new(1));
    }
    if !export.document.reviewed {
        pdf.push(
            elements::Paragraph::new("DRAFT — NOT YET REVIEWED")
                .aligned(Alignment::Center)
                .styled(
                    style::Style::new()
                        .bold()
                        .with_font_size(11)
                        .with_color(style::Color::Rgb(140, 50, 40)),
                ),
        );
        pdf.push(elements::Break::new(1));
    }
    pdf.push(
        elements::Paragraph::new(&export.document.title)
            .styled(style::Style::new().bold().with_font_size(18)),
    );
    pdf.push(elements::Break::new(1));
    for block in &export.document.body.blocks {
        match block.kind {
            BlockKind::Heading => pdf
                .push(paragraph(&block.runs).styled(style::Style::new().bold().with_font_size(14))),
            BlockKind::BulletedList => {
                pdf.push(elements::BulletPoint::new(paragraph(&block.runs)).with_bullet("•"))
            }
            BlockKind::Paragraph => pdf.push(paragraph(&block.runs)),
        }
        pdf.push(elements::Break::new(0.45));
    }

    let clinician = [
        export.clinician.display_name.as_str(),
        export.clinician.role.as_str(),
        export.clinician.qualifications.as_str(),
    ]
    .into_iter()
    .filter(|value| !value.is_empty())
    .collect::<Vec<_>>();
    if !clinician.is_empty() || export.signature.is_some() {
        pdf.push(elements::Break::new(1.5));
        if let Some(signature) = &export.signature {
            let signature = opaque_signature(signature)?;
            let image = elements::Image::from_reader(Cursor::new(signature))
                .map_err(|_| PDF_ERROR)?
                .with_alignment(Alignment::Left);
            pdf.push(image);
            pdf.push(elements::Break::new(0.4));
        }
        for line in clinician {
            pdf.push(elements::Paragraph::new(line));
        }
    }

    let mut bytes = Vec::new();
    pdf.render(&mut bytes).map_err(|_| PDF_ERROR)?;
    Ok(bytes)
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::*;
    use clinicians_veil_core::document_generation::{
        ClinicianProfile, DocumentBlock, DocumentBody, PatientDocument,
    };
    use std::sync::atomic::AtomicBool;

    fn signature() -> Vec<u8> {
        let mut bytes = Vec::new();
        {
            let mut encoder = png::Encoder::new(&mut bytes, 8, 4);
            encoder.set_color(png::ColorType::Rgba);
            encoder.set_depth(png::BitDepth::Eight);
            encoder
                .write_header()
                .unwrap()
                .write_image_data(&[80; 128])
                .unwrap();
        }
        bytes
    }

    fn run(text: &str, bold: bool) -> DocumentRun {
        DocumentRun {
            text: text.into(),
            bold,
        }
    }

    #[test]
    fn splits_runs_into_lines_at_hard_breaks() {
        let runs = [
            run("Re: ", true),
            run("Synthetic Patient\nDate of birth: ", false),
            run("01/01/1990", true),
            run("\n\nEnd", false),
        ];
        assert_eq!(
            super::lines(&runs),
            vec![
                vec![("Re: ", true), ("Synthetic Patient", false)],
                vec![("Date of birth: ", false), ("01/01/1990", true)],
                vec![],
                vec![("End", false)],
            ]
        );
    }

    #[test]
    fn renders_hard_breaks_as_separate_lines() {
        let mut export = synthetic_export();
        export.document.body.blocks = vec![DocumentBlock {
            kind: BlockKind::Paragraph,
            runs: vec![
                run("Re: ", true),
                run("Synthetic Patient\nDate of birth: 01/01/1990\n", false),
                run("Reference: SYN 0000", true),
            ],
        }];

        let bytes = render(&export).unwrap();
        let extracted =
            super::super::pdf::extract(&bytes, &AtomicBool::new(false), |_, _| {}).unwrap();
        for expected in [
            "Re: Synthetic Patient",
            "Date of birth: 01/01/1990",
            "Reference: SYN 0000",
        ] {
            assert!(
                extracted.text.contains(expected),
                "missing {expected} in {:?}",
                extracted.text
            );
        }
        // Whether those lines come back separated depends on PDFKit's reading-order
        // heuristics, which differ between macOS versions, so the split itself is
        // asserted by `splits_runs_into_lines_at_hard_breaks` instead.
    }

    fn synthetic_export() -> DocumentExport {
        DocumentExport {
            document: PatientDocument {
                id: 8,
                patient_id: 4,
                title: "Synthetic follow up letter".into(),
                template_id: 1,
                template_name: "Synthetic template".into(),
                revision: 1,
                body: DocumentBody { blocks: vec![] },
                reviewed: false,
                include_signature: false,
                created_at: 1,
                updated_at: 1,
            },
            clinician: ClinicianProfile {
                display_name: String::new(),
                role: String::new(),
                qualifications: String::new(),
                letter_header: String::new(),
                has_signature: false,
            },
            signature: None,
        }
    }

    #[test]
    fn renders_local_header_rich_text_draft_marker_and_signature() {
        let export = DocumentExport {
            document: PatientDocument {
                id: 8,
                patient_id: 4,
                title: "Synthetic follow up letter".into(),
                template_id: 1,
                template_name: "Synthetic template".into(),
                revision: 1,
                body: DocumentBody {
                    blocks: vec![
                        DocumentBlock {
                            kind: BlockKind::Heading,
                            runs: vec![DocumentRun {
                                text: "Review".into(),
                                bold: false,
                            }],
                        },
                        DocumentBlock {
                            kind: BlockKind::Paragraph,
                            runs: vec![
                                DocumentRun {
                                    text: "A ".into(),
                                    bold: false,
                                },
                                DocumentRun {
                                    text: "synthetic".into(),
                                    bold: true,
                                },
                                DocumentRun {
                                    text: " result.".into(),
                                    bold: false,
                                },
                            ],
                        },
                    ],
                },
                reviewed: false,
                include_signature: true,
                created_at: 1,
                updated_at: 1,
            },
            clinician: ClinicianProfile {
                display_name: "Dr Synthetic".into(),
                role: "Clinician".into(),
                qualifications: "Test qualification".into(),
                letter_header: "Synthetic Health Centre\nTest Street".into(),
                has_signature: true,
            },
            signature: Some(signature()),
        };

        let bytes = render(&export).unwrap();
        assert!(bytes.starts_with(b"%PDF-"));
        assert!(bytes.windows(14).any(|value| value == b"/Subtype/Image"));
        let extracted =
            super::super::pdf::extract(&bytes, &AtomicBool::new(false), |_, _| {}).unwrap();
        for expected in [
            "Synthetic Health Centre",
            "DRAFT",
            "Synthetic follow up letter",
            "A synthetic result.",
            "Dr Synthetic",
        ] {
            assert!(extracted.text.contains(expected), "missing {expected}");
        }
    }
}
