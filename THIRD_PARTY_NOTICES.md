# Third-party components

Clinician’s Veil is Apache-2.0 licensed. The bundled runtime also includes:

- ONNX Runtime 1.24.2, Microsoft Corporation — MIT. Upstream:
  <https://github.com/microsoft/onnxruntime/tree/v1.24.2>.
  Its complete dependency notices are in
  `licenses/onnxruntime-1.24.2-third-party.txt` (copied from that tag).
- ort 2.0.0-rc.12, copyright (c) 2023–2026 pyke.io and
  copyright (c) 2020 Nicolas Bigaouette — MIT OR Apache-2.0.
  <https://github.com/pykeio/ort/tree/v2.0.0-rc.12>.
- Hugging Face tokenizers — Apache-2.0.
  <https://github.com/huggingface/tokenizers>.

The model is downloaded separately, only on request, from
`onnx-community/bert-base-NER-ONNX` at revision
`9faa2f4a2d59b396888b318f596ff719cc893f1e`. Its model card declares MIT and credits
the original `dslim/bert-base-NER` model. The app uses the quantised ONNX export
and tokenizer without training or uploading source text.

Model sources and attribution:

- <https://huggingface.co/onnx-community/bert-base-NER-ONNX/tree/9faa2f4a2d59b396888b318f596ff719cc893f1e>
- <https://huggingface.co/dslim/bert-base-NER>

The app's Apache-2.0 licence and these notices are included in the app bundle's
Resources directory. Model weights are not included in the DMG.

## MIT licence (ONNX Runtime and ort)

Copyright (c) Microsoft Corporation

Copyright (c) 2023-2026 pyke.io
Copyright (c) 2020 Nicolas Bigaouette

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Local document adapters

The native document workflow also uses the following MIT-licensed components
(or selects their MIT licence where alternatives are offered):

- zip 6.0.0 — bounded DOCX archive reading.
- quick-xml 0.38.4 — WordprocessingML extraction.
- rfd 0.17.2 — native file selection.
- base64 0.22.1 — in-memory PDF preview image transport.
- objc2 0.6.4 and objc2-pdf-kit, objc2-foundation, objc2-app-kit 0.3.2 —
  macOS framework bindings. PDFKit itself is supplied by macOS.

Their distributed licence notices or upstream licensing statements are included
in the matching `licenses/<component>-<version>.txt` files, bundled with the
application.

## Markdown editing and signature validation

- @types/linkify-it 5.0.0 — MIT (`licenses/@types-linkify-it-5.0.0.txt`).
- @types/markdown-it 14.2.0 — MIT (`licenses/@types-markdown-it-14.2.0.txt`).
- @types/mdurl 2.0.0 — MIT (`licenses/@types-mdurl-2.0.0.txt`).
- linkify-it 6.1.0 — MIT (`licenses/linkify-it-6.1.0.txt`).
- markdown-it 15.0.2 — MIT (`licenses/markdown-it-15.0.2.txt`).
- argparse 3.0.2 — PSF-2.0 (`licenses/argparse-3.0.2.txt`).
- mdurl 2.1.0 — MIT (`licenses/mdurl-2.1.0.txt`).
- orderedmap 2.1.1 — MIT (`licenses/orderedmap-2.1.1.txt`).
- prosemirror-commands 1.7.2 — MIT (`licenses/prosemirror-commands-1.7.2.txt`).
- prosemirror-history 1.5.0 — MIT (`licenses/prosemirror-history-1.5.0.txt`).
- prosemirror-keymap 1.2.3 — MIT (`licenses/prosemirror-keymap-1.2.3.txt`).
- prosemirror-markdown 1.13.8 — MIT (`licenses/prosemirror-markdown-1.13.8.txt`).
- entities 4.5.0 — BSD-2-Clause (`licenses/entities-4.5.0.txt`).
- linkify-it 5.0.2 — MIT (`licenses/linkify-it-5.0.2.txt`).
- markdown-it 14.3.2 — MIT (`licenses/markdown-it-14.3.2.txt`).
- uc.micro 2.1.0 — MIT (`licenses/uc.micro-2.1.0.txt`).
- prosemirror-model 1.25.12 — MIT (`licenses/prosemirror-model-1.25.12.txt`).
- prosemirror-schema-list 1.5.1 — MIT (`licenses/prosemirror-schema-list-1.5.1.txt`).
- prosemirror-state 1.4.4 — MIT (`licenses/prosemirror-state-1.4.4.txt`).
- prosemirror-transform 1.12.2 — MIT (`licenses/prosemirror-transform-1.12.2.txt`).
- prosemirror-view 1.42.6 — MIT (`licenses/prosemirror-view-1.42.6.txt`).
- punycode.js 2.3.1 — MIT (`licenses/punycode.js-2.3.1.txt`).
- rope-sequence 1.3.4 — MIT (`licenses/rope-sequence-1.3.4.txt`).
- uc.micro 3.0.0 — MIT (`licenses/uc.micro-3.0.0.txt`).
- w3c-keyname 2.2.8 — MIT (`licenses/w3c-keyname-2.2.8.txt`).
- png-0.17.16 — MIT selected (`licenses/png-0.17.16.txt`).
