import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

function option(name) {
    const index = process.argv.indexOf(name)
    return index >= 0 ? process.argv[index + 1] : undefined
}

function hasFlag(name) {
    return process.argv.includes(name)
}

function run(command, args, { allowFailure = false, encoding = 'utf8' } = {}) {
    const result = spawnSync(command, args, {
        encoding,
        windowsHide: true,
        maxBuffer: 32 * 1024 * 1024,
    })
    if (result.error) throw result.error
    const stdout = typeof result.stdout === 'string' ? result.stdout : ''
    const stderr = typeof result.stderr === 'string' ? result.stderr : ''
    if (!allowFailure && result.status !== 0) {
        throw new Error(
            `${basename(command)} failed with exit code ${result.status}\n${stdout}${stderr}`.trim(),
        )
    }
    return { status: result.status, stdout, stderr }
}

function numericVersion(value) {
    return value.split(/[.-]/).map(part => Number.parseInt(part, 10) || 0)
}

function compareVersions(left, right) {
    const a = numericVersion(left)
    const b = numericVersion(right)
    for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
        const difference = (a[index] ?? 0) - (b[index] ?? 0)
        if (difference !== 0) return difference
    }
    return 0
}

function findAndroidSdk() {
    const candidates = [
        process.env.ANDROID_HOME,
        process.env.ANDROID_SDK_ROOT,
        process.platform === 'win32' && process.env.LOCALAPPDATA
            ? join(process.env.LOCALAPPDATA, 'Android', 'Sdk')
            : undefined,
        process.platform === 'darwin'
            ? join(homedir(), 'Library', 'Android', 'sdk')
            : join(homedir(), 'Android', 'Sdk'),
    ].filter(Boolean)
    const sdk = candidates.find(candidate => existsSync(join(candidate, 'build-tools')))
    if (!sdk) throw new Error('Android SDK build-tools were not found')
    return sdk
}

function findBuildTools(androidSdk) {
    const root = join(androidSdk, 'build-tools')
    const versions = readdirSync(root, { withFileTypes: true })
        .filter(entry => entry.isDirectory())
        .map(entry => entry.name)
        .sort(compareVersions)
        .reverse()
    for (const version of versions) {
        const directory = join(root, version)
        if (
            existsSync(join(directory, 'lib', 'apksigner.jar')) &&
            existsSync(join(directory, process.platform === 'win32' ? 'aapt2.exe' : 'aapt2')) &&
            existsSync(join(directory, process.platform === 'win32' ? 'zipalign.exe' : 'zipalign'))
        ) {
            return directory
        }
    }
    throw new Error('No complete Android SDK build-tools installation was found')
}

function collectApks(directory) {
    if (!existsSync(directory)) return []
    return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
        const path = join(directory, entry.name)
        return entry.isDirectory() ? collectApks(path) : entry.name.endsWith('.apk') ? [path] : []
    })
}

function discoverApk(projectRoot, mode) {
    const outputRoot = join(
        projectRoot,
        'src-tauri',
        'gen',
        'android',
        'app',
        'build',
        'outputs',
        'apk',
    )
    const candidates = collectApks(outputRoot).filter(path =>
        mode === 'release' ? /release/i.test(path) : /debug/i.test(path),
    )
    const universal = candidates.filter(
        path => /universal/i.test(path) && (mode !== 'release' || !/-unsigned\.apk$/i.test(path)),
    )
    const splitDebug = candidates.filter(path => mode === 'debug' && /x86_64/i.test(path))
    const matches = universal.length > 0 ? universal : splitDebug.length > 0 ? splitDebug : candidates
    if (matches.length !== 1) {
        throw new Error(
            `Expected exactly one ${mode} APK; pass --apk explicitly (found ${matches.length})`,
        )
    }
    return matches[0]
}

function expectedVersionCode(version) {
    const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(version)
    if (!match) throw new Error(`Unsupported release version for Android versionCode: ${version}`)
    return Number(match[1]) * 1_000_000 + Number(match[2]) * 1_000 + Number(match[3])
}

function cargoPackageVersion(cargoToml) {
    const packageSection = cargoToml.match(
        /(?:^|\r?\n)\[package\]\r?\n([\s\S]*?)(?=\r?\n\[|$)/,
    )?.[1]
    const version = packageSection?.match(/^\s*version\s*=\s*"([^"]+)"/m)?.[1]
    if (!version) throw new Error('Could not read the package version from src-tauri/Cargo.toml')
    return version
}

function parseBadging(output) {
    const packageLine = output.match(
        /^package:\s+name='([^']+)'\s+versionCode='([^']+)'\s+versionName='([^']+)'/m,
    )
    const minSdk = output.match(/^(?:sdkVersion|minSdkVersion):'(\d+)'/m)
    const targetSdk = output.match(/^targetSdkVersion:'(\d+)'/m)
    const nativeCode = output.match(/^native-code:\s*(.*)$/m)
    const launchableActivity = output.match(/^launchable-activity:\s+name='([^']+)'/m)
    if (!packageLine || !minSdk || !targetSdk || !nativeCode || !launchableActivity) {
        throw new Error('APK badging is missing package, SDK, ABI, or launch activity metadata')
    }
    return {
        applicationId: packageLine[1],
        versionCode: Number(packageLine[2]),
        versionName: packageLine[3],
        minSdkVersion: Number(minSdk[1]),
        targetSdkVersion: Number(targetSdk[1]),
        abis: [...nativeCode[1].matchAll(/'([^']+)'/g)].map(match => match[1]),
        launchableActivity: launchableActivity[1],
    }
}

function normalizeFingerprint(value) {
    return value.replaceAll(':', '').toUpperCase()
}

function findAdb(androidSdk) {
    const adb = join(androidSdk, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb')
    if (!existsSync(adb)) throw new Error(`adb was not found: ${adb}`)
    return adb
}

function selectDevice(adb) {
    const requested = option('--device')
    const devices = run(adb, ['devices']).stdout
        .split(/\r?\n/)
        .slice(1)
        .map(line => line.trim().split(/\s+/))
        .filter(parts => parts.length >= 2 && parts[1] === 'device')
        .map(parts => parts[0])
    if (requested) {
        if (!devices.includes(requested)) throw new Error(`Requested adb device is not ready: ${requested}`)
        return requested
    }
    if (devices.length !== 1) {
        throw new Error(`Expected exactly one ready adb device; found ${devices.length}`)
    }
    return devices[0]
}

function installAndLaunch({ adb, apkPath, applicationId, launchableActivity }) {
    const serial = selectDevice(adb)
    const adbArgs = (...args) => ['-s', serial, ...args]
    const install = run(adb, adbArgs('install', '-r', apkPath), { allowFailure: true })
    if (install.status !== 0 || !/\bSuccess\b/.test(`${install.stdout}${install.stderr}`)) {
        throw new Error(`adb install failed\n${install.stdout}${install.stderr}`.trim())
    }

    run(adb, adbArgs('logcat', '-c'))
    run(adb, adbArgs('shell', 'am', 'force-stop', applicationId))
    const component = `${applicationId}/${launchableActivity}`
    const launch = run(adb, adbArgs('shell', 'am', 'start', '-W', '-n', component), {
        allowFailure: true,
    })
    const launchStatus = launch.stdout.match(/^Status:\s*(\S+)/im)?.[1]
    if (launch.status !== 0 || launchStatus?.toLowerCase() !== 'ok') {
        throw new Error(`Android activity launch failed\n${launch.stdout}${launch.stderr}`.trim())
    }

    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 3000)
    const pid = run(adb, adbArgs('shell', 'pidof', '-s', applicationId), {
        allowFailure: true,
    }).stdout.trim()
    if (!pid) {
        const crashes = run(adb, adbArgs('logcat', '-b', 'crash', '-d'), {
            allowFailure: true,
        })
        throw new Error(
            `Android process exited after launch${crashes.stdout ? `\n${crashes.stdout}` : ''}`,
        )
    }
    const crashes = run(adb, adbArgs('logcat', '-b', 'crash', '-d'), {
        allowFailure: true,
    }).stdout
    if (
        crashes.includes(applicationId) &&
        /FATAL EXCEPTION|AndroidRuntime|Rust panicked|Process:/.test(crashes)
    ) {
        throw new Error(`Android crash buffer contains a launch failure\n${crashes}`)
    }
    const appLogs = run(adb, adbArgs('logcat', '-d', '--pid', pid), {
        allowFailure: true,
    }).stdout
    if (/FATAL EXCEPTION|Rust panicked|not allowed/i.test(appLogs)) {
        throw new Error(`Android app log contains a launch failure\n${appLogs}`)
    }
    console.log(`ADB install and launch passed on ${serial} (pid ${pid})`)
}

if (hasFlag('--help')) {
    console.log(
        'Usage: node scripts/verify-android-apk.mjs [--mode release|debug] [--apk path] [--install] [--device serial]',
    )
    process.exit(0)
}

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(option('--project-root') ?? join(scriptDirectory, '..'))
const mode = option('--mode') ?? 'release'
if (!['release', 'debug'].includes(mode)) throw new Error(`Unsupported verification mode: ${mode}`)

const policy = JSON.parse(readFileSync(join(projectRoot, 'android-release-policy.json'), 'utf8'))
const packageJson = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8'))
const tauriConfig = JSON.parse(readFileSync(join(projectRoot, 'src-tauri', 'tauri.conf.json'), 'utf8'))
const cargoVersion = cargoPackageVersion(
    readFileSync(join(projectRoot, 'src-tauri', 'Cargo.toml'), 'utf8'),
)
if (packageJson.version !== tauriConfig.version || packageJson.version !== cargoVersion) {
    throw new Error('package.json, tauri.conf.json, and Cargo.toml versions do not match')
}

const apkPath = resolve(option('--apk') ?? discoverApk(projectRoot, mode))
if (!existsSync(apkPath)) throw new Error(`APK does not exist: ${apkPath}`)
if (mode === 'release' && /-unsigned\.apk$/i.test(apkPath)) {
    throw new Error(`Refusing to verify an unsigned release artifact: ${apkPath}`)
}

const androidSdk = findAndroidSdk()
const buildTools = findBuildTools(androidSdk)
const java = process.env.JAVA_HOME
    ? join(process.env.JAVA_HOME, 'bin', process.platform === 'win32' ? 'java.exe' : 'java')
    : 'java'
const apksigner = join(buildTools, 'lib', 'apksigner.jar')
const signature = run(java, ['-jar', apksigner, 'verify', '--verbose', '--print-certs', apkPath])
const signatureOutput = `${signature.stdout}${signature.stderr}`
if (!/^Verifies$/m.test(signatureOutput)) throw new Error('apksigner did not confirm the APK signature')
const signerCount = Number(signatureOutput.match(/^Number of signers:\s*(\d+)$/m)?.[1])
if (signerCount !== 1) throw new Error(`APK must have exactly one signer; found ${signerCount || 0}`)
const fingerprintMatch = signatureOutput.match(/certificate SHA-?256 digest:\s*([0-9a-f:]+)/i)
if (!fingerprintMatch) throw new Error('Could not read the APK signer SHA-256 certificate digest')
const fingerprint = normalizeFingerprint(fingerprintMatch[1])
if (
    mode === 'release' &&
    fingerprint !== normalizeFingerprint(policy.signing.certificateSha256)
) {
    throw new Error('APK signer certificate does not match android-release-policy.json')
}

const aapt2 = join(buildTools, process.platform === 'win32' ? 'aapt2.exe' : 'aapt2')
const metadata = parseBadging(run(aapt2, ['dump', 'badging', apkPath]).stdout)
const expectedApplicationId =
    mode === 'debug'
        ? `${policy.applicationId}${policy.debugApplicationIdSuffix}`
        : policy.applicationId
if (metadata.applicationId !== expectedApplicationId) {
    throw new Error(
        `APK applicationId ${metadata.applicationId} does not match policy ${expectedApplicationId}`,
    )
}
if (metadata.versionName !== packageJson.version) {
    throw new Error(`APK versionName ${metadata.versionName} does not match ${packageJson.version}`)
}
if (metadata.versionCode !== expectedVersionCode(packageJson.version)) {
    throw new Error(`APK versionCode ${metadata.versionCode} does not match the configured version`)
}
const baselineVersion = policy.updateBaseline.tag.replace(/^v/, '')
if (metadata.versionCode <= expectedVersionCode(baselineVersion)) {
    throw new Error(
        `APK versionCode ${metadata.versionCode} must be newer than update baseline ${policy.updateBaseline.tag}`,
    )
}
if (metadata.minSdkVersion !== policy.minSdkVersion) {
    throw new Error(`APK minSdkVersion ${metadata.minSdkVersion} does not match policy`)
}
if (metadata.targetSdkVersion !== policy.targetSdkVersion) {
    throw new Error(`APK targetSdkVersion ${metadata.targetSdkVersion} does not match policy`)
}
if (mode === 'release') {
    const missingAbis = policy.requiredAbis.filter(abi => !metadata.abis.includes(abi))
    if (missingAbis.length > 0) throw new Error(`APK is missing required ABIs: ${missingAbis.join(', ')}`)
}

const zipalign = join(buildTools, process.platform === 'win32' ? 'zipalign.exe' : 'zipalign')
run(zipalign, ['-c', '-P', '16', '-v', '4', apkPath])

console.log(
    `Android APK verified: ${basename(apkPath)} (${metadata.applicationId}, version ${metadata.versionName}, minSdk ${metadata.minSdkVersion}, targetSdk ${metadata.targetSdkVersion}, ${metadata.abis.join(', ')})`,
)
console.log(`Signer certificate SHA-256: ${fingerprint}`)

if (hasFlag('--install')) {
    installAndLaunch({
        adb: findAdb(androidSdk),
        apkPath,
        applicationId: metadata.applicationId,
        launchableActivity: metadata.launchableActivity,
    })
}
