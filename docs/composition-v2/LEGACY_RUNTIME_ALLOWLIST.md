# Legacy source runtime allowlist

기준일: 2026-07-13 (Asia/Seoul)

`legacy/**`는 이전 구현을 보존한 historical source snapshot이며 현재 application runtime, dependency graph 또는 release input이 아니다. 과거 설계를 설명하거나 migration fixture의 provenance를 확인할 때만 읽는다.

## 허용 범위

검증 검색어 `marketplace`, `supabase`, `market-auth`, `oauth-callback`, `signInWithDiscord`, `VITE_SUPABASE`, `@supabase/supabase-js`, `@tauri-apps/plugin-deep-link`, `tauri-plugin-deep-link`, `nais2://`, `onOpenUrl`, `preset_likes`, `preset_downloads`의 `legacy/**` 결과만 historical allowlist로 허용한다. 이 allowlist는 현재 source나 dependency에 동일 문자열을 다시 추가하는 근거가 아니다.

Migration fixture와 ignored-key test는 old backup을 안전하게 읽고 retired keys를 복구 대상에서 제외하는 compatibility 증거이므로 별도 허용한다.

## Non-runtime development tooling

`.codex/**`는 repository-local Codex agent/plugin 지침이며 application source가 아니다. 이 경로의 `marketplace`는 Codex plugin 배포 개념을 가리키고, 일부 planning 문서는 historical Supabase 문맥을 보존할 수 있다. Gate는 이 경로도 계속 검색하고 매치 수를 출력하되, 정확한 `.codex/**` prefix만 별도의 non-runtime development tooling allowlist로 분류한다.

이 제외는 무조건적인 문자열 allowlist가 아니다. Gate는 동시에 Tauri frontend input이 `../dist`인지, Vite `publicDir`이 repository root 또는 `legacy/**`를 노출하지 않는지, public source staging이 `.codex/**`를 제외하는지 검증한다. `src/**`, dependency manifests, Tauri/Android 설정, CI와 일반 문서는 계속 검색 대상이다.

## Release exclusion

- Vite entry graph는 `src/main.tsx`에서 시작하며 `legacy/**`를 import하지 않는다.
- Tauri frontend artifact는 `dist/`만 사용한다. bundle resource 또는 external binary 목록에 `legacy/**`가 없다.
- Android workflow는 clean checkout에서 Vite `dist/`와 generated Tauri project를 새로 만들며 `legacy/**`를 복사하지 않는다.
- Public source staging은 repository-only `.codex/**` 개발 도구를 제외한다.
- `legacy/**` 아래 snapshot package와 lockfile은 `npm ci`, `npm ls`, Cargo 또는 Android dependency resolution의 입력이 아니다.

따라서 runtime dependency removal gate는 `legacy/**`를 제외하되, release 구성에 해당 경로가 새로 포함되지 않는지 계속 확인한다. Historical source를 검색 결과를 줄일 목적으로 삭제하거나 수정하지 않는다.
