# Composition Domain v2 최종 상태

기준일: 2026-07-15 (Asia/Seoul)

## 결론

Composition Domain v2의 core, workflow adapter, repository/migration, authoring UI, OutputWriter, portable resource/capability adapter와 responsive Android 계약은 구현되어 있다. Phase 08부터 Main과 Scene의 새 generation 명령은 durable queue에 immutable snapshot과 managed resource를 transaction으로 등록하며, queue repository가 claim/snapshot/status authority다. 기존 transport, save, dual-token/session/cancel 경계는 executor adapter로 재사용한다. 한 release 동안 Scene `queueCount` compatibility와 명시적 legacy execution rollback을 유지한다. Phase 06은 production-like startup matrix, 항상 접근 가능한 Composition Authority diagnostics panel, repository/hash 검증과 한 동작 legacy rollback을 추가했다. 그러나 **fresh production startup은 아직 Composition v2 authority를 기본 활성화하지 않는다.** Composition authority와 queue execution authority는 서로 다른 gate다. Main/Scene/Style Lab의 persisted composition mode 기본값은 `v2`지만 process authority가 `legacy`이면 effective mode가 legacy로 강제된다. Vitest setup과 explicit fixture activation은 v2를 올릴 수 있으므로 local test 통과만으로 composition production cutover를 선언할 수 없다.

따라서 이번 최종 정리에서는 caller search로 definition-only임이 확인된 작은 public alias만 제거했다. legacy request builder, shadow 비교, migration projection, authority feature flag와 recovery importer/parser는 삭제하지 않았다.

Phase 12 secure sync transport는 **진행 중이며 지원 완료로 선언하지 않는다.** 현재 source에는 TLS 1.3
mTLS desktop LAN agent, 120초 이하 pairing, Stronghold-backed device/peer identity, revoke와
sequence/nonce replay fence, bounded sanitized JSON 교환 경계가 추가됐다. 첫 listener는 사용자가 명시적으로
시작하고 한 번에 active peer 한 대만 허용한다. 그러나 optional LAN blob은 interface/validation만 있고
native resumable temp-file channel은 비활성이고, Android transfer plugin도 scheduler/notification lifecycle만
있으며 process-safe R2/LAN executor가 없어 capability가 계속 unsupported다. Desktop end-to-end loopback은
통과했고 verified ARM64 libsodium static archive를 process-local로 연결한 Kotlin/Gradle/APK build와 Samsung
SM-S928N install/start/process-recreation도 통과했다. 그러나 실제 R2/LAN executor와 지속되는 notification action/
byte-transfer evidence가 완료되기 전에는 production cutover나 Phase 12 완료 조건 충족으로 간주하지 않는다.

## 선행 조건 판정

| 조건 | 판정 | 코드·테스트 근거 |
| --- | --- | --- |
| Main이 v2 engine을 사용 | 조건부 충족 | `generation-store`의 v2 adapter/materialization과 Main adapter tests는 통과한다. Runtime authority가 v2일 때만 실제 요청에 사용한다. |
| Scene이 v2 engine을 사용 | 조건부 충족 | Scene builder가 v2 plan을 소비하고 queue/session orchestration은 보존된다. Runtime authority가 legacy이면 legacy builder로 되돌아간다. |
| Style Lab이 v2 engine을 사용 | 조건부 충족 | Style Lab facade가 engine plan을 materialize하고 invalid-plan/cancel characterization을 갖는다. Runtime authority gate가 남아 있다. |
| repository authority와 migration 안정성 | migration 충족, cutover 미충족 | CAS/lock/interrupted cleanup/source-hash/startup re-read/backup restore tests와 무변경 Android 재시작 `already-current`가 통과한다. fresh repository의 기본 authority는 legacy다. |
| old backup import fixture가 CI에 존재 | 충족 | `tests/fixtures/legacy/old-backup-with-obsolete-remote-state.json`을 `test:migration`이 실행하며 PR/main source-contract에 연결했다. |
| retired online catalog 제거 | 충족 | route/UI/auth/dependency/deep-link/CI env가 제거됐고 allowlist gate가 통과한다. 과거 backup key classifier와 historical source만 허용한다. |
| rollback release/tag/export 정책 | 문서 충족 | `ROLLBACK_POLICY.md`, `BACKUP_RESTORE_GUIDE.md`, `RELEASING.md`가 tag, immutable artifact, backup/export, authority rollback 순서를 정의한다. 실제 signed release restore drill은 별도 환경이 필요하다. |
| production legacy mode 불필요 근거 | **미충족** | Phase 06 fixture는 통과했지만 fresh default는 legacy이고 full supported-model online matrix, authenticated Android output, signed rollback drill이 없다. legacy runtime compatibility 삭제 gate는 닫혀 있다. |

## 최종 아키텍처

- `src/domain/composition/**`: React/Zustand/Tauri/IndexedDB/Node/filesystem과 분리된 schema, commands, resolver, engine, repository와 migration model.
- workflow adapter: Main, Scene, Style Lab이 engine plan을 각 workflow request와 state transition으로 materialize한다. Main/Scene queue executor는 기존 transport/save/session API를 감싸고 Scene legacy worker는 rollback/rotation compatibility로 유지한다.
- repository authority: CAS revision, stale conflict, migration lock/journal, shadow comparison과 fail-closed runtime authority. Critical IndexedDB store는 immediate commit/readback하며 DB unavailable startup은 normal App을 mount하지 않는 rescue mode로 격리된다.
- durable queue: `batches`, `jobs`, `attempts`, `leases`, `resources` object store를 가진 별도 IndexedDB database가 immutable enqueue snapshot, CAS lease, attempt/progress, terminal-state 불변, output transaction linkage, retry lineage와 restart recovery를 소유한다. Managed AppData resource materialization과 Queue Center가 이 repository를 사용하며 Main/Scene의 새 enqueue write authority다.
- native R2: non-secret R2ProfileV2와 UploadJob/manifest v2를 별도 IndexedDB repository가 소유하고, Rust가
  OS vault credential을 resolve해 official SDK로 file streaming, conditional PUT와 multipart를 실행한다.
  Renderer에는 secret read command가 없고 Android/iOS는 profile read만 지원한다.
- authoring: `AssetModuleStudio`와 shared composition workspace가 typed draft/validate/commit/undo/conflict/repair 흐름을 repository command로 수행한다.
- output: 공통 OutputWriter가 destination, temp stage, image/metadata/thumbnail, session recheck, atomic commit, state callback, rollback과 recovery journal을 소유한다.
- platform: portable path/resource reference와 RuntimeCapabilities adapter가 desktop/Android materialization 차이를 격리한다.
- local-first sync: user-scoped 별도 IndexedDB가 sanitized shadow entity, outbox/inbox, tombstone와
  checkpoint를 소유한다. Phase 12의 in-progress desktop adapter는 audited TLS 1.3 mTLS와 current
  Stronghold vault identity를 사용하되 한 active peer로 제한되고, Phase 11 repository를 대체하지 않는다.
  Relay는 interface/test contract뿐이고 optional blob 및 Android execution capability는 아직 비활성이다.
- UI: desktop command bar/stack/inspector, compact sheets, mobile safe-area command dock, list virtualization과 responsive/accessibility gates.

자세한 구조는 [ARCHITECTURE.md](./ARCHITECTURE.md), 불변 결정은 [DECISIONS.md](./DECISIONS.md), 위험은 [RISK_REGISTER.md](./RISK_REGISTER.md)를 따른다.

## 완료된 phase

- Phase 00~10: baseline, fixtures, domain schema, fragment/module/params/output primitives, pure engine, payload parity gate.
- Phase 11~17: Main/Scene/Style Lab adapter, shadow path와 workflow integration.
- Phase 18: repository migration, backup v3, old backup ignored-key compatibility, authoring conflict transaction.
- Phase 19: retired online catalog/remote auth/deep-link runtime와 dependency 제거.
- Phase 20 구현: OutputWriter/metadata v2, canonical authoring studio, Main/Scene information architecture, portable resource/capability adapter, Android/responsive contracts.
- 최종 cleanup: caller audit, definition-only export 정리, CI compatibility gates와 운영 문서 연결.
- 후속 hardening Phase 01~05: secret-safe backup projection, redacted diagnostic kernel,
  persistence correctness/rescue startup, Stronghold-backed Credential Vault/AuthState v3,
  Android fixed-endpoint NAI transport와 Scene network cancellation.
- 후속 hardening Phase 06: production-like authority fixture matrix, repository/runtime/workflow
  authority diagnostics, redacted fallback observation, one-action legacy rollback.
- 후속 hardening Phase 07: native vault data-directory precondition, flush→Stronghold unload→exit/relaunch
  lifecycle, History source-edit readiness wait와 Android privileged-permission crash classification.
- Phase 07 durable queue domain: workflow-independent snapshot/state/retry model, normalized IndexedDB
  repository, competing lease/restart recovery/schema-upgrade/10,000-job deterministic tests. Runtime cutover 없음.
- Phase 08 queue workflow cutover: Main/Scene immutable enqueue, managed resource materialization, current
  dual-token/stream/session/cancel transport executor, OutputWriter recovery linkage, explicit legacy rollback과
  10,000-job virtualized Queue Center.
- Phase 09 native R2 integration: desktop Rust official S3 SDK/SigV4 streaming, OS vault reference, guided setup,
  read-only conflict preview, resumable multipart UploadJob/manifest v2와 foreground restart recovery. 기존
  Python/Wrangler backend와 mobile explicit unsupported boundary는 유지.
- Phase 11 local-first sync core: SyncEnvelope/sanitizer, user-scoped transactional outbox, operation-set
  recomputation, tombstone, retry/ack/checkpoint와 network-free two-device behavior contract. Runtime cutover 없음.

Production authority cutover와 legacy builder retirement는 별도 release gate로 남는다.

## Phase 10 — Organizer and distribution artifacts

Organizer는 Tauri/portable capability와 current OutputWriter를 재사용해 managed AppData collection 또는 명시적으로
선택한 desktop external folder의 PNG/WebP/JPEG를 fixed-grid virtualization으로 browse한다. PageUp/PageDown sibling
navigation, Enter의 next-empty slot, drag/touch specific slot 및 duplicate-assignment block을 제공한다. ArtifactRecord는
artifactId, nullable source job/scene identity, immutable original checksum/file, thumbnail cache identity,
distribution variants, sidecar digest/ref와 R2 refs를 secret-free IndexedDB authority로 보존한다.

Distribution은 original bytes를 write하지 않는다. Same-format copy/rename/strip과 Canvas PNG/WebP conversion은
OutputWriter의 temp/journal/atomic rename/rollback 안에서 image와 `.nais2.artifact.json` sidecar를 함께 commit한다.
Raw PNG/WebP/JPEG metadata scanner와 decoded alpha/color verification이 strict strip/convert fixture로 고정됐고,
optional R2는 current native queue에 follow-up만 enqueue한다. Canvas lossless WebP와 mobile external/native upload는
silent fallback 없이 unsupported/fail-safe로 남는다. 기존 Composition authority, repository/migration, queue worker,
payload, OutputWriter, legacy importer/reader/user data는 이 phase에서 교체하거나 삭제하지 않았다.

## Phase 11 — Local-first sync core

Phase 11은 `src/domain/sync/**`와 `src/services/sync/**`에 network-free local sync domain을 추가했다.
Envelope schema v1은 `baseRevision + 1`의 revision, exact predecessor `baseOpId`, device/user identity,
canonical UTC timestamp, `upsert | delete`, sanitized payload와 `encrypted: false`를 고정한다. Schema-v0
upgrade에서 predecessor를 복원할 수 없을 때만 `baseOpId: null` + `lineageUnknown: true`를 durable
marker로 쓰며, 새 non-root operation은 explicit predecessor 없이 생성할 수 없다.

Sanitizer는 Composition document/profile/recipe/module을 current canonical schema로 검증한 뒤 top-level
allowlist를 projection하고, nested `extensions`를 항상 제거한다. Scene text/params/order, prompt
preset/fragment, allowlisted UI preference, artifact metadata와 succeeded R2 object identity도 entity-specific
projection 후 whole-envelope safety scan을 다시 통과한다. Secret/credential detail, signed URL,
cookie/session, image/thumbnail/blob/base64, local absolute path, OutputWriter journal, queue lease/controller,
raw diagnostic와 platform-only setting은 sync authority data가 아니다. Percent-encoded key/value와 URL
component는 bounded fixed-point decode 뒤 다시 검사하며, full bounded string/byte-array의 every-offset image
signature, raw/hex/Base64/MIME-wrapped image와 bounded strong-binary canary, known credential shape를
persistence 전에 거부한다.
Standalone generic opaque ID/reference는 exact semantic field allowlist에서만 허용되고 같은 값도
image/strong-binary/credential/path signature 검사는 면제되지 않는다. Free-form natural prose와 문법적으로
동일하고 decoded evidence도 없는 unpadded Base64의 불가피한 모호성은 `KNOWN_LIMITATIONS.md` 55에 고정했다.

`nais2-local-sync--<user-hash>` 물리 database는 user별로 entities/outbox/inbox/tombstones/checkpoints를
분리하고 repository instance를 exact `userId`에 bind한다. Local mutation은 sanitized sync shadow
projection과 outbox를 한 transaction에 기록하지만, production Composition/Scene/prompt/artifact
source mutation과 하나의 cross-database transaction으로 commit하지는 않는다. Production caller가
없으므로 이 atomicity는 sync shadow + outbox 경계에만 해당한다.

모든 local/received operation은 primary, conflict copy, inbox, outbox, tombstone에 보존된 unique operation
set에서 arrival order와 무관하게 projection을 다시 계산한다. Per-entity unique operation은
2,048개로 fail-closed cap되며 Phase 11에 compaction/retention은 없다. UI preference만 documented
LWW를 쓰고 complex Composition/Scene/prompt/artifact conflict는 deterministic primary + conflict copy를
남긴다. Immutable generation snapshot은 no-merge policy-only entity이며 active outbox target이 아니다.

Tombstone store는 primary entity가 없어도 independent delete authority로 recomputation에 포함되며,
ordinary local upsert와 stale remote upsert가 삭제를 부활시키지 못한다. Outbox `in-flight`는
60초 lease를 갖고 unexpired attempt의 중복 claim을 막으며, expiry 후 `listReadyOutbox()`에서
다시 선택된다. Retry scheduler/backoff와 후속 transport는 Phase 11 repository 밖 caller 책임이다.

이 phase는 network transport, user-facing sync toggle, background worker, encryption/key management와 production
workflow adapter를 추가하지 않았다. CompositionEngine, repository/migration, OutputWriter, durable queue,
payload builder와 portable capability authority는 변경되지 않았다.

## Phase 12 — Secure LAN sync transport (진행 중)

Phase 12 source는 명시적으로 시작하는 desktop LAN agent와 paired outbound client를 추가한다. Listener는
loopback 또는 선택한 private/link-local address와 CIDR allowlist로 제한하고 browser Origin/CORS를 거부한다.
Pairing은 최대 120초 one-use capability와 6자리 확인 코드, client CSR을 사용하며 rustls/rcgen이 TLS 1.3
mTLS와 certificate validation/signing을 소유한다. Host/client private identity는 current Credential Vault
Stronghold에 저장하고 native durable journal에는 fingerprint, revoke state, sequence/nonce high-water와
checkpoint 같은 non-secret state만 둔다. 첫 구현은 active peer 한 대만 허용하며 revoke 뒤에만 교체한다.

Authenticated manifest/push/pull/ack는 2 MiB/100-operation bound와 Phase 11 sanitizer/envelope validation을
다시 적용한다. Pull은 local receive/duplicate projection이 성공한 뒤 exact ack하고, request-scoped
cancel/timeout과 방향별 reconnect checkpoint를 유지한다. `SyncEnvelope.encrypted`는 계속 `false`이고
wire confidentiality/integrity만 audited TLS outer transport가 담당한다. Relay는 provider-neutral interface와
local test contract에 머물며 removed catalog/provider runtime이나 production endpoint를 추가하지 않는다.

Image bytes는 JSON에 포함하지 않고 succeeded R2 object reference가 기본이다. R2 object missing은 typed
failure이며 image fallback이 아니다. Optional LAN blob은 descriptor, original/distribution policy, size/SHA-256와
resume interface까지만 존재한다. Native partial temp-file write, checksum readback, atomic commit과 interruption
recovery가 연결되지 않았으므로 capability는 disabled다.

Tracked Android transfer plugin은 API 34+ user-initiated data transfer job과 API 24–33 foreground WorkManager,
notification pause/cancel/retry 및 secret-free ticket recovery lifecycle을 정의한다. 하지만
`TransferExecutionRegistry`에 process-safe R2/LAN executor가 설치되지 않아
`E_TRANSFER_EXECUTOR_UNAVAILABLE`가 정상 blocked 결과이고 `r2ForegroundUpload`, `r2BackgroundUpload`와
large-LAN capability는 false로 유지한다. Generation request의 장기 background 실행도 활성화하지 않는다.

따라서 Phase 12는 아직 BLOCKED다. Actual native loopback에서 paired/unpaired/expired/replay/revoke, fixed denial,
Origin/body bound와 keepalive revoke를 통과했고 production TLS 1.3 config를 재사용한 ciphertext bit-flip도 plaintext
미방출을 확인했다. Native durable peek/ack와 TypeScript apply/receipt restart test도 통과했다. Samsung SM-S928N
`arm64-v8a`/API 36에서는 Android Studio JBR/SDK/NDK와 pre-built static libsodium으로 tracked Kotlin plugin을 포함한
debug APK를 만들고 metadata/install/cold launch/process recreation을 통과했다. Synthetic secret-free ticket은
UIDT `userInitiatedApproved=true` 등록, cancel과 cancelled-state restart persistence를 확인했다. 하지만 executor가
없어 job은 queued에서 byte execution/notification action으로 진행하지 않았고 notification permission은 UI-tree
검증 후 원래 denied 상태로 복원했다. Production source/outbox caller와 vault-lock lifecycle hook, optional blob channel,
Android paired JSON client/executor 및 실제 notification→pause/resume/cancel→checkpoint transfer는 남아 있다. Token,
Authorization, certificate private key, signed URL, prompt, image/base64와 raw path가 payload/log/artifact에 나타나거나
tombstone이 다른 장치에서 부활하면 즉시 listener/cutover를 중단한다.

## 보존한 compatibility

- old backup importer와 ignored retired-key preview
- v1 Asset Profile importer
- legacy metadata/PNG/sidecar reader와 compatibility parser
- migration, payload, characterization, historical fixtures
- Main/Scene/Style Lab legacy builders와 shadow comparison
- fragment legacy runtime/projection과 rollback feature flag
- repository migration bridge, raw rollback snapshot과 recovery journal

보존 이유와 정확한 caller 분류는 [KNOWN_LIMITATIONS.md](./KNOWN_LIMITATIONS.md)와 [MIGRATION_GUIDE.md](./MIGRATION_GUIDE.md)에 기록한다.

## 제거한 compatibility/dead surface

- retired online catalog route, pages/components, remote auth client/store와 dependency
- catalog 전용 OAuth callback/deep-link scheme, Tauri/Android plugin·permission·CI env
- caller가 없는 wildcard counter reset wrapper
- caller가 없는 Scene fragment sequence commit wrapper
- caller가 없는 FragmentState random/sequential line wrappers
- caller가 없는 Style Lab formatting/signature type/function alias
- 이전 OutputWriter 통합 전 NAI verifier의 stale source-shape assertion

## Verification

실행 명령과 환경 요구사항은 [DEVELOPER_VERIFICATION.md](./DEVELOPER_VERIFICATION.md)를 따른다. Phase 06 transport continuation 최종 로컬 run은 clean install, lint, TypeScript/Vite build, 85 passed/1 skipped file과 671 passed/3 opt-in skipped test의 Vitest aggregate, 8-case production-like startup fixture, payload/migration/characterization/diagnostics/NAI transport/smart tools, responsive sizes, Android contracts, dependency tree, retired-runtime residue gate와 Cargo host/mock tests를 포함한다.

Phase 06에서 diagnostics launcher를 항상 보이게 한 첫 responsive run은 1536px Asset Modules의 Prompt CTA와 겹쳤고, 반대쪽 하단 배치는 Scene Resolved Plan CTA와 겹쳤다. 테스트를 완화하지 않고 desktop launcher를 shell toolbar로 이동하고 mobile만 safe-area 위에 유지한 뒤 전체 matrix가 통과했다. 연결 가능한 in-app/Chrome browser backend가 없어 별도 수동 click-through는 실행하지 못했다.

Emulator에서 Asset Profile의 session 진단값 `lastLoadedAt`이 exact legacy source hash를 매번 바꾸는 문제가 발견됐다. 이 값은 persistence projection에서 제외했고, 기존 persisted 값이 한 번 정리된 뒤 연속 무변경 재시작이 `already-current; authority=legacy`로 안정됨을 확인했다.

Phase 04에서는 official Stronghold plugin, AuthState v3 reference persistence와 two-phase legacy
credential migration을 추가했다. Android x86_64 debug APK가 Stronghold/libsodium을 포함해
빌드됐고 emulator에서 vault create/unlocked/lock과 encrypted snapshot 생성을 확인했다.
Windows cross-build는 transitive libsodium prebuild 환경 제한이 있어 R-025와 developer
verification 절차에 분리 기록한다.

Phase 05에서는 browser/test fetch와 desktop Tauri HTTP plugin을 유지하고, Phase 04에서
response/abort가 완료되지 않은 Android generation만 고정 endpoint Rust reqwest/channel
adapter로 격리했다. Standard/stream은 JS/native 120초 total deadline을 가지며 Scene cancel은
session/slot/request AbortController에서 실제 HTTP request까지 전달된다. Host mock server의
headers/body, stream chunk, active socket cancel, timeout과 Android x86_64 cross-build/APK 설치,
startup, Scene routing은 통과했다. Credential opt-in이 없어 Android authenticated output은
실행하지 않았고 R-019를 Watching으로 유지한다. Request 전 Main Back 종료에서 별도 native
mutex teardown log가 재현돼 R-026으로 분리했다.

2026-07-14 opt-in physical M500_MIKU run은 Stronghold vault create, token remote verification과
Main standard/stream request headers까지 도달했지만 raw `Channel<Response>` body가 mobile IPC에서
0 byte가 되어 ZIP/msgpack decode가 실패했다. Body를 headers/end와 같은 ordered JSON/base64
event channel로 바꿨고 JS adapter 12/12, Rust loopback 5/5, arm64 APK build/metadata/install은
통과했다. Post-fix app launch 시 testbed의 Google Play Services FontsProvider가 ROM permission
mismatch로 crash loop에 빠져 Android가 NAIS2를 dependency-died로 종료했다. 이 system blocker는
R-027로 분리하며 post-fix authenticated output을 통과한 것으로 간주하지 않는다. 따라서 R-019는
Open이고 Android release gate는 계속 닫혀 있다.

이번 opt-in host smoke에서는 실제 NovelAI raw endpoint 512×512/1 step PNG와 production client
512×512/4 steps fixed-seed T2I, msgpack streaming final, Metadata v2/redacted payload hash,
AbortSignal cancel이 통과했다. Token은 ignored `.env`에서 process-local로만 읽었고 값, Authorization
header, payload 전문, image base64 또는 response body를 출력·보존하지 않았다. Android
image/output commit은 위 authenticated gate가 남아 있어 성공으로 선언하지 않는다.

Host production-client smoke는 통과했지만 Main/Scene/Style Lab 전체 supported-model·format·source-edit
online matrix는 아니다. Android pre-fix failure는 확보했지만 post-fix authenticated image/output과
cancel/no-late-save는 R-027로 미실행이다. Signed release/update/rollback install은 protected keystore와
immutable release baseline이 없어 실행하지 않았다. 따라서 Phase 05 emulator와 이번 physical
evidence를 Phase 06 production cutover 승인으로 승격하지 않는다.

## 운영 문서

- [MIGRATION_GUIDE.md](./MIGRATION_GUIDE.md)
- [BACKUP_RESTORE_GUIDE.md](./BACKUP_RESTORE_GUIDE.md)
- [AGENT_JSON_EDITING_GUIDE.md](./AGENT_JSON_EDITING_GUIDE.md)
- [ARCHITECTURE.md](./ARCHITECTURE.md)
- [DEVELOPER_VERIFICATION.md](./DEVELOPER_VERIFICATION.md)
- retired online catalog runtime removal note
- [ROLLBACK_POLICY.md](./ROLLBACK_POLICY.md)
- [KNOWN_LIMITATIONS.md](./KNOWN_LIMITATIONS.md)

## 다음 release gate

1. production-like fresh/upgrade/old-backup startup에서 default v2 authority를 명시적으로 승인한다.
2. supported NovelAI model의 Main/Scene/Style Lab online matrix를 redacted evidence로 통과한다.
3. signed desktop/Android artifact로 backup export → rollback install → restore → forward migration drill을 실행한다.
4. 한 release observation window 뒤 legacy builder caller를 다시 검색한다.
5. 그때 caller 0, rollback drill 성공, payload gap 해소가 모두 성립하면 별도 PR에서 legacy runtime을 제거한다.

Phase 07은 Windows restart source-edit의 재현 가능한 lifecycle 결함을 수정했지만 live credential을
사용한 existing-vault re-unlock/ZIP request는 실행하지 않았다. Android logcat은 NAIS2 권한 누락이
아니라 Google Play Services privileged permission/FontsProvider dependency failure임을 재확인했다.
따라서 NAIS2 runtime permission을 추가하지 않았으며 Android authenticated release gate는 계속 닫혀 있다.

Durable queue Phase 07은 pure domain/repository만 추가했다. 10,000-job pagination, competing CAS lease,
expiry/restart recovery, duplicate idempotency, missing resource, v1→v2 schema upgrade와 aborted upgrade가
결정적으로 통과한다. Enqueue caller, worker execution, managed AppData resource-copy producer와 UI는
의도적으로 연결하지 않았으므로 기존 generation behavior와 production authority는 바뀌지 않는다.

Phase 08은 위 Phase 07 경계를 Main/Scene generation에 연결했다. 새 enqueue는 durable job만 authority로
쓰며 startup은 linked OutputWriter journal을 먼저 복구하고 이전 process lease를 회수한 뒤 executor를
시작한다. Queue Center는 10,000개 projection에서 bounded DOM을 유지하고 batch/item control, retry-failed,
failure policy, throughput/ETA와 redacted diagnostic link를 제공한다. 기존 Scene `queueCount`는 자동 삭제하지
않고 확인 후 현재 parameter snapshot으로만 변환하며, `nais2-queue-ui.executionAuthority=legacy` rollback
선택 시 retained legacy executor를 사용한다. Composition authority의 fresh legacy 기본값은 바뀌지 않았다.

같은 phase의 isolated production binary probe는 generated capability에 `$APPDATA/**`가 있음을 확인했고,
`BaseDirectory.AppData` resolved directory와 Stronghold snapshot parent가 동일하며 absolute/relative
`exists`가 모두 허용되고 같은 존재 결과를 반환함을 경로 원문 없이 확인했다. 따라서 관찰된 Vault
`unavailable`은 generated ACL의 AppData 해석 차이가 원인이 아니다. Availability probe는 capability와
동일한 relative path + `BaseDirectory.AppData` 형태로 고정해 이후 ACL/존재 오류를 분리한다.
