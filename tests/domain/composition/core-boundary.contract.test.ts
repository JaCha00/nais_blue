import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import * as ts from 'typescript'
import { describe, expect, it } from 'vitest'

const CORE_ROOT = path.resolve(process.cwd(), 'src/domain/composition')

function sourceFiles(directory: string): string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
        const absolute = path.join(directory, entry.name)
        if (entry.isDirectory()) return sourceFiles(absolute)
        return entry.isFile() && /\.tsx?$/.test(entry.name) ? [absolute] : []
    })
}

function forbiddenModuleReason(specifier: string): string | undefined {
    const normalized = specifier.toLowerCase()
    if (normalized === 'react' || normalized.startsWith('react/')) return 'React'
    if (normalized === 'zustand' || normalized.startsWith('zustand/')) return 'Zustand'
    if (normalized.startsWith('@tauri-apps/')) return 'Tauri API/plugin'
    if (normalized === 'electron' || normalized.startsWith('electron/')) return 'Electron'
    if (normalized === 'sharp' || normalized.startsWith('sharp/')) return 'Sharp'
    if (/sqlite|better-sqlite3/.test(normalized)) return 'SQLite'
    if (/indexeddb|(^|[/_-])idb($|[/_-])|dexie|localforage/.test(normalized)) return 'IndexedDB'
    if (normalized.startsWith('node:')) return 'Node'
    if (/^(fs|fs\/promises|path|os|url|util|stream|buffer|crypto|child_process|worker_threads)$/.test(normalized)) {
        return 'Node'
    }
    if (/(^|[/_-])(filesystem|file-system)([/_-]|$)/.test(normalized)) return 'filesystem API'
    return undefined
}

function moduleSpecifier(node: ts.Node): string | undefined {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
        return ts.isStringLiteral(node.moduleSpecifier) ? node.moduleSpecifier.text : undefined
    }
    if (ts.isImportEqualsDeclaration(node)
        && ts.isExternalModuleReference(node.moduleReference)
        && node.moduleReference.expression
        && ts.isStringLiteral(node.moduleReference.expression)) {
        return node.moduleReference.expression.text
    }
    if (ts.isCallExpression(node) && node.arguments.length === 1 && ts.isStringLiteral(node.arguments[0])) {
        if (node.expression.kind === ts.SyntaxKind.ImportKeyword) return node.arguments[0].text
        if (ts.isIdentifier(node.expression) && node.expression.text === 'require') return node.arguments[0].text
    }
    return undefined
}

describe('Composition core boundary', () => {
    it('contains no UI, state-store, platform, filesystem, database, or native image imports', () => {
        const violations: string[] = []

        for (const file of sourceFiles(CORE_ROOT)) {
            const source = readFileSync(file, 'utf8')
            const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)
            const relative = path.relative(CORE_ROOT, file).replaceAll('\\', '/')

            const visit = (node: ts.Node): void => {
                const specifier = moduleSpecifier(node)
                if (specifier !== undefined) {
                    const reason = forbiddenModuleReason(specifier)
                    if (reason !== undefined) {
                        const line = tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1
                        violations.push(`${relative}:${line} imports ${specifier} (${reason})`)
                    }
                }

                if (ts.isIdentifier(node)
                    && ['indexedDB', 'IDBDatabase', 'showOpenFilePicker', 'showSaveFilePicker',
                        'FileSystemHandle', 'Buffer', '__dirname', '__filename'].includes(node.text)) {
                    const line = tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1
                    violations.push(`${relative}:${line} references platform global ${node.text}`)
                }
                ts.forEachChild(node, visit)
            }
            visit(tree)
        }

        expect(violations).toEqual([])
    })
})
