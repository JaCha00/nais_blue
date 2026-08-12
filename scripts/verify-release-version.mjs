import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
    resolveAndroidUpdateBaselineVersionCode,
    resolveAndroidVersionCode,
} from './android-update-baseline.mjs'

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const root = resolve(scriptDirectory, '..')
const read = path => readFileSync(join(root, path), 'utf8')
const readJson = path => JSON.parse(read(path))

function option(name) {
    const index = process.argv.indexOf(name)
    if (index >= 0) {
        const value = process.argv[index + 1]
        if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`)
        return value
    }
    const inline = process.argv.find(argument => argument.startsWith(`${name}=`))
    return inline?.slice(name.length + 1)
}

function cargoPackageVersion(source) {
    const packageSection = source.match(
        /(?:^|\r?\n)\[package\]\r?\n([\s\S]*?)(?=\r?\n\[|$)/,
    )?.[1]
    const version = packageSection?.match(/^\s*version\s*=\s*"([^"]+)"/m)?.[1]
    if (!version) throw new Error('Could not read the package version from src-tauri/Cargo.toml')
    return version
}

function cargoLockPackageVersion(source, name) {
    const block = source
        .split(/\r?\n(?=\[\[package\]\])/)
        .find(candidate => new RegExp(`^name = "${name}"$`, 'm').test(candidate))
    const version = block?.match(/^version = "([^"]+)"$/m)?.[1]
    if (!version) throw new Error(`Could not read ${name} from src-tauri/Cargo.lock`)
    return version
}

function stableSemver(value, label) {
    const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(value)
    if (!match) throw new Error(`${label} must be a stable major.minor.patch version: ${value}`)
    const parts = match.slice(1).map(Number)
    if (parts[1] >= 1_000 || parts[2] >= 1_000) {
        throw new Error(`${label} minor and patch components must be lower than 1000`)
    }
    return parts
}

const packageJson = readJson('package.json')
const packageLock = readJson('package-lock.json')
const tauriConfig = readJson('src-tauri/tauri.conf.json')
const policy = readJson('android-release-policy.json')
const nativeUpdater = read('src/platform/native-update.ts')
const desktopWorkflow = read('.github/workflows/build.yml')
const versions = new Map([
    ['package.json', packageJson.version],
    ['package-lock.json', packageLock.version],
    ['package-lock.json root package', packageLock.packages?.['']?.version],
    ['src-tauri/tauri.conf.json', tauriConfig.version],
    ['src-tauri/Cargo.toml', cargoPackageVersion(read('src-tauri/Cargo.toml'))],
    [
        'src-tauri/Cargo.lock',
        cargoLockPackageVersion(read('src-tauri/Cargo.lock'), packageJson.name),
    ],
])

for (const [source, version] of versions) {
    if (version !== packageJson.version) {
        throw new Error(`${source} version ${version ?? '<missing>'} does not match ${packageJson.version}`)
    }
}

stableSemver(packageJson.version, 'Release version')
if (packageJson.name !== 'nai-blue' || tauriConfig.productName !== 'NAI Blue') {
    throw new Error('Package and Tauri product names must use the NAI Blue release identity')
}
if (tauriConfig.identifier !== 'com.bluhair.naisblue') {
    throw new Error('The stable application identifier must not change during the version-label reset')
}
if (!nativeUpdater.includes('allowDowngrades: true')) {
    throw new Error('The reset display version requires the explicit compatible updater check')
}
if (!desktopWorkflow.includes('updaterJsonPreferNsis: true')) {
    throw new Error('Windows updater metadata must prefer the NSIS upgrade path')
}
const versionCode = resolveAndroidVersionCode(policy, packageJson.version)
const baselineVersionCode = resolveAndroidUpdateBaselineVersionCode(policy, packageJson.version)
if (baselineVersionCode !== null && versionCode <= baselineVersionCode) {
    throw new Error(
        `Android versionCode ${versionCode} must be newer than update baseline ${baselineVersionCode}`,
    )
}

const tag = option('--tag')
if (tag && tag !== `v${packageJson.version}`) {
    throw new Error(`Tag ${tag} does not match release version v${packageJson.version}`)
}

console.log(
    `Release version contract passed: ${packageJson.version} (Android versionCode ${versionCode}${
        tag ? `, tag ${tag}` : ''
    })`,
)
