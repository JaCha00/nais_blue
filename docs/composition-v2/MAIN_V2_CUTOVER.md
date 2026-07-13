# Main Mode CompositionEngine v2 전환 계약

기준일: 2026-07-12 (Asia/Seoul)

이 문서는 Main Mode의 prompt, generation parameter, character 조합 책임을 `CompositionEngine`으로 전환한 경계와 rollback 계약을 기록한다. `generation-store`가 session·transport·저장 orchestration을 계속 소유하고, `src/lib/composition/main-adapter.ts`가 기존 Main/Asset 상태를 일회성 `ResolveRequest`로 투영한다. Asset Profile 저장 형식을 migration하거나 Scene·Style Lab caller를 변경하는 단계가 아니다.

## Rollout mode

`nais2-generation` persisted store의 `compositionMode` 하나로 Main caller를 전환한다. 현재 기본값은 `v2`이며 `selectedRecipeId`도 함께 보존된다.

| Mode | CompositionEngine 실행 | 실제 NAI 요청에 쓰는 계획 | 실패 동작 | Sequential fragment |
| --- | --- | --- | --- | --- |
| `legacy` | 실행하지 않음 | 기존 Main/Asset resolver 결과 | 기존 fallback 동작 유지 | 기존 processor 동작 유지 |
| `shadow` | preview mode로 실행 | legacy 결과만 사용하며 실제 요청은 1회 | v2 error와 diff를 진단 상태에 남기고 legacy 요청 계속 | counter를 소비하거나 commit하지 않음 |
| `v2` | generate mode로 실행 | 유효한 engine plan | blocking error이면 요청·출력·history 없이 batch 중단 | 성공한 요청의 CAS proposal만 commit |

`legacy`는 즉시 rollback 경로다. Recipe selector는 legacy에서 비활성화되며 기존 Asset recipe 선택/fallback과 prompt processor가 그대로 실행된다. `shadow`는 이중 네트워크 요청을 하지 않고 동일 입력 snapshot에 대한 v2 결과를 legacy `GenerationParams`, redacted resource semantics, recipe와 output policy/materialization 요약에 비교한다. 설명되지 않은 차이는 `compositionShadowDiff`에서 숨기지 않는다.

## Main adapter와 명시적 recipe 선택

`main-adapter.ts`는 React, Zustand, Tauri 또는 image bytes를 import하지 않는다. Caller가 읽은 store snapshot을 다음 pure domain 입력으로 변환한다.

- 기존 Asset Profile의 module/recipe ID와 Main character ID는 변경하지 않는다.
- direct 선택은 persisted sentinel `main-selection:direct`, Asset 선택은 percent-encoded `main-selection:asset:<id>`로 구분한다. 저장된 Asset recipe ID가 `main:direct`와 충돌해도 저장 ID를 바꾸거나 direct 선택의 의미를 뒤집지 않는다. Ephemeral document의 synthetic direct entity ID는 충돌 시 결정적 suffix를 사용한다.
- 명시적 selection이 있으면 adapter가 concrete recipe entity ID로 해석해 `ResolveRequest.recipeId`에 넣는다. 선택값이 없을 때만 첫 enabled Asset recipe, 없으면 synthetic direct recipe를 adapter 정책으로 선택한다. Engine 자체는 첫 recipe를 암묵적으로 선택하지 않는다.
- Main base/inpainting/additional/detail/negative와 character prompt/position을 typed contribution 및 stable character reference로 만든다.
- character payload index는 engine에서 만들지 않는다. 유효한 plan을 transport용 `GenerationParams`로 바꾸는 마지막 Main boundary에서 현재 배열 형태로 materialize한다.
- source image와 mask는 byte-free SHA-256 digest, character/vibe는 stable managed ID와 hydration 상태에 무관한 persisted thumbnail digest를 document에 넣는다. 원본 bytes와 cache secret 또는 그 fingerprint는 plan/diff에 넣지 않고 기존 resource hydration 뒤 transport boundary에서만 결합한다.
- unknown legacy setting 또는 `extensions`는 보존할 수 있지만 typed allowlist에 없는 값을 core params나 NAI payload로 전달하지 않는다.

## Resolve와 parameter precedence

Main의 v2 요청은 다음 흐름을 고정한다.

```text
session/seed 선택 → source dimensions + store snapshot
→ explicit ResolveRequest → CompositionEngine.resolve()
→ plan validation → reference bytes materialization
→ existing NAI adapter/payload builder → stream 또는 ZIP transport
→ result/thumbnail guard → sequence CAS commit
→ existing output/history/metadata path
```

Engine의 낮은 우선순위에서 높은 우선순위 방향은 `engine defaults → profile defaults → module defaults → recipe step override → recipe override → scene override → workflow runtime override → transport-derived override → capability/safety clamp`다. Main caller에서는 다음과 같이 대응한다.

| Layer | Main source |
| --- | --- |
| engine defaults | Main store의 model, resolution, steps, CFG, sampler, scheduler, SMEA, variety, quality, UC, seed, source strength/noise, position enable |
| profile/module/step/recipe | 기존 Asset Profile의 typed settings 및 output policy |
| scene override | Main에서는 사용하지 않음 |
| workflow runtime override | 요청 시점 Main runtime override가 있을 때만 명시적으로 전달 |
| transport-derived override | source-derived width/height, source mode, source/mask resource reference, strength/noise |
| capability/safety clamp | CompositionEngine validation 및 writer 직전 desktop/mobile absolute-path capability gate |

Scalar는 마지막으로 명시된 값이 이기며 `false`와 `0`도 유효한 override다. 따라서 활성 Asset recipe가 prompt와 output만 부분적으로 덮던 이전 비대칭을 유지하지 않는다. 유효한 v2 plan에서는 Asset profile/module/step/recipe의 typed params와 output policy도 동일 precedence와 provenance로 최종 결과에 반영된다. 반면 source image 크기, mask 유무와 source edit의 non-streaming 강제 같은 transport 사실은 Asset 값보다 높은 경계에 남는다.

최종 `GenerationParams`는 plan의 positive/negative, prompt slots, character prompt/position, model과 모든 typed params, seed, output format/metadata mode를 사용한다. Plan ID, recipe ID, deterministic plan hash와 provenance 요약은 NAIS2 metadata에 덧붙인다. 기존 `src/services/nai/payload.ts`의 payload shape와 dual API 정책은 교체하지 않는다.

## Invalid plan과 side-effect 차단

`v2`에서 schema/recipe/reference/position/parameter validation이 blocking error를 반환하면 Main은 다음 동작을 보장한다.

- character/vibe byte hydration과 NovelAI transport를 호출하지 않는다.
- `compositionErrors`와 `compositionWarnings`를 store에 남기고 destructive validation toast를 표시한다.
- `isGenerating`, `generatingMode`, `currentBatch`, `abortController`를 정상 종료 상태로 정리한다.
- output file/event, history, sequential counter를 변경하지 않는다.
- missing module을 direct prompt로 조용히 fallback하지 않는다. strict `E_MODULE_REF_MISSING`으로 차단한다.

Shadow에서 동일 error가 발생하면 legacy request는 계속 실행하되 `v2Valid: false`와 error code를 diff에 남긴다. 이 동작은 rollback 검증용이며 v2 error를 성공으로 간주한다는 뜻이 아니다.

## Session, cancel, stream, batch 보존

`generationSessionId`, `AbortController`, locked/unlocked seed 선택, 순차 batch loop, streaming preview callback, source edit의 non-streaming 경로는 기존 Main 구조를 유지한다. Composition, source dimension 계산, fragment lookup, Asset resolution과 reference hydration 같은 await 뒤에는 stale/cancel guard가 있다. API 전, stream callback, API 후와 thumbnail/CAS 직전까지 현재 session을 확인하므로 그 경계 전에 취소된 결과는 output/history/counter로 진행하지 않는다. CAS가 성공해 기존 writer I/O가 시작된 뒤에는 부분 파일을 안전하게 rollback할 수 없으므로 그 짧은 구간은 기존과 같이 non-cancellable completion 구간으로 취급한다.

Sequential fragment resolver는 persistence를 직접 수정하지 않고 expected/next counter를 담은 proposal만 반환한다.

Fragment snapshot은 Main/character와 선택된 recipe step/module에서 실제로 reachable한 named fragment만 재귀적으로 load한다. 사용하지 않는 fragment 파일의 read 실패는 direct generation을 막지 않는다.

- shadow/preview는 proposal을 commit하지 않는다.
- resolve 실패, API 실패, CAS 이전 cancel 또는 stale session은 counter를 변경하지 않는다.
- v2 transport 성공 후 thumbnail guard까지 통과한 시점에만 fragment metadata revision과 canonical-path counter를 비교하는 CAS commit을 수행한다. Basename alias도 stable fragment ID를 통해 canonical path에 commit한다.
- CAS conflict이면 생성 결과를 output/history에 기록하지 않고 사용자에게 conflict를 알린다.

Batch는 기존 loop를 유지하며 locked nonzero seed를 각 요청에 재사용한다. Source image 또는 mask가 있으면 streaming 설정과 무관하게 기존 ZIP/non-streaming transport를 사용한다.

## Output, history와 metadata 경계

Engine은 portable output policy와 deterministic filename policy 입력을 만든다. Main adapter는 요청 시점 `now`, seed, profile name/ID, recipe label/ID를 이용해 이를 기존 writer가 소비하는 directory, filename, format, metadata mode로 materialize한다. 이 filename identity 보강은 `composition-plan-hash-v2`로 versioned된다. 상대 경로의 `.`/`..`는 portable segments로 정규화하며 absolute 요청은 writer 직전 mobile capability gate를 다시 통과한다. 실제 파일 쓰기, Tauri/browser fallback, memory event, history thumbnail과 sidecar 작성은 기존 `generation-store` 경로가 계속 담당한다.

Direct source edit의 기존 `NAIS_I2I_`/`NAIS_INPAINT_` filename prefix는 v2 filename policy에도 유지한다. Absolute runtime/recipe directory는 semantic plan에는 bookmark capability로만 들어가고, 실제 display path와 absolute-write 여부는 adapter materialization으로 기존 writer에 전달한다. Shadow mode는 v2 filename/directory를 실제 output에 사용하지 않고 legacy materialization을 유지한다.

따라서 이번 전환은 새 output writer를 도입하거나 기존 writer를 공통 domain으로 옮긴 것이 아니다. Plan이 선택한 memory/filesystem destination은 resolve 시점에 고정되어 transport 중 live setting 변경으로 바뀌지 않는다. 현재 writer가 static filename 충돌 시 overwrite하므로 plan도 `collisionPolicy: 'overwrite'`로 이를 정직하게 표현하며, filesystem side effect는 engine 밖에 남는다. Cached reference secret은 embedded metadata와 sidecar용 payload summary에서 redaction한다.

## 최소 진단 UI

기존 `PromptPanel`의 prompt field와 layout은 compatibility 기간 동안 유지한다. 정확한 Main route(`/`)에만 다음 additive UI를 표시하며 Scene·Style Lab에는 mount하지 않는다.

- `RecipeSelector`: `legacy`/`shadow`/`v2` mode와 explicit Asset/direct recipe 선택
- `ValidationBadge`: pending, legacy, valid, warning, error 상태
- `ResolvedPlanPanel`: final positive/negative, canonical slot parts, character와 position, final params, output policy, warning/error, plan hash, provenance count/winner, shadow diff

생성 중에는 recipe 변경을 막는다. 이 UI는 prompt editor나 Asset Profile editor를 대체하지 않는다.

## 승인된 parity delta

아래 차이는 기존 Main characterization과 shadow 비교에서 의도적으로 승인된 v2 규칙이다. 이 목록 밖 차이는 자동으로 승인되지 않는다.

| 항목 | Legacy | v2 규칙 |
| --- | --- | --- |
| wildcard random | `Math.random()`에 의존하여 fixed generation seed와 독립 | generation seed + stable scope 기반 deterministic selection; random trace와 plan hash에 반영 |
| global negative wildcard | literal로 남음 | positive와 분리된 negative target 안에서 seeded resolver 적용 |
| full-line comment | 경로별 처리 시점이 달랐고 comment-only character가 남을 수 있음 | 앞 공백을 제외한 첫 문자가 `#`인 줄을 main/negative/character 모두 동일하게 제거; inline `#` 보존 |
| exact-token dedupe | 공통 canonical dedupe 없음 | target-local comma token의 trim-normalized exact string 기준 첫 출현 보존; weighted token은 일반 token과 합치지 않음 |
| broken reference | missing Asset module은 direct prompt fallback 가능 | compatibility mode가 아닌 v2 Main은 blocking error, silent skip 금지 |
| sequential timing | legacy processor가 resolution 과정에서 persisted counter에 관여 | pure resolver proposal을 성공·non-cancelled 결과 뒤 CAS commit |
| Asset params/output | prompt replacement와 output 일부만 적용될 수 있음 | prompt, typed params, output policy 모두 profile/module/step/recipe precedence에 참여 |
| default filename clock | response/save 시점 `Date.now()` | injected request-start `now`로 deterministic materialization; 긴 생성의 timestamp 차이를 승인 |

Seeded wildcard 선택값 때문에 legacy와 v2 final prompt가 다른 경우라도 같은 seed, scope, fragment snapshot이면 v2 결과와 hash는 반복 실행에서 동일해야 한다. Runtime은 raw diff를 보존하고, 승인 여부는 이 문서의 규칙과 random trace/provenance를 함께 보고 판정한다. 원인을 증명하지 않은 valid diff에 `approvedRule`을 자동 부여하지 않는다.

Shadow 비교는 source/mask 존재 여부, strength/noise, character/vibe reference의 byte-free 배열 요약, prompt parts, Asset recipe/module ID, output recipe/directory/template/rendered non-volatile filename/format/metadata/absolute capability까지 포함한다. Volatile time-token filename은 위에서 승인한 clock delta 때문에 concrete name 대신 template을 비교한다. 원본 image bytes·token·전체 cache key는 diff에 넣지 않는다.

## Rollback 절차

문제가 발생하면 Main 설정의 workflow mode를 `legacy`로 바꾼다. 코드 revert, Asset Profile migration rollback, NAI adapter 교체가 필요하지 않다. Persisted selection sentinel은 남아 있어도 legacy 경로에서는 engine 요청을 결정하지 않는다. Mode/recipe 변경 시 stale plan과 issue는 지워진다. 원인 분석은 `lastResolvedPlan`, `compositionWarnings`, `compositionErrors`, `compositionShadowDiff`, plan hash를 캡처한 뒤 `shadow`에서 재현할 수 있다.

Rollback은 Main composition caller만 전환한다. 이미 기록된 output/history를 삭제하거나 fragment counter를 되감지 않으며, 실행 중 mode 변경 대신 현재 generation을 취소하고 정상 종료 후 변경해야 한다.

## 이번 단계 범위 밖

- Scene adapter/caller와 `useSceneGeneration()` worker/session/requeue 구조
- Style Lab preview queue와 `style-lab-generation.ts`
- 기존 output writer의 공통화 또는 교체
- NAI adapter, payload builder, streaming protocol, dual API 정책의 wholesale 변경
- character/vibe bytes 저장소 또는 Asset Profile migration
- PromptPanel 전면 재작성

## 검증 gate

최소 회귀 gate는 다음 명령이다.

```powershell
npm run test:characterization
npm run test:payload-parity
npm run test:composition
npm run test:unit
npm run test:nai-core
npm run lint
npm run build
```

Main characterization은 legacy golden, direct legacy/v2 payload equivalence, shadow 단일 요청과 output diff, invalid-plan block/rollback, fixed-seed batch, deterministic wildcard, Asset recipe active/inactive와 params/output precedence, final-model parity warning, character manual position와 numeric Asset slots, source infill, character/vibe materialization, filesystem+sidecar, cancel-before-API, cancel-during-stream, API failure와 sequential CAS timing을 포함한다. `tests/domain/composition/main-adapter.test.ts`는 pure adapter와 real engine을 검증하고, `tests/components/main-composition-ui.contract.test.ts`는 UI가 Main route에만 연결됐음을 고정한다. Aggregate characterization에는 기존 Scene 및 Style Lab fixture도 포함되어 두 workflow의 비변경을 함께 확인한다.
