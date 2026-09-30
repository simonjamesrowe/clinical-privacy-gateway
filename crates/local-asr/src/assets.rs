//! Pinned Whisper and voice-activity model files, downloaded only by explicit setup.
use clinicians_veil_assets::{self as shared, Asset, Manifest};
use clinicians_veil_core::privacy::PrivacyResult;
use std::{
    path::{Path, PathBuf},
    sync::atomic::AtomicBool,
    time::Duration,
};

pub const MODEL_ID: &str = "Whisper large-v3 turbo · q5_0 · English";
pub const REVISION: &str = "5359861c739e955e79d9a303bcbc70fb988958b1";
const VAD_REVISION: &str = "9ffd54a1e1ee413ddf265af9913beaf518d1639b";
pub const DOWNLOAD_BYTES: u64 = 574_926_293;
const MODEL_FILE: &str = "model.bin";
const VAD_FILE: &str = "vad.bin";

pub const MANIFEST: Manifest = Manifest {
    directory: "whisper-large-v3-turbo-q5_0-5359861c739e955e79d9a303bcbc70fb988958b1",
    assets: &[
        Asset {
            repo: "ggerganov/whisper.cpp",
            revision: REVISION,
            remote: "ggml-large-v3-turbo-q5_0.bin",
            local: MODEL_FILE,
            size: 574_041_195,
            sha256: "394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2",
        },
        Asset {
            repo: "ggml-org/whisper-vad",
            revision: VAD_REVISION,
            remote: "ggml-silero-v6.2.0.bin",
            local: VAD_FILE,
            size: 885_098,
            sha256: "2aa269b785eeb53a82983a20501ddf7c1d9c48e33ab63a41391ac6c9f7fb6987",
        },
    ],
    // ~575 MB: allow slow links. Read and connect timeouts still catch a stalled transfer.
    total_timeout: Duration::from_secs(1_800),
};

/// Files present at their pinned sizes. Hashes are verified by [`crate::load`] before use.
pub fn present(root: &Path) -> bool {
    shared::present(root, &MANIFEST)
}

pub fn verify(root: &Path) -> PrivacyResult<()> {
    shared::verify(root, &MANIFEST)
}

pub(crate) fn verify_vad(root: &Path) -> PrivacyResult<()> {
    shared::verify_named(root, &MANIFEST, VAD_FILE)
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

pub(crate) fn model_path(root: &Path) -> PathBuf {
    shared::directory(root, &MANIFEST).join(MODEL_FILE)
}

pub fn vad_path(root: &Path) -> PathBuf {
    shared::directory(root, &MANIFEST).join(VAD_FILE)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn manifest_matches_the_published_pin() {
        assert_eq!(MANIFEST.download_bytes(), DOWNLOAD_BYTES);
        assert!(MANIFEST.directory.ends_with(REVISION));
        let root = Path::new("/models");
        assert!(model_path(root).starts_with(root.join(MANIFEST.directory)));
        assert!(vad_path(root).starts_with(root.join(MANIFEST.directory)));
    }
}
