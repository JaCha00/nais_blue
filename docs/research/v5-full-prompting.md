# NovelAI Diffusion V5 Full 프롬프팅 연구

> 상태: A01 작가 태그 단독 지문 실험 준비 · 최종 갱신: 2026-08-21

## 범위와 목표

- NovelAI 공식 홈페이지의 V5 Full 텍스트 생성만 다룬다.
- 목표는 재현 가능한 문법, 독창적 그림체, 장면 간 스타일 일관성을 찾는 것이다.
- NAI Blue 구현 변경은 검증된 결과가 나온 뒤 별도 작업으로 다룬다.

## 현재 근거

| 구분 | 내용 |
|---|---|
| 공식 확인 | 자연어와 태그를 함께 지원한다. 따옴표 안의 문자열은 프런트엔드가 하나의 `teXt:` 블록으로 조립하며, 수동 `text:`는 자동 조립을 끈다. `depthness`와 복잡도 태그가 추가됐다. 홍보 예시는 Character Positioning으로 최대 22명을 표시했다. |
| 현재 런타임 확인 | V5는 Qwen 3.5 계열 토크나이저를 사용한다. 현재 공식 UI와 요청 경계는 활성 캐릭터 프롬프트를 32개까지 받으며 33번째는 한도 밖이다. 홍보된 22명은 실제 입력 상한과 다르다. |
| 사용자 관찰 | 기존 V4.5 이하 문법의 상당수는 그대로 이전되지 않는다. RGB 계열 색상과 artist 태그가 유효하다. UI 입력 상한과 정체성을 유지하며 실제 이미지에 안정적으로 표현되는 인원 한도는 다를 수 있다. |
| 검증할 가설 | 따옴표 없는 구조형 문법이 자유 문장보다 속성 충돌을 줄인다. 32개 입력 허용과 32명 표현 성공은 별개의 문제다. |

공식 자료: [V5 출시 안내](https://journal.novelai.net/image-generation-novelai-diffusion-v5-is-here-c2df7c6b8d2d/), [그림체 가이드](https://docs.novelai.net/en/image/tutorial-artstyles/)

## 프롬프트 계약

1. **기본 프롬프트**: 공통 그림체, 배경, 카메라, 조명, 인물 관계를 소유한다.
2. **캐릭터 프롬프트**: 해당 인물의 외형, 의상, 자세, 행동, 대사만 소유한다.
3. **캐릭터 위치**: 화면 배치와 대사 귀속을 위한 공간 앵커다.
4. 구조는 대괄호 없는 `SECTION:`과 따옴표 없는 `key: value`를 사용한다. 큰따옴표는 실제 렌더링할 텍스트에만 사용한다.
5. 공통 artist 태그와 스타일 지문은 기본 프롬프트에 한 번만 둔다.

### 가중치와 배치 규칙

- 대괄호는 구조 표지가 아니라 약화 가중치로 해석될 수 있다. 프롬프트 제목에 `[SECTION]`을 사용하지 않고 `SECTION:`만 사용한다.
- 중괄호도 강화 가중치이므로 구조 표지로 사용하지 않는다. `[]`, `{}`, `::`는 의도한 가중치에만 쓴다.
- 가중 대상이 숫자로 끝나면 닫는 `::` 앞에 공백을 둔다. `2::year 2026::`는 분리될 수 있으므로 `2::year 2026 ::`로 입력한다.
- 수치 가중치는 최대 `3`까지만 사용한다. 먼저 무가중과 `2`를 비교하고, `3`은 효과가 부족할 때만 시험한다.
- `year 2026`은 일차적으로 시대감 편향으로 취급한다. 긴 프롬프트 속에서 그림체 고정 장치로 작동한다고 가정하지 않는다.
- 프롬프트 하단과 UC는 색조·필터감, 배경 밀도, 미세 묘사의 마감, 페이지 여백에도 전역 영향을 줄 수 있다. 실제 후보정 단계로 단정하지 않고 관찰 항목으로 측정한다.

## 공통 실험 조건

- Model: V5 Full
- Resolution: 832×1216
- Steps: 28
- Prompt Guidance: 7
- Sampler: Euler Ancestral
- Prompt 기본 제공 프리셋: None
- Undesired Content 프리셋: None
- 각 분기에서 최소 2장을 생성하고, 첨부 이미지는 대표 샘플로 사용
- 분기마다 독립적인 무작위 Seed를 사용한다. 고정 Seed의 형태·구도 잠금을 비교 근거로 사용하지 않음
- 같은 비교군에서는 Seed를 제외한 나머지 설정을 고정
- 결과는 픽셀 단위 차이가 아니라 반복되는 형태, 스타일 모드, 발생률과 변동성으로 비교
- 한 번에 변수 하나만 변경하고 참조 이미지 계열 기능은 사용하지 않음

## 활성 실험

| ID | 상태 | 비교 변수 | 성공 기준 |
|---|---|---|---|
| G01 | 완료 | 동일한 1인 장면의 태그형·문장형·혼합형·구조형 | 지시 이행과 스타일 응집력이 개선되고 새 누락이 없음 |
| G02 | 준비 | A의 스타일 태그 + B의 관계 문장 + 공간 배치 구조 | 현대적 스타일, 실내외 구획, 배경 배치와 평균 품질을 함께 유지 |
| C01 | 탐색 완료, 무대사 분리 재검증 필요 | 기본 프롬프트 + 캐릭터 프롬프트 2개 + 좌우 위치 | 2명 모두 등장하고 외형 번짐 없이 우산 공유 관계를 표현 |
| X01 | C01과 동시 탐색 완료, 분리 재검증 필요 | 각 캐릭터 프롬프트의 한국어 대사 | 철자, 순서, 말풍선 위치와 화자 귀속이 정확함 |
| A01 | 독립 Seed 탐색 완료, 반복성 확인 대기 | 무작가·mika pikazo·neco·lack 단독 지문 | 큰 캐릭터 앵커를 보존하면서 작가별 분포 차이가 반복됨 |
| A03 | 다음 실행 | 얼굴·의상·배경에 작가 하나씩 단독 귀속 | 목표 요소만 이동하고 비목표 요소의 전역 누출이 제한됨 |
| A02·A04 | A03 뒤 대기 | 전역 혼합·독자적 지문 치환 | 조합 지문이 여러 Seed와 장면에서 반복되고 작가명 없이 재현됨 |
| Y01 | A 시리즈 동안 보류 | `year 2026`의 유무·가중치·헤더/하단 위치 | 시대감 효과와 전역 색조·밀도·마감 변화를 분리 |
| N01 | Y01 뒤 대기 | 무조건·수동 UC·스타일 캡슐 옆 인라인 음수 가중치 | 원치 않는 복고풍을 줄이면서 세련된 선화와 의미 이행을 보존 |

X01에서는 Undesired Content의 `text`를 제거하고 수동 `text:`를 사용하지 않는다.

## 평가와 결과 기록

각 항목을 0~5점으로 기록한다: 지시 이행, 스타일 개성, 목표 그림체 적합도, 스타일 응집력, 배경 통일성, 구도 안정성, 캐릭터 분리, 위치·상호작용, 텍스트 정확도, 색상 정확도, 프롬프트 관리성. 4장 이상을 비교할 때는 저점·중앙값·고점·유효 결과율도 기록한다. 해당하지 않는 항목은 `-`로 둔다.

| ID | 날짜 | Seed·설정 | 핵심 결과 | 결정 | 증거 |
|---|---|---|---|---|---|
| G01-A | 2026-08-21 | 공통 조건, 캐릭터 프롬프트 없음; Seed 미확인 | 이행 4/5, 개성 4/5, 응집력 5/5, 배경 통일성 5/5, 색상 5/5 | 채택: 시각 기준선 | 사용자 평가 2장 이상 + 대표 PNG |
| G01-B | 2026-08-21 | 공통 조건; Seed 미확인 | 이행 4.5/5, 개성 4/5, 응집력 5/5, 배경 통일성 5/5, 색상 5/5 | 수정: 관계 표현만 채택 | 사용자 평가 2장 이상 + 대표 PNG |
| G01-C | 2026-08-21 | 공통 조건; Seed 미확인 | 이행 4/5, 개성 4.5/5, 목표 적합도 5/5, 응집력 3/5, 배경 통일성 3.5/5, 색상 5/5 | 수정: 방향성 채택, 일관성 보강 | 사용자 평가 2장 이상 + 대표 PNG |
| G01-D | 2026-08-21 | 공통 조건; Seed 미확인 | 이행 3.5/5, 개성 4.5/5, 목표 적합도 4/5, 응집력 4/5, 배경 구조 2.5/5, 변동성 높음 | 수정: 고점은 높지만 유효 결과율 확인 필요 | 사용자 반복 평가 + 대표 PNG 2장 |
| C01 | 2026-08-21 | 공통 조건, 캐릭터 프롬프트 2개와 위치; Seed 미확인 | 분리·위치·상호작용·소품 5/5, 배경 위치 4.5/5, 생성 간 스타일 안정성 1.5/5 | 채택: 의미·배치, 스타일 축소 필요 | 사용자 반복 평가 + 대표 PNG 2장 |
| X01 | 2026-08-21 | C01과 대사 동시 사용; Seed 미확인 | 대표 샘플 텍스트 성공 1/2, 성공본의 철자·화자 귀속 양호, 말풍선 작음 | 수정: 크기·전체 화면 사용 보강 | 대표 PNG 2장 |
| Y00 | 2026-08-21 | `year 2026` 탐색; 정확한 분기·Seed 미확인 | 시대감 단독 효과 미확정, 생성 간 스타일 안정성 낮음, 색조·배경 밀도·마감과 하단 여백 변동 | 수정: Y01로 변수 분리 | 사용자 반복 평가 + 대표 PNG 2장 |

결정은 `채택`, `수정`, `폐기` 중 하나로 기록하고, 이유는 한 문장만 남긴다.

### G01-A 관찰

- 표의 점수는 사용자의 2장 이상 평가와 대표 이미지 분석을 합친 임시값이며 독립 Seed 반복 표본이 충분할 때 확정한다.
- 사용자 평가는 감성적인 한국 웹툰풍, 높은 세부 품질과 그림체 일관성, 낮은 프롬프트 관리성이다.
- 인물·우산·역사·자판기는 동일한 가는 선과 제한 팔레트로 통일됐고, 지정한 머리·눈·코트·목도리 색도 분리됐다.
- 자판기의 따뜻한 빛, 바람에 들리는 목도리, 해안역 단서는 약하다. 쉼표 태그가 개체와 관계를 명시하지 못한 결과인지 B에서 확인한다.
- 다음 태그 묶음을 임시 스타일 캡슐로 보존한다: `high complexity, depthness, faux traditional media, clean lineart, varied line weight, flat color, muted color, limited palette, subtle paper texture`.
- 첨부 파일은 832×1216 RGBA이지만 PNG 생성 메타데이터를 포함하지 않는다.

### G01-B 관찰

- 표의 점수는 사용자의 2장 이상 평가와 대표 이미지 분석을 합친 임시값이며 독립 Seed 반복 표본이 충분할 때 확정한다.
- 자연어는 비, 외부 강우와 내부 젖음의 구분, 바다, 목재 역사, 날리는 목도리를 A보다 명확하게 연결했다.
- 짙은 청색 환경광이 강해져 A보다 어둡고 차가우며, 제한된 코랄·아이보리 강조색은 유지됐다.
- 얼굴은 더 길고 눈·코가 작은 오래된 작법으로 이동했다. `1girl` 앵커의 부재와 `adult woman`, `handcrafted`, `dry gouache`, `paper grain`의 자연어 조합이 원인 후보다.
- 둥근 형태와 달리 선은 필압이 보이는 날카로운 볼펜형 질감으로 표현되어 손그림 느낌이 강해졌다.
- 자판기는 화면 왼쪽의 어두운 물체인데 따뜻한 림라이트는 오른쪽에서 들어온다. 자연어가 림라이트 자체는 표현했지만 광원과 대상의 정확한 귀속에는 실패했다.
- 목도리의 움직임은 크게 개선됐지만 머리카락도 함께 날려 `only her scarf`는 부분 이행에 그쳤다.
- C에서는 A의 스타일 캡슐과 `1girl, solo`를 복원하고, B의 장면·관계 문장만 결합한다.

### G01-C 관찰

- 표의 점수는 사용자의 2장 이상 평가와 대표 이미지 분석을 합친 임시값이며 독립 Seed 반복 표본이 충분할 때 확정한다.
- A의 현대적인 한국 웹툰풍과 B의 감성적 환경 연출이 결합됐고, 보라·코랄·아이보리·청색의 사용 범위도 넓어졌다.
- 우산, 머리카락, 목도리, 코트 자락의 대각선 흐름이 강화되어 A와 B보다 역동적이다.
- 비와 젖음이 실내외 전체에 평탄하게 퍼지고 바다는 사라져, B가 보여준 공간 구획과 환경 인과는 약해졌다.
- 양쪽 눈의 크기·눈매·홍채 배치가 다르고 얼굴의 섬세한 선, 의상의 단순한 선, 배경의 기하학적 선이 서로 다른 문법처럼 보인다.
- 우산살과 의상 부속의 미세 형상도 A·B보다 불안정하다. 혼합 문법이 거시적 스타일은 개선했지만 영역별 표현을 균일하게 고정하지 못한 결과인지 D에서 확인한다.
- 자판기는 왼쪽에 있는데 강한 따뜻한 림라이트는 오른쪽에서 들어와 광원 귀속 실패가 반복됐다.
- D는 기존 구조형 프롬프트를 수정하지 않고 실행해 섹션 구분 자체의 효과를 비교한다.

### G01-D 관찰

- 한국 웹툰의 색과 선 흐름에 일본 클래식 애니메이션식 얼굴·평면 채색이 섞였다. `flat cel-like color shapes`가 얼굴까지 강하게 적용된 결과 후보다.
- 두 결과 모두 중앙의 단독 인물, 왼쪽을 향한 측면·준측면, 머리 위 우산이라는 구도를 반복했다. D에는 화면 내 비대칭 위치를 지정하지 않았으므로 중앙 배치는 구조 문법의 실패보다 명세 누락에 가깝다.
- 자판기, 기둥, 대합실의 개별 묘사는 정교하지만 서로의 위치 관계가 정의되지 않아 배경 조립은 매번 달라졌다.
- 얼굴 조형, 목도리 방향, 자판기 좌우 위치, 우산살과 코트 세부는 결과 간 변동이 크다. 의상은 넓은 평면과 단순 윤곽이 우세해 A·B보다 정보량이 줄었다.
- 스타일 응집력은 A·B보다 낮고 C보다 높다. 대신 반복 생성 중 좋은 조합이 나오면 다른 문법보다 고점이 높다는 사용자 관찰이 있다.
- `STYLE_PROFILE` 이름과 `preserve` 지시는 Seed를 넘는 고정 참조가 아니다. 실제 일관성은 구체적인 스타일 속성과 결과 분포로 평가한다.
- 구조형 섹션은 의미를 정리했지만 공간 관계를 만들지는 않았다. G02에서는 전경·중경·배경, 좌우 위치, 실내외 경계, 광원 방향을 명시한다.

### G01 결론

| 문법 | 가장 강한 점 | 주요 비용 |
|---|---|---|
| A 태그형 | 평균 스타일·세부 일관성 | 관계 표현과 관리성 |
| B 문장형 | 환경 인과와 공간 분위기 | 오래된 얼굴·작법으로 이동 |
| C 혼합형 | 현대적 웹툰풍과 역동성 | 눈·영역별 선화의 불일치 |
| D 구조형 | 관리성, 개별 요소, 최고점 | 중앙 구도 편향, 배경 조립, 높은 변동성 |

### C01·X01 결합 탐색 관찰

- 두 결과 모두 여성의 인디고 머리·호박색 눈·크림 코트·코랄 목도리와 남성의 갈색 머리·녹색 눈·청록 더플코트·황갈색 가방을 분리했다.
- 여성 왼쪽, 남성 오른쪽, 공유 우산, 서로를 보는 시선, 뒤쪽 자판기와 목조 역사의 큰 배치도 안정적이다.
- 첫 결과는 세련된 성인 웹툰풍, 두 번째는 단순하고 복고적인 애니메이션풍으로 이동해 지금까지 가장 큰 생성 간 스타일 분산을 보였다.
- 첫 대표 샘플은 `우산 안으로 들어와.`와 `고마워.`를 올바른 화자 근처에 렌더링했지만 말풍선이 작다. 두 번째 샘플은 대사와 말풍선을 생략했다.
- 두 결과 모두 장면이 상단 패널처럼 압축되고 하단 약 30%가 단색 여백으로 남았다. 대사·말풍선 신호와 캐릭터 위치 중 어느 쪽이 원인인지 무대사 C01과 X01을 분리해 확인한다.
- 지붕 아래에도 비가 내려 실내외 구획은 실패했다. 다음 공간 실험에서는 인물을 처마 바깥 한 걸음에 두고, 처마 뒤의 보호 구역과 낙수 경계를 물리적 장면으로 설명한다.
- 캐릭터 프롬프트는 의미와 위치를 안정화했지만 전역 스타일 선택 범위는 좁히지 않았다.

### Y00 시대감·배치 탐색 관찰

- `year 2026`을 사용한 반복 생성에서도 얼굴, 눈매, 선화와 채색 방식의 분산이 컸다. 다른 스타일·장면 지시가 많은 조건에서는 이 태그 하나의 영향이 희석될 수 있다.
- 두 대표 결과 모두 여성 왼쪽, 남성 오른쪽, 공유 우산, 자판기라는 의미·배치는 유지했다. 시대감 태그는 캐릭터 프롬프트가 만든 배치 안정성을 훼손하지 않았다.
- 한 결과는 흰 하단 여백에 두 말풍선을 배치했고, 다른 결과는 남색 하단 여백을 남긴 채 장면 안에서 여성의 문장을 두 말풍선으로 나눴다. 텍스트 의미는 대체로 보존됐지만 페이지 구성과 말풍선 크기·분할은 불안정하다.
- 두 결과 모두 지붕 아래 강우가 남아 있어 `year`는 실내외 물리 구획 문제와 무관하다.
- 프롬프트 하단 또는 UC의 조건이 전역 시각 분포를 바꾼다는 사용자 관찰은 유력하지만, 두 PNG에는 생성 메타데이터가 없어 특정 분기와 인과적으로 연결할 수 없다.

### Y01 시대감·배치 대조군

동일한 기본·캐릭터 프롬프트를 사용하되 분기마다 독립 Seed를 사용한다. UC는 모두 비우고, 아래 한 줄의 유무와 위치만 바꾼다.

| 분기 | 변경 | 분리되는 효과 |
|---|---|---|
| Y01-0 | `year` 태그 없음 | 기준선 |
| Y01-H1 | 스타일 캡슐 바로 뒤에 `year 2026` | 태그 존재 효과 |
| Y01-H2 | 같은 위치에 `2::year 2026 ::` | 가중치 효과 |
| Y01-T2 | 기본 프롬프트 맨 끝에 `2::year 2026 ::` | 배치 효과 |

각 분기에서 최소 2장을 생성한다. 얼굴·눈·선화의 시대감 외에도 색조·필터감, 배경 밀도, 미세 마감, 하단 여백 비율, 말풍선 위치를 함께 기록한다. `3::year 2026 ::`은 H2의 효과가 부족할 때만 후속 분기로 추가한다.

### N01 스타일 축소 대조군

동일한 기본·캐릭터 프롬프트를 사용하되 분기마다 독립 Seed를 사용하고 한 번에 하나만 적용한다.

| 분기 | 변경 |
|---|---|
| N01-0 | 수동 UC와 인라인 음수 가중치 없음 |
| N01-U | 수동 UC에 `retro artstyle` 추가 |
| N01-W | 기본 프롬프트의 스타일 캡슐 바로 뒤에 `-0.8::retro artstyle::` 추가 |

첫 비교에서는 UC와 음수 가중치를 함께 사용하지 않는다. 아직 효과가 불명확한 과거 `year` 태그와 프롬프트 하단 배치도 제외한다. 복고풍 발생률, 현대적 선화 보존, 캐릭터 분리, 텍스트 성공률과 전역 색조·배경 밀도 변화를 함께 비교한다.

## G02-E 입력

목표는 A의 평균 스타일 안정성을 유지하면서 B의 환경 인과와 D의 관리성을 결합하는 것이다. 캐릭터 프롬프트와 위치 UI는 사용하지 않는다.

```text
high complexity, depthness, faux traditional media, clean lineart, varied line weight, flat color, muted color, limited palette, subtle paper texture, modern Korean webtoon style, 1girl, solo

CHARACTER:
identity: a young adult woman in her mid twenties
hair: short indigo hair
eyes: balanced amber eyes with the same upper-eyelid design
clothing: cream trench coat and coral-red scarf
held object: transparent umbrella

COMPOSITION:
canvas: portrait
framing: cowboy shot
camera: slightly low three-quarter view
face: turned three quarters toward the viewer with both eyes visible
character anchor: 42 percent from the left and 56 percent from the top

SCENE TOPOLOGY:
foreground: the woman stands beneath the station roof on a damp platform
midground right: one old illuminated vending machine stands behind the woman
background left: the open platform edge, railway tracks, and the dark sea remain visible
architecture: weathered wooden beams connect the roof, wall, bench, and platform into one plausible station structure

WEATHER BOUNDARY:
exposed zone: rain falls beyond the roof edge and remains visible against the sea
sheltered zone: calm air beneath the roof with damp footprints and shallow puddles
boundary cue: the roof edge clearly separates falling rain outside from the sheltered platform

MOTION:
wind direction: from screen left to screen right
scarf: the two scarf ends flow toward screen right in one clean arc
hair: only the tips move slightly toward screen right while the hairstyle remains readable
stable shapes: the coat and umbrella retain clear silhouettes

LIGHTING:
ambient: cool deep-navy evening light fills the station
source: the vending machine at screen right emits warm-ivory light
direction: the warm light travels from screen right toward the woman
target: a narrow warm rim appears only on the right contour of her cream coat

STYLE UNITY:
brush family: use one clean ink-brush family throughout the image
line hierarchy: medium lines for the face and clothing, thinner lines for the background
face construction: contemporary webtoon proportions with balanced eyes, a subtle nose bridge, and natural adult features
color rule: preserve deep navy, coral red, warm ivory, and indigo as the dominant palette
```

## 후속 대기열

1. [A 시리즈](./v5-full-artist-mixing.md): artist 태그 단독 재현 → 전역 혼합 → 요소별 귀속 → 스타일 지문으로 치환
2. 영어·한국어 의미 이행과 RGB·색상 설명 조합 비교
3. 동일 스타일 지문을 서로 다른 장면과 Seed에 적용
4. C01 통과 후 `2 → 4 → 8 → 16 → 22 → 32`명 순서로 실용 표현 한도 측정
