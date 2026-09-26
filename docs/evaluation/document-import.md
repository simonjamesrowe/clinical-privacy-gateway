# Document import verification

Synthetic verification on 26 September 2026, Apple M4 Pro with 24 GB RAM.
This is development evidence, not target M2/8 GB or clinical validation.

## Automated checks

- Rust tests exercise strict Unicode text decoding, 99,999/100,000/100,001
  character limits, file-byte limits, DOCX structural extraction, tracked
  changes, supplementary parts, invalid XML/entities, 100 MiB expansion and
  nesting limits, and cancellation.
- Native PDFKit tests extract multiple pages, identify missing text, render a
  PNG in memory, and reject invalid, image-only, excessive-page and
  password-protected PDFs.
- Storage tests cover encryption, restart, removal of the external file,
  source/filename search exclusion, edit preservation, failed-save rollback,
  uniqueness, migration and note/patient deletion.
- UI tests cover editable extraction, original previews, extraction warnings,
  cancellation/replacement preservation, disposal, independent search icons,
  query and focus restoration, inert rendering and PDF paging.
- A 100,000-character review with a tail identifier rendered in 27 ms in the
  jsdom regression test. This measures DOM construction without browser layout,
  not native WKWebView rendering or dense-detection performance.

## Model benchmark

The existing synthetic evaluator now tests exactly 100,000 source characters.
The tail remains a complete sentence, separated from the repeated prefix;
truncating the prefix mid-word would change the NER fixture rather than merely
its length. Its tail-coverage assertion and cancellation check passed.

Release build, pinned BERT/ONNX model:

- 53 overlapping windows; 6.0 seconds for the long source (earlier run: 6.4 s).
- 24 synthetic corpus notes: median 326 ms, maximum 632 ms on the measured run.
- Whole evaluator: 25.13 s elapsed, maximum resident set 457,539,584 bytes
  (436 MiB), peak memory footprint 366,068,648 bytes (349 MiB), zero swaps.
- Existing documented recall gaps remain: initials, some organisation spans,
  file paths and indirect identifying combinations. Import does not improve
  model coverage or remove the need for human review.

Reproduce with:

```sh
cargo run --release --target aarch64-apple-darwin -p clinicians-veil-ner --example evaluate -- <installed-model-directory>
```

## Visual and packaging checks

The interactive design-system specimen uses the production page and synthetic
bridge responses. Browser checks cover import, preview, review, save and the
Original column, without remote document requests. This does not exercise the
native file chooser. Native parsers and storage are covered separately above.

The arm64 DMG is built through the existing Tauri command and checked using
`scripts/verify-macos-dmg.sh` for image checksum and packaged app signature.
The existing installed application and its clinical library are not used for
synthetic UI testing. Full interactive native import/save/restart and M2/8 GB
performance validation remain follow-up checks.
