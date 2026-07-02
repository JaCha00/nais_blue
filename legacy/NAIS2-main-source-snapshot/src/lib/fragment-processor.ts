import { useFragmentStore, normalizeFragmentPath } from '@/stores/fragment-store'

/**
 * Fragment Processor (조각 프롬프트 처리기)
 * 프롬프트에서 조각 프롬프트를 랜덤 선택으로 치환
 * 
 * 지원 형식:
 * 1. 괄호 형식 (권장): (option1/option2/option3)
 *    - 각 옵션에 쉼표 포함 가능: (white hair, blue eyes/red hair, purple eyes)
 * 2. 단순 형식: red/blue/green (쉼표로 구분된 단일 태그 내에서만)
 * 3. 파일 기반: <filename> 또는 <folder/filename>
 *    - 조각 프롬프트 스토어에서 파일 내용을 가져와 랜덤 선택
 * 4. 인라인: <option1|option2|option3>
 *    - 파일 없이 인라인으로 옵션 정의
 * 5. 순차 모드: <*filename>
 *    - 랜덤이 아닌 순서대로 선택 (배치 생성용)
 */

/**
 * 파일 기반 조각 프롬프트 처리 (비동기)
 * "<hair>" → 조각 프롬프트 파일에서 랜덤 줄 선택
 * "<*hair>" → 조각 프롬프트 파일에서 순차적으로 줄 선택
 * "<red|blue|green>" → 인라인 옵션에서 랜덤 선택
 */
async function processFileWildcards(prompt: string): Promise<string> {
    // <...> 패턴 찾기 (중첩 불가)
    const filePattern = /<([^<>]+)>/g
    const matches: { match: string; content: string; index: number }[] = []

    let match
    while ((match = filePattern.exec(prompt)) !== null) {
        matches.push({
            match: match[0],
            content: match[1],
            index: match.index
        })
    }

    if (matches.length === 0) return prompt

    // 모든 매치를 비동기로 처리
    const replacements = await Promise.all(
        matches.map(async ({ match, content }) => {
            const trimmed = content.trim()

            // 1. 인라인 와일드카드: <option1|option2|option3>
            if (trimmed.includes('|')) {
                const options = trimmed.split('|').map(o => o.trim()).filter(o => o.length > 0)
                if (options.length > 0) {
                    const randomIndex = Math.floor(Math.random() * options.length)
                    return { match, replacement: options[randomIndex] }
                }
                return { match, replacement: match } // 유효하지 않으면 원본 반환
            }

            // 2. 순차 모드: <*filename>
            const isSequential = trimmed.startsWith('*')
            const path = normalizeFragmentPath(isSequential ? trimmed.slice(1) : trimmed)

            if (!path) return { match, replacement: match }

            // 조각 프롬프트 스토어에서 라인 가져오기 (비동기)
            const store = useFragmentStore.getState()
            const line = isSequential
                ? await store.getSequentialLine(path)
                : await store.getRandomLine(path)

            if (line === null) {
                // 파일을 찾을 수 없으면 원본 유지
                console.warn(`Fragment not found: ${path}`)
                return { match, replacement: match }
            }

            // 재귀적으로 중첩된 조각 프롬프트 처리
            const processedLine = await processFileWildcards(line)
            return { match, replacement: processedLine }
        })
    )

    // 역순으로 교체 (인덱스 유지를 위해)
    let result = prompt
    for (let i = replacements.length - 1; i >= 0; i--) {
        const { match, replacement } = replacements[i]
        const idx = result.lastIndexOf(match)
        if (idx !== -1) {
            result = result.slice(0, idx) + replacement + result.slice(idx + match.length)
        }
    }

    return result
}

/**
 * 괄호로 감싸진 와일드카드 처리
 * "(a, b/c, d/e, f)" → "a, b" 또는 "c, d" 또는 "e, f" 중 하나
 */
function processParenthesisWildcards(prompt: string): string {
    // 괄호 안에 슬래시가 있는 패턴 찾기
    // 중첩 괄호는 지원하지 않음
    const parenPattern = /\(([^()]+\/[^()]+)\)/g

    return prompt.replace(parenPattern, (_match, content: string) => {
        // 슬래시로 옵션 분리
        const options = content.split('/').map((o: string) => o.trim()).filter((o: string) => o.length > 0)

        if (options.length <= 1) {
            return content // 와일드카드 아님
        }

        // 랜덤 선택
        const randomIndex = Math.floor(Math.random() * options.length)
        return options[randomIndex]
    })
}

/**
 * 쉼표로 구분된 태그 내에서 단순 와일드카드 처리
 * "tag1, a/b/c, tag2" → "tag1, [선택된값], tag2"
 * 주의: 공백이 포함된 옵션은 괄호 형식 사용 필요
 */
function processSimpleWildcards(prompt: string): string {
    // 쉼표로 태그 분리
    const tags = prompt.split(',')

    const processedTags = tags.map(tag => {
        const trimmed = tag.trim()

        // 슬래시가 있고, URL이 아니며, 공백이 없는 단순 형태만 처리
        // 공백이 있으면 괄호 형식을 사용해야 함
        if (trimmed.includes('/') &&
            !trimmed.startsWith('http') &&
            !trimmed.includes('://') &&
            !trimmed.includes(' ')) {

            const options = trimmed.split('/').map(o => o.trim()).filter(o => o.length > 0)
            if (options.length > 1) {
                const randomIndex = Math.floor(Math.random() * options.length)
                return options[randomIndex]
            }
        }

        return trimmed
    })

    return processedTags.join(', ')
}

/**
 * 프롬프트에서 모든 와일드카드 처리 (비동기)
 * @param prompt 원본 프롬프트
 * @returns 와일드카드가 랜덤 선택으로 치환된 프롬프트
 * 
 * 사용 예시:
 * - (white hair, blue eyes/red hair, purple eyes) → 세트 중 하나 선택
 * - red/blue/green_hair → 단순 옵션 중 하나 선택
 * - (long hair/short hair), smile → 괄호 내 선택 + 일반 태그
 * - <hair> → 조각 프롬프트 파일에서 랜덤 선택
 * - <*hair> → 조각 프롬프트 파일에서 순차 선택
 * - <red|blue|green> → 인라인 옵션에서 랜덤 선택
 */
export async function processWildcards(prompt: string): Promise<string> {
    if (!prompt) return prompt

    let result = prompt

    // 1단계: 파일 기반 조각 프롬프트 처리 (최우선, 비동기)
    // <filename>, <*filename>, <option1|option2>
    result = await processFileWildcards(result)

    // 2단계: 괄호 형식 와일드카드 처리 (쉼표 포함 옵션 지원)
    // (white hair, blue eyes/red hair, purple eyes) → 선택된 세트
    result = processParenthesisWildcards(result)

    // 3단계: 단순 와일드카드 처리 (공백 없는 단일 태그만)
    // red/blue/green → 선택된 값
    result = processSimpleWildcards(result)

    return result
}

/**
 * 프롬프트에 와일드카드가 있는지 확인
 */
export function hasWildcards(prompt: string): boolean {
    if (!prompt) return false

    // 파일 기반 조각 프롬프트 체크 <...>
    if (/<[^<>]+>/.test(prompt)) return true

    // 괄호 형식 체크
    const parenPattern = /\([^()]+\/[^()]+\)/
    if (parenPattern.test(prompt)) return true

    // 단순 형식 체크 (쉼표로 구분된 태그 내 슬래시, 공백 없음)
    const tags = prompt.split(',')
    for (const tag of tags) {
        const trimmed = tag.trim()
        if (trimmed.includes('/') &&
            !trimmed.startsWith('http') &&
            !trimmed.includes('://') &&
            !trimmed.includes(' ')) {
            return true
        }
    }

    return false
}

/**
 * 순차 조각 프롬프트 카운터 리셋
 * @param path 특정 조각 프롬프트 경로 (없으면 전체 리셋)
 */
export function resetWildcardCounters(path?: string): void {
    useFragmentStore.getState().resetSequentialCounter(path)
}
