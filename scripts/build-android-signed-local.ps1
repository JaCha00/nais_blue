param(
    [ValidateSet('debug', 'release')]
    [string]$Variant,
    [string]$LogPath
)

$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$envFile = Join-Path $repo '.env'

# This parser deliberately preserves backslashes: dotenv-style escape handling can corrupt Windows keystore paths.
function Get-RawEnvValue([string]$Name) {
    $line = Get-Content -LiteralPath $envFile | Where-Object { $_ -match "^\s*$([regex]::Escape($Name))\s*=" } | Select-Object -Last 1
    if (-not $line) { return $null }
    $value = ($line -replace "^\s*$([regex]::Escape($Name))\s*=\s*", '').Trim()
    if ($value.Length -ge 2 -and (($value[0] -eq '"' -and $value[-1] -eq '"') -or ($value[0] -eq "'" -and $value[-1] -eq "'"))) {
        return $value.Substring(1, $value.Length - 2)
    }
    return $value
}

$sourceKeystore = Get-RawEnvValue 'KEYSTORE_PATH'
$password = Get-RawEnvValue 'APK_RELEASE_KEY_PASSWORD'
if (-not $sourceKeystore -or -not $password -or -not (Test-Path -LiteralPath $sourceKeystore)) {
    throw 'Local Android signing inputs are unavailable.'
}

$tempKeystore = Join-Path ([System.IO.Path]::GetTempPath()) ("nais-signing-{0}.jks" -f [guid]::NewGuid().ToString('N'))
$logAbsolute = if ($LogPath) { [System.IO.Path]::GetFullPath((Join-Path $repo $LogPath)) } else { $null }
if ($logAbsolute) { New-Item -ItemType Directory -Force -Path (Split-Path $logAbsolute) | Out-Null }

try {
    Copy-Item -LiteralPath $sourceKeystore -Destination $tempKeystore
    $env:JAVA_HOME = 'E:\Android_studio\jbr'
    $env:ANDROID_HOME = 'C:\Users\User\AppData\Local\Android\Sdk'
    $env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
    $env:ANDROID_NDK_HOME = Join-Path $env:ANDROID_HOME 'ndk\29.0.14206865'
    # rustup owns the Android std targets; prefer its proxies over a machine-wide host-only Rust install.
    $env:PATH = "C:\Users\User\.cargo\bin;$env:PATH"
    $env:SODIUM_LIB_DIR = Join-Path $repo 'src-tauri\target\phase06-sodium-aarch64-v1\libsodium-stable\src\libsodium\.libs'
    $env:ANDROID_KEYSTORE_PATH = $tempKeystore
    # The configured .env alias is stale; keytool verification identifies the sole user-owned key as release.
    $env:ANDROID_KEY_ALIAS = 'release'
    $env:ANDROID_KEY_PASSWORD = $password

    $arguments = @('--no-install', 'tauri', 'android', 'build', '--target', 'aarch64', '--split-per-abi', '--apk', '--ci')
    if ($Variant -eq 'debug') { $arguments += '--debug' }
    if ($logAbsolute) {
        & npx @arguments *> $logAbsolute
    } else {
        & npx @arguments
    }
    if ($LASTEXITCODE -ne 0) { throw "Android $Variant build failed with exit code $LASTEXITCODE." }
    Write-Output ('ANDROID_{0}_BUILD_OK' -f $Variant.ToUpperInvariant())
} finally {
    Remove-Item Env:ANDROID_KEY_PASSWORD -ErrorAction SilentlyContinue
    Remove-Item Env:ANDROID_KEYSTORE_PATH -ErrorAction SilentlyContinue
    Remove-Item Env:ANDROID_KEY_ALIAS -ErrorAction SilentlyContinue
    if (Test-Path -LiteralPath $tempKeystore) { Remove-Item -LiteralPath $tempKeystore -Force }
    $password = $null
}
