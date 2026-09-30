//! Microphone privacy authorisation (macOS TCC). The prompt is shown at the point of use.
use std::time::Duration;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Access {
    NotDetermined,
    Denied,
    Restricted,
    Authorized,
}

/// How long to wait for the clinician to answer the system prompt.
const PROMPT_TIMEOUT: Duration = Duration::from_secs(300);

#[cfg(target_os = "macos")]
pub fn access() -> Access {
    use objc2_av_foundation::{AVAuthorizationStatus, AVCaptureDevice, AVMediaTypeAudio};
    // SAFETY: AVMediaTypeAudio is a framework constant; audio is a valid media type here.
    let Some(audio) = (unsafe { AVMediaTypeAudio }) else {
        return Access::Restricted;
    };
    match unsafe { AVCaptureDevice::authorizationStatusForMediaType(audio) } {
        AVAuthorizationStatus::Authorized => Access::Authorized,
        AVAuthorizationStatus::Denied => Access::Denied,
        AVAuthorizationStatus::NotDetermined => Access::NotDetermined,
        _ => Access::Restricted,
    }
}

/// Shows the system prompt if needed and blocks until it is answered. Never call this on the
/// main thread: the completion handler runs on an arbitrary dispatch queue.
#[cfg(target_os = "macos")]
pub fn request() -> bool {
    use block2::RcBlock;
    use objc2::runtime::Bool;
    use objc2_av_foundation::{AVCaptureDevice, AVMediaTypeAudio};
    use std::sync::mpsc;

    if access() == Access::Authorized {
        return true;
    }
    let Some(audio) = (unsafe { AVMediaTypeAudio }) else {
        return false;
    };
    let (sender, receiver) = mpsc::channel();
    let handler = RcBlock::new(move |granted: Bool| {
        let _ = sender.send(granted.as_bool());
    });
    // SAFETY: the block is retained by AVFoundation until it has been called.
    unsafe { AVCaptureDevice::requestAccessForMediaType_completionHandler(audio, &handler) };
    receiver.recv_timeout(PROMPT_TIMEOUT).unwrap_or(false)
}

#[cfg(not(target_os = "macos"))]
pub fn access() -> Access {
    Access::Authorized
}

#[cfg(not(target_os = "macos"))]
pub fn request() -> bool {
    let _ = PROMPT_TIMEOUT;
    true
}
