# Composition fixture provenance

기준일: 2026-07-11 (Asia/Seoul)

이 디렉터리의 fixture는 `provenance.json`에 전부 등록한다. manifest의 `source`, `model`, `captureDate`, `captureKind`, `transformed`, `sensitiveDataRemoved`가 machine-readable provenance의 source of truth다. 로컬 seed fixture는 E 드라이브 checkout의 현재 코드와 Composition v2 결정에서 합성·파생한 characterization 자료이고, `payload/nais3-web/`만 아래에 명시한 외부 NAI 웹 캡처다.

Phase 01 이후 engine 비교의 workflow source of truth는 각 workflow의 `current-workflow.json`이다. `default-direct-prompt.json`과 `cancel-guards.json`은 하네스 구축 단계의 작은 seed/reference fixture이며 현재 workflow golden으로 취급하지 않는다.

| Fixture | 출처 | 모델 | 캡처 날짜 | 변환 | 민감정보 제거 |
| --- | --- | --- | --- | --- | --- |
| `payload/v4-5-text.request.json` | current NAI verifier/request contract | `nai-diffusion-4-5-full` | 2026-07-11 | 예 | 예 |
| `payload/v4-5-text.expected.json` | current payload builder local characterization | `nai-diffusion-4-5-full` | 2026-07-11 | 예 | 예 |
| `fragments/inline-selection.json` | current fragment processor | 해당 없음 | 2026-07-11 | 예 | 예 |
| `fragments/composition-resolver-v2.json` | current fragment grammar + Composition Domain v2 deterministic resolver contract | 해당 없음 | 2026-07-11 | 예 | 예 |
| `legacy/old-only.json` | D-006 synthetic migration state | 해당 없음 | 2026-07-11 | 아니오 | 예 |
| `legacy/new-only.json` | D-006 synthetic migration state | 해당 없음 | 2026-07-11 | 아니오 | 예 |
| `legacy/both-present.json` | D-006 synthetic migration state | 해당 없음 | 2026-07-11 | 아니오 | 예 |
| `legacy/malformed-old.json` | D-006 synthetic migration state | 해당 없음 | 2026-07-11 | 아니오 | 예 |
| `legacy/partial-write.json` | D-006 synthetic migration state | 해당 없음 | 2026-07-11 | 아니오 | 예 |
| `legacy/interrupted-session.json` | D-006 synthetic migration state | 해당 없음 | 2026-07-11 | 아니오 | 예 |
| `legacy/store-backup-roundtrip.json` | retained old-store + full backup/import round-trip contract; image bytes redacted | 해당 없음 | 2026-07-12 | 예 | 예 |
| `legacy/old-backup-with-obsolete-remote-state.json` | ignored obsolete remote state + retained local backup restore contract; credentials redacted | 해당 없음 | 2026-07-13 | 예 | 예 |
| `legacy/production-authority-startup.json` | Phase 06 production-like fresh/v2/upgrade/both/old-backup/interruption/corruption/rollback-forward matrix | 해당 없음 | 2026-07-13 | 아니오 | 예 |
| `workflows/main/default-direct-prompt.json` | current Main direct-prompt path | `nai-diffusion-4-5-full` | 2026-07-11 | 예 | 예 |
| `workflows/main/current-workflow.json` | current Main store → adapter → payload → output golden capture | V4/V4.5 | 2026-07-11 | 예 | 예 |
| `workflows/scene/cancel-guards.json` | current Scene session guards | workflow-agnostic | 2026-07-11 | 예 | 예 |
| `workflows/scene/current-workflow.json` | current Scene builder/worker/queue/save golden capture | `nai-diffusion-4-5-full` | 2026-07-11 | 예 | 예 |
| `workflows/scene/character-rotation-sequence.json` | current rotation store fixed-order runtime projection | workflow-agnostic | 2026-07-12 | 아니오 | 예 |
| `workflows/stylelab/prompt-template.json` | current Style Lab prompt formatter | `nai-diffusion-4-5-full` | 2026-07-11 | 예 | 예 |
| `workflows/stylelab/current-workflow.json` | current Style Lab multi-preview golden capture | `nai-diffusion-4-5-full` | 2026-07-11 | 예 | 예 |

## NAIS3 web payload imports

`payload/nais3-web/`의 원본은 GPL-3.0 프로젝트 [sunanakgo/NAIS3](https://github.com/sunanakgo/NAIS3)다. 이 checkout은 commit `5c65aa6b00b1d3ecbeaf3787e5ab510e2464f464`에 고정했으며, 원본 fixture의 도입 및 마지막 변경 commit은 `1eacaecfa038561121769edba3866cbe338c6dbf`다. 원본은 2026-07-05에 NovelAI 웹 브라우저 DevTools에서 `nai-diffusion-4-5-full` 요청으로 캡처되었다. 각 원본 경로와 Git blob ID는 `provenance.json`에 기록했다.

가져오는 과정에서 JSON 들여쓰기를 정규화했다. cache secret을 포함하던 character reference, i2i, vibe fixture는 해당 값만 `[REDACTED:CACHE_KEY]`로 교체했다. 그 외 payload 값의 차이를 target에 맞추어 수정하지 않았다.

| Fixture | 원본 | 캡처 날짜 | 변환 | 민감정보 제거 |
| --- | --- | --- | --- | --- |
| `payload/nais3-web/nai-web-charref.json` | `tests/fixtures/nai-web-charref.json` | 2026-07-05 | JSON 정규화, cache secret redaction | 예 |
| `payload/nais3-web/nai-web-i2i.json` | `tests/fixtures/nai-web-i2i.json` | 2026-07-05 | JSON 정규화, cache secret redaction | 예 |
| `payload/nais3-web/nai-web-t2i-2char.json` | `tests/fixtures/nai-web-t2i-2char.json` | 2026-07-05 | JSON 정규화 | 예 |
| `payload/nais3-web/nai-web-t2i-coords.json` | `tests/fixtures/nai-web-t2i-coords.json` | 2026-07-05 | JSON 정규화 | 예 |
| `payload/nais3-web/nai-web-t2i-default.json` | `tests/fixtures/nai-web-t2i-default.json` | 2026-07-05 | JSON 정규화 | 예 |
| `payload/nais3-web/nai-web-t2i-quality.json` | `tests/fixtures/nai-web-t2i-quality.json` | 2026-07-05 | JSON 정규화 | 예 |
| `payload/nais3-web/nai-web-t2i-uc-humanfocus.json` | `tests/fixtures/nai-web-t2i-uc-humanfocus.json` | 2026-07-05 | JSON 정규화 | 예 |
| `payload/nais3-web/nai-web-t2i-uc-light.json` | `tests/fixtures/nai-web-t2i-uc-light.json` | 2026-07-05 | JSON 정규화 | 예 |
| `payload/nais3-web/nai-web-t2i-uc-none.json` | `tests/fixtures/nai-web-t2i-uc-none.json` | 2026-07-05 | JSON 정규화 | 예 |
| `payload/nais3-web/nai-web-t2i-variety-1024.json` | `tests/fixtures/nai-web-t2i-variety-1024.json` | 2026-07-05 | JSON 정규화 | 예 |
| `payload/nais3-web/nai-web-t2i-variety.json` | `tests/fixtures/nai-web-t2i-variety.json` | 2026-07-05 | JSON 정규화 | 예 |
| `payload/nais3-web/nai-web-vibe.json` | `tests/fixtures/nai-web-vibe.json` | 2026-07-05 | JSON 정규화, cache secret redaction | 예 |

## Synthetic target Bearer fixtures

`payload/target-bearer/`는 웹 캡처가 아니다. NAIS3의 GPL-3.0 `src/main/nai/payload.ts` (pinned commit `5c65aa6b00b1d3ecbeaf3787e5ab510e2464f464`, blob `b7f1950c7ed539bd069746f06f736128799477d0`)에 합성 `GenerationRequest`와 `BuildOptions`를 입력해 2026-07-11에 재구성했다. manifest와 fixture 내부 provenance 모두 `webCapture: false`로 구분한다. 원본 image, mask, reference bytes는 저장하지 않고 `[REDACTED:BASE64]` marker를 사용한다.

| Fixture | 범위 | 모델 | 변환 | 민감정보 제거 |
| --- | --- | --- | --- | --- |
| `payload/target-bearer/i2i-inline-bearer.json` | Bearer JSON inline i2i | `nai-diffusion-4-5-full` | 합성 입력에서 재구성 | 예 |
| `payload/target-bearer/infill-inline-bearer.json` | Bearer JSON inline image/mask infill | `nai-diffusion-4-5-full-inpainting` | 합성 입력에서 재구성 | 예 |
| `payload/target-bearer/raw-charref-preencoded-vibe.json` | raw character reference + pre-encoded vibe | `nai-diffusion-4-5-full` | 합성 입력에서 재구성 | 예 |
| `payload/target-bearer/v4-uc2-webp-nonstream.json` | V4, UC preset 2, WebP, non-stream | `nai-diffusion-4-full` | 합성 입력에서 재구성 | 예 |

## Stored parity gaps

`payload/gaps/`는 실패를 skip으로 숨기는 대신 sanitized expected payload, 현재 target actual payload, deep-diff를 함께 고정한다. 이 파일 자체는 모두 2026-07-11에 생성한 `synthetic-derived` 자료이며 실제 웹 캡처로 분류하지 않는다.

| Fixture | 근거 | 분류 | 변환 | 민감정보 제거 |
| --- | --- | --- | --- | --- |
| `payload/gaps/nai-web-i2i.gap.json` | sanitized `payload/nais3-web/nai-web-i2i.json` + target Bearer adapter 결과 | Web session cache-key transport와 Bearer inline-image transport 차이 | expected/actual/diff 재구성 | 예 |
| `payload/gaps/nai-web-vibe.gap.json` | sanitized `payload/nais3-web/nai-web-vibe.json` + target Bearer adapter 결과 | Web session cached-vibe transport와 Bearer pre-encoded-vibe transport 차이 | expected/actual/diff 재구성 | 예 |
| `payload/gaps/comment-only-character.gap.json` | pinned NAIS3 builder 의미론 + 현재 target builder 결과 | comment-only character의 target bug 가능성 | expected/actual/diff 재구성 | 예 |

## Phase 13 product-guidance fixtures

| Fixture | 근거 | 분류 | 변환 | 민감정보 제거 |
| --- | --- | --- | --- | --- |
| `product-guidance/token-gate-current-models.json` | NovelAI 공식 image model/quality-tag 문서 + synthetic prompts | numeric parity가 없는 fail-closed current-model matrix | model ID, accuracy classification, 문자 수만 기록 | 예 |

이 fixture는 provider payload나 tokenizer 파일을 포함하지 않고 512를 확정 상한으로 저장하지 않는다. 공식 artifact와
golden 결과가 확보되기 전까지 모든 current/unsupported model의 numeric result와 safety margin은 `null`이다.

## Redaction policy

캡처 또는 파생 데이터를 저장하기 전에 `tests/helpers/redaction.ts`의 `redactSnapshot()` 또는 `redactSnapshotJson()`을 적용한다. fixture review와 provenance test는 다음 값을 허용하지 않는다.

- NovelAI token 또는 Authorization bearer 값
- remote-service anon/service-role key, password, cookie, credential
- 실제 OAuth access/refresh/provider token 또는 전체 session object
- R2 access key, secret, API token, private credential 또는 account identifier
- cache secret/key
- 사용자 홈을 포함한 절대 파일 경로
- 원본 이미지·mask·reference의 전체 data URI/base64 또는 binary bytes

redaction 결과는 범주별 `[REDACTED:…]` marker로 대체한다. 저장 경로는 repository-relative 형태만 사용한다. 실제 credential이 필요한 smoke test의 입력이나 실제 생성 이미지 bytes는 이 fixture 트리에 넣지 않는다.

## Capture rules

- 실제 캡처를 추가하면 source endpoint/file, 정확한 model, KST 기준 캡처 날짜, 수행한 정규화와 redaction을 manifest에 기록한다.
- 외부 캡처가 아닌 합성 자료는 `captureKind: synthetic-derived`로 표시하며 실제 production payload라고 주장하지 않는다.
- 새 fixture 파일을 추가하거나 제거할 때 README 표와 `provenance.json`을 함께 갱신한다.
- V3/Furry V3는 model별 실제 parity fixture가 추가되기 전까지 verified parity로 표시하지 않는다.
