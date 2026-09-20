use crate::assets::{cancelled, directory, installed};
use clinicians_veil_core::privacy::{Category, Evidence, PrivacyResult, Span};
use ort::{session::Session, value::Tensor};
use std::{
    path::Path,
    sync::{atomic::AtomicBool, Arc, Once},
};
use tokenizers::{Encoding, Tokenizer, TruncationDirection};

const MODEL_ERROR: &str =
    "The local entity detector could not finish. Retry or download the model again.";
static INIT: Once = Once::new();

/// No hub client, HTTP client, model cache, optimised-model file or shared inference session.
pub fn detect(
    root: &Path,
    text: &str,
    cancel: &AtomicBool,
    progress: impl Fn(usize, usize),
) -> PrivacyResult<Vec<Evidence>> {
    cancelled(cancel)?;
    if !installed(root) {
        return Err("Model files are missing or damaged. Download the model first.");
    }
    INIT.call_once(|| {
        ort::init()
            .with_logger(Arc::new(|_, _, _, _, _| {}))
            .commit();
    });
    let dir = directory(root);
    let mut tokenizer =
        Tokenizer::from_file(dir.join("tokenizer.json")).map_err(|_| MODEL_ERROR)?;
    let windows = encode_windows(&mut tokenizer, text)?;
    let total = windows.len();
    let mut model = Session::builder()
        .map_err(|_| MODEL_ERROR)?
        .with_intra_threads(2)
        .map_err(|_| MODEL_ERROR)?
        .with_logger(Arc::new(|_, _, _, _, _| {}))
        .map_err(|_| MODEL_ERROR)?
        .commit_from_file(dir.join("model.onnx"))
        .map_err(|_| MODEL_ERROR)?;
    let mut found = Vec::new();
    for (index, window) in windows.into_iter().enumerate() {
        cancelled(cancel)?;
        let tensor = |values: &[u32]| {
            Tensor::from_array((
                [1, values.len()],
                values.iter().map(|v| i64::from(*v)).collect::<Vec<_>>(),
            ))
            .map_err(|_| MODEL_ERROR)
        };
        let outputs = model
            .run(ort::inputs![
                "input_ids" => tensor(window.get_ids())?,
                "attention_mask" => tensor(window.get_attention_mask())?,
                "token_type_ids" => tensor(window.get_type_ids())?
            ])
            .map_err(|_| MODEL_ERROR)?;
        let (shape, scores) = outputs["logits"]
            .try_extract_tensor::<f32>()
            .map_err(|_| MODEL_ERROR)?;
        if shape.as_ref() != [1, window.get_ids().len() as i64, 9] {
            return Err(MODEL_ERROR);
        }
        let mut current: Option<Evidence> = None;
        for ((start, end), logits) in window.get_offsets().iter().zip(scores.as_chunks::<9>().0) {
            if *start == *end {
                continue;
            }
            if !logits.iter().all(|v| v.is_finite()) {
                return Err(MODEL_ERROR);
            }
            let (label, &highest) = logits
                .iter()
                .enumerate()
                .max_by(|a, b| a.1.total_cmp(b.1))
                .ok_or(MODEL_ERROR)?;
            let confidence = 1.0 / logits.iter().map(|v| (v - highest).exp()).sum::<f32>();
            let category = match label {
                1 | 2 => Category::Misc,
                3 | 4 => Category::Person,
                5 | 6 => Category::Organisation,
                7 | 8 => Category::Location,
                _ => {
                    if let Some(e) = current.take() {
                        found.push(e);
                    }
                    continue;
                }
            };
            let span = Span {
                start: *start,
                end: *end,
            };
            if !span.valid_for(text) {
                return Err(MODEL_ERROR);
            }
            if let Some(e) = current.as_mut().filter(|e| {
                e.category == category
                    && label % 2 == 0
                    && *start >= e.span.end
                    && text[e.span.end..*start].chars().all(char::is_whitespace)
            }) {
                e.span.end = *end;
                e.confidence = e.confidence.min(confidence);
            } else {
                if let Some(e) = current.take() {
                    found.push(e);
                }
                current = Some(Evidence {
                    span,
                    category,
                    confidence,
                    stage: "ner",
                });
            }
        }
        if let Some(e) = current {
            found.push(e);
        }
        progress(index + 1, total);
    }
    cancelled(cancel)?;
    // Token classifiers can mark only a subword. Never leave the other letters exposed.
    for evidence in &mut found {
        expand_word(text, &mut evidence.span);
    }
    Ok(found)
}

fn encode_windows(tokenizer: &mut Tokenizer, text: &str) -> PrivacyResult<Vec<Encoding>> {
    // Tokenizers 0.23 can stop tokenising early when truncation is enabled. Encode
    // the complete bounded input first; then explicitly window it with overlap.
    tokenizer.with_truncation(None).map_err(|_| MODEL_ERROR)?;
    tokenizer.with_padding(None);
    let mut encoding = tokenizer.encode(text, false).map_err(|_| MODEL_ERROR)?;
    encoding.truncate(510, 64, TruncationDirection::Right);
    let overflow = encoding.take_overflowing();
    std::iter::once(encoding)
        .chain(overflow)
        .map(|window| {
            let window = tokenizer
                .post_process(window, None, true)
                .map_err(|_| MODEL_ERROR)?;
            if window.len() > 512 {
                return Err(MODEL_ERROR);
            }
            Ok(window)
        })
        .collect()
}

fn expand_word(text: &str, span: &mut Span) {
    let word =
        |ch: char| ch.is_alphanumeric() || matches!(ch, '\'' | '’' | '-' | '\u{0300}'..='\u{036f}');
    while span.start > 0 {
        let ch = text[..span.start].chars().next_back().unwrap();
        if !word(ch) {
            break;
        }
        span.start -= ch.len_utf8();
    }
    while span.end < text.len() {
        let ch = text[span.end..].chars().next().unwrap();
        if !word(ch) {
            break;
        }
        span.end += ch.len_utf8();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn encodes_the_complete_input_before_building_overlapping_windows() {
        let model = tokenizers::models::wordlevel::WordLevel::builder()
            .vocab(
                [("[UNK]".to_owned(), 0), ("word".to_owned(), 1)]
                    .into_iter()
                    .collect(),
            )
            .unk_token("[UNK]".into())
            .build()
            .unwrap();
        let mut tokenizer = Tokenizer::new(model);
        tokenizer.with_pre_tokenizer(Some(tokenizers::pre_tokenizers::whitespace::Whitespace));
        let text = format!("{}tail", "word ".repeat(2000));
        let windows = encode_windows(&mut tokenizer, &text).unwrap();
        assert_eq!(windows.len(), 5);
        assert!(windows.iter().all(|w| w.len() <= 512));
        assert_eq!(
            windows.last().unwrap().get_offsets().last().unwrap().1,
            text.len()
        );
        for pair in windows.windows(2) {
            assert!(pair[0].get_offsets().last().unwrap().1 > pair[1].get_offsets()[0].0);
        }
    }
    #[test]
    fn subwords_expand_without_splitting_unicode_or_swallowing_surrounding_text() {
        let source = "🩺 Éva O’Neill takes 10 mg.";
        let start = source.find("Neill").unwrap();
        let mut span = Span {
            start,
            end: start + 2,
        };
        expand_word(source, &mut span);
        assert_eq!(&source[span.start..span.end], "O’Neill");
        let start = source.find("va").unwrap();
        let mut span = Span {
            start,
            end: start + 1,
        };
        expand_word(source, &mut span);
        assert_eq!(&source[span.start..span.end], "Éva");
    }
    #[test]
    fn missing_model_fails_closed_without_echoing_source() {
        assert!(matches!(
            detect(
                Path::new("/nonexistent/veil-test"),
                "Synthetic source",
                &AtomicBool::new(false),
                |_, _| {}
            ),
            Err("Model files are missing or damaged. Download the model first.")
        ));
    }
}
