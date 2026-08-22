# NAI 메타데이터 프롬프트 빈도 정렬 기능 명세

> 상태: 연구 계약 확정, 구현 전 · 최종 갱신: 2026-08-21

## 목적

NAI 이미지에서 Prompt, Character Prompt와 UC를 읽어 용도별로 분류하고, Danbooru 정식 태그의 현재 게시글 수를 근거로 선택한 블록만 안정 정렬한다. 게시글 수는 NAI의 실제 학습량이 아니라 재현 강도를 추정하는 프록시이므로 원문을 자동 덮어쓰지 않고 비교 가능한 미리보기를 만든다.

이 기능은 기존 소유자를 재사용한다.

- 이미지 메타데이터: `src/lib/metadata-parser.ts`의 `parseNAIMetadata`
- 프롬프트 가져오기: `GlobalImageMetadataDrop`, `MetadataDialog`, Data Hub
- 태그 검증 UI: `DanbooruTagVerifyDialog`
- 조회 경계: `src/services/danbooru-tag-verifier.ts`
- 정규화·실조회: `src-tauri/python/danbooru_tags.py`

새 메타데이터 파서, 별도 전역 store나 두 번째 Danbooru 클라이언트를 만들지 않는다.

## 전체 흐름

```text
이미지 바이트
  → 실제 형식·컨테이너 검증
  → 기존 parseNAIMetadata
  → 보존형 Prompt 토큰 트리
  → 용도 분류와 사용자 수정
  → 정식 Danbooru slug 조회
  → 블록 내부 안정 정렬 미리보기
  → 사용자가 선택한 변경만 적용
```

메타데이터 문자열은 신뢰할 수 없는 데이터로만 취급한다. 명령, URL, 코드나 문서 지시로 실행하지 않는다.

## 1. 추출 계약

1. 확장자보다 magic bytes와 디코더 판정을 우선한다.
2. PNG는 평문 text chunk를 먼저 읽고 필요할 때 알파 LSB의 `stealth_pnginfo`·`stealth_pngcomp`를 확인한다.
3. WebP는 RIFF 선언 크기, chunk 경계와 trailing bytes를 검증한 뒤 EXIF를 읽고, 생성 JSON이 없으면 디코딩한 알파 LSB를 확인한다.
4. 평문과 stealth 사본이 함께 있으면 양쪽을 보존해 값 일치 여부를 진단한다.
5. Prompt, UC, Character Prompt, 좌표와 생성 파라미터가 없다고 추측해 채우지 않는다.
6. 분석만으로 원본 이미지, 컨테이너 metadata나 픽셀을 변경하지 않는다.

이번 표본은 표준 EXIF가 아니라 WebP 알파의 `stealth_pngcomp`에서 생성 JSON이 나왔다. 따라서 WebP에서도 컨테이너 EXIF만 읽고 종료하면 안 된다.

## 2. 보존형 토큰 트리

단순 `split(',')`는 수치 가중치 그룹과 줄바꿈을 손상시키므로 사용하지 않는다. 파서는 최소한 다음 값을 보존한다.

```ts
interface PromptTokenNode {
    raw: string
    normalizedText: string
    weight: number | null
    polarity: 'positive' | 'negative'
    groupId: string | null
    field: 'prompt' | 'character' | 'uc' | 'character-uc'
    sourceIndex: number
    diagnostics: readonly PromptDiagnostic[]
}
```

- `2::a, b ::`는 공통 가중치가 적용된 그룹이다.
- 그룹 내부 정렬은 모든 항목이 같은 가중치를 공유한다고 확정됐을 때만 허용한다.
- `1.1:::swept bangs ::` 같은 비정상 콜론 수는 오류로 표시하고 원문을 자동 수정하지 않는다.
- 중복 태그, 오타, 잘못된 `artist:` 접두사와 닫는 `::` 앞 공백도 진단과 정렬을 분리한다.
- 원문 round-trip 모드에서는 byte-for-byte 동일한 Prompt를 다시 만들 수 있어야 한다.

## 3. 용도 분류

분류는 정렬 경계이며 실제 Prompt에 섹션명을 삽입하지 않는다.

| 블록 | 예시 |
|---|---|
| artist | `artist:name`과 확인된 작가명 |
| 전역 매체·작법 | digital illustration, realistic, 3d, lineart |
| 품질·시대 | highres, quality 계열, `year 2026` |
| 배경·장면 | indoors, simple background, lighting |
| 전역 인라인 억제 | 음수 가중치의 작법·텍스트·구도 억제 |
| 캐릭터 정체성 | 인원, 성별·연령 범위 |
| 얼굴·눈·표정 | 눈매, 홍채, 속눈썹, 표정 |
| 머리카락 | 색, 길이, 앞머리·옆머리·뒷머리 |
| 체형·피부 | 체형, 피부색, 신체 표식 |
| 의상·소품 | 의복, 액세서리, 소유 소품 |
| 자세·카메라 | standing, cowboy shot |
| UC | 작가, 텍스트, 형식, 해부, 렌더링, 품질 등 |

규칙 분류가 불확실하면 `미분류`에 두고 사용자에게 블록 이동을 허용한다. 분류 결과만으로 base Prompt의 인물 태그를 Character Prompt로 자동 이전하지 않는다.

## 4. Danbooru 조회와 정규화

1. 조회용 slug와 출력 원문을 분리한다.
2. 공백은 `_`로 바꾸되 작가 식별자의 괄호는 보존한다. 예: `poper (arin sel)` → `poper_(arin_sel)`.
3. 현재 `danbooru_tags.py`의 일반 정규화는 괄호까지 제거하므로, 작가 조회에는 괄호 보존 정규화가 필요하다.
4. exact match만 게시글 수로 확정하고 fuzzy 결과는 교정 후보로만 표시한다.
5. `정식 태그이며 0건`, `deprecated`, `정식 태그 없음`, `조회 실패`를 서로 다른 상태로 유지한다.
6. 기본 API 실패 시 승인된 미러나 번들 스냅샷으로 전환하되 `source`와 `asOf`를 결과에 기록한다.
7. `year 2026` 같은 NAI 전용 토큰과 자연어 품질 문구는 Danbooru 미등록이라는 이유로 삭제하거나 0건으로 간주하지 않는다.

## 5. 안정 정렬

기본 정렬 키는 다음과 같다.

```text
용도 블록의 사용자가 정한 순서
→ 정식 태그 상태
→ post_count 오름차순
→ 원문 sourceIndex
```

- artist, 품질, 배경, 캐릭터와 UC를 하나의 숫자열로 섞지 않는다.
- 같은 게시글 수는 원문 상대 순서를 유지한다.
- 정식 0건 태그와 미등록 토큰을 같은 값으로 취급하지 않는다.
- 미등록·조회 실패 항목은 해당 블록 뒤에 원문 순서로 둔다.
- 가중치와 polarity는 정렬 키가 아니라 보존 대상이다.
- 중복 제거, 오타 수정, `artist:` 접두사 추가와 가중치 그룹 분해는 별도 opt-in 작업이다.
- 현재 빈도 오름차순은 연구 휴리스틱이다. UI에는 원래 순서와 정렬 순서를 나란히 보여준다.

## 6. 출력 모드

| 모드 | 동작 |
|---|---|
| 분석만 | 분류, 빈도와 진단만 표시 |
| 안전 정렬 | 원문 토큰·가중치를 보존하며 블록 안에서만 이동 |
| 정규화 제안 | 괄호 보존 slug, 접두사, 오타와 중복 수정안을 별도 diff로 제공 |
| Character 분리 제안 | base Prompt의 인물 태그를 Character Prompt 후보로 복사하되 자동 적용하지 않음 |

적용 버튼은 원문, 변경본, 이동·수정·삭제 수와 조회 시점을 보여준 뒤 활성화한다. 취소하면 어떤 Prompt 상태도 변경하지 않는다.

## 7. 필수 진단

- 중복 태그와 중복 UC
- Positive, 인라인 음수와 UC 사이의 같은 개념 반복
- 같은 가중치 그룹 안의 서로 다른 용도
- 잘못된 콜론 수와 닫히지 않은 가중치
- Character Prompt가 없는데 base Prompt에 인물 속성이 밀집된 경우
- 전역 UC가 목표 캐릭터 색·피부·표정과 충돌할 가능성
- 실조회 값과 번들 스냅샷 값의 차이
- 특정 태그의 게시글 수가 커도 모델 내부 재현 강도를 보장하지 않는다는 경고

## 8. 개인정보와 저장 정책

- 분석 요청과 캐시에는 이미지 바이트, 전체 Prompt, seed와 서명값을 불필요하게 남기지 않는다.
- 원격 조회에는 정규화된 개별 태그만 전송한다.
- 로그에는 태그 조회 상태와 오류 코드만 남기고 전체 Prompt를 기록하지 않는다.
- 테스트 fixture는 작가명과 Prompt를 합성 값으로 치환한다.
- 사용자가 명시적으로 저장하지 않은 추출 결과는 세션 종료 시 폐기한다.

## 9. 검증 기준

1. PNG 평문, PNG stealth, WebP EXIF, WebP stealth와 sidecar 입력을 모두 읽는다.
2. 분석만 모드의 Prompt round-trip이 원문과 동일하다.
3. 괄호가 있는 작가 태그가 exact Danbooru slug로 조회된다.
4. 동률 정렬은 안정적이며 가중치 그룹을 잃지 않는다.
5. 정식 0건·미등록·네트워크 오류가 UI에서 구분된다.
6. 취소·재시도·오프라인 fallback이 원문을 변경하지 않는다.
7. 적용 전후 diff와 조회 출처·시점이 재현 가능하다.

관련 연구: [전역 태그 빈도순 정렬 실험](./v5-full-global-tag-frequency-ordering.md), [V5 Full 누적 결론](./v5-full-findings.md)
