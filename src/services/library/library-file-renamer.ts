import { nativePathExists, renameNativePath } from '@/platform/native-file-system'
import {
    renderFilenameTemplate,
    resolveCollisionFileName,
    splitFileName,
    toSidecarPath,
} from '@/services/output/filename-policy'

export interface LibraryRenameItem {
    readonly id: string
    readonly name: string
    readonly path: string
    readonly sidecarPath?: string | null
    readonly isStack?: boolean
}

export interface LibraryRenameResult {
    readonly id: string
    readonly name: string
    readonly path: string
    readonly sidecarPath?: string | null
}

const IMAGE_EXTENSION = /\.(?:png|webp|jpe?g)$/iu

function fileNameFromPath(path: string): string {
    return path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1)
}

function replaceFileName(path: string, fileName: string): string {
    const separatorIndex = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
    return separatorIndex < 0 ? fileName : `${path.slice(0, separatorIndex + 1)}${fileName}`
}

function pathKey(path: string): string {
    return path.replace(/\\/gu, '/').toLocaleLowerCase('en-US')
}

function sourceStem(item: LibraryRenameItem): string {
    const displayName = item.name.trim().replace(IMAGE_EXTENSION, '')
    if (displayName) return displayName
    return splitFileName(fileNameFromPath(item.path)).stem || 'image'
}

export function renderLibraryRenameStem(
    template: string,
    item: LibraryRenameItem,
    index: number,
    total: number,
): string {
    const fallback = sourceStem(item)
    return renderFilenameTemplate({
        template,
        fallback,
        context: {
            name: fallback,
            index: index + 1,
            total,
        },
    }).replace(IMAGE_EXTENSION, '')
}

interface PlannedRename extends LibraryRenameResult {
    readonly sourcePath: string
    readonly sourceSidecarPath: string | null
}

async function planLibraryRenames(
    items: readonly LibraryRenameItem[],
    template: string,
    dependencies: {
        exists(path: string): Promise<boolean>
    },
): Promise<PlannedRename[]> {
    const reserved = new Set<string>()
    const plans: PlannedRename[] = []

    for (let index = 0; index < items.length; index += 1) {
        const item = items[index]
        const requestedStem = renderLibraryRenameStem(template, item, index, items.length)
        if (item.isStack || item.path.startsWith('data:') || item.path.startsWith('memory:')) {
            plans.push({
                id: item.id,
                name: requestedStem,
                path: item.path,
                sidecarPath: item.sidecarPath,
                sourcePath: item.path,
                sourceSidecarPath: null,
            })
            continue
        }

        const sourceFileName = fileNameFromPath(item.path)
        const extension = splitFileName(sourceFileName).extension
        const requestedFileName = `${requestedStem}${extension}`
        const sourcePathKey = pathKey(item.path)
        const sourceSidecarPath = item.sidecarPath && await dependencies.exists(item.sidecarPath)
            ? item.sidecarPath
            : null
        const sourceSidecarKey = sourceSidecarPath === null ? null : pathKey(sourceSidecarPath)
        const fileName = await resolveCollisionFileName(requestedFileName, 'unique', async candidate => {
            const candidatePath = replaceFileName(item.path, candidate)
            const candidateKey = pathKey(candidatePath)
            if (candidateKey !== sourcePathKey && (reserved.has(candidateKey) || await dependencies.exists(candidatePath))) {
                return true
            }
            if (sourceSidecarPath === null) return false
            const candidateSidecarPath = toSidecarPath(candidatePath)
            const candidateSidecarKey = pathKey(candidateSidecarPath)
            return candidateSidecarKey !== sourceSidecarKey
                && (reserved.has(candidateSidecarKey) || await dependencies.exists(candidateSidecarPath))
        })
        const targetPath = replaceFileName(item.path, fileName)
        const targetSidecarPath = sourceSidecarPath === null ? item.sidecarPath : toSidecarPath(targetPath)
        reserved.add(pathKey(targetPath))
        if (targetSidecarPath) reserved.add(pathKey(targetSidecarPath))
        plans.push({
            id: item.id,
            name: splitFileName(fileName).stem,
            path: targetPath,
            sidecarPath: targetSidecarPath,
            sourcePath: item.path,
            sourceSidecarPath,
        })
    }

    return plans
}

/** Renames native image and sidecar files before callers update persisted Library paths. */
export async function renameLibraryFiles(
    items: readonly LibraryRenameItem[],
    template: string,
    dependencies: {
        exists(path: string): Promise<boolean>
        rename(source: string, destination: string): Promise<void>
    } = {
        exists: nativePathExists,
        rename: renameNativePath,
    },
): Promise<LibraryRenameResult[]> {
    const plans = await planLibraryRenames(items, template, dependencies)
    const completedMoves: Array<readonly [string, string]> = []

    try {
        for (const plan of plans) {
            if (plan.sourcePath !== plan.path) {
                await dependencies.rename(plan.sourcePath, plan.path)
                completedMoves.push([plan.sourcePath, plan.path])
            }
            if (plan.sourceSidecarPath !== null && plan.sourceSidecarPath !== plan.sidecarPath) {
                await dependencies.rename(plan.sourceSidecarPath, plan.sidecarPath as string)
                completedMoves.push([plan.sourceSidecarPath, plan.sidecarPath as string])
            }
        }
    } catch (error) {
        const rollbackFailures: string[] = []
        for (const [source, destination] of completedMoves.reverse()) {
            try {
                await dependencies.rename(destination, source)
            } catch {
                rollbackFailures.push(destination)
            }
        }
        const rollbackNote = rollbackFailures.length === 0
            ? ''
            : ` 되돌리지 못한 파일: ${rollbackFailures.join(', ')}`
        const causeNote = error instanceof Error ? ` ${error.message}` : ''
        throw new Error(`이미지 파일 이름을 변경하지 못했습니다.${causeNote}${rollbackNote}`)
    }

    return plans.map(({ sourcePath: _sourcePath, sourceSidecarPath: _sourceSidecarPath, ...result }) => result)
}
