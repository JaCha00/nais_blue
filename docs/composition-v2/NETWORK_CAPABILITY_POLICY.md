# Phase 12 Network Capability Policy

기준일: 2026-07-15 (Asia/Seoul)

## 허용 범위

첫 production sync transport는 사용자가 명시적으로 시작한 desktop LAN agent와 이미 pairing된 한 장치의
직접 연결로 제한한다. 앱 시작, 설정 hydration, Composition/Scene 진입만으로 listener를 열지 않는다.
Relay는 provider-neutral interface와 local contract server만 허용하며 production endpoint, removed
provider/catalog runtime, OAuth, deep-link를 추가하지 않는다.

Listener scope는 다음 두 모드뿐이다.

- `loopback`: `127.0.0.1` 또는 `::1`의 선택한 주소에만 bind한다.
- `lan`: 사용자가 선택한 private/link-local interface 주소에 bind하고 명시한 CIDR allowlist를 함께 적용한다.

Wildcard public bind, public/routable allowlist, automatic port forwarding, network discovery broadcast와
internet relay fallback은 허용하지 않는다. Mobile은 listener가 아니라 paired outbound client와
user-initiated transfer worker로만 동작하는 것이 target contract다. Current native sync command의 mobile branch는
`E_SYNC_UNSUPPORTED`이고 executor/capability도 disabled이므로 이 target을 지원 완료로 표시하지 않는다.

## 인증과 암호화

Data listener는 rustls TLS 1.3 mutual TLS를 요구한다. Key agreement, record nonce, AEAD, certificate
verification과 ciphertext tamper rejection은 rustls가 소유하며 앱이 primitive를 조합하지 않는다.
0-RTT/early data와 TLS downgrade는 허용하지 않는다. Client는 pairing invitation에 포함된 local CA를
정상 trust anchor로 등록하며 `danger_accept_invalid_*` 또는 certificate 검증 우회를 사용하지 않는다.

Pairing listener는 최대 120초, 한 번만 사용할 수 있는 OS CSPRNG capability와 6자리 사용자 확인 코드를
요구한다. Client가 생성한 private key/CSR 중 CSR만 host에 보내고 host CA가 client certificate를 서명한다.
장기 client identity와 host device identity는 Credential Vault에 저장한다. Native runtime은 사용자가
agent/transfer를 시작하고 vault가 unlocked인 동안만 필요한 secret을 memory에 보유한다.

Data route는 TLS가 검증한 peer certificate fingerprint를 active peer allowlist에 먼저 대조한다. Revoke는
새 요청을 차단한 뒤 vault identity를 삭제한다. 인증 실패, 만료 invitation, revoked/unpaired certificate는
entity type, ID, count, checkpoint, peer 목록과 server manifest를 반환하지 않는 같은 bounded denial로 끝난다.

## Protocol과 replay

Authenticated `manifest`, `push`, `pull`, `ack`, self-`revoke`만 제공한다. 각 request는 peer별 monotonic sequence와 random
request ID/nonce를 가지며 persistent high-water/recent-ID journal보다 낮거나 중복이면 body 처리 전에
거부한다. TLS record replay protection과 별개로 이 application fence를 유지한다. Phase 11 `opId` inbox
deduplication은 interruption 뒤 새 sequence로 같은 operation을 다시 전달할 때 exactly-once projection을
보장하지만 replay admission을 대신하지 않는다.

JSON request/response는 최대 2 MiB, 100 operations로 제한한다. Phase 11 sanitizer와 envelope validator를
network 양쪽에서 다시 실행한다. Token, Authorization, credential, signed URL, image/thumbnail/base64/blob,
absolute/native path가 JSON에 나타나면 전체 request를 fail closed하고 phase Stop Gate로 취급한다.

## CORS, timeout, cancellation

LAN API는 browser API가 아니다. Renderer는 Tauri native command를 통해 호출하므로 `Origin`이 있는 request와
preflight를 거부하고 CORS response header를 추가하지 않는다. Exact method/content type만 받는다. Connect,
request, idle timeout과 bounded concurrency를 적용하고 request ID별 cancel을 제공한다. Timeout/cancel 뒤
Phase 11 attempt lease와 checkpoint를 보존해 재연결 시 retry 또는 duplicate receipt로 복구한다.

## Image와 large transfer

JSON sync와 image bytes channel은 분리한다. 기본 동작은 succeeded R2 object reference만 동기화하는 것이며,
object가 없으면 typed missing 상태를 반환하고 JSON image fallback을 만들지 않는다. Optional LAN blob은
original/distribution policy, declared size, SHA-256, fixed chunk index/offset와 resumable checkpoint를 요구한다.
수신기는 app-scoped partial temp file에만 쓰고 전체 checksum/size 검증 뒤 atomic commit한다. Cancel/interruption
시 partial/checkpoint는 재개용으로 남기되 user data를 삭제하지 않는다.

Android의 user-started R2/large LAN transfer는 완료 gate에서 notification과 pause/cancel/retry를 가진 native
worker가 담당해야 한다. API 34+는 user-initiated data transfer job을 우선하고 API 24–33은 foreground
WorkManager를 쓴다.
Android 16에서 long-running WorkManager가 ordinary job quota를 소비하므로 API 34+ primary로 사용하지 않는다.
현재 tracked scheduler/plugin은 process-safe R2/LAN executor가 설치되지 않으면 visible blocked 상태를 남기므로
capability는 unsupported다. 실제 executor, Kotlin/Gradle build와 physical notification/cancel/recreation gate 전에는
연결 완료로 표시하지 않는다. Generation request의 장기 background 실행은 이 capability에 포함하지 않는다.

## Logging과 diagnostics

Token, Authorization header, pairing capability/code, certificate private key, signed URL, prompt 전문, image bytes와
base64는 log, diagnostic event, terminal output, test artifact에 남기지 않는다. 허용하는 diagnostic은 typed
error code, transport kind, redacted peer reference, bounded count/size와 lifecycle state뿐이다. HTTP/TLS library의
request/response body 또는 sensitive header tracing은 활성화하지 않는다.
