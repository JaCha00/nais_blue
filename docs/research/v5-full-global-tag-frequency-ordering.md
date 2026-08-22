# 전역 태그 빈도순 정렬 실험

> 상태: 메타데이터 추출·Danbooru 실조회·1차 정렬 완료 · 조회 시점: 2026-08-21 KST

## 범위와 판정 원칙

- 원본은 `E:\AI_Project_Library\assets\nais-output\NAIS_1776590047940.webp`다.
- 이 파일은 V5가 아니라 `NovelAI Diffusion V4.5 4BDE2A90` 결과다. 전역 태그를 V5에 이식하는 후속 실험과 원본 재현을 구분한다.
- 게시글 수는 NAI Blue의 `danbooru_tags.py`가 Danbooru Tags API 미러에서 실조회한 `post_count`다.
- Danbooru 현재 게시글 수는 NAI의 실제 학습 이미지 수가 아니라 공개 빈도 프록시다. `희귀 태그 우선`은 검증할 정렬 휴리스틱으로만 사용한다.
- 정식 태그 0건과 정식 태그 자체가 없는 항목은 다르다. 후자는 숫자 정렬에서 제외한다.
- 용도 블록은 유지하고 각 블록 안에서 게시글 수 오름차순으로 정렬한다. artist·품질·억제 태그를 하나의 숫자열로 뒤섞지 않는다.

조회 경로: [Danbooru Tags API](https://danbooru.donmai.us/tags.json), [Danbooru 미러 Tags API](https://hijiribe.donmai.us/tags.json)

## 생성 메타데이터

| 항목 | 값 |
|---|---|
| Model | NovelAI Diffusion V4.5 `4BDE2A90` |
| Size | 1216×832 |
| Steps | 28 |
| Guidance | 6.5 |
| CFG Rescale | 0.05 |
| Sampler | Euler (`k_euler`) |
| Noise schedule | Karras |
| Seed | 2358231231 |
| Character Prompt | 1개, 좌표 미사용, 순서 사용 |
| UC | 기본 UC와 Character UC 모두 존재하나 이번 정렬 범위에서 제외 |

### 원본 전역 Prompt

```text
0.6::artist:ebifurya::, 0.4::artist:ixy::, artist:dsmile, artist:fuzichoco, 0.8::artist:pako (pakosun) ::, 2::artist:kurono mitsuki::, artist:wanke, 1.2::airtst:chigusa minori::, 0.8::artist:freng::, 0.8::artist:pro-p::, 0.6::artist:ratatatat74, artist:yutokamizu, artist:mx2j, artist:doremi (doremi4704) ::, 3::official_art, game_cg ::, 2::dishwasher1910 ::, 0.8::artist:haguhagu_(rinjuu_circus) ::, 0.8::artist:henriiku_(ahemaru) ::, 0.6::artist:ie (raarami) ::, 1.1::artist:dino (dinoartforame) ::, 0.4::artist:ama_mitsuki::, 1.2::artist:kitou_sakeru::, rating:explicit, no text, 3::year 2024 ::, 3::year 2025 ::, solo artist, -3::artist collaboration ::, -2::multiple views ::, masterpiece, best quality, best illustration, ultra-detailed, 1.6::soft shadows ::, -3::production art ::, -3::reference sheet ::, -1::halo (blue archive) ::, -1::yellow light::, , rating:explicit, no text, 3::year 2024 ::, 3::year 2025 ::, -6::artist collaboration ::, -2::multiple views ::, masterpiece, best quality, -3::production art ::, -3::reference sheet ::, -1::halo (blue archive) ::,
```

### 원본 Character Prompt 1

```text
girl, seductive smile, huge breasts, thick thighs, wide hips, 2::high chroma blue hair, royal blue hair, lapis lazuli colored hair ::, -3::navy hair, indigo hair, light blue hair, colored inner hair, two-tone hair ::, 2::very long hair, long sidelocks, curtained bangs, hair over one eye ::, messy hair, 3::white eyes, half-closed eyes, silver choker ::, 3::oversized clothing, loose clothes, white shirt, shirt tucked in, white long blazer, long white tie, sleeves past fingers, white short shorts ::, -3::cleavage, unbuttoned shirt ::, indoors, window
```

### Character 태그 용도 분류

| 용도 | 태그 | 처리 |
|---|---|---|
| 인물 정체성 | `girl` | Character 유지 |
| 표정 | `seductive smile` | Character 유지 |
| 체형 | `huge breasts`, `thick thighs`, `wide hips` | Character 유지 |
| 목표 머리색 | `high chroma blue hair`, `royal blue hair`, `lapis lazuli colored hair` | 가중치 2 유지 |
| 제외 머리색·염색 | `navy hair`, `indigo hair`, `light blue hair`, `colored inner hair`, `two-tone hair` | 역가중치 -3 유지 |
| 머리 형태 | `very long hair`, `long sidelocks`, `curtained bangs`, `hair over one eye`, `messy hair` | 앞 네 태그의 가중치 2와 `messy hair` 무가중 유지 |
| 눈 | `white eyes`, `half-closed eyes` | 가중치 3 유지 |
| 액세서리 | `silver choker` | 눈 그룹에서 분리하되 기존 가중치 3 유지 |
| 의상 | `oversized clothing`, `loose clothes`, `white shirt`, `shirt tucked in`, `white long blazer`, `long white tie`, `sleeves past fingers`, `white short shorts` | 가중치 3 유지 |
| 의상 억제 | `cleavage`, `unbuttoned shirt` | 역가중치 -3 유지 |
| 장면·배경 | `indoors`, `window` | Character에서 제거하고 전역·장면 Prompt로 이동 |

### 용도별 정리 Character Prompt

설명용 섹션명을 새 토큰으로 넣지 않고 빈 줄만으로 용도를 구분한다. 원문의 상대 순서와 가중치를 최대한 보존했다.

```text
girl,

seductive smile,
huge breasts, thick thighs, wide hips,

2::high chroma blue hair, royal blue hair, lapis lazuli colored hair ::,
-3::navy hair, indigo hair, light blue hair, colored inner hair, two-tone hair ::,
2::very long hair, long sidelocks, curtained bangs, hair over one eye ::,
messy hair,

3::white eyes, half-closed eyes ::,
3::silver choker ::,

3::oversized clothing, loose clothes, white shirt, shirt tucked in, white long blazer, long white tie, sleeves past fingers, white short shorts ::,
-3::cleavage, unbuttoned shirt ::
```

전역·장면 Prompt로 이동할 태그:

```text
indoors, window
```

## UC 용도별 정리

### 원본 기본 UC

```text
yellow light, purple, green, cyan, cat ears, animal ears, no nipples, pubic hair, mosaic censoring, bar censor, artistic error, jpeg artifacts, logo, text, watermark, too many watermarks, blank page, reference, username, signature, artist:xinzoruo, artist:milkpanda, artist collaboration, variant set, large variant set, 4koma, 2koma, toon (style), oekaki, chibi, turnaround, film grain, monochrome, dithering, halftone, screentones, dated, old, 1990s (style), mutation, deformed, distorted, disfigured, distorted anatomy, anatomical structure error, asymmetrical face, bad eyes, cloudy eyes, blank eyes, pointy ears, bad proportions, bad limb, bad hands, extra hands, bad hand structure, extra digits, fewer digits, bad legs, extra legs, amputee, distorted composition, bad perspective, multiple views, negative space, animation error, chromatic aberration, disorganized colors, scan artifacts, vertical lines, vertical banding, worst quality, bad quality, lowres, upscaled, fewer details, unfinished, incomplete, amateur, cheesy, unsatisfactory, inadequate, deficient, subpar, poor, displeasing, very displeasing, bad illustration, bad portrait, lipstick, loli, child, warm, blue archive, genshin, hololive, multiple boys, gangbang, group sex, threesome, mmf threesome, ffm threesome, double handjob, spitroast, cooperative fellatio, lips
```

### 기본 UC 용도 구조

| 블록 | 용도 | 대표 태그 |
|---:|---|---|
| 1 | 색·조명 억제 | `yellow light`, `warm`, `purple`, `green`, `cyan` |
| 2 | 원치 않는 인물 속성 | 동물귀, 뾰족귀, 연령·입술 표현 |
| 3 | 신체·노출 세부 억제 | `no nipples`, `pubic hair` |
| 4 | 검열·텍스트·서명 억제 | 검열선, 로고, 텍스트, 워터마크, 사용자명, 서명 |
| 5 | 페이지·구도·변형 세트 억제 | 빈 페이지, reference, variant, 다중 컷·뷰, turnaround |
| 6 | 작가·화풍·시대·인쇄 질감 억제 | 작가 2명, toon, oekaki, chibi, 1990s, 망점·스크린톤 |
| 7 | 해부·얼굴·사지 오류 억제 | 변형, 비대칭 얼굴, 눈·손·다리·손가락 오류 |
| 8 | 렌더링·파일 결함 억제 | JPEG, animation error, 색수차, 스캔·밴딩 |
| 9 | 저품질·미완성 억제 | worst/bad quality, lowres, unfinished와 평가형 동의어 |
| 10 | 특정 IP 억제 | Blue Archive, Genshin, Hololive |
| 11 | 다인·성적 행위 억제 | multiple boys와 집단·다인 행위 태그 |

### 용도별 정리 기본 UC

설명용 섹션명은 실제 UC에 넣지 않고 빈 줄만으로 블록을 구분한다. 태그는 삭제하지 않았다.

```text
yellow light, warm, purple, green, cyan, disorganized colors,

cat ears, animal ears, pointy ears, lipstick, lips, loli, child,
no nipples, pubic hair,

mosaic censoring, bar censor, logo, text, watermark, too many watermarks, username, signature,

blank page, reference, artist collaboration, variant set, large variant set, 4koma, 2koma, turnaround, distorted composition, bad perspective, multiple views, negative space,

artist:xinzoruo, artist:milkpanda, toon (style), oekaki, chibi, film grain, monochrome, dithering, halftone, screentones, dated, old, 1990s (style),

mutation, deformed, distorted, disfigured, distorted anatomy, anatomical structure error, asymmetrical face, bad eyes, cloudy eyes, blank eyes, bad proportions, bad limb, bad hands, extra hands, bad hand structure, extra digits, fewer digits, bad legs, extra legs, amputee,

artistic error, jpeg artifacts, animation error, chromatic aberration, scan artifacts, vertical lines, vertical banding,

worst quality, bad quality, lowres, upscaled, fewer details, unfinished, incomplete, amateur, cheesy, unsatisfactory, inadequate, deficient, subpar, poor, displeasing, very displeasing, bad illustration, bad portrait,

blue archive, genshin, hololive,

multiple boys, gangbang, group sex, threesome, mmf threesome, ffm threesome, double handjob, spitroast, cooperative fellatio
```

### Character UC

원본은 `cyan hair, purple hair, hair intakes, hair flaps`다. 머리색과 머리 형태 억제를 분리한다.

```text
cyan hair, purple hair,

hair intakes, hair flaps
```

### 충돌 가능성이 있는 UC

- 전역 `cyan`은 Character UC의 `cyan hair`보다 범위가 넓어 파란 머리의 밝은 청록 반사광이나 배경색까지 약화할 수 있다.
- `warm`은 따뜻한 피부색과 광원까지 전역으로 억제할 수 있다.
- `lips`는 `seductive smile`의 입 모양과 입술 세부를 함께 약화할 수 있다.
- `artist collaboration`과 `multiple views`는 Positive Prompt의 역가중치에도 있어 중복 억제다.
- `text`는 Positive Prompt의 `no text`와 같은 목표를 양쪽에서 반복한다.

이번 단계에서는 정렬만 수행하고 위 항목을 제거하지 않는다. 필요하면 UC 원본과 정리본을 먼저 비교한 뒤 `전역 cyan → Character UC의 cyan hair만 유지` 같은 축소 실험을 별도 수행한다.

## Artist 태그 실조회 결과

동률은 원문 상대 순서를 유지했다. 표의 NAI 표기는 정렬 후보에서 사용할 태그이며, 조회는 Danbooru 정식 slug로 수행했다.

| 순서 | NAI 표기 | 가중치 | Danbooru 정식 태그 | 게시글 수 |
|---:|---|---:|---|---:|
| 1 | `artist:pro-p` | 0.8 | `pro-p` | 142 |
| 2 | `artist:wanke` | 1.0 | `wanke` | 178 |
| 3 | `artist:kitou_sakeru` | 1.2 | `kitou_sakeru` | 178 |
| 4 | `artist:yutokamizu` | 0.6 | `yutokamizu` | 243 |
| 5 | `artist:kurono mitsuki` | 2.0 | `kurono_mitsuki` | 316 |
| 6 | `artist:ie (raarami)` | 0.6 | `ie_(raarami)` | 392 |
| 7 | `artist:henriiku_(ahemaru)` | 0.8 | `henriiku_(ahemaru)` | 445 |
| 8 | `artist:ratatatat74` | 0.6 | `ratatatat74` | 563 |
| 9 | `artist:dino (dinoartforame)` | 1.1 | `dino_(dinoartforame)` | 629 |
| 10 | `artist:dsmile` | 1.0 | `dsmile` | 638 |
| 11 | `artist:haguhagu_(rinjuu_circus)` | 0.8 | `haguhagu_(rinjuu_circus)` | 648 |
| 12 | `artist:freng` | 0.8 | `freng` | 670 |
| 13 | `artist:mx2j` | 0.6 | `mx2j` | 819 |
| 14 | `artist:doremi (doremi4704)` | 0.6 | `doremi_(doremi4704)` | 833 |
| 15 | `artist:pako (pakosun)` | 0.8 | `pako_(pakosun)` | 921 |
| 16 | `artist:fuzichoco` | 1.0 | `fuzichoco` | 1,161 |
| 17 | `artist:ama_mitsuki` | 0.4 | `ama_mitsuki` | 1,348 |
| 18 | `artist:dishwasher1910` | 2.0 | `dishwasher1910` | 1,750 |
| 19 | `artist:chigusa minori` | 1.2 | `chigusa_minori` | 2,029 |
| 20 | `artist:ixy` | 0.4 | `ixy` | 3,022 |
| 21 | `artist:ebifurya` | 0.6 | `ebifurya` | 6,616 |

원문의 `airtst:chigusa minori`는 오타라서 작가 토큰으로 작동하지 않을 수 있다. `dishwasher1910`은 Danbooru artist 카테고리로 확인됐으므로 정렬 후보에서는 `artist:` 접두사를 복원한다. 원문의 0.6 가중치 묶음 네 개는 개별 정렬을 위해 같은 가중치의 독립 태그로 분해한다.

## 비작가 태그 용도별 실조회

| 용도 | 원문 표기 | 정식 태그 | 게시글 수 | 판정 |
|---|---|---|---:|---|
| 출처·매체 | `game_cg` | `game_cg` | 0 | 정식 meta 태그 |
| 출처·매체 | `official_art` | `official_art` | 532,919 | 정식 meta 태그 |
| 품질·마감 | `masterpiece` | `masterpiece` | 0 | 정식이지만 deprecated |
| 품질·마감 | `best quality` | `best_quality` | 0 | 정식 태그 |
| 품질·마감 | `ultra-detailed` | `ultra-detailed` | 0 | 정식 태그 |
| 품질·마감 | `best illustration` | 없음 | 비교 불가 | 정식 태그 없음 |
| 품질·마감 | `soft shadows` | 없음 | 비교 불가 | 정확히 일치하는 태그 없음; `soft_shadow`는 0건 |
| 전역 제어 | `no text` | `no_text` | 0 | 정식 general 태그 |
| 색 억제 | `yellow light` | `yellow_light` | 161 | 정식 general 태그 |
| 형식 억제 | `production art` | `production_art` | 2,772 | 정식 meta 태그 |
| 작가 수 억제 | `artist collaboration` | `artist_collaboration` | 10,556 | 정식 meta 태그 |
| 형식 억제 | `reference sheet` | `reference_sheet` | 22,225 | 정식 general 태그 |
| 구도 억제 | `multiple views` | `multiple_views` | 267,238 | 정식 general 태그 |
| 콘텐츠 등급 | `rating:explicit` | 태그 아님 | 비교 불가 | Danbooru 검색 metatag·NAI 제어 토큰 |
| 시대 | `year 2024`, `year 2025` | 없음 | 비교 불가 | NAI 학습·시대 토큰 |
| 작가 수 | `solo artist` | 없음 | 비교 불가 | 정식 태그 없음 |
| 작품 억제 | `halo (blue archive)` | 없음 | 비교 불가 | 정확히 일치하는 현행 태그 없음 |

정식 태그 없음은 게시글 0건으로 취급하지 않는다. Danbooru 빈도만으로 해당 NAI 토큰의 효력을 판단할 수 없다.

## F01 비교용 정규화

두 분기 모두 중복 후반 블록을 한 번만 남기고, `airtst` 오타와 `dishwasher1910` 접두사를 수정하며, 기존 V5 연구 규칙에 맞춰 `-6`을 `-3`으로 제한한다. 이 정규화는 두 분기에 똑같이 적용해 비교 변수에서 제외한다.

### F01-O: 정규화된 원래 artist 순서

```text
0.6::artist:ebifurya ::,
0.4::artist:ixy ::,
artist:dsmile,
artist:fuzichoco,
0.8::artist:pako (pakosun) ::,
2::artist:kurono mitsuki ::,
artist:wanke,
1.2::artist:chigusa minori ::,
0.8::artist:freng ::,
0.8::artist:pro-p ::,
0.6::artist:ratatatat74 ::,
0.6::artist:yutokamizu ::,
0.6::artist:mx2j ::,
0.6::artist:doremi (doremi4704) ::,
2::artist:dishwasher1910 ::,
0.8::artist:haguhagu_(rinjuu_circus) ::,
0.8::artist:henriiku_(ahemaru) ::,
0.6::artist:ie (raarami) ::,
1.1::artist:dino (dinoartforame) ::,
0.4::artist:ama_mitsuki ::,
1.2::artist:kitou_sakeru ::
```

### F01-F: 게시글 수 오름차순 artist 순서

첫 블록은 artist, 둘째는 출처·매체, 셋째는 품질·마감, 넷째는 NAI 전용 전역 제어, 다섯째는 억제 태그다. 실제 입력에는 설명용 헤더를 넣지 않는다. F01-O에도 첫 artist 블록만 위의 원래 순서로 교체하고 나머지 블록은 동일하게 붙인다.

```text
0.8::artist:pro-p ::,
artist:wanke,
1.2::artist:kitou_sakeru ::,
0.6::artist:yutokamizu ::,
2::artist:kurono mitsuki ::,
0.6::artist:ie (raarami) ::,
0.8::artist:henriiku_(ahemaru) ::,
0.6::artist:ratatatat74 ::,
1.1::artist:dino (dinoartforame) ::,
artist:dsmile,
0.8::artist:haguhagu_(rinjuu_circus) ::,
0.8::artist:freng ::,
0.6::artist:mx2j ::,
0.6::artist:doremi (doremi4704) ::,
0.8::artist:pako (pakosun) ::,
artist:fuzichoco,
0.4::artist:ama_mitsuki ::,
2::artist:dishwasher1910 ::,
1.2::artist:chigusa minori ::,
0.4::artist:ixy ::,
0.6::artist:ebifurya ::,

3::game_cg ::,
3::official_art ::,

masterpiece,
best quality,
ultra-detailed,
best illustration,
1.6::soft shadows ::,

no text,
rating:explicit,
3::year 2024 ::,
3::year 2025 ::,
solo artist,

-1::yellow light ::,
-3::production art ::,
-3::artist collaboration ::,
-3::reference sheet ::,
-2::multiple views ::,
-1::halo (blue archive) ::
```

## 다음 판정

1. 정규화된 원래 순서 F01-O와 빈도 오름차순 F01-F를 각각 독립 Seed 최소 2장으로 비교한다.
2. 두 분기의 artist 태그 집합·가중치, Character Prompt, UC와 나머지 생성값은 바꾸지 않는다. V4.5 원본 재현과 V5 이식은 서로 다른 실험 ID로 기록한다.
3. 얼굴·전체 작법, 의상·소품, 배경·마감에서 어떤 작가 지문이 이동했는지 기록한다.
4. 게시글 수가 적은 작가가 위로 이동했을 때 실제 영향이 커지는지와, 게시글 수가 많은 후순위 작가가 여전히 전역을 지배하는지를 분리한다.
5. F01은 정렬 효과만 판정한다. 중복 제거, 오타 수정과 가중치 제한 자체의 효과는 필요할 때 별도 분기로 대조한다.
