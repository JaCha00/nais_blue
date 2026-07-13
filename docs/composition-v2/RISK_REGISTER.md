# Composition Domain v2 위험 등록부

기준일: 2026-07-14 (Asia/Seoul)

상태 값: `Open`, `Watching`, `Mitigated`. 심각도는 영향과 발생 가능성을 함께 반영한다.

| ID | 위험 | 근거 | 심각도 | 완화 및 검증 gate | 상태 |
| --- | --- | --- | --- | --- | --- |
| R-001 | 세 workflow의 composition 의미가 미세하게 다르다 | Main, Scene builder, Style Lab adapter가 공통 engine을 소비하지만 workflow materialization은 각자 유지한다 | High | workflow별 characterization, engine adapter, payload parity를 함께 실행 | Watching |
| R-002 | Asset Profile resolver를 공통화하면서 현재 비활성 workflow까지 동작이 바뀔 수 있다 | resolver fallback과 compatibility import가 공존한다 | High | default/disabled profile과 v1 import fixture, resolved-plan diff를 유지 | Watching |
| R-003 | Scene worker/session/cancel race regression | slot worker set, session guard, requeue, finalize, image release가 module-level state와 store state에 걸쳐 있다 | Critical | orchestration은 수정하지 않고 cancel-before-call, cancel-after-call, cancel-before-save, requeue characterization 유지 | Watching |
| R-004 | NAI model payload parity가 과대 선언될 수 있다 | 현재 source와 verifier가 V4/V4.5만 verified로 명시하고 V3/Furry V3는 경고한다 | Critical | model별 captured fixture 없이는 builder 교체·parity 완료 금지 | Watching |
| R-005 | wildcard 결과가 비결정적이어서 engine parity가 흔들릴 수 있다 | `processWildcards()`는 `Math.random()`을 사용하고 resolver seed와 직접 연결되지 않는다 | High | injectable deterministic wildcard processor와 captured result fixture 사용; production 선택 순서는 보존 | Open |
| R-006 | migration helper의 기존 key 삭제가 dual-read rollback을 깨뜨릴 수 있다 | `migrateIndexedDBKeys()`는 copy/length verify 후 old key를 삭제한다 | Critical | v2 migration 전용 dual-read/single-write adapter를 별도로 설계하고 cleanup을 후속 gate로 분리 | Open |
| R-007 | IndexedDB write 실패가 상위 호출에 충분히 전파되지 않을 수 있다 | 과거 `rawSetItem()`은 최종 catch에서 log 후 반환했고 writes는 debounce됐다 | High | typed PersistenceFault, critical immediate commit/readback, keyed flush error, close diagnostic과 rescue startup fault injection을 category test로 유지 | Mitigated |
| R-008 | backup/import compatibility와 image memory가 손상될 수 있다 | 다수 store key, 별도 wildcard DB, character/vibe base64와 retired remote key가 한 backup에 공존할 수 있다 | Critical | backup v3 fixture, old backup fixture, ignored-key preview, repository rollback과 wildcard round-trip을 CI에서 실행 | Mitigated |
| R-009 | output/metadata parity 손실 | PNG/WebP, embedded/sidecar metadata, portable path와 memory history가 workflow별로 분기한다 | High | OutputWriter fault injection, metadata v2/legacy reader, format/sidecar characterization 유지 | Mitigated |
| R-010 | automated test shape가 contract script에 편중되어 있다 | Playwright와 `node:test`는 사용하지만 일반 test/spec/config suite는 없었다 | Medium | Vitest 기반 category script, executable fixture, helper unit/provenance test를 추가하고 static source assertion과 behavior test를 구분 | Mitigated |
| R-011 | App startup lifecycle 회귀 | Scene hook은 `AppContent` mount에 남아 있지만 retired remote auth 초기화는 제거 대상이었다 | High | Scene hook은 route 밖에 유지하고 startup network/auth side effect 부재를 contract로 검증 | Mitigated |
| R-012 | clean install 재현성이 실행 중 dev server에 의존한다 | Vite/esbuild process가 `node_modules` binary를 잠글 수 있다 | Medium | dev server 종료 후 `npm ci`; 종료 권한이 없으면 실패를 환경 제약으로 기록 | Watching |
| R-013 | Rust target이 checkout 경로에 종속된 stale artifact를 포함할 수 있다 | 최초 `cargo check`가 과거 OneDrive 절대 경로의 generated permissions를 참조했다 | Medium | checkout 이동 후 workspace 내부 target을 clean하고 fresh `cargo check` 실행 | Mitigated |
| R-014 | 비교 저장소를 현재 설계로 오인할 수 있다 | NAIS3에서 CompositionEngine/AssetProfile/composition-v2 직접 검색 결과가 없었다 | Medium | 비교는 behavior/fixture 참고로 제한하고 현재 checkout contract를 우선 | Watching |
| R-015 | UI의 v2 기본값과 process authority가 다르다 | store mode는 v2지만 fresh repository startup은 fail-closed `legacy`; Vitest/explicit fixture activation은 authority를 v2로 올릴 수 있다 | Critical | Composition Authority panel에서 persisted/runtime와 workflow requested/effective를 함께 표시하고 fallback을 redacted event로 기록; online/signed cutover 전 legacy builders/shadow/feature flag와 legacy default 삭제 금지 | Open |
| R-016 | 실제 NovelAI 온라인 회귀가 credential에 의존한다 | emulator/local 자동 검증은 token 없이 API 직전까지만 진행 가능하다 | High | credential이 있는 격리 smoke에서 Main/Scene/Style Lab supported-model matrix를 실행하고 redacted artifact만 보존 | Open |
| R-017 | Android release 서명/업데이트 검증이 CI secret에 의존한다 | 로컬 debug APK는 가능하지만 release keystore와 immutable baseline 다운로드는 별도 권한이 필요하다 | High | protected GitHub environment에서 signed-build, signed-install, checksum, update baseline gate 유지 | Watching |
| R-018 | volatile store 진단값이 migration source hash를 흔들 수 있다 | Android 연속 재시작에서 Asset Profile `lastLoadedAt` 때문에 같은 target이 반복 commit됐다 | High | session-only timestamp를 persistence projection에서 제외하고 contract test 및 emulator `already-current` 재시작 검증 | Mitigated |
| R-019 | Android native NAI transport가 live service/device에서 mock과 다르게 동작할 수 있다 | M500_MIKU authenticated run에서 raw `Channel<Response>`가 standard/stream headers와 end만 전달하고 body를 0 byte로 소실했다. Body를 ordered JSON/base64 event로 바꾼 뒤 JS 12/12와 Rust loopback 5/5는 통과했지만 post-fix physical app은 R-027로 실행되지 못했다 | Critical | JS/Rust 120초 deadline, 15초 connect timeout, request-scoped cancel과 single-channel order를 유지한다. 정상 기기에서 standard/stream/cancel/no-late-save/OutputWriter를 다시 통과하기 전 Android authenticated generation 완료 선언 금지 | Open |
| R-020 | Phase 01 이전에 생성된 backup/snapshot 파일에 raw auth credential이 남아 있을 수 있다 | 새 export/restore 경로와 AuthState v3는 sanitize하지만 기존 사용자 disk 파일은 동의 없이 삭제·수정하지 않는다 | Critical | restore preflight는 secret을 저장하지 않고 재입력 경고를 표시; vault UI의 별도 destructive confirmation 뒤 managed local/full/snapshot artifact를 값 노출 없이 scan하고 credential-bearing artifact 전체만 삭제 | Watching |
| R-021 | 새 provider 또는 caller가 diagnostic redactor를 우회할 수 있다 | 이 phase는 NovelAI, OutputWriter, startup migration/recovery, R2를 우선 연결하지만 모든 future service error를 자동 변환하지는 않는다 | High | category fixture, token/path/prompt/signed-URL canary, redacted export/clipboard test, Rust structured-log gate를 유지하고 새 provider wiring 시 같은 gate를 추가 | Watching |
| R-022 | critical Zustand store의 immediate commit/readback이 write pressure를 높일 수 있다 | Scene, generation, character 등 사용자 데이터는 debounce 성공 응답 대신 durability를 우선한다 | Medium | UI preference만 명시적 debounce allowlist로 유지하고 per-key write serialization, targeted fault tests, responsive/characterization gate를 관찰; 데이터 계약 없이 다시 debounce하지 않음 | Watching |
| R-023 | Stronghold passphrase 분실 또는 snapshot 손상 시 credential을 복구할 수 없다 | plaintext/Base64 fallback과 raw-secret backup을 의도적으로 금지하고 OS keychain recovery는 아직 없다 | High | credential 재발급/재등록을 recovery로 안내하고 vault 오류 시 generation을 차단; snapshot을 자동 삭제하거나 v3 reference를 secret으로 간주하지 않음 | Watching |
| R-024 | Android/desktop native Stronghold runtime 동작이 host-only source contract보다 다를 수 있다 | unit tests는 migration/backend contract를 검증하지만 authenticated generation은 native app data 및 opt-in credential이 필요하다 | Critical | exact mobile capability, Argon2 registration, cargo check/Android contract와 emulator vault create/lock을 통과; process-restart re-unlock과 live dual-token generation은 release gate로 유지 | Watching |
| R-025 | Windows host의 fresh Android cross-build가 Stronghold의 transitive libsodium build script에서 실패할 수 있다 | 공식 crate의 Unix `configure`를 Windows가 직접 실행하지 못하며 rustup shim보다 standalone Rust가 먼저 선택될 수도 있다 | High | Linux Android build host를 우선 사용하거나 공식 archive로 target static library를 준비해 documented `SODIUM_LIB_DIR`를 process-local로 지정; prebuilt binary는 tracked source에 추가하지 않음 | Watching |
| R-026 | Android debug app의 정상 Back 종료가 native mutex teardown fatal log를 남긴다 | API 35 x86_64 emulator에서 NAI request를 시작하지 않은 Main 종료를 두 번 재현했고 process는 종료됐지만 crash buffer에 `pthread_mutex_lock called on a destroyed mutex`가 기록됐다 | Medium | transport 요청과 분리된 종료-only 현상으로 기록한다. Phase 05 base artifact와 physical device/signed build에서 재현 비교하고 shutdown data flush 손실이 없음을 확인하기 전 원인을 단정하지 않는다 | Open |
| R-027 | 지정 physical testbed의 system service crash가 app 검증을 중단한다 | M500_MIKU API 34에서 Google Play Services 26.20.31 persistent process가 ROM에 없는 `ACCESS_BROADCAST_RESPONSE_STATS` 호출로 `SecurityException` crash loop에 빠졌다. Android는 FontsProvider dependency가 죽을 때 NAIS2를 `DEPENDENCY DIED`로 종료했다. Reboot 후에도 재현됐으며 NAIS2 native crash가 아니다 | High | 기기 image/Play Services compatibility를 정상화하거나 다른 승인 physical device를 사용한다. Agent가 임의로 privileged permission grant, Play Services data clear/disable 또는 user data reset을 하지 않는다. 정상화 뒤 같은 APK로 R-019 matrix 재실행 | Open |

## 공통 stop 조건

다음 중 하나가 발생하면 해당 phase의 cutover를 중단하고 직전 adapter/format으로 rollback한다.

- 기존 fixture 또는 fresh baseline 명령의 regression
- Scene session/cancel 이후 API 결과가 저장되는 현상
- old backup을 읽지 못하거나 image bytes가 손실되는 현상
- NAI payload에서 model별 fixture와 설명되지 않는 차이
- 제거 대상이 아닌 NovelAI auth, system opener 또는 single-instance가 함께 사라지는 현상
- dependency/lockfile 변경이 phase 범위를 넘어서는 현상
