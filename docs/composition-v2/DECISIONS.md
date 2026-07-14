# Composition Domain v2 결정 기록

기준일: 2026-07-13 (Asia/Seoul)

이 문서의 결정은 이후 phase의 기본 gate다. 변경이 필요하면 기존 항목을 묵시적으로 덮어쓰지 말고, 근거·fixture·rollback을 포함한 새 decision record로 대체한다.

## D-001 — 현재 checkout 우선

상태: Accepted

`E:\AI_Project_Library\projects\nais\nais2-main` checkout의 runtime 코드와 테스트를 source of truth로 사용한다. C 드라이브/OneDrive의 NAIS checkout과 거기서 생성된 지침은 명시적으로 다시 활성화되지 않는 한 legacy다. README, 과거 integration 계획, legacy 디렉터리, 비교 저장소가 충돌하면 현재 E 드라이브 runtime 코드, 최신 사용자 지시, fresh verification 결과를 우선한다. NAIS3는 비교 참고 자료일 뿐 wholesale port의 원본이 아니다.

## D-002 — Asset Profile을 출발점으로 사용

상태: Accepted

Asset Profile을 Composition Domain v2의 출발점으로 사용한다. `revision`, `updatedBy`, `updatedAt`, `settings`, `output`, `r2`, `modules`, `recipes`의 안정 top-level shape를 기존 GUI/agent JSON 교환 경계로 취급한다. v2 확장은 기존 profile을 읽을 수 있어야 하며, 현재 resolver의 fallback/warning 동작을 fixture 없이 제거하지 않는다.

## D-003 — 공통 engine과 workflow adapter

상태: Accepted

Main, Scene, Style Lab은 공통 `CompositionEngine`의 workflow adapter가 된다. engine은 가능한 한 순수한 composition 결과를 만들고, workflow adapter는 각 workflow의 store 접근, queue/session, API 호출, 저장, toast 및 history side effect를 소유한다. 세 workflow를 한 번에 cutover하지 않고 shadow/parity 검증 뒤 순차 전환한다.

## D-004 — Scene orchestration 보존

상태: Accepted

Scene orchestration은 보존한다. 특히 다음 현재 계약을 engine 도입의 부수 효과로 재작성하지 않는다.

- App 수준 `useSceneGeneration()` lifecycle
- token slot별 worker loop와 streaming 시 single-worker 제한
- `generationSessionId`, `isGenerating`, `isCancelling` 검사
- API 호출 전·후 및 result 저장 전 session guard
- retry/requeue, generation delay, progress, rotation worker confirmation
- character/vibe image data의 session 단위 release

## D-005 — NAI payload builder 교체 금지 gate

상태: Accepted

NAI payload builder는 fixture parity 없이 교체하지 않는다. `src/services/nai/payload.ts`를 통째로 교체하지 않으며, 현재 43/43 NAI core verifier와 payload snapshot이 최소 회귀 gate다. V4/V4.5 외 V3/Furry V3 동작은 model별 fixture가 확보되기 전 parity 완료로 선언하지 않는다. source edit의 ZIP 경로와 stream-final parity gate도 유지한다.

## D-006 — dual-read/single-write migration

상태: Accepted

migration은 dual-read/single-write 방식으로 진행한다.

- read: 새 v2 형식을 우선 읽고, 없거나 호환 가능한 경우 기존 형식을 fallback으로 읽는다.
- write: cutover 이후에는 새 v2 형식만 쓴다.
- delete: rollback window와 backup/import compatibility가 입증되기 전 기존 데이터를 자동 삭제하지 않는다.
- verify: migration fixture는 old-only, new-only, both-present, malformed-old, partial-write, interrupted-session을 포함한다.

현재 `migrateIndexedDBKeys()`처럼 검증 후 old key를 삭제하는 helper는 이 결정의 최종 cleanup 단계와 동일하지 않다. v2 migration에 그대로 재사용하지 않는다.

## D-007 — retired online catalog 제거 순서

상태: Accepted

온라인 catalog 제거는 backup compatibility 이후에 수행한다. Phase 19에서 route/UI, remote auth client와 전용 callback protocol을 제거했으며, backup/import는 과거 관련 key를 선언적으로 무시하면서 나머지 데이터 복구를 계속한다. system browser opener와 application single-instance는 독립 기능으로 유지한다.

## D-008 — UI 전면 재작성 순서

상태: Accepted

UI 전면 재작성은 pure engine과 Main/Scene/Style Lab workflow cutover 이후에만 수행한다. 그 전에는 engine 도입에 필요한 최소 adapter wiring과 진단 UI만 허용한다. `DESIGN.md`의 Cobalt Instrument token, responsive breakpoint, accessibility, Android safe-area 계약을 유지한다.

## D-009 — dependency 및 저장소 경계

상태: Accepted

Composition Domain v2 작업에서 Electron, better-sqlite3, Sharp를 도입하지 않는다. image bytes의 대규모 저장소 migration도 별도 승인과 fixture 없이 수행하지 않는다. 기존 Tauri, browser IndexedDB, file output, metadata sidecar 경계를 우선 재사용한다.

## D-010 — phase 단위 변경과 rollback

상태: Accepted

각 phase는 작은 diff, phase 전용 contract, fresh lint/build/check 결과, 명시적 rollback을 가져야 한다. unrelated working-tree 변경은 삭제하거나 덮어쓰지 않는다. 실패한 검증은 환경 제약과 code regression으로 구분하되 어느 쪽도 성공으로 보고하지 않는다. push, PR, release는 명시 요청 없이는 수행하지 않는다.

## D-011 — Composition 테스트 러너로 Vitest 채택

상태: Accepted

Composition Domain의 일반 TypeScript unit/fixture suite에는 `vitest` 4.1.10을 정확 버전의 devDependency로 사용한다. 기존 저장소에는 Playwright 기반 responsive contract, `node:test` 기반 Smart Tools contract, Node custom verifier만 있고 TypeScript helper와 fixture를 범주별로 실행할 일반 unit runner가 없었다. Vitest는 현재 Vite 6 alias/transform 경계를 재사용하고 로컬 Node 25 및 CI Node 20 범위를 지원하므로 별도 runtime loader나 broad mock 없이 payload builder와 순수 helper를 직접 검증할 수 있다.

Vitest는 Node 환경의 Composition 테스트에만 사용하며 production dependency나 runtime bundle에 포함하지 않는다. Playwright는 responsive/E2E 목적에 유지하고 기존 Node contract/verifier 명령과 기대값은 변경하지 않는다. 새 스크립트는 일회 실행인 `vitest run`만 사용하며 실패를 숨기는 fallback을 두지 않는다.

## D-012 — production authority gate가 legacy 제거보다 우선

상태: Accepted

Main, Scene, Style Lab의 persisted workflow mode 기본값은 `v2`지만 process authority는 startup repository 검증이 `v2`를 활성화한 경우에만 engine 요청을 허용한다. fresh repository의 현재 기본 authority는 의도적으로 `legacy`이며 Vitest setup은 workflow 테스트를 위해 authority를 `v2`로 올린다. 따라서 테스트에서 v2 adapter가 통과한다는 사실만으로 production cutover가 입증되지는 않는다.

다음 증거가 모두 확보되기 전에는 legacy request builder, shadow 비교, compatibility projection, authority feature flag를 제거하지 않는다.

- clean production-like startup에서 repository authority가 `v2`로 검증된다.
- Main/Scene/Style Lab 온라인 회귀가 supported model과 source-edit 경로에서 통과한다.
- rollback release/tag/export가 복원 연습으로 검증된다.
- legacy caller search가 rollback 외 production caller 0건을 보인다.

## D-013 — compatibility cleanup은 definition-only caller에 한정

상태: Accepted

최종 cleanup은 `rg` caller search와 TypeScript/lint/test가 함께 dead임을 증명한 export만 제거한다. 과거 데이터의 의미를 해석하는 importer, parser, fixture와 legacy metadata reader는 caller가 적어 보여도 데이터 복구 계약이므로 보존한다. 이번 cleanup에서 제거한 것은 wildcard counter와 FragmentState random/sequential line의 미사용 public wrapper, Scene fragment sequence의 미사용 commit wrapper, Style Lab의 미사용 formatting/signature alias뿐이다.

## D-014 — output commit은 OutputWriter가 소유

상태: Accepted

Main, Scene, Style Lab의 final file, sidecar/metadata, thumbnail, session recheck, atomic commit, workflow state callback, cleanup과 recovery journal은 공통 OutputWriter 경계가 소유한다. history/scene image는 file commit 이후에만 추가한다. filename template와 extension 정책은 filename policy에 집중하고 desktop/Android path 차이는 capability adapter로 분리한다.

## D-015 — portable document와 platform capability 분리

상태: Accepted

Composition document에는 raw OS absolute path나 platform의 opaque bookmark token을 authority 데이터로 저장하지 않는다. portable root/relative path/display path와 stable resource ID를 저장하고 실제 materialization은 platform adapter가 수행한다. Android가 desktop resource를 해석하지 못하면 recipe는 열되 generation을 차단하고 repair action, reason, alternative를 표시한다. 비지원 기능의 silent fallback은 허용하지 않는다.

## D-016 — session 진단값은 migration source로 persist하지 않음

상태: Accepted

Migration raw source는 persisted compatibility data의 exact preimage를 보존한다. 반면 매 startup마다 새로 계산하는 `lastLoadedAt` 같은 session 진단값은 persistence projection에 넣지 않는다. 이 값은 composition 의미가 없고 무변경 startup의 source hash와 repository revision만 불필요하게 바꾼다. Profile content, source path, disk mtime, save/conflict 정보처럼 복구에 필요한 상태는 계속 persist한다.

## D-017 — Tauri generation transport는 scoped HTTP plugin 사용

상태: Accepted; Android generation 부분은 D-023으로 대체

Browser/test runtime은 native fetch를 사용하고 desktop Tauri NovelAI generation은 capability
allowlist가 적용된 HTTP plugin을 사용한다. 이 결정은 처음에 Android도 포함했지만 WebView
`window.fetch`의 CORS를 피한 뒤에도 plugin response/abort 완료가 입증되지 않았다. 해당 Android
부분만 D-023의 fixed-endpoint native adapter가 대체하며 browser/desktop 경계는 유지한다.

## D-018 — backup과 restore는 secret-safe store projection을 사용

상태: Accepted

Credential Vault 도입 전에도 manual/full, local auto, disk auto, per-store snapshot과
restore preflight는 `projectStoreForBackup()` 경계를 공유한다. `nais2-auth`는 raw
payload를 복사하거나 token을 encode/hash하지 않고 allowlist projection으로 다시 만든다.
NovelAI token, runtime Anlas, provider error를 제외하고 verified 상태를 false로
정규화하며 slot enabled와 알려진 subscription tier만 보존한다.

로컬 Composition migration rollback archive는 exact preimage로 유지한다. 다만 그
archive가 외부 backup이나 store snapshot으로 새롭게 복제될 때 중첩된 `nais2-auth`
직렬값만 같은 projection으로 sanitize하고 projected source hash/count를 다시 계산한다.
Restore는 과거 raw auth가 있는 legacy/v3/snapshot을 읽되 secret을 쓰지 않고
credential 재입력 필요를 dry-run report와 UI summary에 표시한다. 기존 disk backup은
자동 삭제하거나 수정하지 않는다.

## D-019 — 진단 이벤트는 redacted projection 하나로만 이동한다

상태: Accepted

NovelAI, OutputWriter, startup migration/recovery, R2와 이후 queue는 raw Error,
provider response, token, prompt, image bytes를 toast·drawer·clipboard·JSON export·file
log에 직접 전달하지 않는다. `DiagnosticEvent`의 redacted projection만 in-memory store와
Tauri production file logger로 전달한다. Event store는 100개로 bounded하며 persisted
Zustand projection에 포함하지 않는다.

prompt는 SHA-256, 문자 수와 추정 token 수로만 남기고, image/base64/binary와 provider
plaintext body는 제외한다. provider JSON body는 명시 allowlist와 512-byte 상한을 거쳐야
한다. 같은 redactor는 stack, cause chain, breadcrumb, clipboard와 export에 재적용한다.

OperationMonitor는 고정 10초 slow, 30초 no-heartbeat stalled, 120초 hard-timeout
threshold를 사용한다. streaming progress heartbeat는 stalled 판정을 갱신한다. adaptive
threshold는 이번 phase의 확장점일 뿐 동작하지 않는다. monitor는 queue worker 수,
dual-token, cancel/stale/retry/requeue/rotation/image-release 계약을 변경하지 않는다.

기존 `tauri-plugin-log`만 재사용하며, production file target은 `nais2_diagnostic`
structured event만 허용한다. 각 파일은 1,000,000 bytes, rotation 보존은 active file을
포함해 최대 5개(`KeepSome(5)`)다. 별도 JS logging dependency나 console forwarding을
도입하지 않는다.

## D-020 — critical persistence는 즉시 commit/readback하고 DB unavailable은 rescue mode로 격리한다

상태: Accepted

Zustand persistence는 store 단위 정책을 사용한다. Layout, theme, shortcut, tools와 update
표시 상태만 best-effort UI preference로 debounce할 수 있다. 그 밖의 현재/향후 사용자
데이터 store는 기본 critical이며, 특히 auth, Scene, Composition repository/migration
archive, restore journal과 queue repository는 immediate IndexedDB transaction과 readback
또는 기존 strict/CAS API를 사용한다. Unknown future key도 명시적으로 best-effort에
등록되기 전까지 critical이다.

IndexedDB quota, abort, blocked open, timeout과 readback mismatch는 `PersistenceFault`로
정규화한 뒤 D-019의 `DiagnosticEvent` 경계로만 이동하며 critical caller에 reject를
전파한다. Pending flush는 store별 실패 목록을 포함한 `PersistenceFlushError`를 throw한다.
Close flush가 실패하면 사용자에게 미commit 상태를 알리고 진단 event를 기록한 뒤 exit를
한 번만 수행한다.

Startup mode는 `normal | rescue`다. DB open 자체가 실패하면 normal App과 generation/edit/
save entry point를 import/mount하지 않고 retry, redacted diagnostic export, backup 위치 안내,
safe exit만 제공한다. 반면 healthy DB에서 Composition migration이 실패하면 old source를
삭제하지 않고 legacy authority의 normal App으로 진행한다. Rescue mode는 migration failure를
대체하는 일반 오류 화면이 아니다.

## D-021 — native credential backend는 공식 Stronghold plugin을 사용한다

상태: Accepted

`CredentialVault` backend는 `@tauri-apps/plugin-stronghold`와
`tauri-plugin-stronghold` 2.3.1을 정확 버전으로 사용한다. Native startup은 app-local salt
file과 공식 `Builder::with_argon2`를 사용하며 passphrase는 unlock call 동안만 전달하고
NAIS2 state/storage/log에 보관하지 않는다. Capability는 initialize, client create/load,
store get/save/remove, snapshot save/destroy에 필요한 명시적 permission만 desktop/mobile에
부여하고 `stronghold:default`는 사용하지 않는다.

현재 NovelAI transport와 dual-token worker가 renderer token을 소비하므로 plugin의 공식 JS
API를 `CredentialVault` service 안에 감쌌다. 별도 Rust command를 추가하면 같은 secret이
새 custom IPC를 한 번 더 통과하며 renderer session memory를 제거하지 못한다. 따라서 이번
phase에서는 custom command보다 공식 plugin IPC 하나가 secret 노출 면적이 작다. 향후 native
HTTP/keychain/biometric backend가 renderer plaintext까지 제거할 수 있을 때 interface 뒤에서
교체한다.

직접 암호화, Base64/plaintext fallback, hardcoded machine key와 custom crypto format은
복구성과 검증 가능한 KDF/secret-store 경계를 약화하므로 기각했다. Dependency는 frontend
Stronghold API module과 Rust Stronghold/crypto graph를 추가하며 Android/iOS target도 같은
공식 plugin 경계를 사용한다. License는 MIT OR Apache-2.0이다. Dev build KDF 성능을 위해
공식 setup 권고의 `scrypt` dev-profile optimization만 추가하고 release cryptography는
변경하지 않는다.

## D-022 — AuthState v3는 reference만 persist하고 migration marker를 마지막에 쓴다

상태: Accepted

AuthState v3 durable projection은 두 `CredentialRef`, slot enabled, tier/display metadata만
저장한다. `token`, `token2`, session plaintext, verified runtime flag와 Anlas cache는 저장하지
않는다. Plaintext는 unlocked app session의 Zustand memory에만 있고 lock 시 즉시 비운다.

Legacy v2 migration은 startup hydration 뒤 사용자 unlock을 기다린다. Strict source read와
secret detection 뒤 vault write, exact vault readback, sanitized v3 strict write/readback,
남아 있는 localStorage source의 sanitized write/readback을 차례로 수행하고 마지막에만
completion marker를 기록한다. Vault/marker 단계에서 중단되면 marker를 기록하지 않으며 raw
secret을 v3 payload로 쓰거나 plaintext fallback으로 전환하지 않는다. Marker 직전 중단은
v3 reference를 vault에서 재검증한 뒤 resume한다. 기존 backup은 자동 삭제하지 않고 별도
privacy warning과 명시적 destructive confirmation을 거친 managed-artifact cleanup만 제공한다.

## D-023 — Android generation은 fixed-endpoint Rust reqwest channel transport 사용

상태: Accepted

Phase 04 Android API 35 emulator에서 capability-scoped JS HTTP plugin의 standard/stream
request와 abort가 각각 제한 시간 안에 response 또는 cancellation으로 완료되지 않았다.
따라서 D-017의 browser native fetch와 desktop Tauri HTTP plugin은 유지하되 Android의 NAI
generation 두 endpoint만 Rust command adapter로 교체한다. Source edit은 계속 standard ZIP
endpoint를 사용하며 payload는 기존 `buildGenerateImagePayload()` 결과를 그대로 전달한다.

Command는 caller URL을 받지 않고 `standard | stream` enum을 NovelAI의 두 고정 URL에만
매핑한다. 기존 `reqwest`, `tokio`, Tauri `Channel`, `base64` dependency를 재사용해
dependency/lockfile 변경은 없다. Connect deadline은 15초, request/body total deadline은
120초이며 JS adapter도 동일한 유한 deadline으로 IPC/fetch와 body consumption을 race한다.
Request ID별 oneshot과 `tokio::select!`가 header wait 및 body chunk wait를 실제 socket
cancellation에 연결한다.

2026-07-14 M500_MIKU physical run에서 desktop IPC용 raw `Channel<Response>`는 headers와 end는
전달했지만 Android mobile channel에서 standard/stream body를 모두 0 byte로 만들었다. Mobile
plugin channel은 JSON message 경계이므로 body를 별도 raw channel에 두지 않는다. Rust는 각
64 KiB 이하 chunk를 `BodyChunk { bytesBase64 }` JSON event로 보내고 JS는 같은 channel에서
decode한다. Headers, body chunks, end가 한 channel의 순서를 공유하므로 별도 channel 간 end race도
제거한다. Base64는 mobile IPC encoding일 뿐 persistence, diagnostic 또는 log format이 아니다.

Diagnostic event에는 DNS/connect 시작, request sent, response headers, body first byte,
heartbeat, decode stage만 전달한다. Native IPC의 body event는 diagnostic kernel에 연결하지
않는다. Token, Authorization header, payload, response body와 image bytes는 diagnostic이나
Rust/JS log에 넣지 않는다. Scene controller는 session/slot/request별로 소유하고
cancel 시 session을 먼저 무효화한 뒤 active HTTP request를 abort한다. Revert가 필요하면 이
transport hardening commit만 되돌려도 Android empty-body failure가 다시 노출되고, Phase 05
commit까지 되돌리면 plugin hang이 다시 노출된다. 어느 경우든 Android authenticated generation을
성공 지원으로 표시해서는 안 된다. Post-fix physical rerun은 R-027 device environment가
정상화되기 전까지 R-019의 열린 release gate로 유지한다.

## D-024 — authority 운영 가시성은 production default 승인을 대체하지 않는다

상태: Accepted

Diagnostics의 Composition Authority panel은 strict repository read를 통해 persisted authority,
process runtime authority, revision/hash, migration/startup verification, Main/Scene/Style Lab의
requested/effective mode를 표시한다. Startup이 persisted v2를 process에 설치하지 못한 경우 raw
Error를 console에 남기지 않고 stable fallback reason을 D-019 redacted diagnostic event로 기록한다.

사용자 rollback은 한 동작으로 `applyCompositionAuthorityFeatureFlag('legacy')`를 호출한다. 이
경계는 runtime을 먼저 fail-closed하고 repository `setAuthority('legacy')`의 write/readback 뒤
feature flag를 기록하며 committed v2 document와 migration archive를 삭제하지 않는다. V2
activation은 같은 public helper 안에서 startup migration, authoritative document re-read와
committed hash 일치를 다시 검증한 경우에만 성공한다. Panel은 release gate를 우회하는 v2
activation control을 노출하지 않는다.

Fresh, canonical-v2-only, current legacy upgrade, both-present, retired-key old backup, interrupted
migration, corrupted repository, rollback→forward fixture가 통과해도 supported-model online matrix,
authenticated Android output, signed export/restore drill을 대신하지 않는다. 해당 외부 증거가
없으므로 Phase 06은 fresh default를 `legacy`로 유지하고 BLOCKED handoff를 남긴다.

## D-025 — Vault lifecycle은 app-owned shutdown/readiness 경계에서 직렬화한다

상태: Accepted

Stronghold snapshot은 frontend `appDataDir`, Argon2 salt는 Rust `app_local_data_dir`에 있으므로
native setup이 두 directory를 plugin 등록 전에 비파괴적으로 생성한다. Window close, custom
titlebar close, updater relaunch, backup restore relaunch는 IndexedDB flush 뒤 official Stronghold
`unload()`를 await하고 마지막에만 exit/relaunch한다. Cleanup 실패는 redacted diagnostic과 사용자
안내를 남기되 Rust process exit를 막아 stale process가 file/memory lock을 계속 보유하게 만들지
않는다. Plaintext/Base64 fallback, snapshot delete와 passphrase persistence는 추가하지 않는다.

Credential metadata hydration은 single-flight로 만들고 History의 source-edit 진입은 hydration과
진행 중 unlock이 terminal status에 도달할 때까지 기다린다. `locked`는 source composition이 가능한
준비 상태이며 실제 generation은 기존 unlock gate를 유지한다. `unavailable/error`는 vault dialog를
열고 I2I state/navigation을 commit하지 않는다. 이 gate는 payload builder나 source-edit ZIP transport를
변경하지 않는다.

M500_MIKU logcat의 `ACCESS_BROADCAST_RESPONSE_STATS`, `READ_SAFETY_CENTER_STATUS`,
`SEND_SAFETY_CENTER_UPDATE` denial은 `com.google.android.gms(.persistent)`에서 발생했다. Device
package manager상 각각 signature/privileged/development, signature/privileged,
internal/privileged 보호 수준이며 NAIS2는 `DEPENDENCY DIED`였다. 따라서 NAIS2 manifest/runtime
permission request나 try/catch로 해결할 수 없다. Contract는 이 privileged permission들을 NAIS2에
추가하지 못하게 하고, 정상 ROM/Play Services 조합에서 physical matrix를 다시 실행한다.

## D-026 — durable generation queue는 workflow와 분리된 normalized repository다

상태: Accepted

Generation job은 큰 Zustand JSON이나 Scene queue state에 넣지 않고 별도 IndexedDB database의
`batches`, `jobs`, `attempts`, `leases`, `resources` store에 저장한다. Enqueue snapshot은 최종
prompt/params/output policy를 immutable canonical document로 고정하고 hash와 idempotency key를 함께
commit한다. Token, Authorization, base64와 cache secret은 schema에서 거부한다. Restart 뒤 필요한
source/mask는 managed AppData digest/reference만 가리키며 volatile memory resource는 명시적으로
non-resumable/blocked 처리한다.

Repository는 indexed priority/ordinal/id order, CAS lease token, immediate transaction/readback,
idempotent transition, terminal-state 불변, expiry recovery와 versioned schema upgrade를 소유한다.
이번 phase는 enqueue caller, network, worker, UI와 OutputWriter를 연결하지 않는다. 따라서 기존
Scene worker 수, dual-token/streaming/session/cancel/stale/retry/requeue/rotation/image-release 계약과
generation-store는 그대로다.

## D-027 — IndexedDB behavior test는 exact dev-only fake-indexeddb를 사용한다

상태: Accepted

`fake-indexeddb@6.2.5`를 exact devDependency로 추가한다. License는 Apache-2.0이고 Node >=18 개발
환경에서만 실행되므로 production/browser/Android bundle에는 포함되지 않는다. Custom in-memory
repository는 IndexedDB transaction abort, key range, unique index와 version upgrade semantics를
재구현해야 해 실제 경계를 검증하지 못하므로 거절했다. Browser-only integration test는 10,000-job
matrix를 느리고 비결정적으로 만들 수 있어 focused repository tests의 기본 대안으로 사용하지 않는다.

## D-028 — Vault availability ACL probe는 BaseDirectory-relative 표현을 사용한다

상태: Accepted

Tauri generated capability의 `$APPDATA/**`와 JS `BaseDirectory.AppData`는 같은 app-specific data
directory resolver를 사용한다. Isolated production binary에서 resolved directory/snapshot parent
동일성, absolute/relative `exists` 허용과 동일 존재 결과를 경로 원문 없이 직접 확인했다. 따라서
이전 `unavailable` 관찰을 ACL expansion mismatch로 분류하지 않는다.

Stronghold load에는 official API가 요구하는 absolute snapshot path를 계속 전달하되 availability의
filesystem check는 `exists(SNAPSHOT_FILE, { baseDir: BaseDirectory.AppData })`로 수행한다. 이는 ACL과
동일한 표현을 사용해 directory bootstrap/파일 부재와 permission rejection을 구분하며 snapshot
format, salt, passphrase, credential persistence를 바꾸지 않는다.

## D-029 — durable queue가 Main/Scene claim·snapshot·status authority다

상태: Accepted

Phase 08부터 일반 Main/Scene generation command는 current Composition resolve/preview 결과를 capture한
뒤 immutable batch/job snapshot을 durable repository에 등록한다. Zustand에는 selected batch와 operation
projection만 저장하며 새 enqueue의 authoritative job count/state를 `queueCount`에 이중 기록하지 않는다.
Process restart는 linked OutputWriter recovery, prior-process lease recovery, executor start 순서로 진행한다.

Executor는 current NovelAI transport, Main/Scene save API, dual-token scheduler, streaming T2I single-worker,
source-edit non-streaming, generationSessionId/cancel/stale guard, retry/requeue, token rotation과 image release를
adapter로 재사용한다. Cross-workflow slot arbitration만 durable coordinator가 소유한다. CompositionEngine,
composition repository/migration, payload builder와 portable capability를 queue 구현으로 대체하지 않는다.

## D-030 — queue resource와 output 성공은 content/transaction identity로 연결한다

상태: Accepted

Restart 가능한 source/mask/character/vibe byte는 enqueue 전에 SHA-256 content address로 managed AppData에
temp-write/rename하고 digest를 다시 검증한다. Queue record에는 reference/digest만 남기며 raw byte, base64,
token, Authorization, signed URL과 prompt 전문을 diagnostic에 기록하지 않는다. 같은 content는 operation
간 재사용하고 concurrent writer는 기존 verified winner를 받아들인다. 새 production dependency는 없다.

Enqueue idempotency는 immutable operation identity와 repository unique key로 보장한다. UI는 pending
operation ID를 DB commit acknowledgement 전까지 재사용하고 성공 확인 뒤에만 회전한다. OutputWriter는
prebound `outputTransactionId`/`sourceJobId`를 사용하며 files-committed journal이 있으면 startup recovery가
artifact와 job을 함께 조정한다. 성공 판정은 output path 존재가 아니라 journal/transaction/job terminal
commit에 근거한다. Terminal durable success 뒤 journal cleanup만 실패한 경우 이미 committed artifact를
rollback하지 않는다.

## D-031 — Queue Center와 legacy 변환/rollback은 비파괴적 explicit control이다

상태: Accepted

Queue Center는 lightweight projection을 fixed-range virtualization하여 10,000 job에서도 DOM node 수를
bounded하게 유지한다. Batch summary, item/batch cancel, pause/resume, retry-failed, skip, failure policy,
fractional/total progress, recent throughput와 bounded ETA, redacted diagnostic drawer를 desktop keyboard와
mobile 44px touch target으로 제공한다.

기존 Scene `queueCount`는 사용자가 confirmation을 승인한 경우에만 현재 parameter snapshot으로 durable
jobs로 변환한다. 변환은 legacy count를 삭제하거나 줄이지 않는다. Persisted queue UI authority의 기본은
`durable`이고 `legacy`는 한 release 동안의 명시적 rollback flag다. Source rollback도 durable DB,
managed resource, OutputWriter journal, legacy count와 user output을 삭제하지 않는다.

## D-032 — native R2는 desktop Rust SDK, one-way OS vault와 별도 resumable repository를 사용한다

상태: Accepted

Native R2 transport는 official maintained `aws-sdk-s3=1.122.0`을 exact pin한다. 이 line은 crate의
Rust 1.88 MSRV와 맞는 마지막 S3 SDK release이며 Apache-2.0이다. `default-features=false`에서
Tokio, rustls, HTTP/1.x와 default HTTPS client만 켜고 SigV4 signing, streamed `ByteStream`, conditional
request와 multipart lifecycle을 SDK가 소유한다. Latest SDK는 Rust 1.94.1을 요구해 현재 toolchain
contract를 깨고, handwritten SigV4/lower-level signer는 canonicalization, retry, error parsing과
multipart state를 다시 구현해야 하므로 선택하지 않았다. Compatible Smithy/AWS transitive versions는
Cargo.lock에 고정한다.

Credential은 desktop-only `keyring=4.1.4`(MIT OR Apache-2.0)에 access/secret pair를 저장한다. Renderer는
one-way store, availability와 delete command만 호출하며 secret read command는 제공하지 않는다. Profile,
job, manifest와 diagnostics에는 `credentialRef`만 둔다. AWS SDK와 keyring은 Windows/macOS/Linux target
dependency이므로 Android/iOS native binary graph에는 들어가지 않는다. `sha2=0.10`(MIT OR Apache-2.0)은
1 MiB file streaming hash를 위해 direct dependency로 선언한다. Official SDK는 desktop binary/compile graph를
키우지만 renderer bundle에는 포함되지 않는다. Clean base binary가 없어 exact size delta는 release artifact
관찰 gate로 남긴다.

R2 queue는 generation queue schema를 확장하지 않고 같은 normalized IndexedDB/CAS/terminal-state 패턴을
별도 `nais2-r2-upload-queue` database에 적용한다. Multipart upload ID와 completed part를 part 성공 직후
commit해 restart가 missing part만 전송한다. Manifest v2 checksum이 완료 object 재업로드를 막는다.
Conflict `fail`/`skip-same`/`suffix`는 preflight와 `If-None-Match: *`를 유지하고 `overwrite`만 명시적
unconditional write다. Dry-run은 HEAD만 수행한다. Legacy Python/Wrangler mode와 manifest 의미는 유지하며
native directory UI는 current-session을 전체 directory로 재해석하지 않고 explicit artifact set을 요구한다.

Mobile은 profile read capability만 지원한다. Native foreground upload와 Phase 12 background worker는
명시적 unsupported capability이며 silent Wrangler/native fallback을 하지 않는다.

## D-033 — Organizer distribution authority는 portable ArtifactRecord와 OutputWriter transaction으로 분리한다

상태: Accepted

Organizer의 separate `nais2-organizer-artifacts` IndexedDB는 artifactId, source job/scene identity, immutable
original checksum/portable file ref, thumbnail cache identity, distribution variant, sidecar digest/ref와 R2 object
ref만 저장한다. Raw absolute path, opaque platform token, image/base64, prompt, credential, Authorization 또는 signed
URL은 이 authority에 넣지 않는다. External folder의 raw path는 RuntimeCapabilities가 허용한 current-process token
registry에서만 materialize하며 app restart 뒤에는 다시 선택해야 한다.

Original record는 content checksum, size, portable file ref와 format이 immutable이다. Distribution file/sidecar는
OutputWriter가 image와 같은 recovery journal로 stage/rename/rollback하며 commit callback이 성공 record를 쓴다.
Artifact sidecar collision도 image collision과 동일하게 preflight한다. Interrupted write/rename, workflow failure와
retry-failed는 existing OutputWriter/repository boundary를 사용하고 original을 copy·rename·strip 대상으로 만들지
않는다.

Metadata strict mode는 raw PNG tEXt/iTXt/zTXt/eXIf/iCCP/app chunks, WebP EXIF/XMP/ICCP flags/chunks, JPEG APP/COM을
scan/strip하고 decode-level alpha LSB/color verification을 함께 요구한다. Same-format preserve operation은 raw
container path를 우선 사용한다. PNG/WebP conversion은 existing WebView Canvas라 dependency를 추가하지 않으며,
Canvas가 lossless WebP를 증명하지 못하므로 lossless WebP request는 fail-safe typed error다. Sharp/Electron/native
image dependency는 bundle/mobile graph와 codec parity를 넓히므로 거절했다.

Optional R2 follow-up은 non-secret profile ID와 key prefix만 policy에 저장하고 existing R2 upload coordinator에
enqueue한다. Organizer가 credential, upload protocol, multipart/manifest 또는 background runtime을 재구현하지 않는다.
새 npm/Rust dependency는 추가하지 않았다.
