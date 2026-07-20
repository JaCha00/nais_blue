import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { parse } from '@babel/parser'
import * as t from '@babel/types'
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

function moduleSpecifier(node: t.Node): string | undefined {
    if ((t.isImportDeclaration(node) || t.isExportNamedDeclaration(node) || t.isExportAllDeclaration(node)) && node.source) {
        return node.source.value
    }
    if (t.isTSImportEqualsDeclaration(node)
        && t.isTSExternalModuleReference(node.moduleReference)
        && t.isStringLiteral(node.moduleReference.expression)) {
        return node.moduleReference.expression.value
    }
    if (t.isCallExpression(node) && node.arguments.length === 1 && t.isStringLiteral(node.arguments[0])) {
        if (t.isImport(node.callee)) return node.arguments[0].value
        if (t.isIdentifier(node.callee, { name: 'require' })) return node.arguments[0].value
    }
    return undefined
}

function isNode(value: unknown): value is t.Node {
    return typeof value === 'object'
        && value !== null
        && 'type' in value
        && typeof value.type === 'string'
}

function visitChildren(node: t.Node, visit: (child: t.Node) => void): void {
    // Babel nodes expose children as node-valued properties or arrays; walking
    // that shape keeps this architecture check independent of compiler APIs.
    for (const value of Object.values(node)) {
        if (Array.isArray(value)) {
            for (const entry of value) if (isNode(entry)) visit(entry)
        } else if (isNode(value)) {
            visit(value)
        }
    }
}

describe('Composition core boundary', () => {
    it('contains no UI, state-store, platform, filesystem, database, or native image imports', () => {
        const violations: string[] = []

        for (const file of sourceFiles(CORE_ROOT)) {
            const source = readFileSync(file, 'utf8')
            const tree = parse(source, {
                sourceType: 'module',
                plugins: ['typescript', 'jsx'],
            })
            const relative = path.relative(CORE_ROOT, file).replaceAll('\\', '/')

            const visit = (node: t.Node): void => {
                const specifier = moduleSpecifier(node)
                if (specifier !== undefined) {
                    const reason = forbiddenModuleReason(specifier)
                    if (reason !== undefined) {
                        const line = node.loc?.start.line ?? 1
                        violations.push(`${relative}:${line} imports ${specifier} (${reason})`)
                    }
                }

                if (t.isIdentifier(node)
                    && ['indexedDB', 'IDBDatabase', 'showOpenFilePicker', 'showSaveFilePicker',
                        'FileSystemHandle', 'Buffer', '__dirname', '__filename'].includes(node.name)) {
                    const line = node.loc?.start.line ?? 1
                    violations.push(`${relative}:${line} references platform global ${node.name}`)
                }
                visitChildren(node, visit)
            }
            visit(tree.program)
        }

        expect(violations).toEqual([])
    })
})
