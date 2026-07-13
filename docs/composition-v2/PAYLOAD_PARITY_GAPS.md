# NAI payload parity 검증 및 gap 기록

기준일: 2026-07-11 (Asia/Seoul)

이 문서는 NAIS3의 실제 NAI 웹 payload fixture를 현재 `buildGenerateImagePayload()` 입력으로 역변환해 비교한 결과와, 동일성으로 선언할 수 없는 범위를 분리해 기록한다. NAIS3 builder를 production에 이식하거나 현재 `src/services/nai/payload.ts`를 웹 session 전송 형식에 맞추는 작업은 이 단계에 포함하지 않는다.

## 비교 자료와 출처

| 항목 | 값 |
| --- | --- |
| 비교 저장소 | `https://github.com/sunanakgo/NAIS3.git` |
| 비교 기준 commit | `5c65aa6b00b1d3ecbeaf3787e5ab510e2464f464` |
| 원본 fixture 도입/최종 변경 commit | `1eacaecfa038561121769edba3866cbe338c6dbf` |
| 원본 fixture 경로 | `tests/fixtures/nai-web-*.json` |
| 원본 equality test | `tests/payload.test.ts` |
| 원본 builder | `src/main/nai/payload.ts` |
| 원본 라이선스 | GPL-3.0 |
| 웹 캡처 모델 | `nai-diffusion-4-5-full` |
| 원본 캡처일 | 2026-07-05 |

가져온 fixture와 그 변형물은 NAIS3의 GPL-3.0 출처를 유지한다. repository, source path, source commit, 원본 blob, 캡처일과 변환 내역은 `tests/fixtures/provenance.json` 및 `tests/fixtures/README.md`에 fixture별로 기록한다. JSON formatting은 현재 테스트 저장소 형식으로 정규화했으며, 웹 session의 cache secret은 `[REDACTED:CACHE_KEY]`로 치환했다. 이 치환은 payload shape나 equality 차이를 target 구현에 맞추기 위한 수정이 아니다.

## 동일성 판정 계약

- fixture에서 사용자 입력에 해당하는 `GenerationRequest`와 builder option을 test adapter가 재구성한다.
- expected와 actual은 object semantic deep equality로 비교한다. 값의 차이뿐 아니라 누락된 key와 불필요하게 추가된 key도 실패다.
- JSON object key order는 의미상 동일성의 대상이 아니다. NAIS3 원본 test도 object deep equality를 사용한다.
- serialized JSON byte/string equality는 별도 transport 계약이 없으므로 이번 검증에 포함하지 않는다. 따라서 직렬화 순서나 byte parity를 검증했다고 주장하지 않는다.
- parity suite에서 동일한 웹 fixture만 passing equality case로 둔다. 알려진 차이는 skip하지 않고 expected, actual, deep diff를 gap artifact로 고정한다.

## 검증됨 — 웹 fixture exact parity 10건

다음 10개 NAIS3 웹 fixture는 현재 target adapter로 재구성한 입력을 current builder에 전달했을 때 payload 전체가 deep equality로 일치하는 범위다.

| Fixture | 확인된 범위 | 분류 |
| --- | --- | --- |
| `tests/fixtures/payload/nais3-web/nai-web-t2i-default.json` | V4.5 기본 T2I, quality off, UC preset 0, streaming, PNG | Verified exact parity |
| `tests/fixtures/payload/nais3-web/nai-web-t2i-quality.json` | quality tags on | Verified exact parity |
| `tests/fixtures/payload/nais3-web/nai-web-t2i-uc-light.json` | UC preset 1 | Verified exact parity |
| `tests/fixtures/payload/nais3-web/nai-web-t2i-uc-humanfocus.json` | UC preset 3 | Verified exact parity |
| `tests/fixtures/payload/nais3-web/nai-web-t2i-uc-none.json` | UC preset 4 | Verified exact parity |
| `tests/fixtures/payload/nais3-web/nai-web-t2i-variety.json` | variety 설정 | Verified exact parity |
| `tests/fixtures/payload/nais3-web/nai-web-t2i-variety-1024.json` | 1024 계열 크기의 variety 설정 | Verified exact parity |
| `tests/fixtures/payload/nais3-web/nai-web-t2i-2char.json` | 2명 character prompt, AI's Choice 좌표 | Verified exact parity |
| `tests/fixtures/payload/nais3-web/nai-web-t2i-coords.json` | manual character coordinates | Verified exact parity |
| `tests/fixtures/payload/nais3-web/nai-web-charref.json` | cached character reference | Verified exact parity |

이 10건의 결론은 V4.5 웹 fixture의 해당 parameter 조합에만 적용된다. 목록에 없는 모델과 transport 조합까지 동일하다는 의미가 아니다.

## 분류됨 — Web session과 Bearer transport 차이 2건

NAIS3 웹 fixture 12개 중 다음 2개는 generation 의미가 아니라 image 전달 방식이 target transport와 달라 exact parity로 집계하지 않는다.

| Fixture | 웹 session expected | target Bearer actual | 분류 | 고정된 diff artifact |
| --- | --- | --- | --- | --- |
| `nai-web-i2i.json` | `parameters.image_cache_secret_key` | `parameters.image`의 inline base64 | Web session cache vs Bearer inline transport | `tests/fixtures/payload/gaps/nai-web-i2i.gap.json` |
| `nai-web-vibe.json` | `parameters.reference_image_multiple_cached` | `parameters.reference_image_multiple`의 pre-encoded data | Web session cache vs Bearer pre-encoded transport | `tests/fixtures/payload/gaps/nai-web-vibe.gap.json` |

NAIS3 웹 호출은 session 기반 multipart/recaptcha 흐름에서 cache secret key를 사용한다. 현재 target client는 Bearer 인증 JSON body를 전송하며 source image는 inline base64, vibe는 pre-encoded payload로 운반한다. 그러므로 cache key 필드를 target builder에 임의로 추가하거나 fixture를 Bearer 형식으로 조용히 바꾸지 않는다.

두 gap artifact는 원본 expected, 현재 builder actual, missing/unexpected path를 포함한 deep diff를 함께 저장한다. gap test의 통과는 두 payload가 동일하다는 뜻이 아니라, 알려진 transport 차이가 명시된 artifact와 정확히 일치하고 새로운 설명되지 않은 차이가 추가되지 않았다는 뜻이다.

## 구조만 확인됨 — synthetic target-Bearer fixture 4건

다음 fixture는 실제 NAI 웹 캡처가 아니다. NAIS3의 pinned builder 동작을 바탕으로 target Bearer 입력을 합성해 현재 builder의 구조적 경로를 고정한 characterization 자료다.

| Fixture | 구조적 확인 범위 | 증거 수준 |
| --- | --- | --- |
| `tests/fixtures/payload/target-bearer/v4-uc2-webp-nonstream.json` | V4, UC preset 2, WebP, nonstream | Synthetic structural coverage only |
| `tests/fixtures/payload/target-bearer/raw-charref-preencoded-vibe.json` | raw character reference, pre-encoded vibe | Synthetic structural coverage only |
| `tests/fixtures/payload/target-bearer/i2i-inline-bearer.json` | Bearer inline i2i image | Synthetic structural coverage only |
| `tests/fixtures/payload/target-bearer/infill-inline-bearer.json` | inline source image와 mask를 포함한 infill | Synthetic structural coverage only |

이 4건은 target builder가 재구성된 입력을 일관되게 처리하는지는 확인하지만 NAI 웹 payload와의 실제 parity, 서버 수용성 또는 응답 동작을 증명하지 않는다. 따라서 위의 웹 fixture exact parity 10건에 합산하지 않는다.

## 미검증 — NAIS3 웹 캡처가 없는 범위

현재 pinned NAIS3 fixture set에는 다음 실제 웹 캡처가 없다.

- V4 모델
- UC preset 2
- raw/base64 character reference
- pre-encoded vibe
- infill/mask
- WebP image format
- nonstream request

해당 조합 일부는 synthetic target-Bearer fixture로 구조를 확인했지만, 실제 웹 캡처 또는 독립된 transport contract가 확보되기 전에는 web parity로 승격하지 않는다.

## target bug 가능성 및 추가 추적 항목

### Comment-only character prompt

분류: **Target bug 가능성**

현재 target은 character prompt의 활성 여부를 먼저 검사한 뒤 full-line comment를 제거한다. 따라서 comment만 있는 prompt가 활성 character로 남은 다음 빈 prompt entry를 payload에 추가할 수 있다. pinned NAIS3 builder는 comment 제거 뒤 빈 prompt를 제외한다. 이 차이는 transport 차이가 아니며 `tests/fixtures/payload/gaps/comment-only-character.gap.json`에 expected, actual, deep diff를 고정한다.

production builder는 이번 단계에서 수정하지 않는다. 실제 UI 입력 가능성, 기존 저장 데이터, NAI 서버 의미를 확인한 뒤 별도 bug-fix 단계에서 판단한다.

### 아직 분류가 끝나지 않은 범위

| 항목 | 현재 관찰 | 다음 증거 |
| --- | --- | --- |
| character `charInfo` | target payload의 `info_extracted`가 입력과 무관하게 고정될 가능성 | 실제 웹 fixture와 UI 입력 round-trip |
| reference carrier 의존성 | pre-encoded vibe/cache key가 대응 image carrier 존재 여부에 의존하는 경로 | carrier 유무 조합 fixture |
| mixed reference ordering | cached/raw character reference가 섞일 때 배열 정렬과 index mapping 미검증 | 혼합 reference 웹 캡처 |
| V3 / Furry V3 | 선택 가능한 모델이지만 model별 payload parity 미검증 | 각 모델의 실제 웹 fixture |

이 항목은 현재 회귀로 단정하지 않으며, 검증 자료가 없는 상태도 passing parity로 처리하지 않는다.

## 현재 결론과 변경 경계

- Verified: pinned NAIS3 웹 fixture 12개 중 10개가 current builder와 object semantic deep equality로 일치한다.
- Classified gap: i2i와 vibe 2개는 Web session cache transport와 target Bearer inline/pre-encoded transport의 의도된 경계 차이다.
- Unverified: NAIS3 웹 캡처가 없는 모델/형식/전송 조합과 추가 추적 항목은 parity 완료로 선언하지 않는다.
- Actual regression: 이번 fixture 비교에서 확정된 production regression은 없다. comment-only character는 재현 가능한 target bug 가능성으로 별도 기록한다.
- Runtime change: `src/services/nai/payload.ts`, `src/services/nai/adapter.ts`, `src/services/nai/presets.ts`, `src/services/nai/client.ts`를 이 단계에서 변경하지 않는다.

production payload 동작을 바꾸려면 별도 승인된 단계에서 gap별 fixture를 passing equality contract로 전환하고 기존 `test:nai-core`, payload parity, lint, build gate를 모두 다시 통과해야 한다.
