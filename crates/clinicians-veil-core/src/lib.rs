//! Framework-independent domain types for Clinician's Veil.

/// Identifies the exact build shown to the person using the application.
///
/// This contains release metadata only; it must never contain clinical
/// material, local paths, or environment values.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AppBuildInfo {
    pub version: String,
    pub build_number: String,
    pub revision: String,
    pub channel: BuildChannel,
}

impl AppBuildInfo {
    pub fn display_version(&self) -> String {
        match self.channel {
            BuildChannel::Release => format!(
                "Version {} · build {} · {}",
                self.version, self.build_number, self.revision
            ),
            BuildChannel::Development => {
                format!("Version {} · local development build", self.version)
            }
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BuildChannel {
    Release,
    Development,
}

#[cfg(test)]
mod tests {
    use super::{AppBuildInfo, BuildChannel};

    #[test]
    fn release_builds_include_traceable_metadata() {
        let info = AppBuildInfo {
            version: "0.1.0".into(),
            build_number: "42".into(),
            revision: "a1b2c3d".into(),
            channel: BuildChannel::Release,
        };

        assert_eq!(info.display_version(), "Version 0.1.0 · build 42 · a1b2c3d");
    }

    #[test]
    fn development_builds_do_not_claim_release_traceability() {
        let info = AppBuildInfo {
            version: "0.1.0".into(),
            build_number: "local".into(),
            revision: "local".into(),
            channel: BuildChannel::Development,
        };

        assert_eq!(
            info.display_version(),
            "Version 0.1.0 · local development build"
        );
    }
}
