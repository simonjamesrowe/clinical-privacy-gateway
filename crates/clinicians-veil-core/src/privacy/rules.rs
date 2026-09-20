use super::{Category, Evidence, Span};
use regex::Regex;
use std::sync::LazyLock;

// Rust regex uses finite automata, not backtracking. Explicit lengths also bound matches.
static RULES: LazyLock<Vec<(Category, Regex)>> = LazyLock::new(|| {
    [
        (Category::Email, r"(?i)\b[A-Z0-9._%+-]{1,64}@[A-Z0-9.-]{1,253}\.[A-Z]{2,24}\b"),
        (Category::Phone, r"(?:\+44[ \t.-]?(?:\(0\)[ \t.-]?)?|\b0)[1-9](?:[ \t().-]?[0-9]){8,9}\b"),
        (Category::Postcode, r"(?i)\b(?:GIR[ ]?0AA|[A-Z]{1,2}[0-9][0-9A-Z]?[ ]?[0-9][A-Z]{2})\b"),
        (Category::NhsNumber, r"\b[0-9]{3}[ -]?[0-9]{3}[ -]?[0-9]{4}\b"),
        (Category::NiNumber, r"(?i)\b[A-CEGHJ-PR-TW-Z][A-CEGHJ-NPR-TW-Z][ ]?[0-9]{2}[ ]?[0-9]{2}[ ]?[0-9]{2}[ ]?[A-D]\b"),
        (Category::Url, r"(?i)\b(?:https?://|www\.)[^\s<>\x22]{1,2048}"),
        (Category::Date, r"\b(?:[0-3]?[0-9][/.-][01]?[0-9][/.-](?:[0-9]{4}|[0-9]{2})|[0-9]{4}-[01][0-9]-[0-3][0-9])\b"),
        (Category::Date, r"(?i)\b[0-3]?[0-9](?:st|nd|rd|th)?[ ]{1,3}(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)(?:[ ,]{1,3}[0-9]{4})?\b"),
        (Category::CaseReference, r"(?i)\b(?:case|patient|hospital|record)[ ]{1,3}(?:ref(?:erence)?|id|number|no\.?)[ \t:#-]{0,5}(?P<value>[A-Z0-9][A-Z0-9/-]{2,39})\b"),
    ].into_iter().map(|(c,r)| (c, Regex::new(r).expect("static identifier rule"))).collect()
});

pub fn detect_rules(text: &str) -> Vec<Evidence> {
    let mut found = Vec::new();
    for (category, regex) in RULES.iter() {
        for captures in regex.captures_iter(text) {
            let matched = captures
                .name("value")
                .or_else(|| captures.get(0))
                .expect("matched capture");
            if *category == Category::NhsNumber && !valid_nhs(matched.as_str()) {
                continue;
            }
            if *category == Category::NiNumber
                && ["BG", "GB", "KN", "NK", "NT", "TN", "ZZ"]
                    .contains(&&matched.as_str()[..2].to_ascii_uppercase()[..])
            {
                continue;
            }
            let end = if *category == Category::Url {
                matched.start()
                    + matched
                        .as_str()
                        .trim_end_matches(['.', ',', ';', ')', '!', '?'])
                        .len()
            } else {
                matched.end()
            };
            found.push(Evidence {
                span: Span {
                    start: matched.start(),
                    end,
                },
                category: *category,
                confidence: 1.0,
                stage: "rules",
            });
        }
    }
    found
}

fn valid_nhs(value: &str) -> bool {
    let digits: Vec<u32> = value.chars().filter_map(|c| c.to_digit(10)).collect();
    if digits.len() != 10 || digits.iter().all(|d| *d == digits[0]) {
        return false;
    }
    let sum: u32 = digits[..9]
        .iter()
        .enumerate()
        .map(|(i, d)| d * (10 - i as u32))
        .sum();
    let check = (11 - sum % 11) % 11;
    check < 10 && check == digits[9]
}
