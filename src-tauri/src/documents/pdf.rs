use super::cancelled;
use clinicians_veil_core::{
    documents::*,
    privacy::{PrivacyResult, MAX_CHARACTERS},
};
use std::sync::atomic::AtomicBool;

#[cfg(target_os = "macos")]
mod native {
    use super::*;
    use base64::{engine::general_purpose::STANDARD, Engine};
    use objc2::{
        rc::{autoreleasepool, Retained},
        AnyThread,
    };
    use objc2_app_kit::{NSBitmapImageFileType, NSBitmapImageRep};
    use objc2_foundation::{NSData, NSDictionary, NSSize};
    use objc2_pdf_kit::{PDFDisplayBox, PDFDocument};
    const ERROR: &str = "The PDF could not be read. Save a new copy and try again.";
    fn document(bytes: &[u8]) -> PrivacyResult<Retained<PDFDocument>> {
        if !bytes.starts_with(b"%PDF-") {
            return Err(ERROR);
        }
        // PDFKit receives immutable in-memory data; no URL, actions or external resources.
        let pdf =
            unsafe { PDFDocument::initWithData(PDFDocument::alloc(), &NSData::with_bytes(bytes)) }
                .ok_or(ERROR)?;
        if unsafe { pdf.isEncrypted() || pdf.isLocked() } {
            return Err("Password-protected PDFs are unsupported. Choose an unprotected copy.");
        }
        if !unsafe { pdf.allowsCopying() } {
            return Err("This PDF does not permit text extraction. Choose another copy.");
        }
        let pages = unsafe { pdf.pageCount() };
        if pages == 0 || pages > MAX_PDF_PAGES {
            return Err("Choose a PDF with between 1 and 500 pages.");
        }
        Ok(pdf)
    }
    pub fn extract(
        bytes: &[u8],
        cancel: &AtomicBool,
        progress: impl Fn(usize, usize),
    ) -> PrivacyResult<ExtractedDocument> {
        autoreleasepool(|_| {
            let pdf = document(bytes)?;
            let count = unsafe { pdf.pageCount() };
            let mut blocks = Vec::new();
            let mut missing = Vec::new();
            let mut characters = 0;
            for index in 0..count {
                cancelled(cancel)?;
                let page = unsafe { pdf.pageAtIndex(index) }.ok_or(ERROR)?;
                let text = unsafe { page.string() }
                    .map(|s| s.to_string())
                    .unwrap_or_default();
                characters += text.chars().count() + usize::from(index > 0);
                if characters > MAX_CHARACTERS {
                    return Err("Use at most 100,000 characters.");
                }
                if text.trim().is_empty() {
                    missing.push((index + 1).to_string());
                }
                blocks.push(DocumentBlock::Paragraph { text });
                progress(index + 1, count);
            }
            if missing.len() == count {
                return Err("This PDF has no selectable text. Scanned PDFs require OCR, which is not included. Choose a text-based document.");
            }
            let mut warnings = vec!["Only selectable PDF text is extracted; text in images is not included. Check the reading order and any image content.".into()];
            if !missing.is_empty() {
                warnings.push(format!("No selectable text on pages {}. Check those pages in the original before continuing.", missing.join(", ")));
            }
            let mut result = ExtractedDocument::from_blocks(blocks, warnings)?;
            result.page_count = Some(count);
            Ok(result)
        })
    }
    pub fn render_page(bytes: &[u8], page: usize, width: usize) -> PrivacyResult<String> {
        autoreleasepool(|_| {
            let pdf = document(bytes)?;
            let page = unsafe { pdf.pageAtIndex(page) }.ok_or("This PDF page is unavailable.")?;
            let width = width.clamp(400, 1600) as f64;
            let image = unsafe {
                page.thumbnailOfSize_forBox(NSSize::new(width, width * 1.5), PDFDisplayBox::CropBox)
            };
            let tiff = image.TIFFRepresentation().ok_or(ERROR)?;
            let bitmap =
                NSBitmapImageRep::initWithData(NSBitmapImageRep::alloc(), &tiff).ok_or(ERROR)?;
            let data = unsafe {
                bitmap.representationUsingType_properties(
                    NSBitmapImageFileType::PNG,
                    &NSDictionary::new(),
                )
            }
            .ok_or(ERROR)?;
            Ok(format!(
                "data:image/png;base64,{}",
                STANDARD.encode(data.to_vec())
            ))
        })
    }
}
#[cfg(target_os = "macos")]
pub use native::{extract, render_page};
#[cfg(not(target_os = "macos"))]
pub fn extract(
    _: &[u8],
    _: &AtomicBool,
    _: impl Fn(usize, usize),
) -> PrivacyResult<ExtractedDocument> {
    Err("PDF import requires macOS.")
}
#[cfg(not(target_os = "macos"))]
pub fn render_page(_: &[u8], _: usize, _: usize) -> PrivacyResult<String> {
    Err("PDF preview requires macOS.")
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::*;
    fn fixture(pages: &[&str]) -> Vec<u8> {
        let kids = (0..pages.len())
            .map(|i| format!("{} 0 R", 4 + i * 2))
            .collect::<Vec<_>>()
            .join(" ");
        let mut objects = vec![
            "<< /Type /Catalog /Pages 2 0 R >>".to_owned(),
            format!("<< /Type /Pages /Kids [{kids}] /Count {} >>", pages.len()),
            "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>".to_owned(),
        ];
        for (i, text) in pages.iter().enumerate() {
            objects.push(format!("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents {} 0 R >>", 5 + i * 2));
            let stream = format!("BT /F1 12 Tf 72 720 Td ({text}) Tj ET");
            objects.push(format!(
                "<< /Length {} >>\nstream\n{stream}\nendstream",
                stream.len()
            ));
        }
        let mut pdf = String::from("%PDF-1.4\n");
        let mut offsets = vec![0];
        for (i, object) in objects.iter().enumerate() {
            offsets.push(pdf.len());
            pdf.push_str(&format!("{} 0 obj\n{object}\nendobj\n", i + 1));
        }
        let xref = pdf.len();
        pdf.push_str(&format!("xref\n0 {}\n0000000000 65535 f \n", offsets.len()));
        for offset in offsets.iter().skip(1) {
            pdf.push_str(&format!("{offset:010} 00000 n \n"));
        }
        pdf.push_str(&format!(
            "trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF",
            offsets.len()
        ));
        pdf.into_bytes()
    }
    #[test]
    fn extracts_pages_in_order_flags_missing_text_and_renders_inert_png() {
        let bytes = fixture(&["Synthetic first page", "", "Synthetic final page"]);
        let extracted = extract(&bytes, &AtomicBool::new(false), |_, _| {}).unwrap();
        assert_eq!(extracted.page_count, Some(3));
        assert!(extracted.text.find("first").unwrap() < extracted.text.find("final").unwrap());
        assert!(extracted
            .warnings
            .iter()
            .any(|warning| warning.contains("pages 2")));
        let image = render_page(&bytes, 0, 800).unwrap();
        assert!(image.starts_with("data:image/png;base64,iVBOR"));
        assert!(render_page(&bytes, 3, 800).is_err());
    }
    #[test]
    fn rejects_password_protected_pdf_without_prompting_or_persisting_a_password() {
        use objc2::{rc::autoreleasepool, AnyThread};
        use objc2_foundation::{NSData, NSDictionary, NSString};
        use objc2_pdf_kit::{
            PDFDocument, PDFDocumentOwnerPasswordOption, PDFDocumentUserPasswordOption,
        };
        autoreleasepool(|_| {
            let pdf = unsafe {
                PDFDocument::initWithData(
                    PDFDocument::alloc(),
                    &NSData::with_bytes(&fixture(&["Synthetic protected material"])),
                )
            }
            .unwrap();
            let options = NSDictionary::from_slices(
                &[unsafe { PDFDocumentUserPasswordOption }, unsafe {
                    PDFDocumentOwnerPasswordOption
                }],
                &[
                    &*NSString::from_str("synthetic-test-password"),
                    &*NSString::from_str("synthetic-owner-password"),
                ],
            );
            // Erase lightweight generic types for PDFKit's untyped options dictionary.
            let options = unsafe {
                options.cast_unchecked::<objc2::runtime::AnyObject, objc2::runtime::AnyObject>()
            };
            let protected = unsafe { pdf.dataRepresentationWithOptions(&options) }.unwrap();
            assert!(
                extract(&protected.to_vec(), &AtomicBool::new(false), |_, _| {})
                    .err()
                    .unwrap()
                    .contains("Password")
            );
        });
    }
    #[test]
    fn rejects_image_only_invalid_and_excessive_page_documents() {
        assert!(extract(&fixture(&[""]), &AtomicBool::new(false), |_, _| {}).is_err());
        assert!(extract(b"not pdf", &AtomicBool::new(false), |_, _| {}).is_err());
        assert!(extract(
            &fixture(&vec!["Synthetic"; 501]),
            &AtomicBool::new(false),
            |_, _| {}
        )
        .is_err());
        assert!(extract(&fixture(&["Synthetic"]), &AtomicBool::new(true), |_, _| {}).is_err());
    }
}
