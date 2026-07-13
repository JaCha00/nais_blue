# Marketplace runtime removal

기준일: 2026-07-13 (Asia/Seoul)

## Removed runtime surface

- `/marketplace`와 `/marketplace/:id` route, lazy imports, startup market-auth initialization
- Marketplace list/detail pages와 upload/report/auth dialogs
- `market-auth-store`와 Supabase client
- Scene/Fragment remote upload/share CTA
- `@supabase/supabase-js`, JavaScript/Rust deep-link dependencies
- Tauri deep-link initialization, permissions, desktop/mobile `nais2` scheme
- Android callback scheme/intent configuration
- `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` workflow secrets/env
- ko/en/ja Marketplace/auth/upload/report keys

Local scene/fragment import-export/editor, NovelAI `auth-store`, dual API, NAI HTTP allowlist, updater, system browser opener, R2 tooling은 독립 기능이므로 보존한다. Opener는 외부 browser 기능이 계속 사용한다. 전체 caller search에서 Marketplace 외 non-legacy deep-link 사용처가 없었으므로 deep-link plugin 자체를 제거했다.

## Historical and migration allowlist

`legacy/**`는 Vite entry graph, Tauri `dist` frontend input, Android generated project, dependency resolution에 포함되지 않는 historical source다. 검색 결과를 0으로 만들기 위해 삭제하지 않는다.

Runtime에서 Marketplace/Supabase 문자열이 허용되는 위치는 old backup의 retired key를 식별하고 무시하는 classifier뿐이다.

- `src/domain/composition/migrations/legacy-stores-to-v2.ts`
- `src/lib/auto-backup.ts`
- `src/lib/indexed-db.ts`
- migration tests와 legacy fixtures
- `docs/composition-v2/LEGACY_RUNTIME_ALLOWLIST.md`
- gate script 자체

다음 gate가 이 allowlist 밖의 runtime, dependency, platform, CI, docs residue와 `legacy/**` release 포함을 거부한다.

```text
npm run test:remote-runtime-removal
```

CI Android `source-contract` job에서도 같은 gate를 실행한다.

## Old backup compatibility

Marketplace/Supabase state가 들어 있는 old backup은 전체 restore를 실패시키지 않는다. 해당 key만 ignored report에 기록하고 clean storage에는 쓰지 않으며, scenes/fragments/presets와 같은 local data는 복원한다. 이 compatibility classifier는 Marketplace runtime 재도입이 아니며 삭제 대상이 아니다.
