//! Pinned NER model files. Downloading is delegated to the shared allowlisted installer.
use clinicians_veil_assets::{self as shared, Asset, Manifest};
use clinicians_veil_core::privacy::PrivacyResult;
use std::{
    path::{Path, PathBuf},
    sync::atomic::AtomicBool,
    time::Duration,
};

pub use shared::cancelled;

pub const MODEL_ID: &str = "BERT NER · quantised · English";
pub const REVISION: &str = "9faa2f4a2d59b396888b318f596ff719cc893f1e";
pub const DOWNLOAD_BYTES: u64 = 109_577_030;
const REPO: &str = "onnx-community/bert-base-NER-ONNX";

pub const MANIFEST: Manifest = Manifest {
    directory: "bert-ner-9faa2f4a2d59b396888b318f596ff719cc893f1e",
    assets: &[
        Asset {
            repo: REPO,
            revision: REVISION,
            remote: "onnx/model_quantized.onnx",
            local: "model.onnx",
            size: 108_908_107,
            sha256: "b324e829f1fad3b897f926d1a1d1372803c6d04546831a3a2ed103652b916adf",
        },
        Asset {
            repo: REPO,
            revision: REVISION,
            remote: "tokenizer.json",
            local: "tokenizer.json",
            size: 668_923,
            sha256: "343989712a36cd8b253efeaf8baf6a08b9d2583f78e395e83832e8ee9f8d8ee1",
        },
    ],
    total_timeout: Duration::from_secs(300),
};

pub fn directory(root: &Path) -> PathBuf {
    shared::directory(root, &MANIFEST)
}

pub fn installed(root: &Path) -> bool {
    shared::installed(root, &MANIFEST)
}

pub fn cleanup(root: &Path) {
    shared::cleanup(root, &MANIFEST)
}

pub fn remove(root: &Path) -> PrivacyResult<()> {
    shared::remove(root, &MANIFEST)
}

pub fn install(root: &Path, cancel: &AtomicBool, progress: impl Fn(u64, u64)) -> PrivacyResult<()> {
    shared::install(root, &MANIFEST, cancel, progress)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn manifest_matches_the_published_pin() {
        assert_eq!(MANIFEST.download_bytes(), DOWNLOAD_BYTES);
        assert!(MANIFEST.directory.ends_with(REVISION));
        assert!(MANIFEST
            .assets
            .iter()
            .all(|asset| asset.revision == REVISION));
    }
}
