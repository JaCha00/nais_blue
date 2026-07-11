import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { patchAndroidSigning } from './patch-android-signing.mjs'

const root = process.cwd()
const read = path => readFileSync(join(root, path), 'utf8')
const pkg = JSON.parse(read('package.json'))
const policy = JSON.parse(read('android-release-policy.json'))
const tauri = JSON.parse(read('src-tauri/tauri.conf.json'))
const android = JSON.parse(read('src-tauri/tauri.android.conf.json'))

assert.equal(policy.applicationId, tauri.identifier)
assert.equal(policy.debugApplicationIdSuffix, '.dev')
assert.equal(policy.minSdkVersion, android.bundle.android.minSdkVersion)
assert.equal(policy.targetSdkVersion, 36)
assert.match(policy.signing.certificateSha256, /^[A-F0-9]{64}$/)
assert.match(policy.updateBaseline.sha256, /^[A-F0-9]{64}$/)
assert.equal(policy.updateBaseline.tag, 'v2.8.0')
assert.match(policy.updateBaseline.url, /\/v2\.8\.0\/NAIS2_2\.8\.0-universal\.apk$/)
assert.ok(policy.signing.keyAlias)
assert.deepEqual(policy.requiredAbis, ['arm64-v8a', 'armeabi-v7a', 'x86', 'x86_64'])
assert.match(pkg.devDependencies.playwright, /^\d+\.\d+\.\d+$/)

assert.equal(pkg.scripts['android:prepare'], 'node scripts/prepare-android-release.mjs')
assert.equal(pkg.scripts['test:release-version'], 'node scripts/verify-release-version.mjs')
assert.equal(
    pkg.scripts['test:android-release-contract'],
    'node scripts/verify-android-release-contract.mjs',
)
assert.equal(
    pkg.scripts['test:android-release'],
    'node scripts/verify-android-apk.mjs --mode release',
)
assert.equal(pkg.scripts['test:android-debug'], 'node scripts/verify-android-apk.mjs --mode debug')

for (const path of [
    'scripts/verify-release-version.mjs',
    'scripts/patch-android-signing.mjs',
    'scripts/prepare-android-release.mjs',
    'scripts/verify-android-apk.mjs',
    '.github/workflows/android.yml',
]) {
    assert.ok(read(path).length > 0, `${path} must exist`)
}

const workflow = read('.github/workflows/android.yml')
for (const requiredText of [
    'secrets.NAIS_KEYSTORE_BASE64',
    'secrets.NAIS_KEYSTORE_PASSWORD',
    'ANDROID_KEY_ALIAS',
    'npm run android:prepare',
    'npm run test:release-version',
    'npm run test:android-release',
    'signed-build:',
    'signed-install:',
    'publish-android:',
    'environment: android-release',
    'inputs.release',
    'GH_REPO: ${{ github.repository }}',
    'Remove signing material',
    'contents: read',
    'contents: write',
    'outputs/apk/universal/debug/app-universal-debug.apk',
    'android-release-policy.json',
    'updateBaseline.url',
    'updateBaseline.sha256',
    'npm run test:responsive-layout',
    'playwright install --with-deps chromium',
    'verify_or_upload',
]) {
    assert.ok(workflow.includes(requiredText), `Android workflow must include ${requiredText}`)
}
assert.ok(
    workflow.indexOf('Remove signing material') < workflow.indexOf('signed-install:'),
    'Signing material must be removed before the no-secret emulator job starts',
)
assert.ok(
    workflow.indexOf('NAIS2_2.8.0-baseline.apk') <
        workflow.lastIndexOf('npm run test:android-release'),
    'The pinned baseline must be installed before the current release APK',
)

const desktopWorkflow = read('.github/workflows/build.yml')
for (const requiredText of [
    "if: startsWith(github.ref, 'refs/tags/v')",
    'release-preflight:',
    'node scripts/verify-release-version.mjs --tag "$GITHUB_REF_NAME"',
    'git merge-base --is-ancestor "$GITHUB_SHA" refs/remotes/origin/main',
    'needs: release-preflight',
    'releaseDraft: true',
    'needs: desktop',
    'release: true',
]) {
    assert.ok(desktopWorkflow.includes(requiredText), `Desktop workflow must include ${requiredText}`)
}
assert.ok(!desktopWorkflow.includes('secrets: inherit'))
assert.ok(!desktopWorkflow.includes('ANDROID_KEY_BASE64: ${{ secrets.NAIS_KEYSTORE_BASE64 }}'))
assert.ok(!desktopWorkflow.includes('ANDROID_KEY_PASSWORD: ${{ secrets.NAIS_KEYSTORE_PASSWORD }}'))
assert.ok(workflow.includes('gh release edit "$GITHUB_REF_NAME" --draft=false'))

for (const [name, source] of [
    ['Android workflow', workflow],
    ['desktop workflow', desktopWorkflow],
]) {
    const actionReferences = [...source.matchAll(/^\s*uses:\s*([^\s#]+).*$/gm)].map(
        match => match[1],
    )
    for (const reference of actionReferences) {
        if (reference.startsWith('./')) continue
        assert.match(
            reference,
            /^[^@]+@[a-f0-9]{40}$/,
            `${name} action must use a full commit SHA: ${reference}`,
        )
    }
}

const gitignore = read('.gitignore')
for (const ignoredSecret of [
    'nais-release-key',
    'NAIS_KEYSTORE_BASE64.txt',
    'keystore.properties',
    '*.jks',
    '*.keystore',
    '*.p12',
    '*.pfx',
    '.env.*',
]) {
    assert.ok(gitignore.includes(ignoredSecret), `.gitignore must exclude ${ignoredSecret}`)
}

const localRelease = read('scripts/release-android.ps1')
assert.ok(localRelease.includes('android-release-policy.json'))
assert.ok(localRelease.includes('scripts\\patch-android-signing.mjs'))
assert.ok(localRelease.includes('npm run test:android-release'))
assert.ok(localRelease.includes('ANDROID_KEYSTORE_PATH'))
assert.ok(localRelease.includes('ANDROID_KEY_PASSWORD'))
assert.ok(!localRelease.includes('WriteAllText($keystorePropertiesPath'))

const prepareRelease = read('scripts/prepare-android-release.mjs')
assert.ok(!prepareRelease.includes("requiredEnvironment('ANDROID_KEY_PASSWORD')"))
assert.ok(!prepareRelease.includes('writeFileSync'))

const temporaryRoot = mkdtempSync(join(tmpdir(), 'nais-android-signing-'))
try {
    const gradleFile = join(temporaryRoot, 'build.gradle.kts')
    writeFileSync(
        gradleFile,
        `import java.util.Properties

plugins {
    id("com.android.application")
}

android {
    buildTypes {
        getByName("debug") {
            isDebuggable = true
        }
        getByName("release") {
            isMinifyEnabled = true
        }
    }
}
`,
    )
    assert.equal(patchAndroidSigning(gradleFile), true)
    const once = readFileSync(gradleFile, 'utf8')
    assert.equal(patchAndroidSigning(gradleFile), false)
    const twice = readFileSync(gradleFile, 'utf8')
    assert.equal(twice, once, 'Gradle signing patch must be idempotent')
    assert.equal((twice.match(/NAIS_ANDROID_SIGNING_START/g) ?? []).length, 1)
    assert.equal((twice.match(/NAIS_ANDROID_SIGNING_CONFIG/g) ?? []).length, 1)
    assert.equal((twice.match(/NAIS_ANDROID_DEBUG_ID/g) ?? []).length, 1)
    assert.match(twice, /naisReleaseSigningConfig\?\.let \{ signingConfig = it \}/)
    assert.match(twice, /applicationIdSuffix = "\.dev"/)
} finally {
    rmSync(temporaryRoot, { recursive: true, force: true })
}

console.log('Android release contract passed.')
