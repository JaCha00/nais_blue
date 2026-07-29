# Phase 0 기준선

측정일은 2026-07-29이며, 기준 checkout은 `main`의 `3c62c4e` (`v2.11.2`)입니다. 수치는 변경 전 통과 상태와 이번 안전망 도입 직후 구조를 함께 기록합니다.

## 기능 안전망

변경 전 다음 항목이 모두 통과했습니다.

- Queue: 14 files, 58 tests
- ESLint: warning/error 0
- TypeScript + Vite production build: 성공

Queue Runtime 경계 테스트 추가 후에는 15 files, 59 tests가 통과합니다.

## Import graph

Dependency Cruiser가 현재 Production source를 다음과 같이 해석했습니다.

- 모듈: 421
- 의존 edge: 2,088
- 기존 경계 위반: 42

| 규칙 | 기존 위반 |
| --- | ---: |
| Store 간 직접 import | 19 |
| Application의 구현 계층 의존 | 16 |
| Domain의 `src/lib` 의존 | 4 |
| 순환 의존 | 2 |
| Service의 UI component 의존 | 1 |

전체 폴더 그래프는 [import-graph.dot](./import-graph.dot), CI에서 무시하는 기존 부채의 정확한 edge는 저장소 루트의 `.dependency-cruiser-known-violations.json`이 기준입니다. TypeScript 7은 현재 Dependency Cruiser의 TSC 파서 지원 범위 밖이므로, `@swc/core` 파서를 사용하는 실용적 우회안을 채택했습니다.

## Bundle 기준선

| Chunk | Minified |
| --- | ---: |
| `tag-data` (명시적 대형 정적 데이터 예외) | 26,125.37 kB |
| `ui-vendor` | 324.27 kB |
| `vendor` | 297.71 kB |
| `i18n` | 236.44 kB |
| `react-vendor` | 229.22 kB |
| `data-vendor` | 217.68 kB |
| `App` | 206.59 kB |

이 기준선은 이후 `data-vendor` 해체, locale 동적 import, Feature Runtime 분리의 비교점으로 사용합니다.

## Dependency 정리

Knip과 소스 검색을 함께 적용해 다음 미사용 Production dependency를 제거했습니다.

- `canvas-confetti`
- `@types/canvas-confetti`
- `prismjs`
- `@radix-ui/react-switch` (현재 Switch는 native checkbox 기반)
- `@tauri-apps/plugin-shell` (Rust plugin은 유지하며 JS package만 제거)

현재 `npm run test:dependencies`는 미사용 Production dependency 0건으로 통과합니다. `cloudflare:workers`는 Cloudflare 런타임 프로토콜이므로 중앙 Knip 설정에서만 예외 처리합니다.

## 아직 측정하지 않은 항목

Desktop/Android cold start와 memory는 실제 배포형 바이너리 계측이 필요해 이번 첫 절단에서는 수치화하지 않았습니다. 후속 Phase 0 작업에서 동일 장비·동일 데이터셋 기준으로 측정합니다.
