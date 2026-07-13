import { readFile } from '@tauri-apps/plugin-fs'
import { getPortableStorageBaseDirectory } from './storage'
import type {
    MaterializedPortablePath,
    PortableResourceByteReader,
} from './portable-resources'

export class TauriPortableResourceByteReader implements PortableResourceByteReader {
    read(materialized: MaterializedPortablePath): Promise<Uint8Array> {
        if (materialized.kind === 'standard' && materialized.root !== undefined) {
            return readFile(materialized.relativePath, {
                baseDir: getPortableStorageBaseDirectory(materialized.root),
            })
        }
        if (!materialized.opaqueToken) {
            throw new Error('User-selected resource has no platform token')
        }
        const separator = materialized.relativePath ? '/' : ''
        return readFile(`${materialized.opaqueToken}${separator}${materialized.relativePath}`)
    }
}

export const runtimePortableResourceByteReader: PortableResourceByteReader = new TauriPortableResourceByteReader()
