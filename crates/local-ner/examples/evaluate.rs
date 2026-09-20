//! Synthetic-only evaluation. No arbitrary input or patient material is accepted.
use clinicians_veil_core::privacy::{detect_rules, Category, Decision, Session, Span};
use clinicians_veil_ner::{assets, detect};
use serde_json::{json, Value};
use std::{collections::BTreeMap, path::PathBuf, sync::atomic::AtomicBool, time::Instant};

fn main() -> Result<(), &'static str> {
    let args: Vec<_> = std::env::args().skip(1).collect();
    let (install, root) = match args.as_slice() {
        [root] => (false, PathBuf::from(root)),
        [flag, root] if flag == "--install" => (true, PathBuf::from(root)),
        _ => return Err("Usage: evaluate [--install] <model-directory>"),
    };
    let cancel = AtomicBool::new(false);
    if install {
        assets::install(&root, &cancel, |_, _| {})?;
    }
    let corpus: Vec<Value> =
        serde_json::from_str(include_str!("../../../tests/fixtures/privacy-corpus.json"))
            .map_err(|_| "Invalid synthetic corpus")?;
    // gold, fully covered, exact same-category, proposals, unexpected proposals
    let mut totals: BTreeMap<String, [usize; 5]> = BTreeMap::new();
    let mut timings = Vec::new();
    let mut rules_hits = 0;
    let mut ner_hits = 0;
    let mut negative_tokens = 0;
    let mut false_positive_tokens = 0;
    let mut gaps = Vec::new();
    for note in &corpus {
        let source = note["text"].as_str().ok_or("Missing synthetic text")?;
        let expected: Vec<(Category, Span)> = note["entities"]
            .as_array()
            .ok_or("Missing annotations")?
            .iter()
            .flat_map(|e| {
                let category: Category =
                    serde_json::from_value(e["category"].clone()).expect("fixture category");
                source
                    .match_indices(e["text"].as_str().expect("fixture entity"))
                    .map(move |(start, value)| {
                        (
                            category,
                            Span {
                                start,
                                end: start + value.len(),
                            },
                        )
                    })
            })
            .collect();
        let started = Instant::now();
        let mut evidence = detect_rules(source);
        let ner = detect(&root, source, &cancel, |_, _| {})?;
        rules_hits += expected
            .iter()
            .filter(|(_, s)| evidence.iter().any(|e| e.span.contains(s)))
            .count();
        ner_hits += expected
            .iter()
            .filter(|(_, s)| ner.iter().any(|e| e.span.contains(s)))
            .count();
        evidence.extend(ner);
        let mut session = Session::new(1, source.to_owned(), evidence)?;
        let view = session.view();
        let proposals: Vec<_> = view
            .items
            .iter()
            .map(|i| {
                (
                    i.category,
                    Span {
                        start: clinicians_veil_core::privacy::utf16_to_byte(source, i.start)
                            .unwrap(),
                        end: clinicians_veil_core::privacy::utf16_to_byte(source, i.end).unwrap(),
                    },
                )
            })
            .collect();
        for (index, (category, span)) in expected.iter().enumerate() {
            let counts = totals.entry(category.label().into()).or_default();
            counts[0] += 1;
            counts[1] += usize::from(proposals.iter().any(|(_, s)| s.contains(span)));
            counts[2] += usize::from(proposals.iter().any(|(c, s)| c == category && s == span));
            if !proposals.iter().any(|(_, s)| s.contains(span)) {
                gaps.push(
                    json!({"note": note["id"], "annotation": index, "category": category.label()}),
                );
            }
        }
        let mut cursor = 0;
        for token in source.split_whitespace() {
            let start = cursor + source[cursor..].find(token).unwrap();
            cursor = start + token.len();
            let token_span = Span { start, end: cursor };
            if !expected.iter().any(|(_, s)| s.overlaps(&token_span)) {
                negative_tokens += 1;
                false_positive_tokens +=
                    usize::from(proposals.iter().any(|(_, s)| s.overlaps(&token_span)));
            }
        }
        for (category, span) in proposals {
            let counts = totals.entry(category.label().into()).or_default();
            counts[3] += 1;
            counts[4] += usize::from(!expected.iter().any(|(_, s)| span.overlaps(s)));
        }
        timings.push(started.elapsed().as_millis());
        // Exercise real rescan and mapping; new concerns must remain pending.
        for item in view.items {
            session.decide(item.id, Decision::Accept, None)?;
        }
        let scan = session.scan_text()?;
        let mut rescanned = detect_rules(&scan);
        rescanned.extend(detect(&root, &scan, &cancel, |_, _| {})?);
        session.finish_scan(rescanned)?;
        if session.view().pending > 0 {
            assert!(session.copy_text().is_err());
        }
    }
    let cold_ms = timings[0];
    timings.sort_unstable();
    let long_source = format!("{}Alex Morgan.", "No new concerns. ".repeat(1100));
    let windows = std::cell::Cell::new(0);
    let started = Instant::now();
    let long_result = detect(&root, &long_source, &cancel, |_, total| windows.set(total))?;
    let long_ms = started.elapsed().as_millis();
    let tail = long_source.find("Alex Morgan").unwrap();
    assert!(windows.get() > 1);
    assert!(long_source[tail..tail + 11]
        .char_indices()
        .all(|(i, ch)| ch.is_whitespace()
            || long_result
                .iter()
                .any(|e| e.span.start <= tail + i && e.span.end >= tail + i + ch.len_utf8())));
    let cancelled_run = detect(&root, &long_source, &cancel, |_, _| {
        cancel.store(true, std::sync::atomic::Ordering::Relaxed);
    });
    assert!(matches!(cancelled_run, Err("Operation cancelled.")));
    // Print only aggregate metrics and synthetic fixture indices, never source text.
    println!(
        "{}",
        json!({"model_revision": assets::REVISION, "notes": corpus.len(),
        "columns": ["gold", "fully_covered", "exact_same_category", "proposals", "unexpected_proposals"],
        "categories": totals, "rules_covered": rules_hits, "ner_covered": ner_hits,
        "negative_tokens": negative_tokens, "false_positive_tokens": false_positive_tokens,
        "token_false_positive_rate": false_positive_tokens as f64 / negative_tokens as f64,
        "cold_ms": cold_ms, "median_ms": timings[timings.len()/2], "max_ms": timings.last(),
        "long_characters": long_source.chars().count(), "long_ms": long_ms,
        "long_windows": windows.get(), "cancelled_between_windows": true, "gaps": gaps})
    );
    Ok(())
}
