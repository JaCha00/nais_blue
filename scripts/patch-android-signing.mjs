import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const START_MARKER = '// NAIS_ANDROID_SIGNING_START'
const END_MARKER = '// NAIS_ANDROID_SIGNING_END'
const CONFIG_MARKER = '// NAIS_ANDROID_SIGNING_CONFIG'
const DEBUG_ID_MARKER = '// NAIS_ANDROID_DEBUG_ID'

function removeManagedSigning(content) {
    return content
        .replace(
            /^[ \t]*\/\/ NAIS_(?:LOCAL_APK|ANDROID)_SIGNING_START[\s\S]*?^[ \t]*\/\/ NAIS_(?:LOCAL_APK|ANDROID)_SIGNING_END[ \t]*\r?\n?/gm,
            '',
        )
        .replace(
            /^[ \t]*\/\/ NAIS_(?:LOCAL_APK|ANDROID)_SIGNING_CONFIG[ \t]*\r?\n[^\r\n]*\r?\n?/gm,
            '',
        )
        .replace(
            /^[ \t]*\/\/ NAIS_ANDROID_DEBUG_ID[ \t]*\r?\n[^\r\n]*\r?\n?/gm,
            '',
        )
}

export function patchAndroidSigning(gradleFile, debugApplicationIdSuffix = '') {
    const absolutePath = resolve(gradleFile)
    const original = readFileSync(absolutePath, 'utf8')
    const newline = original.includes('\r\n') ? '\r\n' : '\n'
    let content = removeManagedSigning(original)

    if (
        /\bsigningConfigs\s*\{/.test(content) ||
        /\bsigningConfig\s*=/.test(content) ||
        /\bapplicationIdSuffix\s*=/.test(content)
    ) {
        throw new Error(
            `Refusing to replace an unmanaged Android signing or debug ID configuration in ${absolutePath}`,
        )
    }
    if (debugApplicationIdSuffix !== '' && !/^\.[a-z][a-z0-9_.]*$/i.test(debugApplicationIdSuffix)) {
        throw new Error(`Invalid Android debug application ID suffix: ${debugApplicationIdSuffix}`)
    }

    const imports = []
    if (!/^import java\.io\.FileInputStream\s*$/m.test(content)) {
        imports.push('import java.io.FileInputStream')
    }
    if (!/^import java\.util\.Properties\s*$/m.test(content)) {
        imports.push('import java.util.Properties')
    }
    if (imports.length > 0) {
        content = `${imports.join(newline)}${newline}${content}`
    }

    const signingBlock = [
        `    ${START_MARKER}`,
        '    val naisKeystorePropertiesFile = rootProject.file("keystore.properties")',
        '    val naisKeystoreProperties = Properties()',
        '    if (naisKeystorePropertiesFile.exists()) {',
        '        FileInputStream(naisKeystorePropertiesFile).use { naisKeystoreProperties.load(it) }',
        '    }',
        '    val naisStoreFile = System.getenv("ANDROID_KEYSTORE_PATH")',
        '        ?: naisKeystoreProperties.getProperty("storeFile")',
        '    val naisKeyAlias = System.getenv("ANDROID_KEY_ALIAS")',
        '        ?: naisKeystoreProperties.getProperty("keyAlias")',
        '    val naisPassword = System.getenv("ANDROID_KEY_PASSWORD")',
        '        ?: naisKeystoreProperties.getProperty("password")',
        '        ?: naisKeystoreProperties.getProperty("storePassword")',
        '',
        '    val naisUserSigningConfig = if (naisStoreFile != null && naisKeyAlias != null && naisPassword != null) {',
        '        signingConfigs.create("release") {',
        '            keyAlias = naisKeyAlias',
        '            keyPassword = System.getenv("ANDROID_KEY_PASSWORD")',
        '                ?: naisKeystoreProperties.getProperty("keyPassword")',
        '                ?: naisPassword',
        '            storeFile = file(naisStoreFile)',
        '            storePassword = naisPassword',
        '        }',
        '    } else {',
        '        null',
        '    }',
        `    ${END_MARKER}`,
        '',
    ].join(newline)

    const buildTypesAnchor = '    buildTypes {'
    const buildTypesIndex = content.indexOf(buildTypesAnchor)
    if (buildTypesIndex < 0) {
        throw new Error(`Could not find the Android buildTypes block in ${absolutePath}`)
    }
    content = content.slice(0, buildTypesIndex) + signingBlock + content.slice(buildTypesIndex)

    const releaseAnchor = '        getByName("release") {'
    const releaseIndex = content.indexOf(releaseAnchor)
    if (releaseIndex < 0) {
        throw new Error(`Could not find the Android release build type in ${absolutePath}`)
    }
    const releaseConfig = [
        releaseAnchor,
        `            ${CONFIG_MARKER}`,
        '            naisUserSigningConfig?.let { signingConfig = it }',
    ].join(newline)
    content =
        content.slice(0, releaseIndex) +
        releaseConfig +
        content.slice(releaseIndex + releaseAnchor.length)

    const debugAnchor = '        getByName("debug") {'
    const debugIndex = content.indexOf(debugAnchor)
    if (debugIndex < 0) {
        throw new Error(`Could not find the Android debug build type in ${absolutePath}`)
    }
    const debugConfig = [
        debugAnchor,
        `            ${DEBUG_ID_MARKER}`,
        '            naisUserSigningConfig?.let { signingConfig = it }',
    ].join(newline)
    content =
        content.slice(0, debugIndex) +
        debugConfig +
        content.slice(debugIndex + debugAnchor.length)

    if (content !== original) {
        writeFileSync(absolutePath, content, 'utf8')
    }
    return content !== original
}

function readOption(name, fallback) {
    const index = process.argv.indexOf(name)
    return index >= 0 ? process.argv[index + 1] : fallback
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : ''
if (invokedPath === fileURLToPath(import.meta.url)) {
    const gradleFile = readOption(
        '--gradle-file',
        resolve('src-tauri', 'gen', 'android', 'app', 'build.gradle.kts'),
    )
    const debugSuffix = readOption('--debug-suffix', '')
    const changed = patchAndroidSigning(gradleFile, debugSuffix)
    console.log(`Android signing configuration ${changed ? 'updated' : 'already current'}: ${gradleFile}`)
}
