# Text-review baseline evaluation

Recorded 20 September 2026. Synthetic-only development baseline, not a clinical
validation or a privacy guarantee. All names, contacts and narratives in the
24-note corpus were invented for testing; email/URL hosts use `.invalid`.

## Model and runtime

- `onnx-community/bert-base-NER-ONNX`, revision
  `9faa2f4a2d59b396888b318f596ff719cc893f1e`, quantised English BERT classifier.
- ONNX Runtime 1.24.2, statically linked through `ort` 2.0.0-rc.12, CPU with two
  intra-operation threads. Hugging Face `tokenizers` 0.23.2.
- Model: 108,908,107 bytes, SHA-256
  `b324e829f1fad3b897f926d1a1d1372803c6d04546831a3a2ed103652b916adf`.
- Tokenizer: 668,923 bytes, SHA-256
  `343989712a36cd8b253efeaf8baf6a08b9d2583f78e395e83832e8ee9f8d8ee1`.

The [upstream model card](https://huggingface.co/onnx-community/bert-base-NER-ONNX)
identifies English CoNLL-2003 news training, PER/LOC/ORG/MISC labels and MIT
licensing. It cautions against assuming generalisation to other domains and
notes subword post-processing. We expand flagged subwords to lexical word
boundaries, keep proposals pending and expose remaining limitations in the UI.

## Reproduce

```sh
cargo run --release -p clinicians-veil-ner --example evaluate -- --install target/model-evaluation
# Subsequent runs are offline; run the already-built binary for meaningful RSS.
/usr/bin/time -l target/release/examples/evaluate target/model-evaluation
```

The first command explicitly downloads only the pinned model assets. The runner
accepts no arbitrary clinical input: it embeds `tests/fixtures/privacy-corpus.json`.
Output contains aggregates, categories and fixture IDs/indices, not source text.
It also runs real final rescans, a long-input tail-coverage assertion and an
inference cancellation assertion. Ordinary `cargo test` does not download models.

## Detection measures

Gold counts are annotated occurrences (repetitions counted individually).
**Covered** means one merged proposal contains the full gold span, regardless of
label. This intentionally treats partial organisations as a miss. **Exact**
additionally requires the exact boundary and category. A fragmented full name
may be transformed by multiple proposals but still fail this strict measure.

| Category | Gold | Covered | Recall | False-negative rate | Exact |
| --- | ---: | ---: | ---: | ---: | ---: |
| Person | 23 | 22 | 95.7% | 4.3% | 21 |
| Organisation | 4 | 3 | 75% | 25% | 1 |
| Location | 6 | 6 | 100% | 0% | 6 |
| Email | 5 | 5 | 100% | 0% | 5 |
| UK phone | 3 | 3 | 100% | 0% | 3 |
| Postcode | 1 | 1 | 100% | 0% | 1 |
| NHS number | 1 | 1 | 100% | 0% | 1 |
| NI number | 1 | 1 | 100% | 0% | 1 |
| URL | 1 | 1 | 100% | 0% | 1 |
| Explicit date | 5 | 5 | 100% | 0% | 5 |
| Labelled case reference | 3 | 3 | 100% | 0% | 3 |
| Manual-only path / contextual concerns | 3 | 0 | 0% | 100% | 0 |

Rules alone fully covered 20 gold occurrences; NER alone covered 32 (with some
overlap). One of 55 proposals did not overlap a gold identifier, an organisation
proposal. Proposal false-discovery fraction: 1/55 (1.8%), **not** a false-positive
rate. Separately, the token-level false-positive rate was 1/216 (0.46%): whitespace
tokens with no overlap with any gold span are the negative population; a proposal
overlapping such a token is a false positive. These small-sample measures are
descriptive; there is no UI privacy score or performance threshold inferred from them.

### Known gaps visible to the reviewer

- `paediatric-03`: the full school name is not covered as one proposal. Parts of
  organisation names can be left unmarked or classified as locations.
- `initials-11`: the punctuated initials are not fully covered.
- `path-19`: file paths are not detected by the current rule suite.
- `indirect-21`: the rare occupation/age combination and tiny village context
  are not detected. The Llama contextual sweep is deferred.
- Nicknames, misspellings, accents, roles and non-English text remain fragile
  beyond this tiny corpus. An exact repeated name is grouped, not proof that it
  represents the same person; separate occurrences when needed.

No clinical numbers, dose or negation were transformed in the three identifier-free
notes. This is a regression check, not proof of clinical-meaning preservation.

## Timing and memory

Host: Apple M4 Pro, 24 GiB unified memory, macOS 26.6.2; release-mode CPU runtime.
This is **not** the target M2/8 GB acceptance measurement.

- First short-note call in a fresh process (filesystem cache not cleared): 346 ms.
- Median of 24 short-note detections, each loading/verifying/unloading: 298 ms.
- Long synthetic note: 18,712 characters, 10 overlapping windows, 1,291 ms;
  identifiers at the end were covered (even when fragmented into two proposals).
- Complete run including final rescans, long input and cancellation: 16.68 s.
- Maximum resident set: 489,881,600 bytes (~467 MiB); peak physical footprint:
  473,793,424 bytes (~452 MiB), measured by `/usr/bin/time -l`.
- Cancellation after the first long-note window returned cancellation, with no
  partial successful result. Native operation guards release busy state when
  workers finish or fail. Model sessions/tensors are scoped to each call; the
  small runtime environment persists. Allocator retention is not secure erasure.

The long-input check caught early truncation inside tokenizers 0.23. Explicit
full encoding before window construction fixes this; both a pure tokenizer
regression test and the real-model long-note assertion are retained.

## UI and packaging checks

DOM tests cover review gating, unapplied placeholder edits, Unicode limits,
manual selection, failed processing, cancellation, discard confirmation,
late results and literal rendering of HTML-like source. Rust tests cover native
copy/revision gates, grouping/splitting, overlap provenance, rescan mapping,
model verification and regex inputs over 100,000 characters.

`tests/visual/index.html` is a development-only synthetic bridge fixture for
repeatable UI inspection, not evidence of native inference. Screenshots are
clearly labelled as fixtures. Native model evaluation above is separate.

The DMG check mounts the actual packaged artifact read-only and verifies its
checksum and app signature. Ad-hoc signing fixes the malformed bundle signature;
first launch can still require **Open Anyway**. Developer ID signing/notarisation
is deferred by user choice.

Before clinical use: complete target-M2 memory/unload and installed-app workflow
checks, measure human review time, expand the gold corpus and complete the
employing organisation's information-governance approval. The current release
is suitable for synthetic exploration only.
