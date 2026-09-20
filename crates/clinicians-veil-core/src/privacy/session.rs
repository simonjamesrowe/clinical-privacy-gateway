use super::*;
use std::collections::{BTreeMap, BTreeSet};

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Decision {
    Pending,
    Accept,
    Edit,
    Keep,
    Remove,
}

#[derive(Clone)]
struct Item {
    id: u64,
    span: Span,
    category: Category,
    group: u64,
    replacement: String,
    decision: Decision,
    evidence: Vec<Evidence>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemView {
    pub id: u64,
    pub start: usize,
    pub end: usize,
    pub category: Category,
    pub group: u64,
    pub replacement: String,
    pub decision: Decision,
    pub stages: Vec<&'static str>,
    pub confidence: f32,
    pub reason: &'static str,
    pub output_start: usize,
    pub output_end: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionView {
    pub id: u64,
    pub revision: u64,
    pub source: String,
    pub output: String,
    pub items: Vec<ItemView>,
    pub pending: usize,
    pub retained: usize,
    pub checked: bool,
}

/// Lives only for the current review. Deliberately no Debug/Serialize on retained clinical state.
#[derive(Clone)]
pub struct Session {
    id: u64,
    revision: u64,
    source: String,
    items: Vec<Item>,
    next_id: u64,
    checked: bool,
    label_counters: BTreeMap<Category, u64>,
}

struct Piece {
    source: Span,
    output: Span,
    replaced: bool,
}

impl Session {
    pub fn new(id: u64, source: String, evidence: Vec<Evidence>) -> PrivacyResult<Self> {
        validate_source(&source)?;
        let mut session = Self {
            id,
            revision: 0,
            source,
            items: vec![],
            next_id: 1,
            checked: false,
            label_counters: BTreeMap::new(),
        };
        session.add_evidence(evidence)?;
        Ok(session)
    }

    pub fn matches(&self, id: u64, revision: u64) -> PrivacyResult<()> {
        if self.id != id || self.revision != revision {
            Err("This review has changed. Try again.")
        } else {
            Ok(())
        }
    }

    fn add_evidence(&mut self, evidence: Vec<Evidence>) -> PrivacyResult<()> {
        if evidence.iter().any(|e| !e.span.valid_for(&self.source)) {
            return Err("Detection returned an invalid text position.");
        }
        for e in evidence {
            let id = self.next_id;
            self.next_id += 1;
            self.items.push(Item {
                id,
                span: e.span.clone(),
                category: e.category,
                group: id,
                replacement: String::new(),
                decision: Decision::Pending,
                evidence: vec![e],
            });
        }
        self.items.sort_by_key(|i| (i.span.start, i.span.end));
        let mut merged: Vec<Item> = vec![];
        for item in self.items.drain(..) {
            if let Some(previous) = merged.last_mut().filter(|p| p.span.overlaps(&item.span)) {
                let old_end = previous.span.end;
                let old_category = previous.category;
                previous.span.end = previous.span.end.max(item.span.end);
                previous.evidence.extend(item.evidence);
                if item.decision == Decision::Pending {
                    previous.decision = Decision::Pending;
                }
                // Structured rules take precedence over partial NER categories; all evidence survives.
                if let Some(rule) = previous.evidence.iter().find(|e| e.stage == "rules") {
                    previous.category = rule.category;
                }
                // An expanded occurrence is no longer the same phrase as its old group.
                if previous.span.end != old_end || previous.category != old_category {
                    previous.replacement.clear();
                    previous.group = self.next_id;
                    self.next_id += 1;
                    previous.decision = Decision::Pending;
                }
            } else {
                merged.push(item);
            }
        }
        self.items = merged;
        let mut used: BTreeSet<_> = self.items.iter().map(|i| i.replacement.clone()).collect();
        let mut labels = BTreeMap::new();
        for item in &self.items {
            if !item.replacement.is_empty() {
                labels
                    .entry((
                        item.category,
                        self.source[item.span.start..item.span.end].to_owned(),
                    ))
                    .or_insert((item.group, item.replacement.clone()));
            }
        }
        for item in &mut self.items {
            if !item.replacement.is_empty() {
                continue;
            }
            let key = (
                item.category,
                self.source[item.span.start..item.span.end].to_owned(),
            );
            let (group, replacement) = labels.entry(key).or_insert_with(|| {
                (
                    item.group,
                    allocate_label(&mut self.label_counters, &mut used, item.category),
                )
            });
            item.group = *group;
            item.replacement.clone_from(replacement);
        }
        // A newly discovered occurrence changes the scope of the group's decision.
        // Reopen the whole group so its card cannot hide an unresolved occurrence.
        let pending_groups: BTreeSet<_> = self
            .items
            .iter()
            .filter(|item| item.decision == Decision::Pending)
            .map(|item| item.group)
            .collect();
        for item in &mut self.items {
            if pending_groups.contains(&item.group) {
                item.decision = Decision::Pending;
            }
        }
        Ok(())
    }

    pub fn decide(
        &mut self,
        id: u64,
        decision: Decision,
        replacement: Option<String>,
    ) -> PrivacyResult<()> {
        let selected = self
            .items
            .iter()
            .find(|i| i.id == id)
            .ok_or("Detection is no longer available.")?;
        let group = selected.group;
        let label = if decision == Decision::Edit {
            let label = replacement.ok_or("Enter a placeholder such as [PERSON_1].")?;
            validate_label(&label)?;
            Some(label)
        } else {
            None
        };
        for item in self.items.iter_mut().filter(|i| i.group == group) {
            item.decision = decision;
            if let Some(label) = &label {
                item.replacement.clone_from(label);
            }
        }
        self.invalidate();
        Ok(())
    }

    pub fn split(&mut self, id: u64) -> PrivacyResult<()> {
        let index = self
            .items
            .iter()
            .position(|i| i.id == id)
            .ok_or("Detection is no longer available.")?;
        let mut used = self.items.iter().map(|i| i.replacement.clone()).collect();
        let replacement = allocate_label(
            &mut self.label_counters,
            &mut used,
            self.items[index].category,
        );
        let item = &mut self.items[index];
        item.group = self.next_id;
        self.next_id += 1;
        item.replacement = replacement;
        item.decision = Decision::Pending;
        self.invalidate();
        Ok(())
    }

    pub fn manual(&mut self, start: usize, end: usize) -> PrivacyResult<()> {
        let span = Span {
            start: utf16_to_byte(&self.source, start)?,
            end: utf16_to_byte(&self.source, end)?,
        };
        if !span.valid_for(&self.source) {
            return Err("Select a phrase in the source text.");
        }
        self.add_evidence(vec![Evidence {
            span,
            category: Category::Manual,
            confidence: 1.0,
            stage: "manual",
        }])?;
        self.invalidate();
        Ok(())
    }

    fn invalidate(&mut self) {
        self.revision += 1;
        self.checked = false;
    }

    fn render(&self) -> (String, Vec<Piece>, Vec<(usize, usize)>) {
        let mut output = String::new();
        let mut pieces = vec![];
        let mut positions = vec![];
        let mut cursor = 0;
        for item in &self.items {
            let before = output.len();
            output.push_str(&self.source[cursor..item.span.start]);
            pieces.push(Piece {
                source: Span {
                    start: cursor,
                    end: item.span.start,
                },
                output: Span {
                    start: before,
                    end: output.len(),
                },
                replaced: false,
            });
            let start = output.len();
            match item.decision {
                Decision::Keep => output.push_str(&self.source[item.span.start..item.span.end]),
                Decision::Remove => {}
                _ => output.push_str(&item.replacement),
            }
            positions.push((start, output.len()));
            pieces.push(Piece {
                source: item.span.clone(),
                output: Span {
                    start,
                    end: output.len(),
                },
                replaced: item.decision != Decision::Keep,
            });
            cursor = item.span.end;
        }
        let start = output.len();
        output.push_str(&self.source[cursor..]);
        pieces.push(Piece {
            source: Span {
                start: cursor,
                end: self.source.len(),
            },
            output: Span {
                start,
                end: output.len(),
            },
            replaced: false,
        });
        (output, pieces, positions)
    }

    pub fn scan_text(&self) -> PrivacyResult<String> {
        if self.items.iter().any(|i| i.decision == Decision::Pending) {
            return Err("Review every detection before checking the result.");
        }
        let (mut output, pieces, _) = self.render();
        // Preserve byte positions and context length while masking only generated spans.
        for piece in pieces.iter().rev().filter(|p| p.replaced) {
            output.replace_range(
                piece.output.start..piece.output.end,
                &" ".repeat(piece.output.end - piece.output.start),
            );
        }
        Ok(output)
    }

    pub fn finish_scan(&mut self, evidence: Vec<Evidence>) -> PrivacyResult<()> {
        let scan = self.scan_text()?;
        let (_, pieces, _) = self.render();
        let mut mapped = vec![];
        for mut e in evidence {
            if !e.span.valid_for(&scan) {
                return Err("Rescan returned an invalid text position.");
            }
            let touched: Vec<&Piece> = pieces
                .iter()
                .filter(|p| !p.replaced && p.output.overlaps(&e.span))
                .collect();
            let (Some(first), Some(last)) = (touched.first(), touched.last()) else {
                continue;
            };
            e.span = Span {
                start: first.source.start + e.span.start.max(first.output.start)
                    - first.output.start,
                end: last.source.start + e.span.end.min(last.output.end) - last.output.start,
            };
            if self
                .items
                .iter()
                .any(|i| i.decision == Decision::Keep && i.span.contains(&e.span))
            {
                continue;
            }
            mapped.push(e);
        }
        if mapped.is_empty() {
            self.checked = true;
        } else {
            self.add_evidence(mapped)?;
            self.checked = false;
        }
        self.revision += 1;
        Ok(())
    }

    pub fn copy_text(&self) -> PrivacyResult<String> {
        if !self.checked || self.items.iter().any(|i| i.decision == Decision::Pending) {
            return Err("Check the reviewed text before copying.");
        }
        Ok(self.render().0)
    }

    pub fn view(&self) -> SessionView {
        let (output, _, positions) = self.render();
        let items = self
            .items
            .iter()
            .zip(positions)
            .map(|(i, (start, end))| {
                let mut stages: Vec<_> = i.evidence.iter().map(|e| e.stage).collect();
                stages.sort_unstable();
                stages.dedup();
                ItemView {
                    id: i.id,
                    start: byte_to_utf16(&self.source, i.span.start),
                    end: byte_to_utf16(&self.source, i.span.end),
                    category: i.category,
                    group: i.group,
                    replacement: i.replacement.clone(),
                    decision: i.decision,
                    stages,
                    confidence: i.evidence.iter().map(|e| e.confidence).fold(0.0, f32::max),
                    reason: if i.evidence.iter().any(|e| e.stage == "manual") {
                        "Manually selected for review."
                    } else if i.evidence.iter().any(|e| e.stage == "rules") {
                        "Matches a structured identifier pattern."
                    } else {
                        "The local model marked this as a possible named entity."
                    },
                    output_start: byte_to_utf16(&output, start),
                    output_end: byte_to_utf16(&output, end),
                }
            })
            .collect();
        SessionView {
            id: self.id,
            revision: self.revision,
            source: self.source.clone(),
            output,
            items,
            pending: self
                .items
                .iter()
                .filter(|i| i.decision == Decision::Pending)
                .count(),
            retained: self
                .items
                .iter()
                .filter(|i| i.decision == Decision::Keep)
                .count(),
            checked: self.checked,
        }
    }
}

fn allocate_label(
    counters: &mut BTreeMap<Category, u64>,
    used: &mut BTreeSet<String>,
    category: Category,
) -> String {
    let number = counters.entry(category).or_default();
    loop {
        *number += 1;
        let label = format!("[{}_{}]", category.label(), number);
        if used.insert(label.clone()) {
            return label;
        }
    }
}

fn validate_label(label: &str) -> PrivacyResult<()> {
    if label.len() < 3
        || label.len() > 48
        || !label.starts_with('[')
        || !label.ends_with(']')
        || !label.as_bytes()[1].is_ascii_uppercase()
        || !label[1..label.len() - 1]
            .bytes()
            .all(|b| b.is_ascii_uppercase() || b.is_ascii_digit() || b == b'_')
    {
        return Err("Use a label such as [PERSON_1]: uppercase letters, digits and underscores in brackets.");
    }
    Ok(())
}
