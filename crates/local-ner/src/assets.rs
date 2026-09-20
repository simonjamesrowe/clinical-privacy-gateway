//! The only network-enabled adapter. It accepts no clinical text or caller-provided URL.
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

pub const MODEL_ID: &str = "BERT NER · quantised · English";
pub const REVISION: &str = "9faa2f4a2d59b396888b318f596ff719cc893f1e";
pub const DOWNLOAD_BYTES: u64 = 109_577_030;
const NETWORK_ERROR: &str = "Model download failed. Check your connection and retry.";
const DISK_ERROR: &str = "Model files could not be stored. Check available space and retry.";

struct Asset {
    remote: &'static str,
    local: &'static str,
    size: u64,
    sha256: &'static str,
}
const ASSETS: [Asset; 2] = [
    Asset {
        remote: "onnx/model_quantized.onnx",
        local: "model.onnx",
        size: 108_908_107,
        sha256: "b324e829f1fad3b897f926d1a1d1372803c6d04546831a3a2ed103652b916adf",
    },
    Asset {
        remote: "tokenizer.json",
        local: "tokenizer.json",
        size: 668_923,
        sha256: "343989712a36cd8b253efeaf8baf6a08b9d2583f78e395e83832e8ee9f8d8ee1",
    },
];

pub fn cancelled(cancel: &AtomicBool) -> PrivacyResult<()> {
    if cancel.load(Ordering::Relaxed) {
        Err("Operation cancelled.")
    } else {
        Ok(())
    }
}

pub fn directory(root: &Path) -> PathBuf {
    root.join(format!("bert-ner-{REVISION}"))
}

pub fn installed(root: &Path) -> bool {
    ASSETS
        .iter()
        .all(|asset| verify_file(&directory(root).join(asset.local), asset).is_ok())
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

/// Remove only our two known partial files, including after an interrupted previous launch.
pub fn cleanup(root: &Path) {
    for asset in ASSETS {
        let _ = fs::remove_file(directory(root).join(format!("{}.partial", asset.local)));
    }
}

/// Removes only the pinned model directory managed by this adapter.
pub fn remove(root: &Path) -> PrivacyResult<()> {
    let directory = directory(root);
    if directory.exists() {
        fs::remove_dir_all(&directory)
            .map_err(|_| "Model files could not be removed. Close any model activity and retry.")?;
    }
    Ok(())
}

pub fn install(root: &Path, cancel: &AtomicBool, progress: impl Fn(u64, u64)) -> PrivacyResult<()> {
    tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(|_| NETWORK_ERROR)?
        .block_on(install_async(root, cancel, progress))
}

async fn install_async(
    root: &Path,
    cancel: &AtomicBool,
    progress: impl Fn(u64, u64),
) -> PrivacyResult<()> {
    cancelled(cancel)?;
    let dir = directory(root);
    fs::create_dir_all(&dir).map_err(|_| DISK_ERROR)?;
    cleanup(root);
    let client = Client::builder()
        .redirect(Policy::none())
        .connect_timeout(Duration::from_secs(10))
        .read_timeout(Duration::from_secs(5))
        .timeout(Duration::from_secs(300))
        .build()
        .map_err(|_| NETWORK_ERROR)?;
    let mut completed = 0;
    for asset in &ASSETS {
        cancelled(cancel)?;
        let destination = dir.join(asset.local);
        if verify_file(&destination, asset).is_ok() {
            completed += asset.size;
            progress(completed, DOWNLOAD_BYTES);
            continue;
        }
        let url = Url::parse(&format!(
            "https://huggingface.co/onnx-community/bert-base-NER-ONNX/resolve/{REVISION}/{}",
            asset.remote
        ))
        .map_err(|_| NETWORK_ERROR)?;
        let mut response = response(&client, url, cancel).await?;
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
                progress(completed + received, DOWNLOAD_BYTES);
                reported = received;
            }
        }
        file.sync_all().map_err(|_| DISK_ERROR)?;
        drop(file);
        verify_file(&temporary.0, asset)?;
        cancelled(cancel)?;
        fs::rename(&temporary.0, destination).map_err(|_| DISK_ERROR)?;
        completed += received;
        progress(completed, DOWNLOAD_BYTES);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn verifies_size_and_checksum_and_removes_only_partial_files() {
        let root = tempfile::tempdir().unwrap();
        assert!(!installed(root.path()));
        let dir = directory(root.path());
        fs::create_dir_all(&dir).unwrap();
        let asset = Asset {
            remote: "unused",
            local: "fixture",
            size: 5,
            sha256: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
        };
        let fixture = dir.join(asset.local);
        fs::write(&fixture, b"hello").unwrap();
        assert!(verify_file(&fixture, &asset).is_ok());
        fs::write(&fixture, b"jello").unwrap();
        assert!(verify_file(&fixture, &asset).is_err());
        fs::write(&fixture, b"hi").unwrap();
        assert!(verify_file(&fixture, &asset).is_err());
        let partial = dir.join("model.onnx.partial");
        fs::write(&partial, b"unfinished").unwrap();
        cleanup(root.path());
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
    fn cancelled_install_has_no_network_or_disk_effect() {
        assert_eq!(
            install(
                Path::new("/nonexistent/unused"),
                &AtomicBool::new(true),
                |_, _| {}
            ),
            Err("Operation cancelled.")
        );
    }

    #[test]
    fn removes_only_the_pinned_model_directory() {
        let root = tempfile::tempdir().unwrap();
        let model = directory(root.path());
        fs::create_dir_all(&model).unwrap();
        fs::write(model.join("model.onnx"), b"fixture").unwrap();
        let unrelated = root.path().join("unrelated");
        fs::create_dir_all(&unrelated).unwrap();
        remove(root.path()).unwrap();
        assert!(!model.exists());
        assert!(unrelated.exists());
    }
}
