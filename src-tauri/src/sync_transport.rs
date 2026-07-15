#[cfg(test)]
mod tests {
    use super::*;

    fn fresh_test_directory(label: &str) -> std::path::PathBuf {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("test clock should follow Unix epoch")
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "nais2-secure-sync-{label}-{}-{unique}",
            std::process::id()
        ));
        std::fs::create_dir(&path).expect("isolated test journal directory should be created");
        path
    }

    fn remove_test_journal(path: &std::path::Path) {
        // Tests create only these two bounded journal slots. Removing known
        // files avoids a recursive cleanup that could escape the isolated temp
        // directory if a path construction regression were introduced.
        for name in ["sync-transport-state-a.json", "sync-transport-state-b.json"] {
            let _ = std::fs::remove_file(path.join(name));
        }
        let _ = std::fs::remove_dir(path);
    }

    #[test]
    fn bind_policy_accepts_explicit_loopback_or_private_lan_and_rejects_global_scope() {
        let loopback = NetworkPolicy::parse("127.0.0.1", &["127.0.0.0/8".to_string()])
            .expect("loopback opt-in should be accepted");
        assert!(loopback.allows("127.0.0.42".parse().expect("valid address")));
        assert!(!loopback.allows("192.168.1.4".parse().expect("valid address")));

        let lan = NetworkPolicy::parse("192.168.10.20", &["192.168.10.0/24".to_string()])
            .expect("private LAN opt-in should be accepted");
        assert!(lan.allows("192.168.10.99".parse().expect("valid address")));
        assert!(!lan.allows("192.168.11.1".parse().expect("valid address")));

        assert!(NetworkPolicy::parse("0.0.0.0", &["0.0.0.0/0".to_string()]).is_err());
        assert!(NetworkPolicy::parse("8.8.8.8", &["8.8.8.0/24".to_string()]).is_err());
        assert!(validate_listen_port(1023).is_err());
        assert!(validate_listen_port(1024).is_ok());
    }

    #[test]
    fn pairing_capability_is_short_lived_and_consumed_once() {
        assert!(validate_pairing_ttl(120).is_ok());
        assert!(validate_pairing_ttl(121).is_err());
        let mut session =
            PairingSession::new("capability-value".to_string(), "314159".to_string(), 1_000);
        session
            .consume("capability-value", "314159", 999)
            .expect("matching session should be consumable before expiry");
        assert!(session.consume("capability-value", "314159", 999).is_err());

        let mut expired = PairingSession::new(
            "expired-capability".to_string(),
            "271828".to_string(),
            2_000,
        );
        assert!(expired
            .consume("expired-capability", "271828", 2_000)
            .is_err());
    }

    #[test]
    fn replay_high_water_and_nonce_survive_serialization() {
        let mut durable = DurableState::default();
        durable.peers.insert(
            "peer-fingerprint".to_string(),
            PeerState::active("client-1", "device-1", "Device One"),
        );

        durable
            .accept_authenticated_request("peer-fingerprint", 7, "nonce-seven-0007")
            .expect("first monotonic request should be accepted");
        assert!(durable
            .accept_authenticated_request("peer-fingerprint", 7, "nonce-seven-0007")
            .is_err());
        assert!(durable
            .accept_authenticated_request("peer-fingerprint", 8, "nonce-seven-0007")
            .is_err());

        let encoded = serde_json::to_vec(&durable).expect("durable state should serialize");
        let mut restored: DurableState =
            serde_json::from_slice(&encoded).expect("durable state should restore");
        assert!(restored
            .accept_authenticated_request("peer-fingerprint", 7, "fresh-nonce-0000")
            .is_err());
        restored
            .accept_authenticated_request("peer-fingerprint", 8, "nonce-eight-0008")
            .expect("next sequence with a new nonce should survive restart");
    }

    #[test]
    fn first_production_listener_allows_only_one_active_data_peer() {
        let mut durable = DurableState::default();
        durable
            .register_peer("fingerprint-one", "client-one", "device-one", "Device One")
            .expect("first paired peer should be accepted");
        assert!(durable
            .register_peer("fingerprint-two", "client-two", "device-two", "Device Two")
            .is_err());

        durable
            .revoke_peer("fingerprint-one")
            .expect("active peer should be revocable");
        durable
            .register_peer("fingerprint-two", "client-two", "device-two", "Device Two")
            .expect("replacement pairing should be accepted after revoke");
    }

    #[test]
    fn sync_json_is_bounded_and_rejects_stop_gate_material() {
        assert!(validate_sync_json(br#"{"schemaVersion":1,"entityId":"scene-1"}"#).is_ok());
        assert!(validate_sync_json(&vec![b'a'; MAX_JSON_BYTES + 1]).is_err());
        assert!(validate_sync_json(br#"{"token":"must-not-sync"}"#).is_err());
        assert!(validate_sync_json(br#"{"thumbnail":"data:image/png;base64,AAAA"}"#).is_err());
        assert!(validate_sync_json(br#"{"path":"C:\\Users\\Example\\image.png"}"#).is_err());
        for payload in [
            br#"{"accessToken":"redacted"}"#.as_slice(),
            br#"{"api_token":"redacted"}"#.as_slice(),
            br#"{"thumbnailUrl":"artifact-ref"}"#.as_slice(),
            br#"{"imageBase64":"redacted"}"#.as_slice(),
            br#"{"location":"/etc/passwd"}"#.as_slice(),
            br#"{"location":"file:///var/tmp/item"}"#.as_slice(),
        ] {
            assert!(validate_sync_json(payload).is_err());
        }
        {
            use base64::Engine as _;
            let mut bytes = b"\x89PNG\r\n\x1a\n".to_vec();
            bytes.extend([0xfb, 0xff, 0xfe]);
            let encoded = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes);
            let payload = serde_json::to_vec(&serde_json::json!({ "artifact": encoded }))
                .expect("URL-safe image fixture should serialize");
            assert!(validate_sync_json(&payload).is_err());
        }
        let hundred = serde_json::to_vec(&vec![serde_json::json!({"id": "ok"}); 100])
            .expect("bounded batch should serialize");
        let hundred_one = serde_json::to_vec(&vec![serde_json::json!({"id": "too-many"}); 101])
            .expect("oversized batch should serialize");
        assert!(validate_sync_payload(&hundred).is_ok());
        assert!(validate_sync_payload(&hundred_one).is_err());
    }

    #[test]
    fn browser_origin_is_rejected_without_cors_headers() {
        assert!(validate_origin(None).is_ok());
        assert!(validate_origin(Some("https://example.invalid")).is_err());
    }

    #[test]
    fn peer_fingerprint_and_scope_use_distinct_stable_labels() {
        let certificate = b"synthetic-certificate-der";
        let fingerprint = certificate_fingerprint(certificate);
        let scope = scope_id(certificate);
        assert_eq!(fingerprint.len(), "sha256:".len() + 64);
        assert!(fingerprint.starts_with("sha256:"));
        assert!(fingerprint["sha256:".len()..]
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit()));
        assert_eq!(scope.len(), "lan:".len() + 64);
        assert!(scope.starts_with("lan:"));
        assert_eq!(&fingerprint["sha256:".len()..], &scope["lan:".len()..]);
    }

    #[test]
    fn secret_or_payload_bearing_types_do_not_derive_debug() {
        let source = include_str!("sync_transport.rs");
        for declaration in [
            "pub struct SyncDeviceIdentityBundle",
            "pub struct SyncClientCredentialBundle",
            "pub struct StartSyncTransportRequest",
            "pub struct StartSyncTransportResult",
            "pub struct PairingInvitation",
            "pub struct PairClientRequest",
            "pub struct PairClientResult",
            "pub struct EnqueueOutboundRequest",
            "pub struct SyncExchangeRequest",
            "pub struct InboundSyncItem",
            "pub struct SyncExchangeResult",
            "pub(super) struct PairingSession",
            "struct OutboundSyncItem",
            "pub(super) struct DurableState",
        ] {
            let offset = source
                .rfind(declaration)
                .unwrap_or_else(|| panic!("missing security-sensitive declaration: {declaration}"));
            let nearby_derive = source[..offset]
                .lines()
                .rev()
                .take(8)
                .find(|line| line.trim_start().starts_with("#[derive"));
            assert!(
                nearby_derive.is_none_or(|derive| !derive.contains("Debug")),
                "{declaration} must not derive Debug"
            );
        }
    }

    #[test]
    fn inbound_peek_survives_restart_until_exact_ack() {
        let directory = fresh_test_directory("peek-ack");
        let scope = format!("lan:{}", "a".repeat(64));
        let store = DurableStore::open(&directory).expect("journal should open");
        store.ensure_scope(&scope).expect("scope should initialize");
        store
            .transaction(|state| {
                state.register_peer("sha256:peer-one", "client-one", "device-one", "Device One")
            })
            .expect("peer should persist");
        store
            .apply_push(
                "sha256:peer-one",
                WireRequest {
                    request_id: "request-persist-0001".to_string(),
                    sequence: 1,
                    nonce: "nonce-persist-0001".to_string(),
                    payload: Some(serde_json::json!({
                        "schemaVersion": 1,
                        "entityId": "scene-one"
                    })),
                    delivery_id: None,
                },
            )
            .expect("authenticated push should queue inbound JSON");
        assert_eq!(
            store
                .peek_inbound(1)
                .expect("peek should succeed")
                .first()
                .map(|item| item.request_id.as_str()),
            Some("request-persist-0001")
        );
        drop(store);

        let reopened = DurableStore::open(&directory).expect("journal should reopen");
        reopened
            .ensure_scope(&scope)
            .expect("same scope should reopen");
        assert_eq!(
            reopened
                .peek_inbound(1)
                .expect("restart peek should remain non-destructive")
                .len(),
            1
        );
        reopened
            .ack_inbound("request-persist-0001")
            .expect("exact applied request should acknowledge");
        drop(reopened);

        let after_ack = DurableStore::open(&directory).expect("acked journal should reopen");
        assert!(after_ack
            .peek_inbound(1)
            .expect("empty peek should succeed")
            .is_empty());
        after_ack
            .ack_inbound("request-persist-0001")
            .expect("duplicate exact ack should remain idempotent");
        drop(after_ack);
        remove_test_journal(&directory);
    }

    #[test]
    fn durable_scope_is_fail_closed_and_physically_isolated() {
        let root = fresh_test_directory("scope-isolation");
        let first_path = root.join("first");
        let second_path = root.join("second");
        let first_scope = format!("lan:{}", "1".repeat(64));
        let second_scope = format!("lan:{}", "2".repeat(64));

        let first = DurableStore::open(&first_path).expect("first scoped journal should open");
        first
            .ensure_scope(&first_scope)
            .expect("first scope should initialize");
        assert!(first.ensure_scope(&second_scope).is_err());
        first
            .transaction(|state| {
                state.register_peer(
                    "sha256:first-peer",
                    "first-client",
                    "first-device",
                    "First Device",
                )
            })
            .expect("first peer should persist");

        let second = DurableStore::open(&second_path).expect("second scoped journal should open");
        second
            .ensure_scope(&second_scope)
            .expect("second scope should initialize");
        assert!(second
            .peer_summaries()
            .expect("second peer list should load")
            .is_empty());
        drop(first);
        drop(second);
        remove_test_journal(&first_path);
        remove_test_journal(&second_path);
        let _ = std::fs::remove_dir(root);
    }

    #[test]
    fn outbound_receipt_survives_restart_until_repository_ack() {
        let directory = fresh_test_directory("outbound-receipt");
        let scope = format!("lan:{}", "b".repeat(64));
        let peer = "sha256:receipt-peer";
        let delivery_id = "delivery-receipt-0001";
        let store = DurableStore::open(&directory).expect("journal should open");
        store.ensure_scope(&scope).expect("scope should initialize");
        store
            .transaction(|state| {
                state.register_peer(peer, "receipt-client", "receipt-device", "Receipt Device")
            })
            .expect("peer should register");
        assert!(store
            .enqueue_outbound(EnqueueOutboundRequest {
                peer_fingerprint: peer.to_string(),
                delivery_id: "delivery-mismatch".to_string(),
                op_ids: vec!["op:expected".to_string()],
                payload: serde_json::json!([{ "opId": "op:different" }]),
            })
            .is_err());
        store
            .enqueue_outbound(EnqueueOutboundRequest {
                peer_fingerprint: peer.to_string(),
                delivery_id: delivery_id.to_string(),
                op_ids: vec!["op:receipt:1".to_string()],
                payload: serde_json::json!([{
                    "schemaVersion": 1,
                    "entityId": "scene-receipt",
                    "opId": "op:receipt:1"
                }]),
            })
            .expect("outbox delivery should queue");
        assert!(store
            .peek_outbound_receipts(1)
            .expect("receipt peek should work before remote ack")
            .is_empty());
        store
            .apply_ack(
                peer,
                &WireRequest {
                    request_id: "request-delivery-ack".to_string(),
                    sequence: 1,
                    nonce: "nonce-receipt-0001".to_string(),
                    payload: None,
                    delivery_id: Some(delivery_id.to_string()),
                },
            )
            .expect("remote exact ack should create repository receipt");
        drop(store);

        let reopened = DurableStore::open(&directory).expect("receipt journal should reopen");
        reopened
            .ensure_scope(&scope)
            .expect("same receipt scope should reopen");
        let receipts = reopened
            .peek_outbound_receipts(1)
            .expect("receipt must survive restart");
        assert_eq!(receipts.len(), 1);
        assert_eq!(receipts[0].peer_fingerprint, peer);
        assert_eq!(receipts[0].delivery_id, delivery_id);
        assert_eq!(receipts[0].op_ids, vec!["op:receipt:1"]);
        assert_eq!(receipts[0].sequence, 1);
        reopened
            .enqueue_outbound(EnqueueOutboundRequest {
                peer_fingerprint: peer.to_string(),
                delivery_id: delivery_id.to_string(),
                op_ids: vec!["op:receipt:1".to_string()],
                payload: serde_json::json!([{
                    "schemaVersion": 1,
                    "entityId": "scene-receipt",
                    "opId": "op:receipt:1"
                }]),
            })
            .expect("restart re-enqueue of terminal delivery should be a no-op");
        reopened
            .ack_outbound_receipt(&AckOutboundReceiptRequest {
                peer_fingerprint: peer.to_string(),
                delivery_id: delivery_id.to_string(),
                sequence: 1,
            })
            .expect("repository commit should ack exact receipt");
        let pulled = reopened
            .apply_pull(
                peer,
                &WireRequest {
                    request_id: "request-after-receipt".to_string(),
                    sequence: 2,
                    nonce: "nonce-receipt-0002".to_string(),
                    payload: None,
                    delivery_id: None,
                },
            )
            .expect("terminal delivery should not resurrect after restart");
        assert_eq!(pulled.get("deliveryId"), Some(&serde_json::Value::Null));
        drop(reopened);

        let after_ack = DurableStore::open(&directory).expect("acked receipt should reopen");
        assert!(after_ack
            .peek_outbound_receipts(1)
            .expect("acked receipt queue should be empty")
            .is_empty());
        after_ack
            .ack_outbound_receipt(&AckOutboundReceiptRequest {
                peer_fingerprint: peer.to_string(),
                delivery_id: delivery_id.to_string(),
                sequence: 1,
            })
            .expect("duplicate repository receipt ack should be idempotent");
        drop(after_ack);
        remove_test_journal(&directory);
    }

    #[test]
    fn authenticated_remote_revoke_disables_only_calling_peer() {
        let directory = fresh_test_directory("self-revoke");
        let store = DurableStore::open(&directory).expect("journal should open");
        store
            .transaction(|state| {
                state.register_peer(
                    "sha256:self-peer",
                    "self-client",
                    "self-device",
                    "Self Device",
                )
            })
            .expect("peer should register");
        let response = store
            .apply_self_revoke(
                "sha256:self-peer",
                &WireRequest {
                    request_id: "request-revoke-0001".to_string(),
                    sequence: 1,
                    nonce: "nonce-revoke-0001".to_string(),
                    payload: None,
                    delivery_id: None,
                },
            )
            .expect("authenticated peer should revoke itself");
        assert_eq!(response, serde_json::json!({ "revoked": true }));

        let error = store
            .apply_manifest(
                "sha256:self-peer",
                &WireRequest {
                    request_id: "request-after-revoke".to_string(),
                    sequence: 2,
                    nonce: "nonce-revoke-0002".to_string(),
                    payload: None,
                    delivery_id: None,
                },
            )
            .expect_err("revoked peer must fail every later request");
        assert_eq!(error.code, "E_SYNC_NOT_PAIRED");
        drop(store);

        let reopened = DurableStore::open(&directory).expect("journal should reopen");
        let error = reopened
            .apply_manifest(
                "sha256:self-peer",
                &WireRequest {
                    request_id: "request-after-restart".to_string(),
                    sequence: 3,
                    nonce: "nonce-revoke-0003".to_string(),
                    payload: None,
                    delivery_id: None,
                },
            )
            .expect_err("revocation must survive restart");
        assert_eq!(error.code, "E_SYNC_NOT_PAIRED");
        drop(reopened);
        remove_test_journal(&directory);
    }
}
use serde::{Deserialize, Serialize};

const MAX_JSON_BYTES: usize = 2 * 1024 * 1024;
const MAX_PUSH_ENVELOPES: usize = 100;
const MAX_QUEUE_ITEMS: usize = 512;
const MAX_RECENT_NONCES: usize = 128;
const MAX_REQUEST_ID_BYTES: usize = 512;
const MIN_TIMEOUT_MS: u64 = 1_000;
const MAX_TIMEOUT_MS: u64 = 120_000;
const MIN_PAIRING_TTL_SECONDS: u64 = 30;
const MAX_PAIRING_TTL_SECONDS: u64 = 120;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncTransportError {
    pub code: &'static str,
    pub message: &'static str,
    pub retryable: bool,
}

impl SyncTransportError {
    fn new(code: &'static str, message: &'static str, retryable: bool) -> Self {
        Self {
            code,
            message,
            retryable,
        }
    }

    #[cfg(mobile)]
    fn unsupported() -> Self {
        Self::new(
            "E_SYNC_UNSUPPORTED",
            "Secure LAN sync transport is available on desktop builds only.",
            false,
        )
    }
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncDeviceIdentityBundle {
    pub ca_private_key_pkcs8_base64: String,
    pub ca_certificate_der_base64: String,
    pub sync_scope_id: String,
    pub device_id: String,
    pub device_name: String,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncClientCredentialBundle {
    pub client_private_key_pkcs8_base64: String,
    pub client_certificate_der_base64: String,
    pub ca_certificate_der_base64: String,
    pub sync_endpoint: String,
    pub sync_scope_id: String,
    pub peer_fingerprint: String,
}

#[cfg(not(mobile))]
impl Drop for SyncDeviceIdentityBundle {
    fn drop(&mut self) {
        use zeroize::Zeroize;
        self.ca_private_key_pkcs8_base64.zeroize();
    }
}

#[cfg(not(mobile))]
impl Drop for SyncClientCredentialBundle {
    fn drop(&mut self) {
        use zeroize::Zeroize;
        self.client_private_key_pkcs8_base64.zeroize();
    }
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartSyncTransportRequest {
    pub bind_ip: String,
    pub port: u16,
    pub allow_cidrs: Vec<String>,
    pub device_id: String,
    pub device_name: String,
    pub device_identity: Option<SyncDeviceIdentityBundle>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartSyncTransportResult {
    pub endpoint: String,
    pub sync_scope_id: String,
    pub device_id: String,
    pub device_name: String,
    pub generated_device_identity: Option<SyncDeviceIdentityBundle>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncPeerSummary {
    pub fingerprint: String,
    pub client_ref: String,
    pub device_id: String,
    pub device_name: String,
    pub active: bool,
    pub revoked: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncTransportStatus {
    pub running: bool,
    pub endpoint: Option<String>,
    pub sync_scope_id: Option<String>,
    pub device_id: Option<String>,
    pub device_name: Option<String>,
    pub pairing_open: bool,
    pub active_peer_count: usize,
    pub peers: Vec<SyncPeerSummary>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenPairingRequest {
    pub ttl_seconds: u64,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PairingInvitation {
    pub pairing_endpoint: String,
    pub sync_endpoint: String,
    pub capability: String,
    pub confirmation_code: String,
    pub ca_certificate_base64: String,
    pub expires_at: u64,
    pub sync_scope_id: String,
}

#[cfg(not(mobile))]
impl Drop for PairingInvitation {
    fn drop(&mut self) {
        use zeroize::Zeroize;
        self.capability.zeroize();
        self.confirmation_code.zeroize();
    }
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PairClientRequest {
    pub invitation: PairingInvitation,
    pub client_ref: String,
    pub device_id: String,
    pub device_name: String,
    pub request_id: String,
    pub timeout_ms: u64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PairClientResult {
    pub peer_fingerprint: String,
    pub sync_scope_id: String,
    pub credential_bundle: SyncClientCredentialBundle,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RevokePeerRequest {
    pub peer_fingerprint: String,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnqueueOutboundRequest {
    pub peer_fingerprint: String,
    pub delivery_id: String,
    pub op_ids: Vec<String>,
    pub payload: serde_json::Value,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DrainInboundRequest {
    pub limit: usize,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AckInboundRequest {
    pub request_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PeekOutboundReceiptsRequest {
    pub limit: usize,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AckOutboundReceiptRequest {
    pub peer_fingerprint: String,
    pub delivery_id: String,
    pub sequence: u64,
}

#[derive(Clone, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OutboundSyncReceipt {
    pub peer_fingerprint: String,
    pub delivery_id: String,
    #[serde(default)]
    pub op_ids: Vec<String>,
    #[serde(default)]
    pub sequence: u64,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum SyncExchangeOperation {
    Manifest,
    Push,
    Pull,
    Ack,
    Revoke,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncExchangeRequest {
    pub client_ref: String,
    pub request_id: String,
    pub operation: SyncExchangeOperation,
    pub credential_bundle: SyncClientCredentialBundle,
    pub payload: Option<serde_json::Value>,
    pub delivery_id: Option<String>,
    pub timeout_ms: u64,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InboundSyncItem {
    pub request_id: String,
    pub peer_fingerprint: String,
    pub sequence: u64,
    pub nonce: String,
    pub payload: serde_json::Value,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncExchangeResult {
    pub sequence: u64,
    pub response: serde_json::Value,
}

#[cfg(not(mobile))]
mod desktop {
    use super::*;
    use axum::{
        body::Bytes,
        extract::{DefaultBodyLimit, Extension, State},
        http::{header, HeaderMap, Request, StatusCode},
        response::{IntoResponse, Response},
        routing::post,
        Json, Router,
    };
    use axum_server::{
        accept::Accept,
        tls_rustls::{RustlsAcceptor, RustlsConfig},
        Handle,
    };
    use base64::{
        engine::general_purpose::{STANDARD as BASE64_STANDARD, URL_SAFE_NO_PAD},
        Engine as _,
    };
    use ipnet::IpNet;
    use rcgen::{
        BasicConstraints, CertificateParams, CertificateSigningRequestParams, DistinguishedName,
        DnType, ExtendedKeyUsagePurpose, IsCa, Issuer, KeyPair, KeyUsagePurpose, SanType,
        PKCS_ECDSA_P256_SHA256,
    };
    use rustls::{
        crypto::aws_lc_rs,
        pki_types::{
            CertificateDer, CertificateSigningRequestDer, PrivateKeyDer, PrivatePkcs8KeyDer,
        },
        server::WebPkiClientVerifier,
        version, RootCertStore, ServerConfig,
    };
    use serde_json::Value;
    use sha2::{Digest, Sha256};
    use std::{
        collections::{BTreeMap, BTreeSet, HashMap, VecDeque},
        fs::OpenOptions,
        future::Future,
        io::{self, Write},
        net::{IpAddr, SocketAddr},
        path::{Path, PathBuf},
        pin::Pin,
        sync::{Arc, Mutex},
        task::{Context, Poll},
        time::{Duration, SystemTime, UNIX_EPOCH},
    };
    use subtle::ConstantTimeEq;
    use tauri::Manager;
    use tokio::{
        net::TcpStream,
        sync::{oneshot, Mutex as AsyncMutex, Notify},
        task::JoinHandle,
        time::{sleep, sleep_until, timeout, timeout_at, Instant},
    };
    use tower::{limit::ConcurrencyLimitLayer, Service};
    use zeroize::{Zeroize, ZeroizeOnDrop};

    /// The network policy depends on explicit user input and `ipnet`, is shared
    /// by both HTTPS listeners, and exists to prevent an opt-in LAN server from
    /// silently widening to wildcard/global scope. It validates the bind address
    /// and checks every accepted socket before TLS or application routing.
    #[derive(Clone, Debug)]
    pub(super) struct NetworkPolicy {
        bind_ip: IpAddr,
        allow_cidrs: Vec<IpNet>,
    }

    impl NetworkPolicy {
        pub(super) fn parse(
            bind_ip: &str,
            allow_cidrs: &[String],
        ) -> Result<Self, SyncTransportError> {
            let bind_ip = bind_ip.parse::<IpAddr>().map_err(|_| {
                SyncTransportError::new(
                    "E_SYNC_BIND_SCOPE",
                    "The LAN sync bind address is invalid.",
                    false,
                )
            })?;
            if !is_local_scope_ip(bind_ip) || bind_ip.is_unspecified() || bind_ip.is_multicast() {
                return Err(SyncTransportError::new(
                    "E_SYNC_BIND_SCOPE",
                    "LAN sync may bind only to an explicit loopback or private LAN address.",
                    false,
                ));
            }
            if allow_cidrs.is_empty() || allow_cidrs.len() > 32 {
                return Err(SyncTransportError::new(
                    "E_SYNC_ALLOWLIST",
                    "LAN sync requires a bounded CIDR allowlist.",
                    false,
                ));
            }

            let parsed = allow_cidrs
                .iter()
                .map(|value| value.parse::<IpNet>())
                .collect::<Result<Vec<_>, _>>()
                .map_err(|_| {
                    SyncTransportError::new(
                        "E_SYNC_ALLOWLIST",
                        "A LAN sync allowlist entry is invalid.",
                        false,
                    )
                })?;
            if parsed
                .iter()
                .any(|network| !is_local_scope_network(network))
                || !parsed.iter().any(|network| network.contains(&bind_ip))
            {
                return Err(SyncTransportError::new(
                    "E_SYNC_ALLOWLIST",
                    "The allowlist must stay in local scope and include the bind address.",
                    false,
                ));
            }

            Ok(Self {
                bind_ip,
                allow_cidrs: parsed,
            })
        }

        pub(super) fn allows(&self, address: IpAddr) -> bool {
            is_local_scope_ip(address)
                && self
                    .allow_cidrs
                    .iter()
                    .any(|network| network.contains(&address))
        }

        pub(super) fn bind_ip(&self) -> IpAddr {
            self.bind_ip
        }
    }

    fn is_local_scope_ip(address: IpAddr) -> bool {
        match address {
            IpAddr::V4(value) => value.is_loopback() || value.is_private() || value.is_link_local(),
            IpAddr::V6(value) => {
                value.is_loopback() || value.is_unique_local() || value.is_unicast_link_local()
            }
        }
    }

    fn is_local_scope_network(network: &IpNet) -> bool {
        match network {
            IpNet::V4(value) => {
                is_local_scope_ip(IpAddr::V4(value.network()))
                    && is_local_scope_ip(IpAddr::V4(value.broadcast()))
            }
            IpNet::V6(value) => is_local_scope_ip(IpAddr::V6(value.network())),
        }
    }

    /// Pairing authorization combines the QR capability and human confirmation
    /// code, and is consumed only after CSR validation plus peer persistence.
    /// Constant-time comparison avoids turning the short-lived listener into a
    /// capability oracle; expiry/consume makes retries require a fresh pairing UI.
    pub(super) struct PairingSession {
        capability: String,
        confirmation_code: String,
        expires_at: u64,
        consumed: bool,
    }

    impl PairingSession {
        pub(super) fn new(capability: String, confirmation_code: String, expires_at: u64) -> Self {
            Self {
                capability,
                confirmation_code,
                expires_at,
                consumed: false,
            }
        }

        fn verify(
            &self,
            capability: &str,
            confirmation_code: &str,
            now: u64,
        ) -> Result<(), SyncTransportError> {
            let capability_matches = self.capability.as_bytes().len()
                == capability.as_bytes().len()
                && bool::from(self.capability.as_bytes().ct_eq(capability.as_bytes()));
            let code_matches = self.confirmation_code.as_bytes().len()
                == confirmation_code.as_bytes().len()
                && bool::from(
                    self.confirmation_code
                        .as_bytes()
                        .ct_eq(confirmation_code.as_bytes()),
                );
            if self.consumed || now >= self.expires_at || !capability_matches || !code_matches {
                return Err(SyncTransportError::new(
                    "E_SYNC_PAIRING_DENIED",
                    "Pairing is not available.",
                    false,
                ));
            }
            Ok(())
        }

        pub(super) fn consume(
            &mut self,
            capability: &str,
            confirmation_code: &str,
            now: u64,
        ) -> Result<(), SyncTransportError> {
            self.verify(capability, confirmation_code, now)?;
            self.consumed = true;
            Ok(())
        }

        fn is_open(&self, now: u64) -> bool {
            !self.consumed && now < self.expires_at
        }
    }

    impl Drop for PairingSession {
        fn drop(&mut self) {
            use zeroize::Zeroize;
            self.capability.zeroize();
            self.confirmation_code.zeroize();
        }
    }

    #[derive(Debug, Clone, Deserialize, Serialize)]
    #[serde(rename_all = "camelCase")]
    pub(super) struct PeerState {
        client_ref: String,
        device_id: String,
        device_name: String,
        revoked: bool,
        high_water_sequence: u64,
        recent_nonces: VecDeque<String>,
    }

    impl PeerState {
        pub(super) fn active(client_ref: &str, device_id: &str, device_name: &str) -> Self {
            Self {
                client_ref: client_ref.to_string(),
                device_id: device_id.to_string(),
                device_name: device_name.to_string(),
                revoked: false,
                high_water_sequence: 0,
                recent_nonces: VecDeque::new(),
            }
        }
    }

    #[derive(Clone, Deserialize, Serialize)]
    #[serde(rename_all = "camelCase")]
    struct OutboundSyncItem {
        delivery_id: String,
        #[serde(default)]
        op_ids: Vec<String>,
        payload_bytes: usize,
        payload: Value,
    }

    #[derive(Clone, Deserialize, Serialize)]
    #[serde(rename_all = "camelCase")]
    pub(super) struct DurableState {
        schema_version: u32,
        generation: u64,
        sync_scope_id: Option<String>,
        pub(super) peers: BTreeMap<String, PeerState>,
        inbound: VecDeque<InboundSyncItem>,
        outbound: BTreeMap<String, VecDeque<OutboundSyncItem>>,
        #[serde(default)]
        outbound_receipts: VecDeque<OutboundSyncReceipt>,
        #[serde(default)]
        outbound_receipt_sequences: BTreeMap<String, u64>,
        received_request_ids: BTreeMap<String, VecDeque<String>>,
        acknowledged_delivery_ids: BTreeMap<String, VecDeque<String>>,
        acknowledged_inbound_ids: VecDeque<String>,
        #[serde(default)]
        acknowledged_outbound_receipts: VecDeque<OutboundSyncReceipt>,
        client_sequences: BTreeMap<String, u64>,
    }

    impl Default for DurableState {
        fn default() -> Self {
            Self {
                schema_version: 1,
                generation: 0,
                sync_scope_id: None,
                peers: BTreeMap::new(),
                inbound: VecDeque::new(),
                outbound: BTreeMap::new(),
                outbound_receipts: VecDeque::new(),
                outbound_receipt_sequences: BTreeMap::new(),
                received_request_ids: BTreeMap::new(),
                acknowledged_delivery_ids: BTreeMap::new(),
                acknowledged_inbound_ids: VecDeque::new(),
                acknowledged_outbound_receipts: VecDeque::new(),
                client_sequences: BTreeMap::new(),
            }
        }
    }

    impl DurableState {
        pub(super) fn register_peer(
            &mut self,
            fingerprint: &str,
            client_ref: &str,
            device_id: &str,
            device_name: &str,
        ) -> Result<(), SyncTransportError> {
            if self
                .peers
                .iter()
                .any(|(stored, peer)| stored != fingerprint && !peer.revoked)
            {
                return Err(SyncTransportError::new(
                    "E_SYNC_SINGLE_PEER",
                    "Revoke the active paired device before pairing a replacement.",
                    false,
                ));
            }
            self.peers.insert(
                fingerprint.to_string(),
                PeerState::active(client_ref, device_id, device_name),
            );
            Ok(())
        }

        pub(super) fn revoke_peer(&mut self, fingerprint: &str) -> Result<(), SyncTransportError> {
            {
                let peer = self.peers.get_mut(fingerprint).ok_or_else(|| {
                    SyncTransportError::new(
                        "E_SYNC_PEER_UNKNOWN",
                        "The paired device was not found.",
                        false,
                    )
                })?;
                peer.revoked = true;
            }
            // Phase 11 remains outbox authority and may target a replacement
            // peer later. Native unacknowledged deliveries for this revoked
            // certificate are unreachable, so retaining them would consume the
            // global bounded queue forever; pending repository receipts remain.
            self.outbound.remove(fingerprint);
            Ok(())
        }

        pub(super) fn accept_authenticated_request(
            &mut self,
            peer_fingerprint: &str,
            sequence: u64,
            nonce: &str,
        ) -> Result<(), SyncTransportError> {
            validate_nonce(nonce)?;
            let peer = self.peers.get_mut(peer_fingerprint).ok_or_else(|| {
                SyncTransportError::new("E_SYNC_NOT_PAIRED", "The peer is not paired.", false)
            })?;
            if peer.revoked {
                return Err(SyncTransportError::new(
                    "E_SYNC_NOT_PAIRED",
                    "The peer is not paired.",
                    false,
                ));
            }
            if sequence <= peer.high_water_sequence
                || peer.recent_nonces.iter().any(|stored| stored == nonce)
            {
                return Err(SyncTransportError::new(
                    "E_SYNC_REPLAY",
                    "The authenticated sync request was replayed.",
                    false,
                ));
            }

            peer.high_water_sequence = sequence;
            peer.recent_nonces.push_back(nonce.to_string());
            while peer.recent_nonces.len() > MAX_RECENT_NONCES {
                peer.recent_nonces.pop_front();
            }
            Ok(())
        }

        fn queued_bytes(&self) -> usize {
            let inbound = self
                .inbound
                .iter()
                .map(|item| {
                    serde_json::to_vec(&item.payload)
                        .map_or(MAX_JSON_BYTES + 1, |bytes| bytes.len())
                })
                .sum::<usize>();
            let outbound = self
                .outbound
                .values()
                .flatten()
                .map(|item| item.payload_bytes)
                .sum::<usize>();
            inbound.saturating_add(outbound)
        }

        fn queued_items(&self) -> usize {
            self.inbound.len()
                + self.outbound.values().map(VecDeque::len).sum::<usize>()
                + self.outbound_receipts.len()
        }
    }

    /// Durable replay/checkpoint and queue state uses two alternating, readback-
    /// verified slots. This depends only on app-data filesystem durability and
    /// keeps all private keys/capabilities out of disk; interruption can corrupt
    /// at most the older slot, so the previous generation remains recoverable.
    pub(super) struct DurableStore {
        first_path: PathBuf,
        second_path: PathBuf,
        state: Mutex<DurableState>,
    }

    impl DurableStore {
        pub(super) fn open(directory: &Path) -> Result<Self, SyncTransportError> {
            std::fs::create_dir_all(directory).map_err(|_| persistence_error())?;
            let first_path = directory.join("sync-transport-state-a.json");
            let second_path = directory.join("sync-transport-state-b.json");
            let first = read_state_slot(&first_path);
            let second = read_state_slot(&second_path);
            let state = match (first, second) {
                (Some(first), Some(second)) => {
                    if first.generation >= second.generation {
                        first
                    } else {
                        second
                    }
                }
                (Some(state), None) | (None, Some(state)) => state,
                (None, None) => DurableState::default(),
            };
            Ok(Self {
                first_path,
                second_path,
                state: Mutex::new(state),
            })
        }

        pub(super) fn snapshot(&self) -> Result<DurableState, SyncTransportError> {
            self.state
                .lock()
                .map(|state| state.clone())
                .map_err(|_| persistence_error())
        }

        pub(super) fn transaction<R>(
            &self,
            operation: impl FnOnce(&mut DurableState) -> Result<R, SyncTransportError>,
        ) -> Result<R, SyncTransportError> {
            let mut current = self.state.lock().map_err(|_| persistence_error())?;
            let mut next = current.clone();
            let result = operation(&mut next)?;
            next.generation = current.generation.saturating_add(1);
            let target = if next.generation % 2 == 0 {
                &self.second_path
            } else {
                &self.first_path
            };
            write_state_slot(target, &next)?;
            *current = next;
            Ok(result)
        }

        pub(super) fn ensure_scope(&self, sync_scope_id: &str) -> Result<(), SyncTransportError> {
            let snapshot = self.snapshot()?;
            if snapshot.sync_scope_id.as_deref() == Some(sync_scope_id) {
                return Ok(());
            }
            if snapshot.sync_scope_id.is_some() {
                return Err(SyncTransportError::new(
                    "E_SYNC_SCOPE_MISMATCH",
                    "The Stronghold device identity does not match this sync scope.",
                    false,
                ));
            }
            self.transaction(|state| {
                state.sync_scope_id = Some(sync_scope_id.to_string());
                Ok(())
            })
        }

        pub(super) fn peer_summaries(&self) -> Result<Vec<SyncPeerSummary>, SyncTransportError> {
            let state = self.snapshot()?;
            Ok(state
                .peers
                .into_iter()
                .map(|(fingerprint, peer)| SyncPeerSummary {
                    fingerprint,
                    client_ref: peer.client_ref,
                    device_id: peer.device_id,
                    device_name: peer.device_name,
                    active: !peer.revoked,
                    revoked: peer.revoked,
                })
                .collect())
        }

        fn revoke(&self, fingerprint: &str) -> Result<(), SyncTransportError> {
            self.transaction(|state| state.revoke_peer(fingerprint))
        }

        pub(super) fn enqueue_outbound(
            &self,
            request: EnqueueOutboundRequest,
        ) -> Result<(), SyncTransportError> {
            validate_identifier(&request.peer_fingerprint)?;
            validate_identifier(&request.delivery_id)?;
            validate_operation_ids(&request.op_ids)?;
            let payload_bytes =
                serde_json::to_vec(&request.payload).map_err(|_| payload_error())?;
            validate_sync_payload(&payload_bytes)?;
            validate_outbound_batch(&request.payload, &request.op_ids)?;
            self.transaction(|state| {
                let peer = state.peers.get(&request.peer_fingerprint).ok_or_else(|| {
                    SyncTransportError::new("E_SYNC_NOT_PAIRED", "The peer is not paired.", false)
                })?;
                if peer.revoked {
                    return Err(SyncTransportError::new(
                        "E_SYNC_NOT_PAIRED",
                        "The peer is not paired.",
                        false,
                    ));
                }
                let terminal_delivery = state
                    .acknowledged_delivery_ids
                    .get(&request.peer_fingerprint)
                    .is_some_and(|acknowledged| {
                        acknowledged
                            .iter()
                            .any(|stored| stored == &request.delivery_id)
                    })
                    || state.outbound_receipts.iter().any(|receipt| {
                        receipt.peer_fingerprint == request.peer_fingerprint
                            && receipt.delivery_id == request.delivery_id
                    })
                    || state.acknowledged_outbound_receipts.iter().any(|receipt| {
                        receipt.peer_fingerprint == request.peer_fingerprint
                            && receipt.delivery_id == request.delivery_id
                    });
                if terminal_delivery {
                    return Ok(());
                }
                if let Some(existing) =
                    state
                        .outbound
                        .get(&request.peer_fingerprint)
                        .and_then(|queue| {
                            queue
                                .iter()
                                .find(|item| item.delivery_id == request.delivery_id)
                        })
                {
                    if existing.payload == request.payload && existing.op_ids == request.op_ids {
                        return Ok(());
                    }
                    return Err(SyncTransportError::new(
                        "E_SYNC_DELIVERY_COLLISION",
                        "A LAN sync delivery identifier was reused with different content.",
                        false,
                    ));
                }
                if state.queued_items() >= MAX_QUEUE_ITEMS
                    || state.queued_bytes().saturating_add(payload_bytes.len()) > MAX_JSON_BYTES
                {
                    return Err(queue_full_error());
                }
                state
                    .outbound
                    .entry(request.peer_fingerprint.clone())
                    .or_default()
                    .push_back(OutboundSyncItem {
                        delivery_id: request.delivery_id,
                        op_ids: request.op_ids,
                        payload_bytes: payload_bytes.len(),
                        payload: request.payload,
                    });
                Ok(())
            })
        }

        pub(super) fn peek_inbound(
            &self,
            limit: usize,
        ) -> Result<Vec<InboundSyncItem>, SyncTransportError> {
            if limit == 0 || limit > 128 {
                return Err(SyncTransportError::new(
                    "E_SYNC_DRAIN_LIMIT",
                    "The inbound LAN sync drain limit is invalid.",
                    false,
                ));
            }
            let state = self.snapshot()?;
            Ok(state.inbound.into_iter().take(limit).collect())
        }

        pub(super) fn ack_inbound(&self, request_id: &str) -> Result<(), SyncTransportError> {
            validate_identifier(request_id)?;
            self.transaction(|state| {
                if state
                    .acknowledged_inbound_ids
                    .iter()
                    .any(|stored| stored == request_id)
                {
                    return Ok(());
                }
                if state.inbound.front().map(|item| item.request_id.as_str()) != Some(request_id) {
                    return Err(SyncTransportError::new(
                        "E_SYNC_INBOUND_ACK_ORDER",
                        "The inbound acknowledgement is not the active apply checkpoint.",
                        false,
                    ));
                }
                state.inbound.pop_front();
                state
                    .acknowledged_inbound_ids
                    .push_back(request_id.to_string());
                while state.acknowledged_inbound_ids.len() > 1024 {
                    state.acknowledged_inbound_ids.pop_front();
                }
                Ok(())
            })
        }

        pub(super) fn peek_outbound_receipts(
            &self,
            limit: usize,
        ) -> Result<Vec<OutboundSyncReceipt>, SyncTransportError> {
            if limit == 0 || limit > 128 {
                return Err(SyncTransportError::new(
                    "E_SYNC_RECEIPT_LIMIT",
                    "The outbound LAN sync receipt limit is invalid.",
                    false,
                ));
            }
            let state = self.snapshot()?;
            Ok(state.outbound_receipts.into_iter().take(limit).collect())
        }

        pub(super) fn ack_outbound_receipt(
            &self,
            request: &AckOutboundReceiptRequest,
        ) -> Result<(), SyncTransportError> {
            validate_identifier(&request.peer_fingerprint)?;
            validate_identifier(&request.delivery_id)?;
            if request.sequence == 0 {
                return Err(payload_error());
            }
            self.transaction(|state| {
                if state.acknowledged_outbound_receipts.iter().any(|stored| {
                    stored.peer_fingerprint == request.peer_fingerprint
                        && stored.delivery_id == request.delivery_id
                        && stored.sequence == request.sequence
                }) {
                    return Ok(());
                }
                if !state.outbound_receipts.front().is_some_and(|stored| {
                    stored.peer_fingerprint == request.peer_fingerprint
                        && stored.delivery_id == request.delivery_id
                        && stored.sequence == request.sequence
                }) {
                    return Err(SyncTransportError::new(
                        "E_SYNC_RECEIPT_ACK_ORDER",
                        "The outbound receipt is not the active repository checkpoint.",
                        false,
                    ));
                }
                let receipt = state
                    .outbound_receipts
                    .pop_front()
                    .ok_or_else(persistence_error)?;
                state.acknowledged_outbound_receipts.push_back(receipt);
                while state.acknowledged_outbound_receipts.len() > 1024 {
                    state.acknowledged_outbound_receipts.pop_front();
                }
                Ok(())
            })
        }

        fn next_client_sequence(&self, client_ref: &str) -> Result<u64, SyncTransportError> {
            validate_identifier(client_ref)?;
            self.transaction(|state| {
                let sequence = state
                    .client_sequences
                    .entry(client_ref.to_string())
                    .or_insert(0);
                *sequence = sequence.checked_add(1).ok_or_else(|| {
                    SyncTransportError::new(
                        "E_SYNC_SEQUENCE_EXHAUSTED",
                        "The LAN sync sequence is exhausted.",
                        false,
                    )
                })?;
                Ok(*sequence)
            })
        }

        pub(super) fn apply_manifest(
            &self,
            peer: &str,
            request: &WireRequest,
        ) -> Result<Value, SyncTransportError> {
            self.transaction(|state| {
                state.accept_authenticated_request(peer, request.sequence, &request.nonce)?;
                let outbound_pending = state.outbound.get(peer).map_or(0, VecDeque::len);
                Ok(serde_json::json!({
                    "syncScopeId": state.sync_scope_id,
                    "outboundPending": outbound_pending,
                }))
            })
        }

        pub(super) fn apply_push(
            &self,
            peer: &str,
            request: WireRequest,
        ) -> Result<Value, SyncTransportError> {
            let payload = request.payload.clone().ok_or_else(payload_error)?;
            let payload_bytes = serde_json::to_vec(&payload).map_err(|_| payload_error())?;
            validate_sync_payload(&payload_bytes)?;
            self.transaction(|state| {
                state.accept_authenticated_request(peer, request.sequence, &request.nonce)?;
                let duplicate = state
                    .received_request_ids
                    .get(peer)
                    .is_some_and(|received| {
                        received.iter().any(|stored| stored == &request.request_id)
                    });
                if !duplicate {
                    if state.queued_items() >= MAX_QUEUE_ITEMS
                        || state.queued_bytes().saturating_add(payload_bytes.len()) > MAX_JSON_BYTES
                    {
                        return Err(queue_full_error());
                    }
                    state.inbound.push_back(InboundSyncItem {
                        request_id: request.request_id.clone(),
                        peer_fingerprint: peer.to_string(),
                        sequence: request.sequence,
                        nonce: request.nonce.clone(),
                        payload,
                    });
                    let received = state
                        .received_request_ids
                        .entry(peer.to_string())
                        .or_default();
                    received.push_back(request.request_id.clone());
                    while received.len() > 1024 {
                        received.pop_front();
                    }
                }
                Ok(serde_json::json!({
                    "accepted": true,
                    "duplicate": duplicate,
                    "requestId": request.request_id,
                }))
            })
        }

        pub(super) fn apply_pull(
            &self,
            peer: &str,
            request: &WireRequest,
        ) -> Result<Value, SyncTransportError> {
            self.transaction(|state| {
                state.accept_authenticated_request(peer, request.sequence, &request.nonce)?;
                let queue = state.outbound.get(peer);
                let item = queue.and_then(|items| items.front()).cloned();
                let has_more = queue.is_some_and(|items| items.len() > 1);
                Ok(match item {
                    Some(item) => serde_json::json!({
                        "deliveryId": item.delivery_id,
                        "payload": item.payload,
                        "hasMore": has_more,
                    }),
                    None => serde_json::json!({
                        "deliveryId": null,
                        "payload": null,
                        "hasMore": false,
                    }),
                })
            })
        }

        pub(super) fn apply_ack(
            &self,
            peer: &str,
            request: &WireRequest,
        ) -> Result<Value, SyncTransportError> {
            let delivery_id = request.delivery_id.as_deref().ok_or_else(|| {
                SyncTransportError::new(
                    "E_SYNC_ACK",
                    "The authenticated acknowledgement is invalid.",
                    false,
                )
            })?;
            validate_identifier(delivery_id)?;
            self.transaction(|state| {
                state.accept_authenticated_request(peer, request.sequence, &request.nonce)?;
                if state
                    .acknowledged_delivery_ids
                    .get(peer)
                    .is_some_and(|acknowledged| {
                        acknowledged.iter().any(|stored| stored == delivery_id)
                    })
                {
                    return Ok(serde_json::json!({
                        "acknowledged": true,
                        "duplicate": true,
                        "deliveryId": delivery_id,
                    }));
                }
                if state.outbound_receipts.len() >= MAX_QUEUE_ITEMS {
                    return Err(queue_full_error());
                }
                let item = {
                    let queue = state.outbound.entry(peer.to_string()).or_default();
                    if queue.front().map(|item| item.delivery_id.as_str()) != Some(delivery_id) {
                        return Err(SyncTransportError::new(
                            "E_SYNC_ACK_ORDER",
                            "The delivery acknowledgement is not the active pull checkpoint.",
                            false,
                        ));
                    }
                    queue.pop_front().ok_or_else(persistence_error)?
                };
                validate_operation_ids(&item.op_ids)?;
                let acknowledged = state
                    .acknowledged_delivery_ids
                    .entry(peer.to_string())
                    .or_default();
                acknowledged.push_back(delivery_id.to_string());
                while acknowledged.len() > 1024 {
                    acknowledged.pop_front();
                }
                let receipt_sequence = {
                    let sequence = state
                        .outbound_receipt_sequences
                        .entry(peer.to_string())
                        .or_insert(0);
                    *sequence = sequence.checked_add(1).ok_or_else(|| {
                        SyncTransportError::new(
                            "E_SYNC_SEQUENCE_EXHAUSTED",
                            "The LAN sync receipt sequence is exhausted.",
                            false,
                        )
                    })?;
                    *sequence
                };
                state.outbound_receipts.push_back(OutboundSyncReceipt {
                    peer_fingerprint: peer.to_string(),
                    delivery_id: delivery_id.to_string(),
                    op_ids: item.op_ids,
                    sequence: receipt_sequence,
                });
                Ok(serde_json::json!({
                    "acknowledged": true,
                    "duplicate": false,
                    "deliveryId": delivery_id,
                }))
            })
        }

        /// Remote revoke is authenticated by the same mTLS client certificate
        /// it disables. Replay admission is durably committed with the revoked
        /// bit, and every later request reloads that bit before returning the
        /// fixed no-metadata denial used for unknown peers.
        pub(super) fn apply_self_revoke(
            &self,
            peer: &str,
            request: &WireRequest,
        ) -> Result<Value, SyncTransportError> {
            self.transaction(|state| {
                state.accept_authenticated_request(peer, request.sequence, &request.nonce)?;
                state.revoke_peer(peer)?;
                Ok(serde_json::json!({ "revoked": true }))
            })
        }
    }

    fn queue_full_error() -> SyncTransportError {
        SyncTransportError::new(
            "E_SYNC_QUEUE_BOUNDED",
            "The bounded LAN sync queue is full.",
            true,
        )
    }

    fn read_state_slot(path: &Path) -> Option<DurableState> {
        let bytes = std::fs::read(path).ok()?;
        if bytes.len() > MAX_JSON_BYTES * 3 {
            return None;
        }
        let state = serde_json::from_slice::<DurableState>(&bytes).ok()?;
        (state.schema_version == 1).then_some(state)
    }

    fn write_state_slot(path: &Path, state: &DurableState) -> Result<(), SyncTransportError> {
        let serialized = serde_json::to_vec(state).map_err(|_| persistence_error())?;
        if serialized.len() > MAX_JSON_BYTES * 3 {
            return Err(SyncTransportError::new(
                "E_SYNC_QUEUE_BOUNDED",
                "The bounded LAN sync queue is full.",
                true,
            ));
        }
        let mut file = OpenOptions::new()
            .create(true)
            .truncate(true)
            .write(true)
            .open(path)
            .map_err(|_| persistence_error())?;
        file.write_all(&serialized)
            .map_err(|_| persistence_error())?;
        file.sync_all().map_err(|_| persistence_error())?;
        let readback = std::fs::read(path).map_err(|_| persistence_error())?;
        if readback != serialized {
            return Err(persistence_error());
        }
        Ok(())
    }

    fn persistence_error() -> SyncTransportError {
        SyncTransportError::new(
            "E_SYNC_PERSISTENCE",
            "Secure LAN sync state could not be committed.",
            true,
        )
    }

    fn validate_nonce(nonce: &str) -> Result<(), SyncTransportError> {
        if !(16..=128).contains(&nonce.len())
            || !nonce
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
        {
            return Err(SyncTransportError::new(
                "E_SYNC_NONCE",
                "The authenticated sync nonce is invalid.",
                false,
            ));
        }
        Ok(())
    }

    pub(super) fn validate_origin(origin: Option<&str>) -> Result<(), SyncTransportError> {
        if origin.is_some() {
            return Err(SyncTransportError::new(
                "E_SYNC_ORIGIN",
                "Browser-origin LAN requests are not accepted.",
                false,
            ));
        }
        Ok(())
    }

    pub(super) fn validate_sync_json(bytes: &[u8]) -> Result<Value, SyncTransportError> {
        if bytes.is_empty() || bytes.len() > MAX_JSON_BYTES {
            return Err(payload_error());
        }
        let value = serde_json::from_slice::<Value>(bytes).map_err(|_| payload_error())?;
        let mut nodes = 0_usize;
        scan_sync_value(&value, 0, &mut nodes)?;
        Ok(value)
    }

    pub(super) fn validate_sync_payload(bytes: &[u8]) -> Result<Value, SyncTransportError> {
        let value = validate_sync_json(bytes)?;
        if value
            .as_array()
            .is_some_and(|items| items.len() > MAX_PUSH_ENVELOPES)
        {
            return Err(payload_error());
        }
        Ok(value)
    }

    fn scan_sync_value(
        value: &Value,
        depth: usize,
        nodes: &mut usize,
    ) -> Result<(), SyncTransportError> {
        *nodes = nodes.saturating_add(1);
        if depth > 64 || *nodes > 100_000 {
            return Err(payload_error());
        }
        match value {
            Value::Array(items) => {
                for item in items {
                    scan_sync_value(item, depth + 1, nodes)?;
                }
            }
            Value::Object(record) => {
                for (key, item) in record {
                    let normalized = key
                        .chars()
                        .filter(|character| character.is_ascii_alphanumeric())
                        .flat_map(char::to_lowercase)
                        .collect::<String>();
                    if matches!(
                        normalized.as_str(),
                        "token"
                            | "authorization"
                            | "credential"
                            | "secret"
                            | "signedurl"
                            | "thumbnail"
                            | "image"
                            | "imagebytes"
                            | "imagedata"
                            | "base64"
                            | "blob"
                            | "absolutepath"
                            | "localpath"
                            | "outputwriterjournal"
                    ) || normalized.contains("token")
                        || normalized.contains("authorization")
                        || normalized.contains("credential")
                        || normalized.contains("secret")
                        || normalized.contains("signedurl")
                        || normalized.contains("thumbnail")
                        || normalized.contains("imagebytes")
                        || normalized.contains("imagedata")
                        || normalized.contains("base64")
                        || normalized.contains("absolutepath")
                        || normalized.contains("localpath")
                    {
                        return Err(payload_error());
                    }
                    scan_sync_value(item, depth + 1, nodes)?;
                }
            }
            Value::String(text) => scan_sync_string(text)?,
            _ => {}
        }
        Ok(())
    }

    fn scan_sync_string(text: &str) -> Result<(), SyncTransportError> {
        if text.len() > 1024 * 1024 {
            return Err(payload_error());
        }
        let normalized = text.to_ascii_lowercase();
        if normalized.contains("data:image")
            || normalized.contains("x-amz-signature=")
            || normalized.contains("x-amz-credential=")
            || normalized.contains("x-goog-signature=")
            || normalized.contains("authorization:")
            || normalized.contains("-----begin private key-----")
            || looks_like_absolute_path(text)
        {
            return Err(payload_error());
        }
        if BASE64_STANDARD
            .decode(text.as_bytes())
            .ok()
            .is_some_and(|decoded| has_image_signature(&decoded))
            || URL_SAFE_NO_PAD
                .decode(text.as_bytes())
                .ok()
                .is_some_and(|decoded| has_image_signature(&decoded))
        {
            return Err(payload_error());
        }
        Ok(())
    }

    fn looks_like_absolute_path(text: &str) -> bool {
        let bytes = text.as_bytes();
        let normalized = text.to_ascii_lowercase();
        (bytes.len() >= 3
            && bytes[0].is_ascii_alphabetic()
            && bytes[1] == b':'
            && matches!(bytes[2], b'\\' | b'/'))
            || text.starts_with("\\\\")
            || text.starts_with('/')
            || normalized.starts_with("file://")
    }

    fn has_image_signature(bytes: &[u8]) -> bool {
        bytes.starts_with(b"\x89PNG\r\n\x1a\n")
            || bytes.starts_with(&[0xff, 0xd8, 0xff])
            || (bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP")
    }

    #[derive(Zeroize, ZeroizeOnDrop)]
    struct SecretBytes(Vec<u8>);

    struct CaMaterial {
        private_key: SecretBytes,
        certificate_der: Vec<u8>,
        sync_scope_id: String,
        device_id: String,
        device_name: String,
    }

    fn validate_identifier(value: &str) -> Result<(), SyncTransportError> {
        if value.is_empty()
            || value.len() > MAX_REQUEST_ID_BYTES
            || !value.bytes().all(|byte| {
                byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b':' | b'.')
            })
        {
            return Err(SyncTransportError::new(
                "E_SYNC_IDENTIFIER",
                "A secure LAN sync identifier is invalid.",
                false,
            ));
        }
        Ok(())
    }

    fn validate_device_name(value: &str) -> Result<(), SyncTransportError> {
        if value.trim().is_empty() || value.len() > 120 || value.chars().any(char::is_control) {
            return Err(SyncTransportError::new(
                "E_SYNC_DEVICE_NAME",
                "The paired device name is invalid.",
                false,
            ));
        }
        Ok(())
    }

    fn validate_operation_ids(op_ids: &[String]) -> Result<(), SyncTransportError> {
        if op_ids.is_empty() || op_ids.len() > MAX_PUSH_ENVELOPES {
            return Err(payload_error());
        }
        let mut unique = BTreeSet::new();
        for op_id in op_ids {
            if op_id.trim().is_empty()
                || op_id.chars().count() > 512
                || op_id.chars().any(char::is_control)
                || looks_like_absolute_path(op_id)
                || !unique.insert(op_id)
            {
                return Err(payload_error());
            }
        }
        Ok(())
    }

    fn validate_outbound_batch(
        payload: &Value,
        op_ids: &[String],
    ) -> Result<(), SyncTransportError> {
        let envelopes = payload.as_array().ok_or_else(payload_error)?;
        if envelopes.len() != op_ids.len() {
            return Err(payload_error());
        }
        for (envelope, op_id) in envelopes.iter().zip(op_ids) {
            if envelope
                .as_object()
                .and_then(|record| record.get("opId"))
                .and_then(Value::as_str)
                != Some(op_id.as_str())
            {
                return Err(payload_error());
            }
        }
        Ok(())
    }

    fn validate_timeout(timeout_ms: u64) -> Result<Duration, SyncTransportError> {
        if !(MIN_TIMEOUT_MS..=MAX_TIMEOUT_MS).contains(&timeout_ms) {
            return Err(SyncTransportError::new(
                "E_SYNC_TIMEOUT",
                "The secure LAN sync timeout is outside the supported range.",
                false,
            ));
        }
        Ok(Duration::from_millis(timeout_ms))
    }

    pub(super) fn validate_listen_port(port: u16) -> Result<(), SyncTransportError> {
        if port < 1024 {
            return Err(SyncTransportError::new(
                "E_SYNC_LISTEN_PORT",
                "Secure LAN sync requires an explicit unprivileged listen port.",
                false,
            ));
        }
        Ok(())
    }

    pub(super) fn validate_pairing_ttl(ttl_seconds: u64) -> Result<Duration, SyncTransportError> {
        if !(MIN_PAIRING_TTL_SECONDS..=MAX_PAIRING_TTL_SECONDS).contains(&ttl_seconds) {
            return Err(SyncTransportError::new(
                "E_SYNC_PAIRING_TTL",
                "Pairing must expire between 30 and 120 seconds.",
                false,
            ));
        }
        Ok(Duration::from_secs(ttl_seconds))
    }

    fn now_epoch_seconds() -> u64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_or(0, |duration| duration.as_secs())
    }

    fn sha256_hex(bytes: &[u8]) -> String {
        let digest = Sha256::digest(bytes);
        let mut encoded = String::with_capacity(digest.len() * 2);
        for byte in digest {
            use std::fmt::Write as _;
            let _ = write!(&mut encoded, "{byte:02x}");
        }
        encoded
    }

    pub(super) fn certificate_fingerprint(certificate_der: &[u8]) -> String {
        format!("sha256:{}", sha256_hex(certificate_der))
    }

    pub(super) fn scope_id(certificate_der: &[u8]) -> String {
        format!("lan:{}", sha256_hex(certificate_der))
    }

    fn secure_random(bytes: &mut [u8]) -> Result<(), SyncTransportError> {
        let provider = aws_lc_rs::default_provider();
        provider.secure_random.fill(bytes).map_err(|_| {
            SyncTransportError::new(
                "E_SYNC_RANDOM",
                "Secure LAN sync randomness is unavailable.",
                false,
            )
        })
    }

    fn new_capability() -> Result<String, SyncTransportError> {
        let mut bytes = [0_u8; 32];
        secure_random(&mut bytes)?;
        let encoded = URL_SAFE_NO_PAD.encode(bytes);
        bytes.zeroize();
        Ok(encoded)
    }

    fn new_nonce() -> Result<String, SyncTransportError> {
        let mut bytes = [0_u8; 18];
        secure_random(&mut bytes)?;
        let encoded = URL_SAFE_NO_PAD.encode(bytes);
        bytes.zeroize();
        Ok(encoded)
    }

    fn new_confirmation_code() -> Result<String, SyncTransportError> {
        let mut bytes = [0_u8; 4];
        secure_random(&mut bytes)?;
        let number = u32::from_be_bytes(bytes) % 1_000_000;
        bytes.zeroize();
        Ok(format!("{number:06}"))
    }

    fn ca_params() -> CertificateParams {
        let mut params = CertificateParams::default();
        let mut name = DistinguishedName::new();
        name.push(DnType::CommonName, "NAIS2 Secure LAN Sync CA");
        params.distinguished_name = name;
        params.is_ca = IsCa::Ca(BasicConstraints::Unconstrained);
        params.key_usages = vec![
            KeyUsagePurpose::DigitalSignature,
            KeyUsagePurpose::KeyCertSign,
            KeyUsagePurpose::CrlSign,
        ];
        params
    }

    fn generate_device_identity(
        device_id: &str,
        device_name: &str,
    ) -> Result<(SyncDeviceIdentityBundle, Arc<CaMaterial>), SyncTransportError> {
        validate_identifier(device_id)?;
        validate_device_name(device_name)?;
        let key =
            KeyPair::generate_for(&PKCS_ECDSA_P256_SHA256).map_err(|_| certificate_error())?;
        let certificate = ca_params()
            .self_signed(&key)
            .map_err(|_| certificate_error())?;
        let certificate_der = certificate.der().to_vec();
        let private_key = key.serialize_der();
        let sync_scope_id = scope_id(&certificate_der);
        let bundle = SyncDeviceIdentityBundle {
            ca_private_key_pkcs8_base64: BASE64_STANDARD.encode(&private_key),
            ca_certificate_der_base64: BASE64_STANDARD.encode(&certificate_der),
            sync_scope_id: sync_scope_id.clone(),
            device_id: device_id.to_string(),
            device_name: device_name.to_string(),
        };
        let material = Arc::new(CaMaterial {
            private_key: SecretBytes(private_key),
            certificate_der,
            sync_scope_id,
            device_id: device_id.to_string(),
            device_name: device_name.to_string(),
        });
        Ok((bundle, material))
    }

    fn decode_device_identity(
        bundle: &SyncDeviceIdentityBundle,
        expected_device_id: &str,
        expected_device_name: &str,
    ) -> Result<Arc<CaMaterial>, SyncTransportError> {
        validate_identifier(expected_device_id)?;
        validate_device_name(expected_device_name)?;
        if bundle.device_id != expected_device_id || bundle.device_name != expected_device_name {
            return Err(certificate_error());
        }
        let private_key = BASE64_STANDARD
            .decode(bundle.ca_private_key_pkcs8_base64.as_bytes())
            .map_err(|_| certificate_error())?;
        let certificate_der = BASE64_STANDARD
            .decode(bundle.ca_certificate_der_base64.as_bytes())
            .map_err(|_| certificate_error())?;
        if private_key.len() > 16 * 1024
            || certificate_der.len() > 64 * 1024
            || bundle.sync_scope_id != scope_id(&certificate_der)
        {
            return Err(certificate_error());
        }
        KeyPair::try_from(private_key.as_slice()).map_err(|_| certificate_error())?;
        Ok(Arc::new(CaMaterial {
            private_key: SecretBytes(private_key),
            certificate_der,
            sync_scope_id: bundle.sync_scope_id.clone(),
            device_id: bundle.device_id.clone(),
            device_name: bundle.device_name.clone(),
        }))
    }

    fn certificate_error() -> SyncTransportError {
        SyncTransportError::new(
            "E_SYNC_CERTIFICATE",
            "Secure LAN sync certificate material is invalid.",
            false,
        )
    }

    fn server_certificate(
        ca: &CaMaterial,
        bind_ip: IpAddr,
    ) -> Result<(Vec<u8>, Vec<u8>), SyncTransportError> {
        let ca_key =
            KeyPair::try_from(ca.private_key.0.as_slice()).map_err(|_| certificate_error())?;
        let ca_params = ca_params();
        let issuer = Issuer::from_params(&ca_params, &ca_key);
        let server_key =
            KeyPair::generate_for(&PKCS_ECDSA_P256_SHA256).map_err(|_| certificate_error())?;
        let mut params =
            CertificateParams::new(Vec::<String>::new()).map_err(|_| certificate_error())?;
        let mut name = DistinguishedName::new();
        name.push(DnType::CommonName, "NAIS2 Secure LAN Sync");
        params.distinguished_name = name;
        params.is_ca = IsCa::ExplicitNoCa;
        params.subject_alt_names = vec![SanType::IpAddress(bind_ip)];
        params.key_usages = vec![KeyUsagePurpose::DigitalSignature];
        params.extended_key_usages = vec![ExtendedKeyUsagePurpose::ServerAuth];
        let certificate = params
            .signed_by(&server_key, &issuer)
            .map_err(|_| certificate_error())?;
        Ok((certificate.der().to_vec(), server_key.serialize_der()))
    }

    fn server_tls_config(
        ca: &CaMaterial,
        bind_ip: IpAddr,
        require_client_certificate: bool,
    ) -> Result<Arc<ServerConfig>, SyncTransportError> {
        let (server_certificate, server_private_key) = server_certificate(ca, bind_ip)?;
        let provider = Arc::new(aws_lc_rs::default_provider());
        let builder = ServerConfig::builder_with_provider(provider.clone())
            .with_protocol_versions(&[&version::TLS13])
            .map_err(|_| certificate_error())?;
        let builder = if require_client_certificate {
            let mut roots = RootCertStore::empty();
            roots
                .add(CertificateDer::from(ca.certificate_der.clone()))
                .map_err(|_| certificate_error())?;
            let verifier = WebPkiClientVerifier::builder_with_provider(Arc::new(roots), provider)
                .build()
                .map_err(|_| certificate_error())?;
            builder.with_client_cert_verifier(verifier)
        } else {
            builder.with_no_client_auth()
        };
        let key = PrivateKeyDer::Pkcs8(PrivatePkcs8KeyDer::from(server_private_key));
        let mut config = builder
            .with_single_cert(
                vec![
                    CertificateDer::from(server_certificate),
                    CertificateDer::from(ca.certificate_der.clone()),
                ],
                key,
            )
            .map_err(|_| certificate_error())?;
        config.alpn_protocols = vec![b"http/1.1".to_vec()];
        config.max_early_data_size = 0;
        config.send_half_rtt_data = false;
        config.send_tls13_tickets = 0;
        Ok(Arc::new(config))
    }

    fn tls_config(
        ca: &CaMaterial,
        bind_ip: IpAddr,
        require_client_certificate: bool,
    ) -> Result<RustlsConfig, SyncTransportError> {
        server_tls_config(ca, bind_ip, require_client_certificate).map(RustlsConfig::from_config)
    }

    fn issue_client_certificate(
        ca: &CaMaterial,
        csr_der: &[u8],
        device_id: &str,
    ) -> Result<Vec<u8>, SyncTransportError> {
        let csr_der = CertificateSigningRequestDer::from(csr_der.to_vec());
        let parsed =
            CertificateSigningRequestParams::from_der(&csr_der).map_err(|_| certificate_error())?;
        let ca_key =
            KeyPair::try_from(ca.private_key.0.as_slice()).map_err(|_| certificate_error())?;
        let ca_params = ca_params();
        let issuer = Issuer::from_params(&ca_params, &ca_key);
        let mut approved =
            CertificateParams::new(Vec::<String>::new()).map_err(|_| certificate_error())?;
        let mut name = DistinguishedName::new();
        name.push(DnType::CommonName, device_id);
        approved.distinguished_name = name;
        approved.is_ca = IsCa::ExplicitNoCa;
        approved.key_usages = vec![KeyUsagePurpose::DigitalSignature];
        approved.extended_key_usages = vec![ExtendedKeyUsagePurpose::ClientAuth];
        approved
            .signed_by(&parsed.public_key, &issuer)
            .map(|certificate| certificate.der().to_vec())
            .map_err(|_| certificate_error())
    }

    #[derive(Clone, Debug)]
    struct PeerIdentity {
        fingerprint: String,
    }

    #[derive(Clone)]
    struct NetworkAcceptor {
        policy: NetworkPolicy,
    }

    impl<S> Accept<TcpStream, S> for NetworkAcceptor {
        type Stream = TcpStream;
        type Service = S;
        type Future = std::future::Ready<io::Result<(Self::Stream, Self::Service)>>;

        fn accept(&self, stream: TcpStream, service: S) -> Self::Future {
            let accepted = stream
                .peer_addr()
                .and_then(|address| {
                    if self.policy.allows(address.ip()) {
                        Ok(())
                    } else {
                        Err(io::Error::from(io::ErrorKind::PermissionDenied))
                    }
                })
                .map(|()| (stream, service));
            std::future::ready(accepted)
        }
    }

    #[derive(Clone)]
    struct PeerIdentityService<S> {
        inner: S,
        identity: PeerIdentity,
    }

    impl<S, B> Service<Request<B>> for PeerIdentityService<S>
    where
        S: Service<Request<B>>,
    {
        type Response = S::Response;
        type Error = S::Error;
        type Future = S::Future;

        fn poll_ready(&mut self, context: &mut Context<'_>) -> Poll<Result<(), Self::Error>> {
            self.inner.poll_ready(context)
        }

        fn call(&mut self, mut request: Request<B>) -> Self::Future {
            request.extensions_mut().insert(self.identity.clone());
            self.inner.call(request)
        }
    }

    #[derive(Clone)]
    struct PeerTlsAcceptor {
        inner: RustlsAcceptor<NetworkAcceptor>,
    }

    impl<S> Accept<TcpStream, S> for PeerTlsAcceptor
    where
        S: Send + 'static,
        <RustlsAcceptor<NetworkAcceptor> as Accept<TcpStream, S>>::Future: Send + 'static,
    {
        type Stream = <RustlsAcceptor<NetworkAcceptor> as Accept<TcpStream, S>>::Stream;
        type Service = PeerIdentityService<S>;
        type Future = Pin<
            Box<dyn Future<Output = io::Result<(Self::Stream, Self::Service)>> + Send + 'static>,
        >;

        fn accept(&self, stream: TcpStream, service: S) -> Self::Future {
            let future = self.inner.accept(stream, service);
            Box::pin(async move {
                let (tls_stream, service) = future.await?;
                let (_, connection) = tls_stream.get_ref();
                let leaf = connection
                    .peer_certificates()
                    .and_then(|certificates| certificates.first())
                    .ok_or_else(|| io::Error::from(io::ErrorKind::PermissionDenied))?;
                let identity = PeerIdentity {
                    fingerprint: certificate_fingerprint(leaf.as_ref()),
                };
                Ok((
                    tls_stream,
                    PeerIdentityService {
                        inner: service,
                        identity,
                    },
                ))
            })
        }
    }

    #[derive(Deserialize, Serialize)]
    #[serde(rename_all = "camelCase")]
    struct PairWireRequest {
        capability: String,
        confirmation_code: String,
        client_ref: String,
        device_id: String,
        device_name: String,
        csr_der_base64: String,
    }

    impl Drop for PairWireRequest {
        fn drop(&mut self) {
            self.capability.zeroize();
            self.confirmation_code.zeroize();
        }
    }

    #[derive(Deserialize, Serialize)]
    #[serde(rename_all = "camelCase")]
    struct PairWireResponse {
        client_certificate_der_base64: String,
        ca_certificate_der_base64: String,
        sync_endpoint: String,
        sync_scope_id: String,
        peer_fingerprint: String,
    }

    #[derive(Clone)]
    struct PairingContext {
        session: Arc<Mutex<PairingSession>>,
        store: Arc<DurableStore>,
        ca: Arc<CaMaterial>,
        sync_endpoint: String,
        notify_closed: Arc<Notify>,
    }

    #[derive(Deserialize, Serialize)]
    #[serde(rename_all = "camelCase")]
    pub(super) struct WireRequest {
        pub(super) request_id: String,
        pub(super) sequence: u64,
        pub(super) nonce: String,
        pub(super) payload: Option<Value>,
        pub(super) delivery_id: Option<String>,
    }

    #[derive(Clone)]
    struct DataContext {
        store: Arc<DurableStore>,
    }

    fn request_headers_allowed(headers: &HeaderMap) -> bool {
        if validate_origin(headers.get(header::ORIGIN).map(|_| "present")).is_err() {
            return false;
        }
        headers
            .get(header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .is_some_and(|value| value.eq_ignore_ascii_case("application/json"))
    }

    fn generic_denial() -> Response {
        (
            StatusCode::NOT_FOUND,
            [(header::CONTENT_TYPE, "application/json")],
            "{\"error\":\"not-available\"}",
        )
            .into_response()
    }

    fn typed_error_response(error: SyncTransportError) -> Response {
        if matches!(error.code, "E_SYNC_NOT_PAIRED" | "E_SYNC_PEER_UNKNOWN") {
            return generic_denial();
        }
        let status = match error.code {
            "E_SYNC_REPLAY" | "E_SYNC_ACK_ORDER" | "E_SYNC_INBOUND_ACK_ORDER" => {
                StatusCode::CONFLICT
            }
            "E_SYNC_QUEUE_BOUNDED" => StatusCode::TOO_MANY_REQUESTS,
            "E_SYNC_PAYLOAD_REJECTED" => StatusCode::PAYLOAD_TOO_LARGE,
            _ => StatusCode::BAD_REQUEST,
        };
        (status, Json(error)).into_response()
    }

    async fn pair_handler(
        State(context): State<PairingContext>,
        headers: HeaderMap,
        body: Bytes,
    ) -> Response {
        if !request_headers_allowed(&headers) || body.len() > MAX_JSON_BYTES {
            return generic_denial();
        }
        let request = match serde_json::from_slice::<PairWireRequest>(&body) {
            Ok(request) => request,
            Err(_) => return generic_denial(),
        };
        if validate_identifier(&request.client_ref).is_err()
            || validate_identifier(&request.device_id).is_err()
            || validate_device_name(&request.device_name).is_err()
            || request.csr_der_base64.len() > 32 * 1024
        {
            return generic_denial();
        }
        let csr_der = match BASE64_STANDARD.decode(request.csr_der_base64.as_bytes()) {
            Ok(bytes) if bytes.len() <= 24 * 1024 => bytes,
            _ => return generic_denial(),
        };

        let mut session = match context.session.lock() {
            Ok(session) => session,
            Err(_) => return generic_denial(),
        };
        let now = now_epoch_seconds();
        if session
            .verify(&request.capability, &request.confirmation_code, now)
            .is_err()
        {
            return generic_denial();
        }
        let certificate_der =
            match issue_client_certificate(&context.ca, &csr_der, &request.device_id) {
                Ok(certificate) => certificate,
                Err(_) => return generic_denial(),
            };
        let peer_fingerprint = certificate_fingerprint(&certificate_der);
        if context
            .store
            .transaction(|state| {
                state.register_peer(
                    &peer_fingerprint,
                    &request.client_ref,
                    &request.device_id,
                    &request.device_name,
                )
            })
            .is_err()
        {
            return generic_denial();
        }
        if session
            .consume(&request.capability, &request.confirmation_code, now)
            .is_err()
        {
            return generic_denial();
        }
        context.notify_closed.notify_waiters();

        Json(PairWireResponse {
            client_certificate_der_base64: BASE64_STANDARD.encode(certificate_der),
            ca_certificate_der_base64: BASE64_STANDARD.encode(&context.ca.certificate_der),
            sync_endpoint: context.sync_endpoint.clone(),
            sync_scope_id: context.ca.sync_scope_id.clone(),
            peer_fingerprint,
        })
        .into_response()
    }

    async fn manifest_handler(
        State(context): State<DataContext>,
        Extension(identity): Extension<PeerIdentity>,
        headers: HeaderMap,
        body: Bytes,
    ) -> Response {
        data_handler(
            context,
            identity,
            headers,
            body,
            SyncExchangeOperation::Manifest,
        )
    }

    async fn push_handler(
        State(context): State<DataContext>,
        Extension(identity): Extension<PeerIdentity>,
        headers: HeaderMap,
        body: Bytes,
    ) -> Response {
        data_handler(
            context,
            identity,
            headers,
            body,
            SyncExchangeOperation::Push,
        )
    }

    async fn pull_handler(
        State(context): State<DataContext>,
        Extension(identity): Extension<PeerIdentity>,
        headers: HeaderMap,
        body: Bytes,
    ) -> Response {
        data_handler(
            context,
            identity,
            headers,
            body,
            SyncExchangeOperation::Pull,
        )
    }

    async fn ack_handler(
        State(context): State<DataContext>,
        Extension(identity): Extension<PeerIdentity>,
        headers: HeaderMap,
        body: Bytes,
    ) -> Response {
        data_handler(context, identity, headers, body, SyncExchangeOperation::Ack)
    }

    async fn revoke_handler(
        State(context): State<DataContext>,
        Extension(identity): Extension<PeerIdentity>,
        headers: HeaderMap,
        body: Bytes,
    ) -> Response {
        data_handler(
            context,
            identity,
            headers,
            body,
            SyncExchangeOperation::Revoke,
        )
    }

    fn data_handler(
        context: DataContext,
        identity: PeerIdentity,
        headers: HeaderMap,
        body: Bytes,
        operation: SyncExchangeOperation,
    ) -> Response {
        if !request_headers_allowed(&headers) || body.len() > MAX_JSON_BYTES {
            return generic_denial();
        }
        let request = match serde_json::from_slice::<WireRequest>(&body) {
            Ok(request) => request,
            Err(_) => return typed_error_response(payload_error()),
        };
        if validate_identifier(&request.request_id).is_err() {
            return typed_error_response(payload_error());
        }
        let result = match operation {
            SyncExchangeOperation::Manifest => context
                .store
                .apply_manifest(&identity.fingerprint, &request),
            SyncExchangeOperation::Push => context.store.apply_push(&identity.fingerprint, request),
            SyncExchangeOperation::Pull => {
                context.store.apply_pull(&identity.fingerprint, &request)
            }
            SyncExchangeOperation::Ack => context.store.apply_ack(&identity.fingerprint, &request),
            SyncExchangeOperation::Revoke => context
                .store
                .apply_self_revoke(&identity.fingerprint, &request),
        };
        match result {
            Ok(response) => Json(response).into_response(),
            Err(error) => typed_error_response(error),
        }
    }

    async fn unknown_route() -> Response {
        generic_denial()
    }

    fn pairing_router(context: PairingContext) -> Router {
        Router::new()
            .route("/v1/pair", post(pair_handler))
            .fallback(unknown_route)
            .layer(DefaultBodyLimit::max(MAX_JSON_BYTES))
            .layer(ConcurrencyLimitLayer::new(2))
            .with_state(context)
    }

    fn data_router(context: DataContext) -> Router {
        Router::new()
            .route("/v1/manifest", post(manifest_handler))
            .route("/v1/push", post(push_handler))
            .route("/v1/pull", post(pull_handler))
            .route("/v1/ack", post(ack_handler))
            .route("/v1/revoke", post(revoke_handler))
            .fallback(unknown_route)
            .layer(DefaultBodyLimit::max(MAX_JSON_BYTES))
            .layer(ConcurrencyLimitLayer::new(8))
            .with_state(context)
    }

    struct RunningServer {
        endpoint: String,
        policy: NetworkPolicy,
        handle: Handle<SocketAddr>,
        task: JoinHandle<io::Result<()>>,
        sync_scope_id: String,
        device_id: String,
        device_name: String,
    }

    struct RunningPairing {
        handle: Handle<SocketAddr>,
        task: JoinHandle<io::Result<()>>,
        session: Arc<Mutex<PairingSession>>,
    }

    /// Runtime state connects Tauri commands to the two HTTPS listeners, the
    /// nonsecret two-slot journal, and request-scoped cancellation. Stronghold
    /// remains secret authority: CA/client private material is accepted only at
    /// explicit command boundaries and the native execution cache is dropped on
    /// stop/close instead of exposing any read-back command.
    pub(super) struct DesktopRuntime {
        lifecycle: AsyncMutex<()>,
        server: AsyncMutex<Option<RunningServer>>,
        pairing: AsyncMutex<Option<RunningPairing>>,
        store: AsyncMutex<Option<Arc<DurableStore>>>,
        identity: AsyncMutex<Option<Arc<CaMaterial>>>,
        active_requests: Mutex<HashMap<String, oneshot::Sender<()>>>,
        client_exchange_lock: AsyncMutex<()>,
    }

    impl Default for DesktopRuntime {
        fn default() -> Self {
            Self {
                lifecycle: AsyncMutex::new(()),
                server: AsyncMutex::new(None),
                pairing: AsyncMutex::new(None),
                store: AsyncMutex::new(None),
                identity: AsyncMutex::new(None),
                active_requests: Mutex::new(HashMap::new()),
                client_exchange_lock: AsyncMutex::new(()),
            }
        }
    }

    impl DesktopRuntime {
        fn register_request(
            &self,
            request_id: &str,
        ) -> Result<oneshot::Receiver<()>, SyncTransportError> {
            validate_identifier(request_id)?;
            let (sender, receiver) = oneshot::channel();
            let mut active = self.active_requests.lock().map_err(|_| runtime_error())?;
            if active.contains_key(request_id) {
                return Err(SyncTransportError::new(
                    "E_SYNC_REQUEST_ACTIVE",
                    "The secure LAN sync request identifier is already active.",
                    false,
                ));
            }
            active.insert(request_id.to_string(), sender);
            Ok(receiver)
        }

        fn release_request(&self, request_id: &str) {
            if let Ok(mut active) = self.active_requests.lock() {
                active.remove(request_id);
            }
        }

        pub(super) fn cancel_request(&self, request_id: &str) -> bool {
            self.active_requests
                .lock()
                .ok()
                .and_then(|mut active| active.remove(request_id))
                .is_some_and(|sender| sender.send(()).is_ok())
        }

        async fn require_store(&self) -> Result<Arc<DurableStore>, SyncTransportError> {
            self.store.lock().await.clone().ok_or_else(|| {
                SyncTransportError::new(
                    "E_SYNC_NOT_RUNNING",
                    "Secure LAN sync is not running.",
                    false,
                )
            })
        }
    }

    pub(super) async fn start(
        app: tauri::AppHandle,
        request: StartSyncTransportRequest,
        runtime: &DesktopRuntime,
    ) -> Result<StartSyncTransportResult, SyncTransportError> {
        let _lifecycle_guard = runtime.lifecycle.lock().await;
        let mut server_guard = runtime.server.lock().await;
        if server_guard.is_some() {
            return Err(SyncTransportError::new(
                "E_SYNC_ALREADY_RUNNING",
                "Secure LAN sync is already running.",
                false,
            ));
        }
        validate_identifier(&request.device_id)?;
        validate_device_name(&request.device_name)?;
        validate_listen_port(request.port)?;
        let policy = NetworkPolicy::parse(&request.bind_ip, &request.allow_cidrs)?;
        let (generated_device_identity, identity) = match request.device_identity.as_ref() {
            Some(bundle) => (
                None,
                decode_device_identity(bundle, &request.device_id, &request.device_name)?,
            ),
            None => {
                let (bundle, identity) =
                    generate_device_identity(&request.device_id, &request.device_name)?;
                (Some(bundle), identity)
            }
        };

        let scope_suffix = identity
            .sync_scope_id
            .strip_prefix("lan:")
            .filter(|value| value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit()))
            .ok_or_else(certificate_error)?;
        let app_data = app.path().app_data_dir().map_err(|_| persistence_error())?;
        let store = Arc::new(DurableStore::open(
            &app_data.join("sync-transport").join(scope_suffix),
        )?);
        store.ensure_scope(&identity.sync_scope_id)?;

        let tls = tls_config(&identity, policy.bind_ip(), true)?;
        let listener = std::net::TcpListener::bind(SocketAddr::new(policy.bind_ip(), request.port))
            .map_err(|_| {
                SyncTransportError::new(
                    "E_SYNC_LISTEN",
                    "The secure LAN sync listener could not bind.",
                    true,
                )
            })?;
        listener
            .set_nonblocking(true)
            .map_err(|_| runtime_error())?;
        let address = listener.local_addr().map_err(|_| runtime_error())?;
        let endpoint = format!("https://{address}");
        let acceptor = PeerTlsAcceptor {
            inner: RustlsAcceptor::new(tls).acceptor(NetworkAcceptor {
                policy: policy.clone(),
            }),
        };
        let handle = Handle::<SocketAddr>::new();
        let handle_for_task = handle.clone();
        let router = data_router(DataContext {
            store: Arc::clone(&store),
        });
        let task = tokio::spawn(async move {
            axum_server::from_tcp(listener)?
                .acceptor(acceptor)
                .handle(handle_for_task)
                .serve(router.into_make_service())
                .await
        });

        *runtime.store.lock().await = Some(store);
        *runtime.identity.lock().await = Some(Arc::clone(&identity));
        *server_guard = Some(RunningServer {
            endpoint: endpoint.clone(),
            policy,
            handle,
            task,
            sync_scope_id: identity.sync_scope_id.clone(),
            device_id: identity.device_id.clone(),
            device_name: identity.device_name.clone(),
        });

        Ok(StartSyncTransportResult {
            endpoint,
            sync_scope_id: identity.sync_scope_id.clone(),
            device_id: identity.device_id.clone(),
            device_name: identity.device_name.clone(),
            generated_device_identity,
        })
    }

    async fn close_pairing_unlocked(runtime: &DesktopRuntime) -> Result<(), SyncTransportError> {
        let running = runtime.pairing.lock().await.take();
        if let Some(running) = running {
            running.handle.shutdown();
            let _ = timeout(Duration::from_secs(3), running.task).await;
        }
        Ok(())
    }

    pub(super) async fn close_pairing(runtime: &DesktopRuntime) -> Result<(), SyncTransportError> {
        let _lifecycle_guard = runtime.lifecycle.lock().await;
        close_pairing_unlocked(runtime).await
    }

    pub(super) async fn stop(runtime: &DesktopRuntime) -> Result<(), SyncTransportError> {
        let _lifecycle_guard = runtime.lifecycle.lock().await;
        close_pairing_unlocked(runtime).await?;
        let running = runtime.server.lock().await.take();
        if let Some(running) = running {
            running
                .handle
                .graceful_shutdown(Some(Duration::from_secs(2)));
            let _ = timeout(Duration::from_secs(3), running.task).await;
        }
        *runtime.store.lock().await = None;
        *runtime.identity.lock().await = None;
        if let Ok(mut requests) = runtime.active_requests.lock() {
            for (_, sender) in requests.drain() {
                let _ = sender.send(());
            }
        }
        Ok(())
    }

    pub(super) async fn status(
        runtime: &DesktopRuntime,
    ) -> Result<SyncTransportStatus, SyncTransportError> {
        let server = runtime.server.lock().await;
        let store = runtime.store.lock().await.clone();
        let peers = match store {
            Some(store) => store.peer_summaries()?,
            None => Vec::new(),
        };
        let pairing_open = runtime
            .pairing
            .lock()
            .await
            .as_ref()
            .is_some_and(|running| {
                running
                    .session
                    .lock()
                    .is_ok_and(|session| session.is_open(now_epoch_seconds()))
            });
        Ok(match server.as_ref() {
            Some(server) => SyncTransportStatus {
                running: true,
                endpoint: Some(server.endpoint.clone()),
                sync_scope_id: Some(server.sync_scope_id.clone()),
                device_id: Some(server.device_id.clone()),
                device_name: Some(server.device_name.clone()),
                pairing_open,
                active_peer_count: peers.iter().filter(|peer| peer.active).count(),
                peers,
            },
            None => SyncTransportStatus {
                running: false,
                endpoint: None,
                sync_scope_id: None,
                device_id: None,
                device_name: None,
                pairing_open: false,
                active_peer_count: 0,
                peers: Vec::new(),
            },
        })
    }

    pub(super) async fn open_pairing(
        request: OpenPairingRequest,
        runtime: &DesktopRuntime,
    ) -> Result<PairingInvitation, SyncTransportError> {
        let _lifecycle_guard = runtime.lifecycle.lock().await;
        let ttl = validate_pairing_ttl(request.ttl_seconds)?;
        close_pairing_unlocked(runtime).await?;
        let store = runtime.require_store().await?;
        if store.peer_summaries()?.iter().any(|peer| peer.active) {
            return Err(SyncTransportError::new(
                "E_SYNC_SINGLE_PEER",
                "Revoke the active paired device before pairing a replacement.",
                false,
            ));
        }
        let (sync_endpoint, policy) = {
            let server = runtime.server.lock().await;
            let running = server.as_ref().ok_or_else(|| {
                SyncTransportError::new(
                    "E_SYNC_NOT_RUNNING",
                    "Secure LAN sync is not running.",
                    false,
                )
            })?;
            (running.endpoint.clone(), running.policy.clone())
        };
        let identity = runtime
            .identity
            .lock()
            .await
            .clone()
            .ok_or_else(runtime_error)?;
        let capability = new_capability()?;
        let confirmation_code = new_confirmation_code()?;
        let expires_at = now_epoch_seconds().saturating_add(ttl.as_secs());
        let session = Arc::new(Mutex::new(PairingSession::new(
            capability.clone(),
            confirmation_code.clone(),
            expires_at,
        )));
        let notify_closed = Arc::new(Notify::new());
        let context = PairingContext {
            session: Arc::clone(&session),
            store,
            ca: Arc::clone(&identity),
            sync_endpoint: sync_endpoint.clone(),
            notify_closed: Arc::clone(&notify_closed),
        };
        let tls = tls_config(&identity, policy.bind_ip(), false)?;
        let listener =
            std::net::TcpListener::bind(SocketAddr::new(policy.bind_ip(), 0)).map_err(|_| {
                SyncTransportError::new(
                    "E_SYNC_PAIRING_LISTEN",
                    "The short-lived pairing listener could not bind.",
                    true,
                )
            })?;
        listener
            .set_nonblocking(true)
            .map_err(|_| runtime_error())?;
        let address = listener.local_addr().map_err(|_| runtime_error())?;
        let pairing_endpoint = format!("https://{address}");
        let acceptor = RustlsAcceptor::new(tls).acceptor(NetworkAcceptor { policy });
        let handle = Handle::<SocketAddr>::new();
        let handle_for_task = handle.clone();
        let task = tokio::spawn(async move {
            axum_server::from_tcp(listener)?
                .acceptor(acceptor)
                .handle(handle_for_task)
                .serve(pairing_router(context).into_make_service())
                .await
        });
        let expiry_handle = handle.clone();
        tokio::spawn(async move {
            tokio::select! {
                _ = sleep(ttl) => {}
                _ = notify_closed.notified() => {}
            }
            expiry_handle.graceful_shutdown(Some(Duration::from_secs(2)));
        });
        *runtime.pairing.lock().await = Some(RunningPairing {
            handle,
            task,
            session,
        });

        Ok(PairingInvitation {
            pairing_endpoint,
            sync_endpoint,
            capability,
            confirmation_code,
            ca_certificate_base64: BASE64_STANDARD.encode(&identity.certificate_der),
            expires_at,
            sync_scope_id: identity.sync_scope_id.clone(),
        })
    }

    pub(super) async fn revoke(
        request: RevokePeerRequest,
        runtime: &DesktopRuntime,
    ) -> Result<(), SyncTransportError> {
        validate_identifier(&request.peer_fingerprint)?;
        runtime
            .require_store()
            .await?
            .revoke(&request.peer_fingerprint)
    }

    pub(super) async fn enqueue_outbound(
        request: EnqueueOutboundRequest,
        runtime: &DesktopRuntime,
    ) -> Result<(), SyncTransportError> {
        runtime.require_store().await?.enqueue_outbound(request)
    }

    pub(super) async fn peek_inbound(
        request: DrainInboundRequest,
        runtime: &DesktopRuntime,
    ) -> Result<Vec<InboundSyncItem>, SyncTransportError> {
        runtime.require_store().await?.peek_inbound(request.limit)
    }

    pub(super) async fn ack_inbound(
        request: AckInboundRequest,
        runtime: &DesktopRuntime,
    ) -> Result<(), SyncTransportError> {
        runtime
            .require_store()
            .await?
            .ack_inbound(&request.request_id)
    }

    pub(super) async fn peek_outbound_receipts(
        request: PeekOutboundReceiptsRequest,
        runtime: &DesktopRuntime,
    ) -> Result<Vec<OutboundSyncReceipt>, SyncTransportError> {
        runtime
            .require_store()
            .await?
            .peek_outbound_receipts(request.limit)
    }

    pub(super) async fn ack_outbound_receipt(
        request: AckOutboundReceiptRequest,
        runtime: &DesktopRuntime,
    ) -> Result<(), SyncTransportError> {
        runtime
            .require_store()
            .await?
            .ack_outbound_receipt(&request)
    }

    fn validate_local_https_endpoint(value: &str) -> Result<reqwest::Url, SyncTransportError> {
        let url = reqwest::Url::parse(value).map_err(|_| endpoint_error())?;
        let host = url
            .host_str()
            .and_then(|host| host.parse::<IpAddr>().ok())
            .ok_or_else(endpoint_error)?;
        if url.scheme() != "https"
            || !is_local_scope_ip(host)
            || url.port().is_none()
            || !url.username().is_empty()
            || url.password().is_some()
            || url.query().is_some()
            || url.fragment().is_some()
            || !matches!(url.path(), "" | "/")
        {
            return Err(endpoint_error());
        }
        Ok(url)
    }

    fn endpoint_error() -> SyncTransportError {
        SyncTransportError::new(
            "E_SYNC_ENDPOINT",
            "The secure LAN sync endpoint is invalid.",
            false,
        )
    }

    fn der_to_pem(label: &str, bytes: &[u8]) -> String {
        let encoded = BASE64_STANDARD.encode(bytes);
        let mut pem = String::with_capacity(encoded.len() + 96);
        pem.push_str("-----BEGIN ");
        pem.push_str(label);
        pem.push_str("-----\n");
        for chunk in encoded.as_bytes().chunks(64) {
            if let Ok(line) = std::str::from_utf8(chunk) {
                pem.push_str(line);
                pem.push('\n');
            }
        }
        pem.push_str("-----END ");
        pem.push_str(label);
        pem.push_str("-----\n");
        pem
    }

    fn pinned_reqwest_client(
        ca_certificate_der: &[u8],
        identity_pem: Option<&str>,
        total_timeout: Duration,
    ) -> Result<reqwest::Client, SyncTransportError> {
        let root =
            reqwest::Certificate::from_der(ca_certificate_der).map_err(|_| certificate_error())?;
        let mut builder = reqwest::Client::builder()
            .tls_built_in_root_certs(false)
            .add_root_certificate(root)
            .min_tls_version(reqwest::tls::Version::TLS_1_3)
            .max_tls_version(reqwest::tls::Version::TLS_1_3)
            .https_only(true)
            .http1_only()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .referer(false)
            .connect_timeout(Duration::from_secs(10).min(total_timeout))
            .timeout(total_timeout)
            .pool_max_idle_per_host(1)
            .user_agent("NAIS2-Secure-Sync/1");
        if let Some(identity_pem) = identity_pem {
            let identity = reqwest::Identity::from_pem(identity_pem.as_bytes())
                .map_err(|_| certificate_error())?;
            builder = builder.identity(identity);
        }
        builder.build().map_err(|_| {
            SyncTransportError::new(
                "E_SYNC_CLIENT",
                "The secure LAN sync client could not be initialized.",
                false,
            )
        })
    }

    async fn read_bounded_response(
        mut response: reqwest::Response,
        cancelled: &mut oneshot::Receiver<()>,
        deadline: Instant,
    ) -> Result<Vec<u8>, SyncTransportError> {
        if response
            .content_length()
            .is_some_and(|length| length > MAX_JSON_BYTES as u64)
        {
            return Err(payload_error());
        }
        let mut bytes = Vec::new();
        loop {
            let chunk = tokio::select! {
                _ = &mut *cancelled => return Err(cancelled_error()),
                _ = sleep_until(deadline) => return Err(timeout_error()),
                chunk = response.chunk() => chunk.map_err(|_| network_error())?,
            };
            match chunk {
                Some(chunk) => {
                    if bytes.len().saturating_add(chunk.len()) > MAX_JSON_BYTES {
                        return Err(payload_error());
                    }
                    bytes.extend_from_slice(&chunk);
                }
                None => return Ok(bytes),
            }
        }
    }

    pub(super) async fn pair_client(
        request: PairClientRequest,
        runtime: &DesktopRuntime,
    ) -> Result<PairClientResult, SyncTransportError> {
        validate_identifier(&request.client_ref)?;
        validate_identifier(&request.device_id)?;
        validate_device_name(&request.device_name)?;
        let total_timeout = validate_timeout(request.timeout_ms)?;
        let deadline = Instant::now() + total_timeout;
        if request.invitation.expires_at <= now_epoch_seconds()
            || request.invitation.confirmation_code.len() != 6
        {
            return Err(SyncTransportError::new(
                "E_SYNC_PAIRING_DENIED",
                "Pairing is not available.",
                false,
            ));
        }
        let pairing_endpoint = validate_local_https_endpoint(&request.invitation.pairing_endpoint)?;
        validate_local_https_endpoint(&request.invitation.sync_endpoint)?;
        let ca_der = BASE64_STANDARD
            .decode(request.invitation.ca_certificate_base64.as_bytes())
            .map_err(|_| certificate_error())?;
        if request.invitation.sync_scope_id != scope_id(&ca_der) {
            return Err(certificate_error());
        }

        let client_key =
            KeyPair::generate_for(&PKCS_ECDSA_P256_SHA256).map_err(|_| certificate_error())?;
        let mut params =
            CertificateParams::new(Vec::<String>::new()).map_err(|_| certificate_error())?;
        let mut name = DistinguishedName::new();
        name.push(DnType::CommonName, request.device_id.as_str());
        params.distinguished_name = name;
        params.is_ca = IsCa::ExplicitNoCa;
        params.key_usages = vec![KeyUsagePurpose::DigitalSignature];
        params.extended_key_usages = vec![ExtendedKeyUsagePurpose::ClientAuth];
        let csr = params
            .serialize_request(&client_key)
            .map_err(|_| certificate_error())?;
        let wire = PairWireRequest {
            capability: request.invitation.capability.clone(),
            confirmation_code: request.invitation.confirmation_code.clone(),
            client_ref: request.client_ref.clone(),
            device_id: request.device_id.clone(),
            device_name: request.device_name.clone(),
            csr_der_base64: BASE64_STANDARD.encode(csr.der()),
        };
        let body = serde_json::to_vec(&wire).map_err(|_| payload_error())?;
        let client = pinned_reqwest_client(&ca_der, None, remaining_timeout(deadline)?)?;
        let url = pairing_endpoint
            .join("v1/pair")
            .map_err(|_| endpoint_error())?;
        let mut cancelled = runtime.register_request(&request.request_id)?;
        let result = async {
            let response = tokio::select! {
                _ = &mut cancelled => return Err(cancelled_error()),
                response = timeout_at(deadline, client.post(url).header(header::CONTENT_TYPE, "application/json").body(body).send()) => {
                    response.map_err(|_| timeout_error())?.map_err(|_| network_error())?
                }
            };
            if !response.status().is_success() {
                return Err(SyncTransportError::new(
                    "E_SYNC_PAIRING_DENIED",
                    "Pairing is not available.",
                    false,
                ));
            }
            let bytes = read_bounded_response(response, &mut cancelled, deadline).await?;
            let response = serde_json::from_slice::<PairWireResponse>(&bytes)
                .map_err(|_| certificate_error())?;
            let client_certificate_der = BASE64_STANDARD
                .decode(response.client_certificate_der_base64.as_bytes())
                .map_err(|_| certificate_error())?;
            let response_ca_der = BASE64_STANDARD
                .decode(response.ca_certificate_der_base64.as_bytes())
                .map_err(|_| certificate_error())?;
            let peer_fingerprint = certificate_fingerprint(&client_certificate_der);
            if response_ca_der != ca_der
                || response.sync_scope_id != request.invitation.sync_scope_id
                || response.sync_endpoint != request.invitation.sync_endpoint
                || response.peer_fingerprint != peer_fingerprint
            {
                return Err(certificate_error());
            }
            let mut private_key = client_key.serialize_der();
            let bundle = SyncClientCredentialBundle {
                client_private_key_pkcs8_base64: BASE64_STANDARD.encode(&private_key),
                client_certificate_der_base64: BASE64_STANDARD.encode(&client_certificate_der),
                ca_certificate_der_base64: BASE64_STANDARD.encode(&ca_der),
                sync_endpoint: response.sync_endpoint,
                sync_scope_id: response.sync_scope_id.clone(),
                peer_fingerprint: peer_fingerprint.clone(),
            };
            private_key.zeroize();
            Ok(PairClientResult {
                peer_fingerprint,
                sync_scope_id: response.sync_scope_id,
                credential_bundle: bundle,
            })
        }
        .await;
        runtime.release_request(&request.request_id);
        result
    }

    fn open_client_scope_store(
        app: &tauri::AppHandle,
        sync_scope_id: &str,
    ) -> Result<DurableStore, SyncTransportError> {
        let suffix = sync_scope_id
            .strip_prefix("lan:")
            .filter(|value| value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit()))
            .ok_or_else(certificate_error)?;
        let app_data = app.path().app_data_dir().map_err(|_| persistence_error())?;
        let store = DurableStore::open(&app_data.join("sync-transport").join(suffix))?;
        store.ensure_scope(sync_scope_id)?;
        Ok(store)
    }

    pub(super) async fn exchange(
        app: tauri::AppHandle,
        request: SyncExchangeRequest,
        runtime: &DesktopRuntime,
    ) -> Result<SyncExchangeResult, SyncTransportError> {
        validate_identifier(&request.client_ref)?;
        validate_identifier(&request.request_id)?;
        let total_timeout = validate_timeout(request.timeout_ms)?;
        let mut cancelled = runtime.register_request(&request.request_id)?;
        let deadline = Instant::now() + total_timeout;
        let result = async {
            // Registration precedes the single-client journal lock so queued
            // calls are cancellable and the advertised timeout covers lock
            // wait, connection, response headers, and bounded body reads.
            let _exchange_guard = tokio::select! {
                _ = &mut cancelled => return Err(cancelled_error()),
                guard = timeout_at(deadline, runtime.client_exchange_lock.lock()) => {
                    guard.map_err(|_| timeout_error())?
                }
            };
            let endpoint =
                validate_local_https_endpoint(&request.credential_bundle.sync_endpoint)?;
            let ca_der = BASE64_STANDARD
                .decode(request.credential_bundle.ca_certificate_der_base64.as_bytes())
                .map_err(|_| certificate_error())?;
            let client_certificate_der = BASE64_STANDARD
                .decode(request.credential_bundle.client_certificate_der_base64.as_bytes())
                .map_err(|_| certificate_error())?;
            let mut private_key = BASE64_STANDARD
                .decode(
                    request
                        .credential_bundle
                        .client_private_key_pkcs8_base64
                        .as_bytes(),
                )
                .map_err(|_| certificate_error())?;
            if request.credential_bundle.sync_scope_id != scope_id(&ca_der)
                || request.credential_bundle.peer_fingerprint
                    != certificate_fingerprint(&client_certificate_der)
                || private_key.len() > 16 * 1024
                || KeyPair::try_from(private_key.as_slice()).is_err()
            {
                private_key.zeroize();
                return Err(certificate_error());
            }
            let mut identity_pem = String::new();
            identity_pem.push_str(&der_to_pem("CERTIFICATE", &client_certificate_der));
            identity_pem.push_str(&der_to_pem("CERTIFICATE", &ca_der));
            identity_pem.push_str(&der_to_pem("PRIVATE KEY", &private_key));
            private_key.zeroize();
            let client_result = pinned_reqwest_client(
                &ca_der,
                Some(&identity_pem),
                remaining_timeout(deadline)?,
            );
            identity_pem.zeroize();
            let client = client_result?;

            match request.operation {
                SyncExchangeOperation::Push => {
                    let payload = request.payload.as_ref().ok_or_else(payload_error)?;
                    let bytes = serde_json::to_vec(payload).map_err(|_| payload_error())?;
                    validate_sync_payload(&bytes)?;
                    if request.delivery_id.is_some() {
                        return Err(payload_error());
                    }
                }
                SyncExchangeOperation::Ack => {
                    let delivery_id =
                        request.delivery_id.as_deref().ok_or_else(payload_error)?;
                    validate_identifier(delivery_id)?;
                    if request.payload.is_some() {
                        return Err(payload_error());
                    }
                }
                SyncExchangeOperation::Manifest
                | SyncExchangeOperation::Pull
                | SyncExchangeOperation::Revoke => {
                    if request.payload.is_some() || request.delivery_id.is_some() {
                        return Err(payload_error());
                    }
                }
            }

            let store =
                open_client_scope_store(&app, &request.credential_bundle.sync_scope_id)?;
            let sequence = store.next_client_sequence(&request.client_ref)?;
            let wire = WireRequest {
                request_id: request.request_id.clone(),
                sequence,
                nonce: new_nonce()?,
                payload: request.payload.clone(),
                delivery_id: request.delivery_id.clone(),
            };
            let body = serde_json::to_vec(&wire).map_err(|_| payload_error())?;
            if body.len() > MAX_JSON_BYTES {
                return Err(payload_error());
            }
            let path = match request.operation {
                SyncExchangeOperation::Manifest => "v1/manifest",
                SyncExchangeOperation::Push => "v1/push",
                SyncExchangeOperation::Pull => "v1/pull",
                SyncExchangeOperation::Ack => "v1/ack",
                SyncExchangeOperation::Revoke => "v1/revoke",
            };
            let url = endpoint.join(path).map_err(|_| endpoint_error())?;
            let response = tokio::select! {
                _ = &mut cancelled => return Err(cancelled_error()),
                response = timeout_at(deadline, client.post(url).header(header::CONTENT_TYPE, "application/json").body(body).send()) => {
                    response.map_err(|_| timeout_error())?.map_err(|_| network_error())?
                }
            };
            if !response.status().is_success() {
                return Err(match response.status() {
                    StatusCode::CONFLICT => SyncTransportError::new(
                        "E_SYNC_REPLAY_OR_CHECKPOINT",
                        "The secure LAN sync replay or checkpoint was rejected.",
                        false,
                    ),
                    StatusCode::NOT_FOUND => SyncTransportError::new(
                        "E_SYNC_NOT_PAIRED",
                        "The peer is not paired.",
                        false,
                    ),
                    StatusCode::TOO_MANY_REQUESTS => queue_full_error(),
                    _ => network_error(),
                });
            }
            let bytes = read_bounded_response(response, &mut cancelled, deadline).await?;
            let response = serde_json::from_slice::<Value>(&bytes).map_err(|_| payload_error())?;
            Ok(SyncExchangeResult { sequence, response })
        }
        .await;
        runtime.release_request(&request.request_id);
        result
    }

    fn cancelled_error() -> SyncTransportError {
        SyncTransportError::new(
            "E_SYNC_CANCELLED",
            "The secure LAN sync request was cancelled.",
            true,
        )
    }

    fn remaining_timeout(deadline: Instant) -> Result<Duration, SyncTransportError> {
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            return Err(timeout_error());
        }
        Ok(remaining)
    }

    fn timeout_error() -> SyncTransportError {
        SyncTransportError::new(
            "E_SYNC_TIMEOUT",
            "The secure LAN sync request timed out.",
            true,
        )
    }

    fn network_error() -> SyncTransportError {
        SyncTransportError::new(
            "E_SYNC_NETWORK",
            "The secure LAN sync request did not complete.",
            true,
        )
    }

    fn runtime_error() -> SyncTransportError {
        SyncTransportError::new(
            "E_SYNC_RUNTIME",
            "Secure LAN sync runtime state is unavailable.",
            true,
        )
    }

    fn payload_error() -> SyncTransportError {
        SyncTransportError::new(
            "E_SYNC_PAYLOAD_REJECTED",
            "The LAN sync JSON payload is invalid or contains local-only material.",
            false,
        )
    }

    #[cfg(test)]
    mod loopback_tests {
        use super::*;

        struct TestListener {
            endpoint: String,
            handle: Handle<SocketAddr>,
            task: JoinHandle<io::Result<()>>,
        }

        impl TestListener {
            async fn shutdown(self) {
                self.handle.graceful_shutdown(Some(Duration::from_secs(1)));
                let _ = timeout(Duration::from_secs(2), self.task).await;
            }
        }

        fn test_directory(label: &str) -> PathBuf {
            let unique = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("test clock should follow Unix epoch")
                .as_nanos();
            std::env::temp_dir().join(format!(
                "nais2-sync-loopback-{label}-{}-{unique}",
                std::process::id()
            ))
        }

        fn remove_test_journal(path: &Path) {
            for name in ["sync-transport-state-a.json", "sync-transport-state-b.json"] {
                let _ = std::fs::remove_file(path.join(name));
            }
            let _ = std::fs::remove_dir(path);
        }

        fn loopback_policy() -> NetworkPolicy {
            NetworkPolicy::parse("127.0.0.1", &["127.0.0.0/8".to_string()])
                .expect("loopback policy should be valid")
        }

        fn start_data_listener(ca: &Arc<CaMaterial>, store: Arc<DurableStore>) -> TestListener {
            let policy = loopback_policy();
            let listener = std::net::TcpListener::bind("127.0.0.1:0")
                .expect("loopback data listener should bind");
            listener
                .set_nonblocking(true)
                .expect("test data listener should be nonblocking");
            let address = listener
                .local_addr()
                .expect("test data address should resolve");
            let acceptor = PeerTlsAcceptor {
                inner: RustlsAcceptor::new(
                    tls_config(ca, policy.bind_ip(), true)
                        .expect("test mTLS configuration should build"),
                )
                .acceptor(NetworkAcceptor { policy }),
            };
            let handle = Handle::<SocketAddr>::new();
            let task_handle = handle.clone();
            let task = tokio::spawn(async move {
                axum_server::from_tcp(listener)?
                    .acceptor(acceptor)
                    .handle(task_handle)
                    .serve(data_router(DataContext { store }).into_make_service())
                    .await
            });
            TestListener {
                endpoint: format!("https://{address}"),
                handle,
                task,
            }
        }

        fn start_pairing_listener(
            ca: &Arc<CaMaterial>,
            store: Arc<DurableStore>,
            sync_endpoint: &str,
            capability: &str,
            confirmation_code: &str,
            session_expires_at: u64,
            invitation_expires_at: u64,
        ) -> (TestListener, PairingInvitation) {
            let policy = loopback_policy();
            let listener = std::net::TcpListener::bind("127.0.0.1:0")
                .expect("loopback pairing listener should bind");
            listener
                .set_nonblocking(true)
                .expect("test pairing listener should be nonblocking");
            let address = listener
                .local_addr()
                .expect("test pairing address should resolve");
            let session = Arc::new(Mutex::new(PairingSession::new(
                capability.to_string(),
                confirmation_code.to_string(),
                session_expires_at,
            )));
            let context = PairingContext {
                session,
                store,
                ca: Arc::clone(ca),
                sync_endpoint: sync_endpoint.to_string(),
                notify_closed: Arc::new(Notify::new()),
            };
            let acceptor = RustlsAcceptor::new(
                tls_config(ca, policy.bind_ip(), false)
                    .expect("test pairing TLS configuration should build"),
            )
            .acceptor(NetworkAcceptor { policy });
            let handle = Handle::<SocketAddr>::new();
            let task_handle = handle.clone();
            let task = tokio::spawn(async move {
                axum_server::from_tcp(listener)?
                    .acceptor(acceptor)
                    .handle(task_handle)
                    .serve(pairing_router(context).into_make_service())
                    .await
            });
            let pairing_endpoint = format!("https://{address}");
            let invitation = PairingInvitation {
                pairing_endpoint: pairing_endpoint.clone(),
                sync_endpoint: sync_endpoint.to_string(),
                capability: capability.to_string(),
                confirmation_code: confirmation_code.to_string(),
                ca_certificate_base64: BASE64_STANDARD.encode(&ca.certificate_der),
                expires_at: invitation_expires_at,
                sync_scope_id: ca.sync_scope_id.clone(),
            };
            (
                TestListener {
                    endpoint: pairing_endpoint,
                    handle,
                    task,
                },
                invitation,
            )
        }

        fn client_from_bundle(bundle: &SyncClientCredentialBundle) -> reqwest::Client {
            let ca = BASE64_STANDARD
                .decode(bundle.ca_certificate_der_base64.as_bytes())
                .expect("test CA should decode");
            let certificate = BASE64_STANDARD
                .decode(bundle.client_certificate_der_base64.as_bytes())
                .expect("test client certificate should decode");
            let mut private_key = BASE64_STANDARD
                .decode(bundle.client_private_key_pkcs8_base64.as_bytes())
                .expect("test client key should decode");
            let mut pem = String::new();
            pem.push_str(&der_to_pem("CERTIFICATE", &certificate));
            pem.push_str(&der_to_pem("CERTIFICATE", &ca));
            pem.push_str(&der_to_pem("PRIVATE KEY", &private_key));
            private_key.zeroize();
            let result = pinned_reqwest_client(&ca, Some(&pem), Duration::from_secs(5));
            pem.zeroize();
            result.expect("test paired client should build")
        }

        fn issued_client(
            issuer: &CaMaterial,
            trusted_server_ca: &[u8],
            device_id: &str,
        ) -> reqwest::Client {
            let key = KeyPair::generate_for(&PKCS_ECDSA_P256_SHA256)
                .expect("test client key should generate");
            let params = CertificateParams::new(Vec::<String>::new())
                .expect("test client CSR parameters should build");
            let csr = params
                .serialize_request(&key)
                .expect("test client CSR should serialize");
            let certificate = issue_client_certificate(issuer, csr.der(), device_id)
                .expect("test client certificate should issue");
            let mut private_key = key.serialize_der();
            let mut pem = String::new();
            pem.push_str(&der_to_pem("CERTIFICATE", &certificate));
            pem.push_str(&der_to_pem("CERTIFICATE", &issuer.certificate_der));
            pem.push_str(&der_to_pem("PRIVATE KEY", &private_key));
            private_key.zeroize();
            let result =
                pinned_reqwest_client(trusted_server_ca, Some(&pem), Duration::from_secs(5));
            pem.zeroize();
            result.expect("test issued client should build")
        }

        fn in_memory_client_config(ca: &CaMaterial) -> Arc<rustls::ClientConfig> {
            let key = KeyPair::generate_for(&PKCS_ECDSA_P256_SHA256)
                .expect("in-memory client key should generate");
            let params = CertificateParams::new(Vec::<String>::new())
                .expect("in-memory CSR parameters should build");
            let csr = params
                .serialize_request(&key)
                .expect("in-memory CSR should serialize");
            let certificate = issue_client_certificate(ca, csr.der(), "ciphertext-test-device")
                .expect("in-memory client certificate should issue");
            let mut roots = RootCertStore::empty();
            roots
                .add(CertificateDer::from(ca.certificate_der.clone()))
                .expect("in-memory pinned CA should load");
            let provider = Arc::new(aws_lc_rs::default_provider());
            let mut config = rustls::ClientConfig::builder_with_provider(provider)
                .with_protocol_versions(&[&version::TLS13])
                .expect("in-memory client should permit TLS 1.3")
                .with_root_certificates(roots)
                .with_client_auth_cert(
                    vec![
                        CertificateDer::from(certificate),
                        CertificateDer::from(ca.certificate_der.clone()),
                    ],
                    PrivateKeyDer::Pkcs8(PrivatePkcs8KeyDer::from(key.serialize_der())),
                )
                .expect("in-memory client identity should load");
            config.alpn_protocols = vec![b"http/1.1".to_vec()];
            Arc::new(config)
        }

        fn client_records_to_server(
            client: &mut rustls::ClientConnection,
            server: &mut rustls::ServerConnection,
        ) -> Result<(), rustls::Error> {
            let mut encoded = Vec::new();
            client
                .write_tls(&mut encoded)
                .expect("client handshake record should encode");
            let mut cursor = io::Cursor::new(encoded);
            server
                .read_tls(&mut cursor)
                .expect("server should read client handshake record");
            server.process_new_packets().map(|_| ())
        }

        fn server_records_to_client(
            server: &mut rustls::ServerConnection,
            client: &mut rustls::ClientConnection,
        ) -> Result<(), rustls::Error> {
            let mut encoded = Vec::new();
            server
                .write_tls(&mut encoded)
                .expect("server handshake record should encode");
            let mut cursor = io::Cursor::new(encoded);
            client
                .read_tls(&mut cursor)
                .expect("client should read server handshake record");
            client.process_new_packets().map(|_| ())
        }

        fn manifest_wire(sequence: u64, request_id: &str, nonce: &str) -> WireRequest {
            WireRequest {
                request_id: request_id.to_string(),
                sequence,
                nonce: nonce.to_string(),
                payload: None,
                delivery_id: None,
            }
        }

        async fn post_wire(
            client: &reqwest::Client,
            endpoint: &str,
            path: &str,
            wire: &WireRequest,
        ) -> Result<reqwest::Response, reqwest::Error> {
            client
                .post(format!("{endpoint}/{path}"))
                .header(header::CONTENT_TYPE, "application/json")
                .body(serde_json::to_vec(wire).expect("test wire should serialize"))
                .send()
                .await
        }

        #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
        async fn actual_tls_pairing_replay_and_revoke_fail_closed() {
            let directory = test_directory("mtls");
            let (_device_bundle, ca) = generate_device_identity("host-device", "Host Device")
                .expect("test host identity should generate");
            let store = Arc::new(DurableStore::open(&directory).expect("test journal should open"));
            store
                .ensure_scope(&ca.sync_scope_id)
                .expect("test scope should initialize");
            let data = start_data_listener(&ca, Arc::clone(&store));
            let runtime = DesktopRuntime::default();
            let now = now_epoch_seconds();

            let (expired_listener, expired_invitation) = start_pairing_listener(
                &ca,
                Arc::clone(&store),
                &data.endpoint,
                "expired-capability-value",
                "123456",
                now.saturating_sub(1),
                now + 60,
            );
            let expired = pair_client(
                PairClientRequest {
                    invitation: expired_invitation,
                    client_ref: "expired-client".to_string(),
                    device_id: "expired-device".to_string(),
                    device_name: "Expired Device".to_string(),
                    request_id: "request-expired-pair".to_string(),
                    timeout_ms: 5_000,
                },
                &runtime,
            )
            .await;
            assert!(matches!(
                expired,
                Err(SyncTransportError {
                    code: "E_SYNC_PAIRING_DENIED",
                    ..
                })
            ));
            expired_listener.shutdown().await;

            let (pairing_listener, invitation) = start_pairing_listener(
                &ca,
                Arc::clone(&store),
                &data.endpoint,
                "valid-capability-value",
                "654321",
                now + 60,
                now + 60,
            );
            let paired = pair_client(
                PairClientRequest {
                    invitation,
                    client_ref: "paired-client".to_string(),
                    device_id: "paired-device".to_string(),
                    device_name: "Paired Device".to_string(),
                    request_id: "request-valid-pair".to_string(),
                    timeout_ms: 5_000,
                },
                &runtime,
            )
            .await
            .expect("valid loopback pairing should succeed");
            pairing_listener.shutdown().await;
            assert!(paired.peer_fingerprint.starts_with("sha256:"));

            let manifest = manifest_wire(1, "request-manifest-one", "nonce-manifest-0001");
            let no_certificate =
                pinned_reqwest_client(&ca.certificate_der, None, Duration::from_secs(5))
                    .expect("pinned no-certificate client should build");
            assert!(
                post_wire(&no_certificate, &data.endpoint, "v1/manifest", &manifest,)
                    .await
                    .is_err()
            );

            let unpaired = issued_client(&ca, &ca.certificate_der, "unpaired-device");
            let unpaired_response = post_wire(&unpaired, &data.endpoint, "v1/manifest", &manifest)
                .await
                .expect("CA-signed but unpaired request should reach fixed denial");
            assert_eq!(unpaired_response.status(), StatusCode::NOT_FOUND);
            assert!(unpaired_response
                .headers()
                .get(header::ACCESS_CONTROL_ALLOW_ORIGIN)
                .is_none());
            assert_eq!(
                unpaired_response
                    .text()
                    .await
                    .expect("fixed denial body should read"),
                "{\"error\":\"not-available\"}"
            );

            let (_wrong_bundle, wrong_ca) = generate_device_identity("wrong-host", "Wrong Host")
                .expect("wrong test CA should generate");
            let wrong_ca_client = issued_client(&wrong_ca, &ca.certificate_der, "wrong-ca-device");
            assert!(
                post_wire(&wrong_ca_client, &data.endpoint, "v1/manifest", &manifest,)
                    .await
                    .is_err()
            );

            let paired_client = client_from_bundle(&paired.credential_bundle);
            let paired_response =
                post_wire(&paired_client, &data.endpoint, "v1/manifest", &manifest)
                    .await
                    .expect("paired manifest should complete");
            assert_eq!(paired_response.status(), StatusCode::OK);
            let paired_body = paired_response
                .json::<Value>()
                .await
                .expect("paired manifest should return JSON");
            assert_eq!(
                paired_body.get("syncScopeId").and_then(Value::as_str),
                Some(ca.sync_scope_id.as_str())
            );

            let replay = post_wire(&paired_client, &data.endpoint, "v1/manifest", &manifest)
                .await
                .expect("paired replay should return authenticated error");
            assert_eq!(replay.status(), StatusCode::CONFLICT);

            let malformed = paired_client
                .post(format!("{}/v1/push", data.endpoint))
                .header(header::CONTENT_TYPE, "application/json")
                .body("{malformed")
                .send()
                .await
                .expect("paired malformed request should receive bounded error");
            assert!(!malformed.status().is_success());

            let origin_wire = manifest_wire(2, "request-origin-denied", "nonce-origin-000002");
            let origin_denied = paired_client
                .post(format!("{}/v1/manifest", data.endpoint))
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::ORIGIN, "https://example.invalid")
                .body(serde_json::to_vec(&origin_wire).expect("origin wire should serialize"))
                .send()
                .await
                .expect("origin denial should return fixed response");
            assert_eq!(origin_denied.status(), StatusCode::NOT_FOUND);
            assert_eq!(
                origin_denied
                    .text()
                    .await
                    .expect("origin denial body should read"),
                "{\"error\":\"not-available\"}"
            );

            let revoke_wire = manifest_wire(2, "request-self-revoke", "nonce-revoke-000002");
            let revoke = post_wire(&paired_client, &data.endpoint, "v1/revoke", &revoke_wire)
                .await
                .expect("paired self-revoke should complete");
            assert_eq!(revoke.status(), StatusCode::OK);

            let after_revoke = manifest_wire(3, "request-after-self-revoke", "nonce-revoke-000003");
            let revoked_response =
                post_wire(&paired_client, &data.endpoint, "v1/manifest", &after_revoke)
                    .await
                    .expect("revoked keepalive request should receive fixed denial");
            assert_eq!(revoked_response.status(), StatusCode::NOT_FOUND);
            let revoked_body = revoked_response
                .text()
                .await
                .expect("revoked denial body should read");
            assert_eq!(revoked_body, "{\"error\":\"not-available\"}");
            assert!(!revoked_body.contains("syncScopeId"));

            data.shutdown().await;
            drop(paired);
            drop(store);
            remove_test_journal(&directory);
        }

        #[test]
        fn tls13_tampered_ciphertext_yields_no_plaintext() {
            use std::io::Read as _;

            let (_device_bundle, ca) =
                generate_device_identity("ciphertext-host", "Ciphertext Host")
                    .expect("ciphertext test CA should generate");
            let bind_ip: IpAddr = "127.0.0.1".parse().expect("loopback test IP should parse");
            let mut server = rustls::ServerConnection::new(
                server_tls_config(&ca, bind_ip, true)
                    .expect("production TLS 1.3 server config should build"),
            )
            .expect("in-memory TLS server should initialize");
            let server_name = rustls::pki_types::ServerName::from(bind_ip);
            let mut client =
                rustls::ClientConnection::new(in_memory_client_config(&ca), server_name)
                    .expect("in-memory pinned client should initialize");

            for _ in 0..12 {
                if client.wants_write() {
                    client_records_to_server(&mut client, &mut server)
                        .expect("client handshake flight should authenticate");
                }
                if server.wants_write() {
                    server_records_to_client(&mut server, &mut client)
                        .expect("server handshake flight should authenticate");
                }
                if !client.is_handshaking() && !server.is_handshaking() {
                    break;
                }
            }
            assert!(!client.is_handshaking());
            assert!(!server.is_handshaking());

            client
                .writer()
                .write_all(b"bounded application message")
                .expect("application plaintext should enter client TLS");
            let mut encrypted_record = Vec::new();
            client
                .write_tls(&mut encrypted_record)
                .expect("application TLS record should encode");
            assert_eq!(encrypted_record.first(), Some(&23));
            assert!(encrypted_record.len() > 5);
            let declared_length =
                u16::from_be_bytes([encrypted_record[3], encrypted_record[4]]) as usize;
            assert_eq!(declared_length + 5, encrypted_record.len());

            let last_ciphertext_byte = encrypted_record
                .last_mut()
                .expect("TLS application record should contain ciphertext");
            *last_ciphertext_byte ^= 0x01;
            let mut cursor = io::Cursor::new(encrypted_record);
            server
                .read_tls(&mut cursor)
                .expect("server should frame the tampered TLS record");
            assert!(server.process_new_packets().is_err());

            let mut plaintext = [0_u8; 1];
            let read = server.reader().read(&mut plaintext);
            assert!(matches!(
                read,
                Err(error) if error.kind() == io::ErrorKind::WouldBlock
            ));
        }
    }
}

#[cfg(all(not(mobile), test))]
use desktop::{
    certificate_fingerprint, scope_id, validate_listen_port, validate_origin, validate_pairing_ttl,
    validate_sync_json, validate_sync_payload, DurableState, DurableStore, NetworkPolicy,
    PairingSession, PeerState, WireRequest,
};

/// Managed command state owns only the live transport execution context. The
/// frontend Stronghold vault supplies private identity bundles at start/pair/
/// exchange boundaries, while this state links cancellation, listeners, and
/// the nonsecret durable journal and drops all in-memory secrets on stop.
pub struct SyncTransportState {
    #[cfg(not(mobile))]
    inner: desktop::DesktopRuntime,
}

impl Default for SyncTransportState {
    fn default() -> Self {
        Self {
            #[cfg(not(mobile))]
            inner: desktop::DesktopRuntime::default(),
        }
    }
}

/// Starts the explicitly opted-in desktop listener. Mobile builds keep the
/// same invoke surface for compatibility but fail closed until a native mobile
/// LAN executor is deliberately introduced.
#[tauri::command]
pub async fn sync_transport_start(
    app: tauri::AppHandle,
    request: StartSyncTransportRequest,
    state: tauri::State<'_, SyncTransportState>,
) -> Result<StartSyncTransportResult, SyncTransportError> {
    #[cfg(not(mobile))]
    {
        desktop::start(app, request, &state.inner).await
    }
    #[cfg(mobile)]
    {
        let _ = (app, request, state);
        Err(SyncTransportError::unsupported())
    }
}

#[tauri::command]
pub async fn sync_transport_stop(
    state: tauri::State<'_, SyncTransportState>,
) -> Result<(), SyncTransportError> {
    #[cfg(not(mobile))]
    {
        desktop::stop(&state.inner).await
    }
    #[cfg(mobile)]
    {
        let _ = state;
        Err(SyncTransportError::unsupported())
    }
}

#[tauri::command]
pub async fn sync_transport_status(
    state: tauri::State<'_, SyncTransportState>,
) -> Result<SyncTransportStatus, SyncTransportError> {
    #[cfg(not(mobile))]
    {
        desktop::status(&state.inner).await
    }
    #[cfg(mobile)]
    {
        let _ = state;
        Err(SyncTransportError::unsupported())
    }
}

/// Pairing uses a separate short-lived TLS listener. Explicit close lets the
/// UI invalidate the native capability if vault persistence or user
/// confirmation fails, so a hidden pairing window cannot remain usable.
#[tauri::command]
pub async fn sync_transport_open_pairing(
    request: OpenPairingRequest,
    state: tauri::State<'_, SyncTransportState>,
) -> Result<PairingInvitation, SyncTransportError> {
    #[cfg(not(mobile))]
    {
        desktop::open_pairing(request, &state.inner).await
    }
    #[cfg(mobile)]
    {
        let _ = (request, state);
        Err(SyncTransportError::unsupported())
    }
}

#[tauri::command]
pub async fn sync_transport_close_pairing(
    state: tauri::State<'_, SyncTransportState>,
) -> Result<(), SyncTransportError> {
    #[cfg(not(mobile))]
    {
        desktop::close_pairing(&state.inner).await
    }
    #[cfg(mobile)]
    {
        let _ = state;
        Err(SyncTransportError::unsupported())
    }
}

/// The client private bundle is returned exactly once for immediate Stronghold
/// persistence. Native code has no secret read-back command and retains only
/// the request-scoped key material needed to complete this CSR exchange.
#[tauri::command]
pub async fn sync_transport_pair_client(
    request: PairClientRequest,
    state: tauri::State<'_, SyncTransportState>,
) -> Result<PairClientResult, SyncTransportError> {
    #[cfg(not(mobile))]
    {
        desktop::pair_client(request, &state.inner).await
    }
    #[cfg(mobile)]
    {
        let _ = (request, state);
        Err(SyncTransportError::unsupported())
    }
}

#[tauri::command]
pub async fn sync_transport_revoke_device(
    request: RevokePeerRequest,
    state: tauri::State<'_, SyncTransportState>,
) -> Result<(), SyncTransportError> {
    #[cfg(not(mobile))]
    {
        desktop::revoke(request, &state.inner).await
    }
    #[cfg(mobile)]
    {
        let _ = (request, state);
        Err(SyncTransportError::unsupported())
    }
}

#[tauri::command]
pub async fn sync_transport_enqueue_outbound(
    request: EnqueueOutboundRequest,
    state: tauri::State<'_, SyncTransportState>,
) -> Result<(), SyncTransportError> {
    #[cfg(not(mobile))]
    {
        desktop::enqueue_outbound(request, &state.inner).await
    }
    #[cfg(mobile)]
    {
        let _ = (request, state);
        Err(SyncTransportError::unsupported())
    }
}

/// Inbound delivery is deliberately two-step: peek leaves the durable item in
/// place until Phase 11 commits it locally, and ack then removes that exact
/// front item. This links process-restart recovery to duplicate-safe sync-core
/// application without a destructive native drain window.
#[tauri::command]
pub async fn sync_transport_peek_inbound(
    request: DrainInboundRequest,
    state: tauri::State<'_, SyncTransportState>,
) -> Result<Vec<InboundSyncItem>, SyncTransportError> {
    #[cfg(not(mobile))]
    {
        desktop::peek_inbound(request, &state.inner).await
    }
    #[cfg(mobile)]
    {
        let _ = (request, state);
        Err(SyncTransportError::unsupported())
    }
}

#[tauri::command]
pub async fn sync_transport_ack_inbound(
    request: AckInboundRequest,
    state: tauri::State<'_, SyncTransportState>,
) -> Result<(), SyncTransportError> {
    #[cfg(not(mobile))]
    {
        desktop::ack_inbound(request, &state.inner).await
    }
    #[cfg(mobile)]
    {
        let _ = (request, state);
        Err(SyncTransportError::unsupported())
    }
}

/// Remote delivery acknowledgement first becomes a durable native receipt.
/// Phase 11 peeks it, commits its repository outbox acknowledgement, and only
/// then acknowledges this exact receipt so restart cannot lose either side of
/// the cross-storage checkpoint.
#[tauri::command]
pub async fn sync_transport_peek_outbound_receipts(
    request: PeekOutboundReceiptsRequest,
    state: tauri::State<'_, SyncTransportState>,
) -> Result<Vec<OutboundSyncReceipt>, SyncTransportError> {
    #[cfg(not(mobile))]
    {
        desktop::peek_outbound_receipts(request, &state.inner).await
    }
    #[cfg(mobile)]
    {
        let _ = (request, state);
        Err(SyncTransportError::unsupported())
    }
}

#[tauri::command]
pub async fn sync_transport_ack_outbound_receipt(
    request: AckOutboundReceiptRequest,
    state: tauri::State<'_, SyncTransportState>,
) -> Result<(), SyncTransportError> {
    #[cfg(not(mobile))]
    {
        desktop::ack_outbound_receipt(request, &state.inner).await
    }
    #[cfg(mobile)]
    {
        let _ = (request, state);
        Err(SyncTransportError::unsupported())
    }
}

/// Exchanges only bounded sanitized JSON over pinned TLS 1.3 mTLS. The caller
/// supplies the unlocked client bundle for this request; the durable client
/// journal supplies the monotonic sequence so reconnects cannot reuse it.
#[tauri::command]
pub async fn sync_transport_exchange(
    app: tauri::AppHandle,
    request: SyncExchangeRequest,
    state: tauri::State<'_, SyncTransportState>,
) -> Result<SyncExchangeResult, SyncTransportError> {
    #[cfg(not(mobile))]
    {
        desktop::exchange(app, request, &state.inner).await
    }
    #[cfg(mobile)]
    {
        let _ = (app, request, state);
        Err(SyncTransportError::unsupported())
    }
}

#[tauri::command]
pub fn sync_transport_cancel_request(
    request_id: String,
    state: tauri::State<'_, SyncTransportState>,
) -> bool {
    #[cfg(not(mobile))]
    {
        state.inner.cancel_request(&request_id)
    }
    #[cfg(mobile)]
    {
        let _ = (request_id, state);
        false
    }
}
