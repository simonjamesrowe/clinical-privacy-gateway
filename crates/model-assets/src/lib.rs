//! The only network-enabled model adapter. It accepts no clinical text or caller-provided URL.
//!
//! Callers describe pinned files with a static [`Manifest`]. Every URL is built from a fixed
//! Hugging Face template, and every redirect's parsed origin is revalidated before it is followed.
use clinicians_veil_core::privacy::PrivacyResult;
use reqwest::{redirect::Policy, Client, Response, Url};
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File},
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::atomic::{AtomicBool, Ordering},
    time::Duration,
};

const NETWORK_ERROR: &str = "Model download failed. Check your connection and retry.";
const DISK_ERROR: &str = "Model files could not be stored. Check available space and retry.";

/// One pinned file in a Hugging Face repository.
pub struct Asset {
    pub repo: &'static str,
    pub revision: &'static str,
    pub remote: &'static str,
    pub local: &'static str,
    pub size: u64,
    pub sha256: &'static str,
}

/// The pinned files that make up one installable model, stored under one directory.
pub struct Manifest {
    pub directory: &'static str,
    pub assets: &'static [Asset],
    /// Whole-download limit. Size caps bound the bytes; this bounds a stalled-but-alive link.
    pub total_timeout: Duration,
}

impl Manifest {
    pub fn download_bytes(&self) -> u64 {
        self.assets.iter().map(|asset| asset.size).sum()
    }
}

pub fn cancelled(cancel: &AtomicBool) -> PrivacyResult<()> {
    if cancel.load(Ordering::Relaxed) {
        Err("Operation cancelled.")
    } else {
        Ok(())
    }
}

pub fn directory(root: &Path, manifest: &Manifest) -> PathBuf {
    root.join(manifest.directory)
}

pub fn installed(root: &Path, manifest: &Manifest) -> bool {
    manifest
        .assets
        .iter()
        .all(|asset| verify_file(&directory(root, manifest).join(asset.local), asset).is_ok())
}

/// Whether every pinned file exists with its expected size. Cheap enough for status checks;
/// callers must still [`verify`] hashes before loading a model.
pub fn present(root: &Path, manifest: &Manifest) -> bool {
    manifest.assets.iter().all(|asset| {
        fs::metadata(directory(root, manifest).join(asset.local))
            .is_ok_and(|metadata| metadata.is_file() && metadata.len() == asset.size)
    })
}

/// Re-verifies every installed file, returning a content-free error on the first mismatch.
pub fn verify(root: &Path, manifest: &Manifest) -> PrivacyResult<()> {
    for asset in manifest.assets {
        verify_file(&directory(root, manifest).join(asset.local), asset)?;
    }
    Ok(())
}

/// Re-verifies one installed file by its local name, so a small file can be checked before use
/// without hashing the whole manifest.
pub fn verify_named(root: &Path, manifest: &Manifest, local: &str) -> PrivacyResult<()> {
    let asset = manifest
        .assets
        .iter()
        .find(|asset| asset.local == local)
        .ok_or("Model files are missing. Download the model first.")?;
    verify_file(&directory(root, manifest).join(asset.local), asset)
}

fn verify_file(path: &Path, asset: &Asset) -> PrivacyResult<()> {
    let mut file =
        File::open(path).map_err(|_| "Model files are missing. Download the model first.")?;
    if file.metadata().map_err(|_| DISK_ERROR)?.len() != asset.size {
        return Err("Model verification failed. Download the model again.");
    }
    let mut digest = Sha256::new();
    let mut buffer = [0; 65_536];
    loop {
        let n = file.read(&mut buffer).map_err(|_| DISK_ERROR)?;
        if n == 0 {
            break;
        }
        digest.update(&buffer[..n]);
    }
    if format!("{:x}", digest.finalize()) != asset.sha256 {
        return Err("Model verification failed. Download the model again.");
    }
    Ok(())
}

fn allowed(url: &Url) -> bool {
    url.username().is_empty()
        && url.password().is_none()
        && [
            "https://huggingface.co",
            "https://us.aws.cdn.hf.co",
            "https://cdn-lfs.huggingface.co",
            "https://cdn-lfs-us-1.huggingface.co",
            "https://cas-bridge.xethub.hf.co",
        ]
        .contains(&url.origin().ascii_serialization().as_str())
}

fn asset_url(asset: &Asset) -> PrivacyResult<Url> {
    Url::parse(&format!(
        "https://huggingface.co/{}/resolve/{}/{}",
        asset.repo, asset.revision, asset.remote
    ))
    .map_err(|_| NETWORK_ERROR)
}

async fn response(client: &Client, mut url: Url, cancel: &AtomicBool) -> PrivacyResult<Response> {
    for _ in 0..6 {
        cancelled(cancel)?;
        if !allowed(&url) {
            return Err("The model download destination was not recognised.");
        }
        let response = client
            .get(url.clone())
            .send()
            .await
            .map_err(|_| NETWORK_ERROR)?;
        if response.status().is_redirection() {
            let location = response
                .headers()
                .get(reqwest::header::LOCATION)
                .and_then(|h| h.to_str().ok())
                .ok_or(NETWORK_ERROR)?;
            url = url.join(location).map_err(|_| NETWORK_ERROR)?;
        } else {
            return response.error_for_status().map_err(|_| NETWORK_ERROR);
        }
    }
    Err("Model download redirected too many times.")
}

struct PartialFile(PathBuf);
impl Drop for PartialFile {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.0);
    }
}

/// Remove only the manifest's known partial files, including after an interrupted launch.
pub fn cleanup(root: &Path, manifest: &Manifest) {
    for asset in manifest.assets {
        let _ = fs::remove_file(directory(root, manifest).join(format!("{}.partial", asset.local)));
    }
}

/// Removes only the pinned model directory described by the manifest.
pub fn remove(root: &Path, manifest: &Manifest) -> PrivacyResult<()> {
    let directory = directory(root, manifest);
    if directory.exists() {
        fs::remove_dir_all(&directory)
            .map_err(|_| "Model files could not be removed. Close any model activity and retry.")?;
    }
    Ok(())
}

pub fn install(
    root: &Path,
    manifest: &Manifest,
    cancel: &AtomicBool,
    progress: impl Fn(u64, u64),
) -> PrivacyResult<()> {
    cancelled(cancel)?;
    tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(|_| NETWORK_ERROR)?
        .block_on(install_async(root, manifest, cancel, progress))
}

async fn install_async(
    root: &Path,
    manifest: &Manifest,
    cancel: &AtomicBool,
    progress: impl Fn(u64, u64),
) -> PrivacyResult<()> {
    cancelled(cancel)?;
    let dir = directory(root, manifest);
    fs::create_dir_all(&dir).map_err(|_| DISK_ERROR)?;
    cleanup(root, manifest);
    let client = Client::builder()
        .redirect(Policy::none())
        .connect_timeout(Duration::from_secs(10))
        .read_timeout(Duration::from_secs(5))
        .timeout(manifest.total_timeout)
        .build()
        .map_err(|_| NETWORK_ERROR)?;
    let total = manifest.download_bytes();
    let mut completed = 0;
    for asset in manifest.assets {
        cancelled(cancel)?;
        let destination = dir.join(asset.local);
        if verify_file(&destination, asset).is_ok() {
            completed += asset.size;
            progress(completed, total);
            continue;
        }
        let mut response = response(&client, asset_url(asset)?, cancel).await?;
        let temporary = PartialFile(dir.join(format!("{}.partial", asset.local)));
        let mut file = File::create(&temporary.0).map_err(|_| DISK_ERROR)?;
        let mut received = 0;
        let mut reported = 0;
        loop {
            cancelled(cancel)?;
            let Some(chunk) = response.chunk().await.map_err(|_| NETWORK_ERROR)? else {
                break;
            };
            received += chunk.len() as u64;
            if received > asset.size {
                return Err("Model download exceeded its expected size.");
            }
            file.write_all(&chunk).map_err(|_| DISK_ERROR)?;
            if received - reported >= 512 * 1024 {
                progress(completed + received, total);
                reported = received;
            }
        }
        file.sync_all().map_err(|_| DISK_ERROR)?;
        drop(file);
        verify_file(&temporary.0, asset)?;
        cancelled(cancel)?;
        fs::rename(&temporary.0, destination).map_err(|_| DISK_ERROR)?;
        completed += received;
        progress(completed, total);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const FIXTURE: Asset = Asset {
        repo: "example/model",
        revision: "0123456789abcdef",
        remote: "nested/model.bin",
        local: "fixture",
        size: 5,
        sha256: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    };
    const MANIFEST: Manifest = Manifest {
        directory: "fixture-model",
        assets: &[FIXTURE],
        total_timeout: Duration::from_secs(1),
    };
    const OTHER: Manifest = Manifest {
        directory: "other-model",
        assets: &[Asset {
            local: "other",
            ..FIXTURE
        }],
        total_timeout: Duration::from_secs(1),
    };

    #[test]
    fn verifies_size_and_checksum_and_removes_only_partial_files() {
        let root = tempfile::tempdir().unwrap();
        assert!(!installed(root.path(), &MANIFEST));
        let dir = directory(root.path(), &MANIFEST);
        fs::create_dir_all(&dir).unwrap();
        let fixture = dir.join(FIXTURE.local);
        fs::write(&fixture, b"hello").unwrap();
        assert!(verify_file(&fixture, &FIXTURE).is_ok());
        assert!(installed(root.path(), &MANIFEST));
        assert!(present(root.path(), &MANIFEST));
        assert!(verify(root.path(), &MANIFEST).is_ok());
        assert!(verify_named(root.path(), &MANIFEST, "fixture").is_ok());
        assert!(verify_named(root.path(), &MANIFEST, "unknown").is_err());
        fs::write(&fixture, b"jello").unwrap();
        assert!(verify_file(&fixture, &FIXTURE).is_err());
        // Same size, wrong content: present for status, rejected before use.
        assert!(present(root.path(), &MANIFEST));
        assert!(!installed(root.path(), &MANIFEST));
        fs::write(&fixture, b"hi").unwrap();
        assert!(verify_file(&fixture, &FIXTURE).is_err());
        assert!(!present(root.path(), &MANIFEST));
        let partial = dir.join("fixture.partial");
        fs::write(&partial, b"unfinished").unwrap();
        cleanup(root.path(), &MANIFEST);
        assert!(!partial.exists());
        assert!(fixture.exists());
        fs::write(&partial, b"unfinished").unwrap();
        drop(PartialFile(partial.clone()));
        assert!(!partial.exists());
    }

    #[test]
    fn download_origins_are_exact_and_https_only() {
        for address in [
            "http://huggingface.co/file",
            "https://huggingface.co.attacker.invalid/file",
            "https://user:pass@huggingface.co/file",
            "https://huggingface.co:8443/file",
            "https://127.0.0.1/file",
        ] {
            assert!(!allowed(&Url::parse(address).unwrap()));
        }
        assert!(allowed(
            &Url::parse("https://us.aws.cdn.hf.co/model").unwrap()
        ));
    }

    #[test]
    fn asset_urls_use_the_pinned_repository_and_revision() {
        let url = asset_url(&FIXTURE).unwrap();
        assert_eq!(
            url.as_str(),
            "https://huggingface.co/example/model/resolve/0123456789abcdef/nested/model.bin"
        );
        assert!(allowed(&url));
    }

    #[test]
    fn cancelled_install_has_no_network_or_disk_effect() {
        let root = Path::new("/nonexistent/unused");
        assert_eq!(
            install(root, &MANIFEST, &AtomicBool::new(true), |_, _| {}),
            Err("Operation cancelled.")
        );
        assert!(!root.exists());
    }

    #[test]
    fn removes_only_the_pinned_model_directory() {
        let root = tempfile::tempdir().unwrap();
        let model = directory(root.path(), &MANIFEST);
        let other = directory(root.path(), &OTHER);
        fs::create_dir_all(&model).unwrap();
        fs::create_dir_all(&other).unwrap();
        fs::write(model.join("fixture"), b"fixture").unwrap();
        let unrelated = root.path().join("unrelated");
        fs::create_dir_all(&unrelated).unwrap();
        remove(root.path(), &MANIFEST).unwrap();
        assert!(!model.exists());
        assert!(other.exists());
        assert!(unrelated.exists());
    }

    #[test]
    fn download_bytes_sum_every_asset() {
        assert_eq!(MANIFEST.download_bytes(), 5);
    }
}
