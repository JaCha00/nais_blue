# Known limitations

기준일: 2026-07-13 (Asia/Seoul)

1. Fresh repository와 feature flag 부재의 authority 기본값은 `legacy`다. Production에서 legacy mode가 더 이상 필요 없다는 cutover evidence가 아직 없으므로 Main/Scene/Style Lab legacy builders, shadow path, retained store projections를 삭제할 수 없다.
2. v2 adapter와 characterization tests가 존재하는 것과 모든 installed user가 v2 authority라는 것은 다르다. 실제 release population의 migration/fallback 관측 자료가 없다.
3. Authority rollback은 internal repository/startup API로 지원되지만 end-user UI는 없다.
4. Android는 external Asset Profile watch, local tagger sidecar, R2 deploy tooling, raw absolute output path를 지원하지 않는다. UI는 이유와 대체 경로를 표시해야 하며 silent fallback은 금지한다.
5. Desktop compatibility Asset Profile JSON은 canonical Composition repository와 별도 경계다. External file edit가 곧 canonical change-set commit을 의미하지 않는다.
6. Emulator에서 token이 없는 경우 authenticated Main/Scene generation, cancel timing, 실제 image AppData output을 검증할 수 없다.
7. Old backup, Asset Profile v1, legacy metadata reader, migration fixtures는 intentional compatibility surface이며 dead-code cleanup 대상이 아니다.
8. Retired remote catalog 문자열은 ignored-key compatibility classifier, tests/fixtures, `legacy/**` historical source와 전용 removal note에 의도적으로 남는다. Runtime residue gate의 allowlist 밖에서는 허용하지 않는다.
9. `test:composition`이 전체 Vitest suite라 category scripts와 실행 범위가 중복된다. 향후 suite가 커지면 explicit all/unit category를 분리할 수 있다.
10. CI는 migration/old-backup와 remote-removal gate를 Android source-contract에서 실행한다. Desktop tag job은 Android reusable workflow가 뒤따르지만, desktop build 이전에 같은 data gate를 독립적으로 요구하려면 별도 common preflight job이 필요하다.
11. Host production-client live smoke는 T2I, streaming final, Metadata v2와 AbortSignal cancel을 통과했다. Android emulator는 authority=v2에서 Tauri HTTP request를 시작하고 UI cancel/session invalidation까지 수행했지만 standard/stream 응답이 각각 160초/60초 안에 완료되지 않았다. Emulator DNS/TCP는 복구 후 정상 확인됐으므로 Android plugin HTTP 응답 전달은 별도 실기기/네트워크 조사 대상이다.
12. Main cancel은 session을 즉시 무효화하지만 request가 끝날 때까지 `isGenerating`을 유지해 재요청/429를 방지한다. Android plugin request가 cancel 완료를 반환하지 않으면 Cancel 버튼이 남을 수 있다. Scene cancel은 현재 HTTP AbortSignal을 전달하지 않고 commit만 차단한다.
13. Character reference와 uncached vibe는 base generation이 무료여도 별도 Anlas 비용 가능성이 있으므로 이번 live smoke에서 제외했다.
