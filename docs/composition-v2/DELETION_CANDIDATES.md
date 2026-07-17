# 삭제 후보 리스트

- 조사 기준일: 2026-07-17 (Asia/Seoul)
- 조사 대상: `E:\AI_Project_Library\projects\nais\nais_blue`
- 목적: 오래된 레거시 파일, 재생성 가능한 빌드 산출물, 낡은 계획·릴리스 문서의 삭제 후보를 식별한다.
- 원칙: 이 문서는 후보 목록과 정리 이력을 함께 기록하며, 최신 산출물·서명 재료·사용자 데이터는 보존한다.

## 판정 규칙

| 판정 | 의미 |
|---|---|
| A · 로컬 정리 우선 | 소스가 아니고 재생성 가능하며 Git에서 추적하지 않는 산출물. 실행 중인 빌드·QA가 없는지 확인한 뒤 정리할 수 있다. |
| B · 증거 보관 후 정리 | QA 로그·스크린샷·임시 릴리스처럼 당장은 유용하지만 PR·릴리스 증거 보관 기간이 지나면 정리할 수 있다. |
| C · 명시적 승인 필요 | 레거시 소스, 롤백 자료, 릴리스 입력과 연결되어 있어 호환성·복구 확인 뒤에만 정리한다. |
| D · 보존 | 현재 소스·런타임·릴리스·보안 경계에 속하거나 삭제 근거가 없다. |

## 우선 후보

아래 크기는 조사 시점의 로컬 파일 크기이며, 빌드가 다시 실행되면 달라질 수 있다.

| 판정 | 경로 | 관찰값 | 근거와 정리 조건 |
|---|---|---:|---|
| A | `src-tauri/target/` | 약 59.67 GB / 105,013 files | Cargo·Tauri 재생성 캐시이며 `.gitignore` 대상이다. 모든 Tauri/Cargo 프로세스를 종료하고, 다음 빌드에서 재생성할 수 있을 때 정리한다. `scripts/clean-local-artifacts.ps1 -DryRun -IncludeBuildOutputs`로 먼저 확인할 수 있다. |
| A | `src-tauri/plugins/nais-android-transfer/target/` | 약 3.15 GB / 5,765 files | 플러그인 Cargo target이며 플러그인 `.gitignore`가 명시적으로 제외한다. Android transfer 플러그인 빌드가 끝난 뒤 정리 가능하다. |
| A | `src-tauri/gen/android/` | 약 3.20 GB(현재 `src-tauri/gen` 합계) | Tauri가 생성하는 Android 프로젝트·Gradle 출력이다. `npm run android:prepare` 또는 Android init으로 재생성 가능하다. 현재 APK QA나 release 검증 중이면 보존하고, APK·로그를 별도 보관한 뒤 정리한다. |
| A | `src-tauri/plugins/nais-android-transfer/android/.tauri/`, `android/build/` | 생성 Gradle 출력 | 플러그인 `.gitignore` 대상이다. 플러그인 Android 빌드 재실행으로 복구 가능하다. |
| A | `src-tauri/gen/67y7/` | 빈 디렉터리 | 생성 과정에서 남은 것으로 보이는 빈 경로다. Git은 빈 디렉터리를 추적하지 않으므로 제거해도 소스 영향이 없다. |
| A | `dist/` | 약 27 MB / 52 files | Vite production 산출물이며 `.gitignore` 대상이다. `npm run build`로 재생성된다. 방금 생성한 QA용 산출물은 검증 종료 후 정리한다. |
| A | `.playwright-cli/` | 약 18 files | 브라우저 점검 로그·페이지 스냅샷만 보관하는 로컬 도구 출력이며 `.gitignore` 대상이다. 현재 재현에 필요한 증거가 아닌지 확인한 뒤 정리한다. |
| A | `.wrangler/tmp/` | 임시 디렉터리 | Wrangler 로컬 임시 출력이다. 실행 중인 Wrangler가 없는지 확인하고 정리한다. |
| A | `tmp/` | `release-matrix-tauri.json`, 0-byte `release.keystore` | 릴리스 시도 중 남은 로컬 scratch다. 0-byte 파일을 실제 서명 키 백업으로 간주하지 말고, 현재 release 프로세스가 참조하지 않는지 확인한 뒤 정리한다. |
| A | `legacy/NAIS2-2.0.29/node_modules/` | 약 439.6 MB / 17,372 files | 레거시 checkout의 설치 의존성이다. 레거시 앱을 다시 실행하지 않는다면 `npm ci`로 복구 가능하다. 레거시 소스 자체와 분리해 정리할 수 있다. |
| A | `legacy/NAIS2-2.0.29/dist/` | 약 27.3 MB | 레거시 Vite 산출물이다. 레거시 소스와 별개로 재생성 가능하다. |
| A | `legacy/NAIS2-2.0.29/src-tauri/target/` | 약 2.37 GB | 레거시 Cargo/Tauri 캐시다. 롤백 바이너리 검증이 끝난 뒤 정리한다. |
| A | `legacy/NAIS2-2.0.29/src-tauri/gen/` | 약 1 MB | 레거시 생성 Tauri metadata다. 레거시 네이티브 재현이 필요하지 않을 때 정리한다. |
| B | `output/playwright/` | baseline UI audit 출력 | 현재 Playwright 재현에 필요한 최신 baseline인지 확인한다. 최신 QA 증거로 대체되었으면 보관 기간 후 정리한다. |
| B | `artifacts/android-smoke/`, `artifacts/android-final-smoke/` | 2026-07-13 Android smoke 증거 | PNG/UI XML/log 증거에 사용자 화면·프롬프트가 포함될 수 있다. PR·릴리스 감사에 필요한지 확인하고, 필요 없으면 민감정보 점검 후 보관 기간을 정해 삭제한다. |
| B | `.artifacts/android-*`, `.artifacts/phase12-*`, `.artifacts/qa/` | 2026-07-10~16 QA 로그·스크린샷 | 현재 Android/Cloudflare QA 증거다. 최신 최종 증거와 중복되는 폴더를 식별한 후 정리한다. 원시 UI XML·스크린샷을 외부에 복사하지 말고, 삭제 전 필요한 요약만 남긴다. |
| B | `release-artifacts/ascii-build-20260708-080202/` | 임시 ASCII build | 이름상 경로 호환성 확인용 임시 산출물이며 현재 공식 릴리스 디렉터리가 아니다. 릴리스/회귀 증거로 사용하지 않는지 확인 후 정리한다. |
| B | `release-artifacts/dragfix-build-20260708-092117/` | 임시 drag-fix build | 기능 확인용 임시 빌드로 보인다. 현재 `v2.8.0` 공식 패키지나 새 릴리스에 포함되지 않으므로 증거 보관 후 정리 후보다. |
| B | `release-artifacts/app-build-20260708-093238/` | 임시 app build | 공식 릴리스가 아닌 날짜 기반 빌드다. 재현·비교에 필요하지 않으면 정리한다. |
| B | `release-artifacts/qa-20260716/`, `screenshots-20260716/`, `ui-captures-20260716/` | 2026-07-16 QA/capture 폴더 | 현재 PR의 데스크톱/Android QA 증거로 사용될 수 있다. PR 게시와 릴리스 판정이 끝난 뒤 중복본만 정리한다. |

## 레거시 소스·오래된 문서 후보

아래 항목은 공간 절약 효과보다 호환성·복구 리스크가 크므로 A가 아니라 C로 분류한다.

| 판정 | 경로 | 관찰값 | 삭제 전 확인 |
|---|---|---:|---|
| C | `legacy/NAIS2-2.0.29/` | 추적 파일 196개, 소스·문서 약 30 MB(로컬 캐시 제외) | `docs/composition-v2/LEGACY_RETIREMENT_GATE.md`, `KNOWN_LIMITATIONS.md`, `MIGRATION_GUIDE.md`가 레거시 builder·reader·rollback 보존을 요구한다. production v2 authority, clean upgrade, rollback 복원이 모두 입증되기 전에는 소스 snapshot을 삭제하지 않는다. |
| C | `legacy/NAIS2-main-source-snapshot/` | 소스 snapshot 약 29.7 MB / 203 files | 현재 런타임 참조는 찾지 못했지만 historical provenance로 보존된 snapshot이다. `legacy/NAIS2-2.0.29`와 중복 범위·복구 필요성을 비교한 뒤 archive 후 삭제한다. |
| C | `legacy/stylelab-frontend-sources-20260628-155859/` | 12 files / 약 0.3 MB | 현재 release script가 source archive에서 의도적으로 제외하는 이전 snapshot이다. 별도 provenance가 필요 없는지 확인 후 삭제한다. |
| C | `docs/ELO_AUDIT.md` | 2026-06-28, StyleLab Elo audit | 내용은 유효할 수 있으나 현재 문서는 Git에서 추적되지 않는다. `scripts/create-public-release.ps1`가 공개 릴리스 패키지에 이 파일을 복사하므로, 스크립트를 갱신하거나 새 문서로 대체하기 전 삭제하지 않는다. |
| C | `docs/PATCHING_GUIDE.md` | 2026-06-28, 2.7.2 patch guide | `source/NAIS2_2.7.2-public-source.zip`와 2.7.2 경로를 설명하는 과거 가이드다. 현재 2.8.1 릴리스 절차로 대체할 때까지는 release script 참조를 먼저 제거·교체한다. |
| C | `docs/PUBLIC_RELEASE.md` | 2026-06-28, 2.7.2 public release layout | 역시 `scripts/create-public-release.ps1`가 요구한다. 새 릴리스 layout 문서로 교체하고 script/CI를 검증한 뒤에만 삭제한다. |
| D | `docs/composition-v2/` | 현재 추적된 canonical guidance | migration·rollback·Android·dependency 정책의 source of truth다. 오래된 날짜만으로 삭제하지 않는다. |
| D | `docs/NAIS2_UIUX_문서_분할/` 및 2026-07-17 통합 문서 | 현재 작업의 UI/UX 기준 문서 | 이번 작업의 요구사항과 handoff 근거다. 오래된 계획 문서로 분류하지 않는다. |
| D | `docs/HANDOFF.md` | 2026-07-17 handoff | 현재 로컬 handoff 로그다. 다음 세션이 작업을 이어가는 데 필요하므로 유지한다. |

## 보안·사용자 데이터 때문에 후보에서 제외한 항목

다음은 오래되어 보이더라도 자동 삭제 대상으로 취급하지 않는다.

- `.env`, `NAIS_KEYSTORE_BASE64.txt`, `keystore_base64.txt`, `release.keystore`: credential·서명 재료일 수 있으므로 실제 소유자 확인과 별도 보안 절차 없이 삭제하지 않는다. 값 자체는 이 문서에 기록하지 않는다.
- `output/`의 사용자 생성 결과·metadata·sidecar: 빌드 출력과 달리 사용자 데이터일 수 있으므로 retention/백업 정책 없이는 삭제하지 않는다.
- `src-tauri/binaries/tagger-server-x86_64-pc-windows-msvc.exe`: `scripts/verify-tagger-sidecar-phase.mjs`와 Tauri bundle 경계가 참조하는 현재 sidecar일 수 있으므로 legacy cache와 혼동하지 않는다.
- `release-artifacts/v2.8.0/`, `release-artifacts/android/`: 공식 installer/APK, signature, checksum, manifest가 있다. 새 2.8.1 릴리스와 rollback 검증이 끝나기 전에는 보존한다.

## 정리 전 공통 확인 순서

1. `git status --short`로 현재 미커밋 작업을 확인하고, 이 문서 외의 변경을 정리 작업에 포함하지 않는다.
2. Tauri, Cargo, Gradle, Vite, Wrangler, Playwright 및 Android/ADB 프로세스를 종료한다.
3. `git clean -ndX`로 ignored 파일의 예상 목록만 확인한다. 전역 `git clean -fdX`는 `.env`, 키, 사용자 데이터와 QA 증거까지 포함할 수 있으므로 사용하지 않는다.
4. 빌드 캐시는 `scripts/clean-local-artifacts.ps1 -DryRun -IncludeBuildOutputs`로 대상과 재생성 비용을 확인한다.
5. QA/릴리스 증거는 최신 요약·checksum·PR 링크를 남긴 뒤 중복본만 정리한다.
6. 레거시 소스·릴리스 문서는 관련 gate와 `scripts/create-public-release.ps1` 참조를 갱신하고, clean checkout에서 lint/build/test를 통과한 뒤 별도 커밋으로 처리한다.

## 현재 결론

가장 큰 즉시 후보는 `src-tauri/target/`과 플러그인 target, 생성 Android 프로젝트이며 합계 약 66 GB 이상이다. 이들은 소스가 아니고 재생성 가능하지만, 현재 Android/Tauri QA가 진행 중이면 마지막 검증 증거를 남긴 후에만 정리한다. 레거시 소스와 2.7.2 문서는 “오래됨”만으로 삭제할 수 없고, production authority·rollback·공개 릴리스 스크립트의 선행 조건을 닫은 뒤 별도 정리 작업으로 분리한다.

## 실행 상태 기록

- 2026-07-17: A 후보 중 최신 산출물을 제외한 오래된 경로를 정리했고, 저장소 내부 경계와 빌드 전용 프로세스 부재를 확인했다.
- 삭제 완료: `legacy/NAIS2-2.0.29/node_modules/`, 레거시 `dist/`, 레거시 `src-tauri/target/`, 레거시 `src-tauri/gen/`, `src-tauri/gen/67y7/`, `.playwright-cli/`, `.wrangler/tmp/`, `src-tauri/plugins/nais-android-transfer/android/.tauri/`.
- 정리량: 약 2.9 GB. `adb`·`node` 프로세스는 종료하거나 조사하지 않았다.
- 보존: 최신 `dist/`, `src-tauri/target/`, `src-tauri/gen/android/`, 최신 Android transfer target/build, `tmp/release-matrix-tauri.json`, `tmp/release.keystore`.
- 레거시 소스, B/C/D 후보, 사용자 출력과 공식 릴리스 artifact는 삭제하지 않았다.
