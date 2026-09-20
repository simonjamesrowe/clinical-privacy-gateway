use clinicians_veil_core::privacy::*;

fn entity(text: &str, value: &str, category: Category) -> Vec<Evidence> {
    text.match_indices(value)
        .map(|(start, _)| Evidence {
            span: Span {
                start,
                end: start + value.len(),
            },
            category,
            confidence: 0.9,
            stage: "ner",
        })
        .collect()
}

#[test]
fn proposals_require_decisions_and_rescan_and_edits_invalidate_it() {
    let text = "Alex Morgan called Alex Morgan about 10 mg; no change.";
    let mut s = Session::new(
        1,
        text.into(),
        entity(text, "Alex Morgan", Category::Person),
    )
    .unwrap();
    let first = s.view().items[0].id;
    assert_eq!(s.view().pending, 2);
    assert_eq!(
        s.view().output,
        "[PERSON_1] called [PERSON_1] about 10 mg; no change."
    );
    assert!(s.copy_text().is_err());
    assert!(s.scan_text().is_err());
    s.decide(first, Decision::Accept, None).unwrap();
    assert_eq!(s.view().pending, 0);
    assert!(s.copy_text().is_err());
    let scan = s.scan_text().unwrap();
    assert!(!scan.contains("PERSON_1"));
    s.finish_scan(vec![]).unwrap();
    assert!(s.copy_text().is_ok());
    s.decide(first, Decision::Edit, Some("[CLIENT]".into()))
        .unwrap();
    assert!(!s.view().checked);
    assert!(s.copy_text().is_err());
    assert!(s
        .decide(first, Decision::Edit, Some("Alex Morgan".into()))
        .is_err());
}

#[test]
fn split_shared_names_keeps_independent_decisions() {
    let text = "Sam met Sam.";
    let mut s = Session::new(1, text.into(), entity(text, "Sam", Category::Person)).unwrap();
    let ids: Vec<_> = s.view().items.iter().map(|i| i.id).collect();
    s.split(ids[1]).unwrap();
    s.decide(ids[0], Decision::Accept, None).unwrap();
    assert_eq!(s.view().pending, 1);
    assert_eq!(s.view().output, "[PERSON_1] met [PERSON_2].");
    s.decide(ids[1], Decision::Keep, None).unwrap();
    let scan = s.scan_text().unwrap();
    s.finish_scan(entity(&scan, "Sam", Category::Person))
        .unwrap();
    assert!(s.view().checked);
    assert_eq!(s.view().retained, 1);
    assert_eq!(s.copy_text().unwrap(), "[PERSON_1] met Sam.");
}

#[test]
fn rescan_reopens_the_group_when_it_finds_another_occurrence() {
    let text = "Sam met Sam.";
    let first_only = entity(text, "Sam", Category::Person)[..1].to_vec();
    let mut s = Session::new(1, text.into(), first_only).unwrap();
    let id = s.view().items[0].id;
    s.decide(id, Decision::Accept, None).unwrap();
    let scan = s.scan_text().unwrap();
    s.finish_scan(entity(&scan, "Sam", Category::Person))
        .unwrap();
    let view = s.view();
    assert_eq!(view.pending, 2);
    assert_eq!(view.items[0].group, view.items[1].group);
    assert!(view
        .items
        .iter()
        .all(|item| item.decision == Decision::Pending));
    assert!(s.copy_text().is_err());
    s.decide(id, Decision::Accept, None).unwrap();
    s.finish_scan(vec![]).unwrap();
    assert_eq!(s.copy_text().unwrap(), "[PERSON_1] met [PERSON_1].");
}

#[test]
fn rescan_maps_new_detections_back_through_replacements_and_unicode() {
    let text = "🩺 Éva called Morgan.";
    let mut s = Session::new(5, text.into(), entity(text, "Éva", Category::Person)).unwrap();
    assert_eq!(s.view().items[0].start, 3);
    let id = s.view().items[0].id;
    s.decide(id, Decision::Accept, None).unwrap();
    let scan = s.scan_text().unwrap();
    s.finish_scan(entity(&scan, "Morgan", Category::Person))
        .unwrap();
    assert_eq!(s.view().pending, 1);
    assert!(!s.view().checked);
    assert_eq!(s.view().output, "🩺 [PERSON_1] called [PERSON_2].");
    assert!(s.matches(5, 0).is_err());
    assert!(s.matches(6, s.view().revision).is_err());
}

#[test]
fn manual_selection_is_utf16_and_never_splits_surrogates() {
    let mut s = Session::new(1, "🩺 Éva".into(), vec![]).unwrap();
    assert!(s.manual(1, 2).is_err());
    s.manual(3, 6).unwrap();
    assert_eq!(s.view().output, "🩺 [MANUAL_1]");
}

#[test]
fn overlaps_union_spans_and_retain_both_stages() {
    let text = "alex@example.invalid";
    let mut evidence = detect_rules(text);
    evidence.extend(entity(text, "alex", Category::Person));
    let s = Session::new(1, text.into(), evidence).unwrap();
    assert_eq!(s.view().items.len(), 1);
    assert_eq!(s.view().items[0].category, Category::Email);
    assert_eq!(s.view().items[0].stages, vec!["ner", "rules"]);
    assert_eq!(s.view().output, "[EMAIL_1]");
}

#[test]
fn rules_cover_structured_details_without_dose_redaction() {
    let text = "alex@example.invalid, 07700 900123, SW1A 1AA, 943 476 5919, QQ123456C, AB123456C, https://example.invalid/path, 12/03/2026, 2026-03-12, 12 March 2026, case reference: SYN-2048. Age 47, 10 mg, no change.";
    let detections = detect_rules(text);
    for category in [
        Category::Email,
        Category::Phone,
        Category::Postcode,
        Category::NhsNumber,
        Category::NiNumber,
        Category::Url,
        Category::Date,
        Category::CaseReference,
    ] {
        assert!(
            detections.iter().any(|e| e.category == category),
            "missing {category:?}"
        );
    }
    assert!(!detections
        .iter()
        .any(|e| ["10", "47", "QQ123456C"].contains(&&text[e.span.start..e.span.end])));
}

#[test]
fn rules_are_bounded_on_adversarial_long_input() {
    for input in [
        format!("{}@{}!", "a".repeat(100_000), "a.".repeat(50_000)),
        "0-".repeat(100_000),
        "case reference: ".repeat(10_000),
    ] {
        let start = std::time::Instant::now();
        let _ = detect_rules(&input);
        assert!(start.elapsed().as_secs() < 5);
    }
}

#[test]
fn input_limit_counts_unicode_characters_and_rejects_empty() {
    assert!(validate_source(" \n").is_err());
    assert!(validate_source(&"🩺".repeat(20_000)).is_ok());
    assert!(validate_source(&"🩺".repeat(20_001)).is_err());
}

#[test]
fn remove_then_rescan_preserves_new_adjacent_detection() {
    let text = "AlexXander";
    let mut s = Session::new(1, text.into(), entity(text, "X", Category::Misc)).unwrap();
    s.decide(s.view().items[0].id, Decision::Remove, None)
        .unwrap();
    assert_eq!(s.scan_text().unwrap(), "Alexander");
    s.finish_scan(entity("Alexander", "Alexander", Category::Person))
        .unwrap();
    assert_eq!(s.view().pending, 1);
    assert!(s.copy_text().is_err());
}

#[test]
fn expanded_occurrences_do_not_change_other_members_of_the_old_group() {
    let text = "Sam Smith met Sam.";
    let mut s = Session::new(1, text.into(), entity(text, "Sam", Category::Person)).unwrap();
    s.manual(0, 9).unwrap();
    let first = s.view().items[0].clone();
    let second = s.view().items[1].clone();
    assert_ne!(first.group, second.group);
    s.decide(first.id, Decision::Remove, None).unwrap();
    assert_eq!(s.view().items[1].decision, Decision::Pending);
}

#[test]
fn generated_labels_never_collide_with_custom_labels() {
    let text = "Sam met Sam.";
    let mut s = Session::new(1, text.into(), entity(text, "Sam", Category::Person)).unwrap();
    let ids: Vec<_> = s.view().items.iter().map(|i| i.id).collect();
    s.decide(ids[0], Decision::Edit, Some("[PERSON_2]".into()))
        .unwrap();
    s.split(ids[1]).unwrap();
    assert_eq!(s.view().output, "[PERSON_2] met [PERSON_3].");
}
