use serde::Serialize;

/// Stable, redacted errors connect the Rust command boundary to the UI without
/// exposing native exception text or any rejected ticket value.
#[derive(Debug, Clone, Serialize, thiserror::Error)]
#[serde(rename_all = "camelCase")]
#[error("{message}")]
pub struct Error {
    pub code: &'static str,
    pub message: &'static str,
}

impl Error {
    pub(crate) const fn invalid() -> Self {
        Self {
            code: "E_TRANSFER_INVALID",
            message: "Transfer ticket was rejected",
        }
    }

    pub(crate) const fn unsupported() -> Self {
        Self {
            code: "E_TRANSFER_UNSUPPORTED",
            message: "Android transfer scheduling is unavailable on this platform",
        }
    }

    #[cfg(target_os = "android")]
    pub(crate) const fn native() -> Self {
        Self {
            code: "E_TRANSFER_NATIVE",
            message: "Android transfer scheduling failed",
        }
    }
}

pub type Result<T> = std::result::Result<T, Error>;
