use serde::{Deserialize, Serialize};

use crate::{Error, Result};

pub const MAX_TRANSFER_BYTES: u64 = 8 * 1024 * 1024 * 1024;

/// Only the two already-authorized transport categories cross this bridge; all
/// unrelated long-running work remains controlled by its existing runtime.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum TransferKind {
    R2Upload,
    LanBlob,
}

/// This durable ticket contains opaque local references and control metadata;
/// credentials remain in Credential Vault and payload bytes remain on disk.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
pub struct TransferTicket {
    pub transfer_id: String,
    pub kind: TransferKind,
    pub resource_ref: String,
    pub credential_ref: String,
    pub peer_device_ref: Option<String>,
    pub content_sha256: String,
    pub size_bytes: u64,
    pub checkpoint_bytes: u64,
    pub user_initiated: bool,
}

impl TransferTicket {
    /// Rust and Kotlin both validate so malformed data is stopped before either
    /// persistence or Android scheduling can observe it.
    pub fn validate(&self) -> Result<()> {
        if !safe_identifier(&self.transfer_id, 96)
            || !safe_reference(&self.resource_ref, "appdata:", 256)
            || !safe_reference(&self.credential_ref, "vault:", 160)
            || self.size_bytes == 0
            || self.size_bytes > MAX_TRANSFER_BYTES
            || self.checkpoint_bytes > self.size_bytes
            || !valid_sha256(&self.content_sha256)
        {
            return Err(Error::invalid());
        }

        match self.kind {
            TransferKind::R2Upload if self.peer_device_ref.is_some() => {
                return Err(Error::invalid())
            }
            TransferKind::LanBlob => match self.peer_device_ref.as_deref() {
                Some(reference) if safe_reference(reference, "device:", 160) => {}
                _ => return Err(Error::invalid()),
            },
            _ => {}
        }

        let mut values = vec![
            self.transfer_id.as_str(),
            self.resource_ref.as_str(),
            self.credential_ref.as_str(),
            self.content_sha256.as_str(),
        ];
        if let Some(peer) = self.peer_device_ref.as_deref() {
            values.push(peer);
        }
        if values.into_iter().any(contains_forbidden_value) {
            return Err(Error::invalid());
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum TransferState {
    Queued,
    Running,
    Paused,
    Retry,
    Blocked,
    Cancelled,
    Succeeded,
    Failed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferStatus {
    pub transfer_id: String,
    pub kind: TransferKind,
    pub state: TransferState,
    pub checkpoint_bytes: u64,
    pub size_bytes: u64,
    pub attempt: u32,
    pub next_attempt_at_epoch_ms: u64,
    pub updated_at_epoch_ms: u64,
    pub error_code: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryResult {
    pub statuses: Vec<TransferStatus>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ScheduleArgs {
    pub ticket: TransferTicket,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TransferIdArgs {
    pub transfer_id: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CheckpointArgs {
    pub transfer_id: String,
    pub checkpoint_bytes: u64,
}

/// The pairing capability is transient command input. It is never part of a
/// durable transfer ticket, status, checkpoint, diagnostic, or command result.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudflarePairingArgs {
    pub credential_ref: String,
    pub endpoint: String,
    pub device_id: String,
    pub pairing_capability: String,
}

impl CloudflarePairingArgs {
    pub fn validate(&self) -> Result<()> {
        let endpoint = url::Url::parse(&self.endpoint).map_err(|_| Error::invalid())?;
        if !safe_reference(&self.credential_ref, "vault:", 160)
            || endpoint.scheme() != "https"
            || endpoint.host_str().is_none()
            || endpoint.username() != ""
            || endpoint.password().is_some()
            || endpoint.query().is_some()
            || endpoint.fragment().is_some()
            || !matches!(endpoint.path(), "" | "/")
            || !safe_identifier(&self.device_id, 96)
            || self.device_id.len() < 8
            || self.pairing_capability.len() < 32
            || self.pairing_capability.len() > 128
            || !self
                .pairing_capability
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
        {
            return Err(Error::invalid());
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudflarePairingStatus {
    pub credential_ref: String,
    pub device_id: String,
    pub configured: bool,
}

pub(crate) fn validate_transfer_id(value: &str) -> Result<()> {
    if safe_identifier(value, 96) && !contains_forbidden_value(value) {
        Ok(())
    } else {
        Err(Error::invalid())
    }
}

fn safe_identifier(value: &str, max: usize) -> bool {
    !value.is_empty()
        && value.len() <= max
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b':' | b'_' | b'-' | b'.'))
}

fn safe_reference(value: &str, prefix: &str, max: usize) -> bool {
    let suffix = value.strip_prefix(prefix).unwrap_or_default();
    value.starts_with(prefix)
        && value.len() > prefix.len()
        && value.len() <= max
        && !value.contains("..")
        && !value.contains(['\\', '?', '#', '%'])
        && !suffix.starts_with('/')
        && !(suffix.len() > 2
            && suffix.as_bytes()[0].is_ascii_alphabetic()
            && suffix.as_bytes()[1] == b':'
            && suffix.as_bytes()[2] == b'/')
        && suffix.bytes().all(|byte| {
            byte.is_ascii_alphanumeric() || matches!(byte, b'/' | b':' | b'_' | b'-' | b'.')
        })
}

fn valid_sha256(value: &str) -> bool {
    value.len() == 71
        && value.starts_with("sha256:")
        && value[7..].bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn contains_forbidden_value(value: &str) -> bool {
    let lower = value.to_ascii_lowercase();
    let markers = [
        "authorization",
        "bearer ",
        "token=",
        "signed url",
        "x-amz-",
        "thumbnail",
        "base64",
        "data:image",
        "image bytes",
        "file:",
        "://",
    ];
    markers.iter().any(|marker| lower.contains(marker))
        || value.starts_with('/')
        || value.starts_with("\\\\")
        || (value.len() > 2
            && value.as_bytes()[0].is_ascii_alphabetic()
            && value.as_bytes()[1] == b':')
}

#[cfg(test)]
mod tests {
    use super::*;

    fn valid_ticket(kind: TransferKind) -> TransferTicket {
        TransferTicket {
            transfer_id: "transfer:1".into(),
            kind,
            resource_ref: "appdata:transfers/object.bin".into(),
            credential_ref: "vault:r2-primary".into(),
            peer_device_ref: None,
            content_sha256: format!("sha256:{}", "a".repeat(64)),
            size_bytes: 1024,
            checkpoint_bytes: 0,
            user_initiated: true,
        }
    }

    #[test]
    fn accepts_bounded_r2_ticket() {
        assert!(valid_ticket(TransferKind::R2Upload).validate().is_ok());
    }

    #[test]
    fn lan_requires_paired_device_reference() {
        assert!(valid_ticket(TransferKind::LanBlob).validate().is_err());
        let mut ticket = valid_ticket(TransferKind::LanBlob);
        ticket.peer_device_ref = Some("device:paired-1".into());
        assert!(ticket.validate().is_ok());
    }

    #[test]
    fn rejects_network_material_and_absolute_paths() {
        for resource_ref in [
            "appdata:https://example.invalid/object",
            "appdata:C:/private/object",
            "appdata:data:image/png;base64,abc",
            "appdata:object?token=secret",
        ] {
            let mut ticket = valid_ticket(TransferKind::R2Upload);
            ticket.resource_ref = resource_ref.into();
            assert!(ticket.validate().is_err(), "accepted {resource_ref}");
        }
    }
}
