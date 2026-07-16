# Known limitations

기준일: 2026-07-15 (Asia/Seoul)

1. Fresh repository와 feature flag 부재의 authority 기본값은 `legacy`다. Production에서 legacy mode가 더 이상 필요 없다는 cutover evidence가 아직 없으므로 Main/Scene/Style Lab legacy builders, shadow path, retained store projections를 삭제할 수 없다.
2. v2 adapter와 characterization tests가 존재하는 것과 모든 installed user가 v2 authority라는 것은 다르다. 실제 release population의 migration/fallback 관측 자료가 없다.
3. Diagnostics의 Composition Authority panel은 end-user one-action legacy rollback을 제공한다. V2 activation UI는 의도적으로 제공하지 않으며, forward activation은 release gate와 repository verification을 통과한 build/operation에서만 수행한다.
4. Android는 external Asset Profile watch, local tagger sidecar, R2 deploy tooling, raw absolute output path를 지원하지 않는다. UI는 이유와 대체 경로를 표시해야 하며 silent fallback은 금지한다.
5. Desktop compatibility Asset Profile JSON은 canonical Composition repository와 별도 경계다. External file edit가 곧 canonical change-set commit을 의미하지 않는다.
6. Emulator에서 token이 없는 경우 authenticated Main/Scene generation, cancel timing, 실제 image AppData output을 검증할 수 없다.
7. Old backup, Asset Profile v1, legacy metadata reader, migration fixtures는 intentional compatibility surface이며 dead-code cleanup 대상이 아니다.
8. Retired remote catalog 문자열은 ignored-key compatibility classifier, tests/fixtures, `legacy/**` historical source와 전용 removal note에 의도적으로 남는다. Runtime residue gate의 allowlist 밖에서는 허용하지 않는다.
9. `test:composition`이 전체 Vitest suite라 category scripts와 실행 범위가 중복된다. 향후 suite가 커지면 explicit all/unit category를 분리할 수 있다.
10. CI는 migration/old-backup와 remote-removal gate를 Android source-contract에서 실행한다. Desktop tag job은 Android reusable workflow가 뒤따르지만, desktop build 이전에 같은 data gate를 독립적으로 요구하려면 별도 common preflight job이 필요하다.
11. Host production-client live smoke는 T2I, streaming final, Metadata v2와 AbortSignal cancel을
    통과했다. Phase 04 Android JS HTTP plugin은 standard/stream/abort를 유한 시간에 완료하지
    못해 Phase 05에서 Android generation만 fixed-endpoint Rust reqwest/channel adapter로
    교체했다. 2026-07-14 명시적 credential opt-in M500_MIKU run은 vault token verify까지
    통과했지만 raw body channel이 standard/stream 응답을 0 byte로 전달함을 발견했다. Body를
    single ordered JSON/base64 event channel로 고친 뒤 JS/Rust tests와 arm64 APK build/install은
    통과했다. Post-fix authenticated output은 item 25의 device-wide blocker로 아직 통과하지
    못했으므로 live Android 성공으로 간주하지 않는다.
12. Standard와 streaming transport는 120초 total deadline을 가지며 Scene cancel은 session/slot/request controller를 실제 HTTP request에 전달한다. Cancel 뒤 sequence proposal, OutputWriter, history/image 저장과 queue resurrection이 없고 worker 종료 시 button lock이 풀리는 behavior test가 있다. 이미 provider가 수신한 request의 과금/서버 측 작업 중단 여부까지 client가 보장하는 것은 아니다.
13. Character reference와 uncached vibe는 base generation이 무료여도 별도 Anlas 비용 가능성이 있으므로 이번 live smoke에서 제외했다.
14. Phase 01 이전에 생성된 manual/auto backup과 per-store snapshot은 raw `nais2-auth`
    credential을 포함할 수 있다. 현재 runtime은 새 artifact와 restore write를 sanitize하고
    vault UI에서 managed artifact cleanup을 제공하지만, 기존 파일을 자동 삭제·수정하지
    않는다. 사용자가 별도 destructive confirmation을 실행하기 전까지 credential-bearing
    artifact로 취급해야 한다. 관리 경로 밖으로 복사한 backup은 자동 scan 대상이 아니다.
15. Diagnostic file logging은 Phase 02부터 생성되는 redacted structured event만 대상으로
    하며 1 MB active file과 최대 5개 rotation으로 제한된다. 이전 release의 console/file
    artifact를 자동 검색·수정·삭제하지 않는다.
16. Rescue mode의 진단 export는 DB unavailable 시점까지 현재 process의 bounded in-memory
    event만 포함한다. Rescue 화면은 disk backup 위치를 안내하지만 DB를 열 수 없는 상태에서
    restore를 실행하거나 기존 backup 파일을 자동 수정·삭제하지 않는다.
17. Critical Zustand store는 immediate transaction/readback을 사용하므로 매우 큰 Scene 또는
    generation state의 연속 변경은 이전 debounce 경로보다 write 비용이 높을 수 있다. Layout,
    theme, shortcut, tools, update UI preference만 best-effort debounce allowlist에 남아 있다.
18. Stronghold passphrase를 잊거나 encrypted snapshot이 손상되면 NAIS2는 plaintext fallback을
    제공하지 않는다. NovelAI/R2 provider에서 credential을 재발급하고 새 vault에 다시
    등록해야 한다.
19. Backup/restore의 `CredentialRef`는 secret을 포함하지 않는다. 다른 device 또는 vault
    snapshot이 없는 profile로 복원하면 last-four metadata가 보여도 generation 전 credential
    재등록이 필요하다.
20. Phase 04 자동 검증은 migration interruption, wrong passphrase classification, deletion,
    redaction, minimum capability와 host Cargo build를 다룬다. Android x86_64 debug APK와
    emulator에서 Stronghold create/unlocked/lock 및 encrypted snapshot 생성은 확인했다.
    Process-restart re-unlock, desktop native lifecycle과 authenticated dual-token generation은
    명시적 live credential opt-in 없이 실행하지 않았다.
21. Windows에서 fresh Android cross-build 시 Stronghold가 사용하는
    `libsodium-sys-stable`의 Unix `configure`를 직접 실행하지 못할 수 있다. Phase 04 local
    APK는 공식 crate archive를 WSL+NDK로 target static library로 만든 뒤 crate가 제공하는
    process-local `SODIUM_LIB_DIR`로 link해 통과했다. 이 generated binary는 tracked source가
    아니며 일반 재현 build는 Linux host 또는 같은 verified prebuild step이 필요하다.
22. Android API 35 x86_64 debug emulator에서 request를 시작하지 않은 Main 화면을 Back으로
    종료하면 process는 끝나지만 native crash buffer에 destroyed-mutex FORTIFY line이 두 번
    재현됐다. Phase 05 transport request와는 분리된 teardown 현상이며 screenshot이나 user-data
    artifact는 만들지 않았다. Base artifact, physical device와 signed build 비교 전까지 data
    flush 영향과 원인은 미확정이다.
23. Phase 06 local fixture는 fresh/canonical-v2/upgrade/both-present/old-backup/interrupted/
    corrupted/rollback-forward startup을 검증하지만 NovelAI online matrix나 signed artifact drill이
    아니다. Live credential opt-in으로 host client와 Android pre-fix failure evidence는 얻었지만
    full Main/Scene/Style Lab supported-model matrix, post-fix Android output, keystore와 immutable
    rollback baseline은 없다. 따라서 fresh default는 계속 `legacy`다.
24. Computer Use setup은 native Windows pipe가 없어 연결되지 않았다. Android embedded WebView는
    adb forward와 redacted CDP inspection으로 대신 조작했으며 screenshot, UI XML, prompt, image,
    token 또는 response body artifact를 보존하지 않았다. Source/behavior contract와 responsive
    route/viewport 자동 검증이 manual UI evidence를 대체하지는 않는다.
25. M500_MIKU API 34 testbed의 Google Play Services 26.20.31 persistent process가
    `ACCESS_BROADCAST_RESPONSE_STATS` permission denial로 crash loop에 빠진다. Android는 해당
    FontsProvider dependency와 함께 NAIS2를 `DEPENDENCY DIED`로 종료하며 reboot 후에도 재현됐다.
    이는 NAIS2 crash가 아니지만 post-fix physical matrix를 막는다. Privileged permission grant,
    Play Services disable/data clear 또는 app-data clear는 별도 authority 없이 수행하지 않는다.
26. Phase 07은 native startup directory precondition, close/relaunch Stronghold unload와 History I2I
    readiness wait를 behavior/contract/Cargo gate로 검증했다. Existing encrypted snapshot과 live
    credential을 가진 isolated Windows profile의 unlock→restart→re-unlock→source-edit request는 이번
    일반 검증에서 credential opt-in이 없어 실행하지 않았다. M500_MIKU는 fresh cold launch 뒤 PID를
    유지하고 새 crash buffer는 비어 있었지만 과거 `DEPENDENCY DIED` exit-info는 남아 있고
    authenticated Android output matrix를 대체하지 않는다.
27. Phase 08부터 Main/Scene의 일반 generation은 durable queue에 등록된다. 한 release 동안 legacy
    `queueCount` reader와 explicit execution rollback을 유지하며 Scene rotation은 retained legacy
    session/worker를 사용한다. Queue 변환이나 durable 성공이 legacy count를 자동 삭제하지 않는다.
28. Source/mask/character/vibe resource는 enqueue 시 managed AppData content address로 materialize되고
    digest를 검증한다. Content dedup은 있지만 reference-aware garbage collection은 아직 없으므로 장기
    queue 사용의 disk quota는 release observation 대상이다. Queue/UI가 임의로 resource를 삭제하지 않는다.
29. Queue의 10,000-job, transaction abort, restart, lease와 retry 검증은 `fake-indexeddb` 기반
    deterministic test다. Responsive browser contract도 `/queue`의 5개 viewport를 실행하지만 실제 browser
    quota/eviction, 장시간 background throttling과 multi-process scheduling evidence는 없다.
30. Sequential fragment wildcard를 가진 multi-job batch는 앞 job의 sequence commit 전에 snapshot되므로
    같은 proposal base를 가질 수 있다. Runtime CAS는 stale publication과 duplicate artifact를 막지만
    Phase 08은 job 간 durable sequence dependency chain을 미리 만들지 않는다. 충돌 item은 retry/fail될 수
    있으며 counter correctness를 위해 CAS를 완화하지 않는다.
31. Queue Center는 DOM row를 virtualize하지만 selected batch의 lightweight projections를 polling한다.
    10,000-job bounded DOM은 통과했으나 더 큰 장기 queue의 IndexedDB scan/paint profiling은 미실행이다.
32. Startup은 하나의 desktop app process가 queue coordinator를 소유한다고 가정하고 이전 process lease를
    즉시 회수한다. Multi-tab/multi-process durable execution은 지원 완료가 아니며 별도 fencing이 필요하다.
33. Live NovelAI credential을 사용한 kill/restart/files-committed recovery와 actual disk-full drill은 일반
    baseline에서 실행하지 않았다. Synthetic transport, fake IndexedDB, OutputWriter fault injection으로
    401/429/decode/ENOSPC/cancel/recovery ordering은 검증했다.
34. Durable job은 성공 artifact와 transaction linkage를 요구하므로 Main의 legacy `autoSave=false` memory-only
    결과와 동일하지 않다. Legacy memory-only 동작이 필요하면 compatibility release의 explicit legacy
    execution을 사용한다.
35. Phase 09 native upload는 Windows/macOS/Linux foreground Tauri runtime만 지원한다. Android/iOS는
    R2ProfileV2를 읽을 수 있지만 native foreground와 background upload를 지원하지 않으며 Wrangler로
    silent fallback하지 않는다. Background worker 연결은 Phase 12 범위다.
36. Guided setup의 `current-session` mode는 generation output에서 전달된 명시적 artifact set이 필요하다.
    Directory picker 전체를 current session으로 재해석하지 않으므로 현재 directory UI에서는 delta,
    full-sync 또는 dry-run을 사용한다. 기존 Python/Wrangler current-session 의미는 바뀌지 않는다.
37. AWS SDK/keyring은 desktop binary와 cold compile dependency graph를 증가시킨다. Rust 1.88-compatible
    exact versions와 minimal S3 features를 사용하고 mobile target graph에서는 제외했지만 clean Phase 08
    release binary와 같은 host/options로 만든 정확한 size delta evidence는 아직 없다.
38. Fake R2 server는 SigV4 header, 403/signature/clock skew, 404, 412 conditional conflict와 multipart
    continuation을 검증하지만 live Cloudflare R2 credential, jurisdiction/custom domain, provider-side multipart
    expiry와 1,000-object WAN interruption은 credential opt-in이 없어 실행하지 않았다.
39. Organizer external folder는 raw absolute path를 persistent authority에 저장하지 않는다. Current desktop process의
    portable token registry에서만 materialize하므로 restart/다른 platform에서는 명시적으로 folder를 다시 선택해야
    한다. Managed AppData artifact collection은 이 제한을 받지 않는다.
40. WebView Canvas는 PNG/WebP conversion quality와 alpha/matte를 제공하지만 lossless WebP encoding 또는 arbitrary
    ICC color-management parity를 증명하지 않는다. Lossless WebP request는 silent lossy conversion 대신 fail-safe로
    실패하며 strict workflow는 raw same-format preserve 또는 PNG를 선택해야 한다.
41. Organizer raw sanitizer는 PNG/WebP/JPEG의 현재 metadata container classes를 대상으로 한다. Future codec,
    malformed container, unknown metadata encoding은 permissive success로 넘기지 않으며 explicit diagnostic/failure
    또는 distribution policy 변경이 필요하다.
42. Organizer R2 action은 existing foreground resumable queue의 enqueue only다. Android/iOS native R2, background
    upload, live provider WAN restart와 remote completion observation은 Phase 09/12 capability/release gate에 남는다.
43. 10,000-image browser contract는 fixed-grid window, assignment, repository pagination과 source contract를
    deterministic test로 검증한다. Actual long-running desktop WebView memory, filesystem watcher behavior, browser
    quota/eviction과 physical Android organizer flow는 release/authorized device environment 없이는 검증하지 않았다.
44. Phase 11 local sync repository는 production Composition/Scene/prompt/artifact caller에 연결되지 않았다.
    Offline edit는 network-free repository simulation을 뜻하며, 현재 end-user edit가 자동으로 outbox에
    등록된다는 의미가 아니다.
45. Local mutation의 transaction은 sanitized sync shadow entity/inbox/outbox/tombstone 사이에만 atomic하다.
    Production source store와 sync database는 cross-database transaction을 공유하지 않으므로 later caller는
    source/outbox one-sided commit에 대한 idempotency와 crash recovery를 별도로 갖춰야 한다.
46. Conflict projection은 primary, conflict copy, inbox, outbox, tombstone에 남은 unique operation set 전체를
    매번 재계산한다. Entity당 2,048 unique operation을 넘으면 fail closed하며 Phase 11에
    causality-preserving compaction, retention 또는 garbage collection은 없다.
47. Normal non-root envelope는 exact `baseOpId`를 필요로 한다. Schema-v0 upgrade는 predecessor identity를
    복원할 수 없어 `baseOpId: null`, `lineageUnknown: true`를 남기고 conservative independent root로
    처리하므로, later known-lineage edit보다 conflict copy가 더 많이 생길 수 있다.
48. Complex Composition/Scene/prompt/artifact conflict copy는 repository에 보존되지만 비교·승격·폐기하는
    end-user resolution UI와 retention policy는 없다. UI preference만 documented LWW 대상이며 immutable
    generation snapshot은 no-merge policy-only entity이자 inactive sync target이다.
49. Sync database는 `userId` hash로 물리 분리되고 repository instance는 exact user에 bind된다. Account
    switch/delete 후 old user database를 자동 삭제하는 lifecycle/retention UI는 없으므로 user data를
    별도 확인 없이 cleanup하지 않는다.
50. `in-flight` outbox는 persisted 60초 lease를 갖고 expiry 이후 ready listing에 다시 나타난다. Repository는
    expired attempt을 자동으로 `retry`로 바꾸거나 backoff을 계산하지 않으며, caller가 typed failure
    code, next-at policy와 현재 attempt count/exact lease fence를 commit해야 한다.
51. `SyncEnvelope.encrypted`는 reserved field이고 Phase 11은 `false`만 허용한다. Network transport,
    key management, background worker와 user-facing sync control은 구현되지 않았다. Sanitizer는 nested
    `extensions`를 projection에서 제거하므로 extension-carried domain data는 sync payload에 보존되지 않는다.
52. Two-device, restart와 cross-user isolation은 fake IndexedDB에서 검증했다. Actual browser quota/eviction,
    multi-tab/process ownership, account switch/delete lifecycle과 physical Android storage behavior는 아직
    검증하지 않았다.
53. Scene/prompt fixture는 sync용 normalized `orderKey`/`presetId` shape를 사용한다. Current runtime stores를
    이 shape로 변환하는 adapter는 Phase 11에 없으며 later caller가 sanitizer 앞에서 explicit mapping과
    validation을 제공해야 한다.
54. Artifact sync target은 metadata와 succeeded R2 object reference만 보존한다. Image/thumbnail/blob/base64,
    local path, pending upload runtime와 provider failure detail은 의도적으로 sync authority에서 제외된다.
55. Free-form prompt text와 opaque identifier/reference는 임의 문자열이라 padding 없는 Base64와 문법적으로
    완전히 구분할 수 없다. Phase 11은 ordinary prose/alphanumeric prompt token을 보존하므로 그와 동일하게
    보이고 decoded UTF-8/control/high-byte/image evidence도 없는 unpadded non-signature encoding은 통과할 수 있다.
    대신 data/blob/file URI, padded Base64, decoded text/strong-binary canary, raw/hex/MIME image signature,
    JWT/PEM/provider credential과 path canary는 fail closed한다.
    Standalone generic Base64 문법 예외는 exact semantic ID field에만, high-entropy hex 예외는
    ID/checksum/digest/R2-key field에만 적용한다. Prose/ID 예외에도 image/strong-binary/credential/path evidence는
    계속 검사하며, later caller/transport도 sanitizer 이전에 binary를 identifier로 재분류하면 안 된다.
56. Phase 12의 첫 LAN transport는 사용자가 vault unlock 뒤 명시적으로 시작하는 desktop listener와 active peer
    한 대만 지원한다. Multi-peer fan-out, automatic discovery/port forwarding, public/WAN bind와 production relay는
    지원하지 않는다. 새 device를 연결하려면 기존 active peer를 revoke해야 하며 이 제약을 peer 목록이 있는
    일반 multi-device sync로 표시하면 안 된다.
57. Host/client private identity는 Stronghold가 authority고 native journal은 fingerprint, revoke,
    sequence/nonce high-water와 checkpoint 같은 non-secret만 보존한다. 이 split은 private material의 plaintext
    persistence를 막지만 vault lock/restart, journal reopen, scope mismatch와 revoke 직후 keepalive request의 실제
    end-to-end evidence가 완료됐다는 뜻은 아니다. Vault가 locked이면 service가 listener/exchange를 새로 시작할
    수는 없지만, 아직 auth-store lock과 live listener/client instance를 자동 stop/drop하는 production lifecycle
    hook이 없다. 따라서 caller는 lock 전에 stop/dispose해야 하며 이 hook 전 capability는 disabled다.
58. Optional LAN image transfer는 `SyncBlobTransport` interface, descriptor validation, original/distribution policy,
    size/SHA-256와 resume shape까지만 있다. Native chunk receiver, app-scoped partial temp file, full checksum readback,
    atomic commit과 interruption recovery는 구현·연결되지 않아 capability가 disabled다. 현재 image sync의 유일한
    기본 경로는 succeeded R2 object reference이며 missing object는 typed failure로 끝나고 JSON image fallback은 없다.
59. Android tracked transfer plugin은 API 34+ UIDT와 API 24–33 foreground WorkManager scheduling,
    notification pause/resume/cancel/retry와 secret-free ticket/checkpoint lifecycle을 제공한다. Cloudflare R2
    executor는 registry에 연결됐지만 LAN은 unsupported이고 live pairing/physical byte evidence가 없어
    `r2ForegroundUpload`, `r2BackgroundUpload`와 large-LAN capability는 계속 false다.
60. Samsung SM-S928N `arm64-v8a`/API 36에서 tracked Kotlin plugin을 포함한 debug APK build, metadata/install,
    cold launch, process recreation, synthetic secret-free UIDT registration/cancel과 cancelled-state restart persistence는
    통과했다. Notification permission은 system UI tree로 임시 허용하고 원래 denied 상태로 복원했다. 그러나
    final-ID user-signed debug APK install/cold launch는 재검증했다. 그러나 deployed Worker의 one-use pairing이 fixed
    403으로 거부돼 notification pause/resume/cancel action과 checkpoint 증가를 관찰하지 못했다. M500_MIKU의 R-027도 별도로 남으므로 이 부분을
    physical foreground transfer 완료 근거로 바꾸거나 privileged service grant/data clear로 보완하지 않는다.
61. Relay는 `RelayTransport` interface와 authenticated/replay-aware local fake server contract뿐이다. Production
    endpoint, provider credential, removed catalog/provider client, OAuth/deep-link와 relay failover는 없으며
    LAN 연결 실패 시 이 contract로 자동 전환하지 않는다.
62. Native TLS listener/client command는 현재 desktop `cfg`에만 구현돼 Android의 `sync_transport_pair_client`와
    `sync_transport_exchange`는 `E_SYNC_UNSUPPORTED`로 fail closed한다. 따라서 network policy의 mobile paired-outbound
    client는 아직 target contract이고 M500_MIKU가 sanitized JSON sync를 교환한다는 의미가 아니다. Mobile mTLS client,
    vault-unlock request lifetime과 Android restart checkpoint를 behavior/physical gate로 통과하기 전
    `secureLanSyncTransport`는 false로 유지한다.
63. Phase 13 cannot provide a reliable numeric NovelAI image token count. Official V4/V4.5 documentation identifies T5 and
    gives combined guidance, but no versioned tokenizer artifact or reproducible golden endpoint is available; V3 tokenizer
    provenance is also insufficient. The UI therefore separates the current confirmed 512-token upper limit from unavailable
    usage calculation, and shows payload-expanded character/section lengths. Unknown/future models assert no limit until a
    capability entry is added; no safety margin or NAIS3 tokenizer file is used until D-039's parity gate is met.
64. Phase 13 Android guidance evidence covers SM-S928N/API 36 and Android Studio AVD API 35, not Hiby M500_MIKU. Hiby was not
    present when the permitted AVD path was selected and appeared only after that matrix and AVD shutdown were complete.
    Current signed ARM64/x86_64 APK build, verify/install, UI-tree-derived
    touch, keyboard Enter/Escape focus restoration and process recreation passed without clearing app data. Android hardware
    Back on the physical device followed Activity background/exit semantics instead of closing the open sheet; the explicit
    Close/Escape flow restores focus. Separately, `test:responsive-layout` still fails at 390px: the left-edge vertical help/
    diagnostic rail is clipped by 8px, while insetting or lowering it trades that failure for organizer-slot overlap or bottom
    clipping. Experimental runtime changes were reverted after three attempts. Do not claim the complete device/responsive
    matrix until a route-specific organizer placement passes the unchanged gate.
