import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
    calculateFixedVirtualRange,
    FixedVirtualModuleList,
    FIXED_MODULE_ROW_HEIGHT,
    type VirtualModuleRow,
} from '@/components/asset-module-studio/FixedVirtualModuleList'
import {
    ASSET_STUDIO_TEST_LOCALES,
    LONG_MODULE_NAMES,
    makeModule,
} from './fixtures/asset-module-studio.fixture'

const source = (path: string) => readFile(resolve(process.cwd(), path), 'utf8')

describe('Asset Module Studio virtual module list', () => {
    it('renders only a bounded window for a 500-module repository', () => {
        expect(calculateFixedVirtualRange({
            itemCount: 500,
            scrollTop: 0,
            viewportHeight: 352,
        })).toEqual({ start: 0, end: 11 })

        expect(calculateFixedVirtualRange({
            itemCount: 500,
            scrollTop: 250 * FIXED_MODULE_ROW_HEIGHT,
            viewportHeight: 352,
        })).toEqual({ start: 245, end: 261 })

        expect(calculateFixedVirtualRange({
            itemCount: 500,
            scrollTop: (500 * FIXED_MODULE_ROW_HEIGHT) - 352,
            viewportHeight: 352,
        })).toEqual({ start: 489, end: 500 })
    })

    it('clamps stale or invalid scroll measurements after filtering', () => {
        expect(calculateFixedVirtualRange({
            itemCount: 7,
            scrollTop: Number.POSITIVE_INFINITY,
            viewportHeight: Number.NaN,
        })).toEqual({ start: 0, end: 6 })
        expect(calculateFixedVirtualRange({
            itemCount: 7,
            scrollTop: 999_999,
            viewportHeight: 352,
        })).toEqual({ start: 1, end: 7 })
        expect(calculateFixedVirtualRange({
            itemCount: 0,
            scrollTop: 0,
            viewportHeight: 352,
        })).toEqual({ start: 0, end: 0 })
    })

    it.each(ASSET_STUDIO_TEST_LOCALES)('preserves the complete %s long name and the same accessible contract', locale => {
        const rows: VirtualModuleRow[] = Array.from({ length: 500 }, (_, index) => ({
            module: makeModule(index, index === 0 ? LONG_MODULE_NAMES[locale] : undefined),
            issueLevel: index % 5 === 0 ? 'warning' : 'valid',
        }))
        const markup = renderToStaticMarkup(createElement(FixedVirtualModuleList, {
            rows,
            selectedId: rows[0].module.id,
            checkedIds: new Set([rows[0].module.id]),
            onSelect: () => undefined,
            onCheck: () => undefined,
            emptyLabel: 'No modules',
        }))

        expect(markup).toContain(LONG_MODULE_NAMES[locale])
        expect(markup).toContain(`aria-label="${LONG_MODULE_NAMES[locale]} select"`)
        expect(markup.match(/data-module-id=/g)).toHaveLength(11)
        expect(markup).toContain(`height:${500 * FIXED_MODULE_ROW_HEIGHT}px`)
    })
})

describe('Asset Module Studio source contracts', () => {
    it('shows unsupported Android capabilities with reasons and alternatives on the canonical surface', async () => {
        const [page, notice] = await Promise.all([
            source('src/pages/AssetModuleStudio.tsx'),
            source('src/components/platform/CapabilityBadge.tsx'),
        ])
        expect(page).toContain('<StudioCapabilityStrip />')
        expect(page).toContain('runtimeCapabilities.externalProfileFileWatch')
        expect(page).toContain('runtimeCapabilities.localTaggerSidecar')
        expect(page).toContain('runtimeCapabilities.r2DeployTooling')
        expect(notice).toContain('capability.reason')
        expect(notice).toContain('capability.alternative')
        expect(notice).toContain("data-capability-supported")
    })

    it('uses canonical typed controls and exposes validation state', async () => {
        const studio = await source('src/components/asset-module-studio/CompositionStudioV2.tsx')

        for (const control of [
            'PromptTargetSelect',
            'PromptContributionsEditor',
            'ParamsOverrideEditor',
            'CharacterPatchesEditor',
            'OutputPolicyEditor',
            'RandomRulesEditor',
        ]) {
            expect(studio).toContain(`function ${control}`)
        }
        expect(studio).toMatch(/append[\s\S]*prepend[\s\S]*replace/)
        expect(studio).toContain('orderKey')
        expect(studio).toContain("t('assetModuleStudioV2.header.validationPassed')")
        expect(studio).toContain('blockingIssues')
    })

    it('supports keyboard sorting plus explicit mobile move controls without forbidding duplicate modules', async () => {
        const studio = await source('src/components/asset-module-studio/CompositionStudioV2.tsx')

        expect(studio).toContain('useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })')
        expect(studio).toContain("t('assetModuleStudioV2.recipe.moveUp')")
        expect(studio).toContain("t('assetModuleStudioV2.recipe.moveDown')")
        expect(studio).toContain('moduleId: modules[0].id')
        expect(studio).toContain("t('assetModuleStudioV2.recipe.missingReference')")
    })

    it('keeps responsive shells shrinkable and pointer/keyboard targets accessible', async () => {
        const [studio, virtualList, globals] = await Promise.all([
            source('src/components/asset-module-studio/CompositionStudioV2.tsx'),
            source('src/components/asset-module-studio/FixedVirtualModuleList.tsx'),
            source('src/styles/globals.css'),
        ])

        expect(studio).toContain('max-w-[1600px]')
        expect(studio).toContain('minmax(0,1fr)')
        expect(studio).toContain('min-[420px]:grid-cols-3')
        expect(studio).toMatch(/sm:grid-cols|sm:p-/)
        expect(studio).toContain('xl:grid-cols')
        expect(studio).toContain('2xl:grid-cols')
        expect(studio).not.toMatch(/overflow-x-(?:auto|scroll)/)
        expect(virtualList).toContain('overflow-x-hidden')
        expect(virtualList).toContain('h-11 w-11')
        expect(virtualList).toContain('focus-visible:ring-2')
        expect(globals).toContain('@media (pointer: coarse)')
        expect(globals).toContain('min-height: var(--touch-target)')
    })
})
