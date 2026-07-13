# Known limitations

기준일: 2026-07-14 (Asia/Seoul)

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
