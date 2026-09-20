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
