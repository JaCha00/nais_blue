[CmdletBinding()]
param(
    [string]$ProjectRoot,
    [string]$Repository = 'JaCha00/nais_blue',
    [string]$Tag,
    [switch]$Publish,
    [switch]$AllowProjectSecrets
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

if ([string]::IsNullOrWhiteSpace($ProjectRoot)) {
    $ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
}

function Get-DotEnvValue {
    param(
        [string]$Path,
        [string]$Name
    )

    if (-not (Test-Path -LiteralPath $Path)) {
        throw "Required local environment file is missing: $Path"
    }

    $pattern = '^\s*(?:export\s+)?' + [regex]::Escape($Name) + '\s*=(.*)$'
    foreach ($line in [IO.File]::ReadAllLines($Path)) {
        $match = [regex]::Match($line, $pattern)
        if (-not $match.Success) {
            continue
        }

        $value = $match.Groups[1].Value
        if ($value.Length -ge 2 -and (
                ($value.StartsWith('"') -and $value.EndsWith('"')) -or
                ($value.StartsWith("'") -and $value.EndsWith("'"))
            )) {
            $value = $value.Substring(1, $value.Length - 2)
        }

        if ([string]::IsNullOrEmpty($value)) {
            throw "$Name is empty in $Path"
        }

        return $value
    }

    throw "$Name is missing from $Path"
}

function Get-KeyToolPath {
    $command = Get-Command keytool -ErrorAction SilentlyContinue
    if ($command) {
        if ($command.Source) {
            return $command.Source
        }
        if ($command.Path) {
            return $command.Path
        }
    }

    $androidStudioKeyTool = 'C:\Program Files\Android\Android Studio\jbr\bin\keytool.exe'
    if (Test-Path -LiteralPath $androidStudioKeyTool) {
        return $androidStudioKeyTool
    }

    throw 'keytool was not found. Install a JDK or Android Studio before building the APK.'
}

function Get-AndroidBuildToolPath {
    param([string]$ToolName)

    $androidHomes = @(
        $env:ANDROID_HOME,
        $env:ANDROID_SDK_ROOT,
        (Join-Path $env:LOCALAPPDATA 'Android\Sdk')
    ) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -Unique

    foreach ($androidHome in $androidHomes) {
        $buildToolsRoot = Join-Path $androidHome 'build-tools'
        if (-not (Test-Path -LiteralPath $buildToolsRoot)) {
            continue
        }

        $versions = Get-ChildItem -LiteralPath $buildToolsRoot -Directory | Sort-Object Name -Descending
        foreach ($version in $versions) {
            $candidate = Join-Path $version.FullName $ToolName
            if (Test-Path -LiteralPath $candidate) {
                return $candidate
            }
        }
    }

    throw "$ToolName was not found in the Android SDK build-tools directory."
}

function Use-RustupAndroidTargets {
    $cargoHome = if ([string]::IsNullOrWhiteSpace($env:CARGO_HOME)) {
        Join-Path $env:USERPROFILE '.cargo'
    } else {
        $env:CARGO_HOME
    }
    $rustupBin = Join-Path $cargoHome 'bin'
    $cargoShim = Join-Path $rustupBin 'cargo.exe'
    $rustcShim = Join-Path $rustupBin 'rustc.exe'
    $rustupShim = Join-Path $rustupBin 'rustup.exe'

    foreach ($requiredShim in @($cargoShim, $rustcShim, $rustupShim)) {
        if (-not (Test-Path -LiteralPath $requiredShim)) {
            throw "Rustup shim is missing: $requiredShim"
        }
    }

    $pathSeparator = [IO.Path]::PathSeparator
    $pathEntries = @($env:PATH -split [regex]::Escape([string]$pathSeparator))
    $otherPathEntries = @($pathEntries | Where-Object { $_ -ine $rustupBin })
    $env:PATH = "$rustupBin$pathSeparator$($otherPathEntries -join $pathSeparator)"
    $env:CARGO = $cargoShim
    $env:RUSTC = $rustcShim

    foreach ($target in @('aarch64-linux-android', 'armv7-linux-androideabi', 'i686-linux-android', 'x86_64-linux-android')) {
        & $rustupShim target add $target
        if ($LASTEXITCODE -ne 0) {
            throw "Rustup could not install the Android target $target"
        }

        $targetLibDir = & $rustcShim --print target-libdir --target $target
        if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $targetLibDir)) {
            throw "Rustup does not provide a usable standard library for $target"
        }
        if ((Get-ChildItem -LiteralPath $targetLibDir -Filter 'libcore-*.rlib' | Measure-Object).Count -eq 0) {
            throw "Rustup standard library for $target is incomplete."
        }
    }
}

function Get-CargoPackageVersion {
    param([string]$CargoTomlPath)

    $cargoToml = Get-Content -LiteralPath $CargoTomlPath -Raw
    $packageSection = [regex]::Match($cargoToml, '(?ms)^\[package\](?<body>.*?)(?=^\[|\z)')
    $versionMatch = [regex]::Match($packageSection.Groups['body'].Value, '(?m)^\s*version\s*=\s*"(?<version>[^"]+)"')
    if (-not $versionMatch.Success) {
        throw "Could not read the package version from $CargoTomlPath"
    }

    return $versionMatch.Groups['version'].Value
}

function Get-Sha256 {
    param([string]$Path)

    $stream = [IO.File]::OpenRead($Path)
    try {
        $hasher = [Security.Cryptography.SHA256]::Create()
        try {
            $hashBytes = $hasher.ComputeHash($stream)
            return ([BitConverter]::ToString($hashBytes)).Replace('-', '').ToLowerInvariant()
        } finally {
            $hasher.Dispose()
        }
    } finally {
        $stream.Dispose()
    }
}

function Get-ReleaseVersion {
    param([string]$Root)

    $packageVersion = [string]((Get-Content -LiteralPath (Join-Path $Root 'package.json') -Raw | ConvertFrom-Json).version)
    $tauriVersion = [string]((Get-Content -LiteralPath (Join-Path $Root 'src-tauri\tauri.conf.json') -Raw | ConvertFrom-Json).version)
    $cargoVersion = Get-CargoPackageVersion -CargoTomlPath (Join-Path $Root 'src-tauri\Cargo.toml')
    $versions = @(@($packageVersion, $tauriVersion, $cargoVersion) | Select-Object -Unique)

    if ($versions.Count -ne 1) {
        throw "Release version mismatch detected: package.json=$packageVersion, tauri.conf.json=$tauriVersion, Cargo.toml=$cargoVersion"
    }

    return $packageVersion
}

function Assert-SecretIsNotTracked {
    param(
        [string]$Root,
        [string]$RelativePath
    )

    $git = Get-Command git -ErrorAction Stop
    $trackedPaths = @(& $git.Source -C $Root ls-files -- $RelativePath)
    if ($LASTEXITCODE -ne 0) {
        throw "Could not inspect Git tracking state for $RelativePath"
    }
    if ($trackedPaths.Count -gt 0) {
        throw "$RelativePath is tracked by Git. Remove it from source control before building a release."
    }
}

function Get-KeystoreFingerprint {
    param(
        [string]$KeyTool,
        [string]$KeyStore,
        [string]$Alias,
        [string]$Password
    )

    $passwordVariable = 'NAIS_ANDROID_KEYTOOL_PASSWORD'
    $previousPassword = [Environment]::GetEnvironmentVariable($passwordVariable, 'Process')
    try {
        [Environment]::SetEnvironmentVariable($passwordVariable, $Password, 'Process')
        $outputLines = & $KeyTool -list -v -alias $Alias -keystore $KeyStore '-storepass:env' $passwordVariable 2>&1
        $exitCode = $LASTEXITCODE
        $output = $outputLines | Out-String
    } finally {
        [Environment]::SetEnvironmentVariable($passwordVariable, $previousPassword, 'Process')
    }
    if ($exitCode -ne 0) {
        throw 'APK signing keystore validation failed. Check the local keystore and APK_RELEASE_KEY_PASSWORD.'
    }

    $fingerprint = [regex]::Match($output, '(?im)SHA-?256[^:\r\n]*:\s*(?<digest>[0-9A-Fa-f:]+)')
    if (-not $fingerprint.Success) {
        throw 'Could not read the APK keystore certificate fingerprint.'
    }

    return $fingerprint.Groups['digest'].Value.Replace(':', '').ToUpperInvariant()
}

function Assert-ApkIsSignedWithExpectedKey {
    param(
        [string]$ApkSigner,
        [string]$ApkPath,
        [string]$ExpectedFingerprint
    )

    $outputLines = & $ApkSigner verify --verbose --print-certs $ApkPath 2>&1
    $exitCode = $LASTEXITCODE
    $output = $outputLines | Out-String
    if ($exitCode -ne 0) {
        throw 'APK signature verification failed.'
    }

    $signerFingerprint = [regex]::Match($output, '(?im)certificate SHA-?256 digest:\s*(?<digest>[0-9A-Fa-f:]+)')
    if (-not $signerFingerprint.Success) {
        throw 'Could not read the APK signer certificate fingerprint.'
    }

    $actualFingerprint = $signerFingerprint.Groups['digest'].Value.Replace(':', '').ToUpperInvariant()
    if ($actualFingerprint -ne $ExpectedFingerprint) {
        throw 'APK signer certificate does not match the configured local keystore.'
    }
}

function Assert-ApkVersion {
    param(
        [string]$Aapt,
        [string]$ApkPath,
        [string]$ExpectedVersion
    )

    $outputLines = & $Aapt dump badging $ApkPath 2>&1
    $exitCode = $LASTEXITCODE
    $output = $outputLines | Out-String
    if ($exitCode -ne 0) {
        throw 'Could not read the Android package metadata from the APK.'
    }

    if ($output -notmatch ("versionName='" + [regex]::Escape($ExpectedVersion) + "'")) {
        throw "APK version does not match the configured release version $ExpectedVersion."
    }
}

function Assert-PublishSourceMatchesTag {
    param(
        [string]$Root,
        [string]$Repo,
        [string]$ReleaseTag
    )

    $git = Get-Command git -ErrorAction Stop
    $changes = @(& $git.Source -C $Root status --porcelain)
    if ($LASTEXITCODE -ne 0) {
        throw 'Could not inspect the Git working tree before publishing.'
    }
    if ($changes.Count -gt 0) {
        throw 'GitHub publishing requires a clean working tree. Commit the release workflow and application changes before creating the release tag.'
    }

    $headCommit = (& $git.Source -C $Root rev-parse HEAD).Trim()
    $tagCommit = (& $git.Source -C $Root rev-parse "$ReleaseTag^{commit}").Trim()
    if ($LASTEXITCODE -ne 0) {
        throw "Local tag $ReleaseTag is missing or does not resolve to a commit."
    }
    if ($headCommit -ne $tagCommit) {
        throw "HEAD does not match $ReleaseTag. Build and publish only from the tagged release commit."
    }

    $remote = "https://github.com/$Repo.git"
    $tagRef = "refs/tags/$ReleaseTag"
    $remoteRefs = @(& $git.Source ls-remote $remote $tagRef "$tagRef^{}")
    if ($LASTEXITCODE -ne 0) {
        throw "Could not inspect remote tag $ReleaseTag."
    }

    $peeledLine = $remoteRefs | Where-Object { $_ -match ([regex]::Escape("$tagRef^{}") + '$') } | Select-Object -First 1
    $tagLine = $remoteRefs | Where-Object { $_ -match ([regex]::Escape($tagRef) + '$') } | Select-Object -First 1
    $remoteCommit = if ($peeledLine) { ($peeledLine -split '\s+')[0] } elseif ($tagLine) { ($tagLine -split '\s+')[0] } else { $null }
    if ([string]::IsNullOrWhiteSpace($remoteCommit)) {
        throw "Remote tag $ReleaseTag does not exist. Push an immutable version tag before publishing."
    }
    if ($remoteCommit -ne $tagCommit) {
        throw "Remote tag $ReleaseTag does not match the local tagged commit."
    }
}

function Publish-AndroidRelease {
    param(
        [string]$Root,
        [string]$Repo,
        [string]$ReleaseTag,
        [string]$ApkPath,
        [string]$ChecksumPath
    )

    $gh = Get-Command gh -ErrorAction Stop
    $null = & $gh.Source auth status 2>$null
    if ($LASTEXITCODE -ne 0) {
        throw 'GitHub CLI is not authenticated. Run gh auth login before publishing.'
    }

    $releaseJson = & $gh.Source release view $ReleaseTag --repo $Repo --json url,assets,isDraft 2>$null
    $releaseExists = $LASTEXITCODE -eq 0
    $createdDraft = $false

    if ($releaseExists) {
        $release = ($releaseJson | Out-String) | ConvertFrom-Json
        if ($release.isDraft) {
            throw "Release $ReleaseTag is already a draft. Review or delete that draft before publishing this APK."
        }
        $existingNames = @($release.assets | ForEach-Object { $_.name })
        $assetNames = @((Split-Path -Leaf $ApkPath), (Split-Path -Leaf $ChecksumPath))
        $duplicates = @($assetNames | Where-Object { $_ -in $existingNames })
        if ($duplicates.Count -gt 0) {
            throw "Release $ReleaseTag already contains: $($duplicates -join ', '). Publish a new version instead of replacing a published asset."
        }

        $uploadArgs = @('release', 'upload', $ReleaseTag, $ApkPath, $ChecksumPath, '--repo', $Repo)
        & $gh.Source @uploadArgs
        if ($LASTEXITCODE -ne 0) {
            throw "GitHub Release upload failed for $ReleaseTag."
        }
    } else {
        & $gh.Source release create $ReleaseTag $ApkPath $ChecksumPath --repo $Repo --verify-tag --draft --title "NAIS blue $ReleaseTag" --notes 'Android APK was built and signed locally. No GitHub Actions build was used.'
        if ($LASTEXITCODE -ne 0) {
            throw "GitHub Release creation failed for $ReleaseTag."
        }
        $createdDraft = $true
    }

    $verificationRoot = Join-Path ([IO.Path]::GetTempPath()) ('nais-android-release-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $verificationRoot -Force | Out-Null
    try {
        $apkName = Split-Path -Leaf $ApkPath
        & $gh.Source release download $ReleaseTag --repo $Repo --pattern $apkName --dir $verificationRoot
        if ($LASTEXITCODE -ne 0) {
            throw 'Could not download the uploaded APK for checksum verification.'
        }

        $downloadedApk = Join-Path $verificationRoot $apkName
        if (-not (Test-Path -LiteralPath $downloadedApk)) {
            throw 'GitHub Release verification download did not contain the APK.'
        }

        $localHash = Get-Sha256 -Path $ApkPath
        $downloadedHash = Get-Sha256 -Path $downloadedApk
        if ($localHash -ne $downloadedHash) {
            throw 'Downloaded GitHub Release APK hash does not match the locally verified APK.'
        }
    } finally {
        if (Test-Path -LiteralPath $verificationRoot) {
            Remove-Item -LiteralPath $verificationRoot -Recurse -Force
        }
    }

    if ($createdDraft) {
        & $gh.Source release edit $ReleaseTag --repo $Repo --draft=false
        if ($LASTEXITCODE -ne 0) {
            throw "APK assets were verified in the draft release, but publishing $ReleaseTag failed. The draft remains available for review."
        }
    }

    $releaseUrl = & $gh.Source release view $ReleaseTag --repo $Repo --json url --jq '.url'
    if ($LASTEXITCODE -ne 0) {
        throw "APK uploaded but the GitHub Release URL could not be read for $ReleaseTag."
    }

    Write-Output "GitHub Release verified: $releaseUrl"
}

$ProjectRoot = (Resolve-Path -LiteralPath $ProjectRoot).Path
$version = Get-ReleaseVersion -Root $ProjectRoot
$releasePolicy = Get-Content -LiteralPath (Join-Path $ProjectRoot 'android-release-policy.json') -Raw | ConvertFrom-Json
$tauriIdentifier = [string]((Get-Content -LiteralPath (Join-Path $ProjectRoot 'src-tauri\tauri.conf.json') -Raw | ConvertFrom-Json).identifier)
if ([string]$releasePolicy.applicationId -ne $tauriIdentifier) {
    throw "Android release policy applicationId does not match the Tauri identifier: $($releasePolicy.applicationId) != $tauriIdentifier"
}
if ([string]::IsNullOrWhiteSpace($Tag)) {
    $Tag = "v$version"
}
if ($Tag -ne "v$version") {
    throw "The release tag must match the configured version: expected v$version, received $Tag"
}

if ($Publish) {
    Assert-PublishSourceMatchesTag -Root $ProjectRoot -Repo $Repository -ReleaseTag $Tag
}

Assert-SecretIsNotTracked -Root $ProjectRoot -RelativePath 'nais-release-key'
Assert-SecretIsNotTracked -Root $ProjectRoot -RelativePath 'NAIS_KEYSTORE_BASE64.txt'
Assert-SecretIsNotTracked -Root $ProjectRoot -RelativePath '.env'

$configuredKeystorePath = [Environment]::GetEnvironmentVariable('APK_RELEASE_KEYSTORE_PATH', 'Process')
$keystorePath = if ([string]::IsNullOrWhiteSpace($configuredKeystorePath)) {
    if (-not $AllowProjectSecrets) {
        throw 'APK_RELEASE_KEYSTORE_PATH must point to a keystore outside the project. Use -AllowProjectSecrets only for an explicit legacy build.'
    }
    Join-Path $ProjectRoot 'nais-release-key'
} elseif ([IO.Path]::IsPathRooted($configuredKeystorePath)) {
    $configuredKeystorePath
} else {
    Join-Path $ProjectRoot $configuredKeystorePath
}
if (-not (Test-Path -LiteralPath $keystorePath)) {
    throw "Local APK keystore is missing: $keystorePath"
}
$keystorePath = (Resolve-Path -LiteralPath $keystorePath).Path
$projectPathPrefix = $ProjectRoot.TrimEnd('\') + '\'
if ($keystorePath.StartsWith($projectPathPrefix, [StringComparison]::OrdinalIgnoreCase)) {
    $relativeKeystorePath = $keystorePath.Substring($projectPathPrefix.Length).Replace('\', '/')
    Assert-SecretIsNotTracked -Root $ProjectRoot -RelativePath $relativeKeystorePath
    if (-not $AllowProjectSecrets) {
        throw 'The Android release keystore must be outside the project directory. Use -AllowProjectSecrets only for an explicit legacy build.'
    }
    Write-Warning 'The Android release keystore is inside the project directory. Move it to a user-private directory and set APK_RELEASE_KEYSTORE_PATH.'
}

$keyPassword = [Environment]::GetEnvironmentVariable('APK_RELEASE_KEY_PASSWORD', 'Process')
if ([string]::IsNullOrWhiteSpace($keyPassword)) {
    if (-not $AllowProjectSecrets) {
        throw 'APK_RELEASE_KEY_PASSWORD must be set in the current process. Use -AllowProjectSecrets only for an explicit legacy build.'
    }
    $keyPassword = Get-DotEnvValue -Path (Join-Path $ProjectRoot '.env') -Name 'APK_RELEASE_KEY_PASSWORD'
}
$keyAlias = [string]$releasePolicy.signing.keyAlias
$keyTool = Get-KeyToolPath
$expectedFingerprint = Get-KeystoreFingerprint -KeyTool $keyTool -KeyStore $keystorePath -Alias $keyAlias -Password $keyPassword
$policyFingerprint = ([string]$releasePolicy.signing.certificateSha256).Replace(':', '').ToUpperInvariant()
if ($expectedFingerprint -ne $policyFingerprint) {
    throw 'The configured APK keystore does not match android-release-policy.json.'
}

$androidRoot = Join-Path $ProjectRoot 'src-tauri\gen\android'
$gradleFile = Join-Path $androidRoot 'app\build.gradle.kts'
if (-not (Test-Path -LiteralPath $gradleFile)) {
    Push-Location $ProjectRoot
    try {
        & npx tauri android init --ci
        if ($LASTEXITCODE -ne 0) {
            throw 'Tauri Android initialization failed.'
        }
    } finally {
        Pop-Location
    }
}
if (-not (Test-Path -LiteralPath $gradleFile)) {
    throw "Tauri Android initialization did not create $gradleFile"
}

& node (Join-Path $ProjectRoot 'scripts\patch-android-signing.mjs') --gradle-file $gradleFile --debug-suffix ([string]$releasePolicy.debugApplicationIdSuffix)
if ($LASTEXITCODE -ne 0) {
    throw 'Could not apply the tracked Android signing configuration.'
}
$generatedGradle = Get-Content -LiteralPath $gradleFile -Raw
$generatedProjectChecks = @(
    @{
        Name = 'applicationId'
        Pattern = 'applicationId\s*=\s*"' + [regex]::Escape([string]$releasePolicy.applicationId) + '"'
    },
    @{
        Name = 'minSdkVersion'
        Pattern = 'minSdk\s*=\s*' + [regex]::Escape([string]$releasePolicy.minSdkVersion) + '\b'
    },
    @{
        Name = 'targetSdkVersion'
        Pattern = 'targetSdk\s*=\s*' + [regex]::Escape([string]$releasePolicy.targetSdkVersion) + '\b'
    }
)
foreach ($check in $generatedProjectChecks) {
    if ($generatedGradle -notmatch $check.Pattern) {
        throw "Generated Android project has a stale $($check.Name). Remove src-tauri/gen/android and rerun the release."
    }
}

$keystorePropertiesPath = Join-Path $androidRoot 'keystore.properties'
if (Test-Path -LiteralPath $keystorePropertiesPath) {
    throw "Remove stale signing properties before releasing: $keystorePropertiesPath"
}

$artifactRoot = Join-Path $ProjectRoot 'release-artifacts\android'
$artifactName = "NAIS-blue_$version-universal.apk"
$artifactPath = Join-Path $artifactRoot $artifactName
$checksumPath = "$artifactPath.sha256"
$signingEnvironment = @{
    ANDROID_KEYSTORE_PATH = $keystorePath
    ANDROID_KEY_ALIAS = $keyAlias
    ANDROID_KEY_PASSWORD = $keyPassword
}
$previousSigningEnvironment = @{}

try {
    foreach ($entry in $signingEnvironment.GetEnumerator()) {
        $previousSigningEnvironment[$entry.Key] = [Environment]::GetEnvironmentVariable($entry.Key, 'Process')
        [Environment]::SetEnvironmentVariable($entry.Key, $entry.Value, 'Process')
    }
    Use-RustupAndroidTargets

    Push-Location $ProjectRoot
    try {
        & npm run tauri:android:build:apk
        if ($LASTEXITCODE -ne 0) {
            throw 'Tauri Android APK build failed.'
        }
    } finally {
        Pop-Location
    }

    $signedApkPath = Join-Path $androidRoot 'app\build\outputs\apk\universal\release\app-universal-release.apk'
    if (-not (Test-Path -LiteralPath $signedApkPath)) {
        throw "Expected signed universal APK was not created: $signedApkPath"
    }
    if ($signedApkPath -match '-unsigned\.apk$') {
        throw 'Refusing to publish an unsigned APK.'
    }

    $apksigner = Get-AndroidBuildToolPath -ToolName 'apksigner.bat'
    $zipalign = Get-AndroidBuildToolPath -ToolName 'zipalign.exe'
    $aapt = Get-AndroidBuildToolPath -ToolName 'aapt.exe'

    Assert-ApkIsSignedWithExpectedKey -ApkSigner $apksigner -ApkPath $signedApkPath -ExpectedFingerprint $expectedFingerprint
    & $zipalign -c -P 16 -v 4 $signedApkPath
    if ($LASTEXITCODE -ne 0) {
        throw 'APK alignment verification failed.'
    }
    Assert-ApkVersion -Aapt $aapt -ApkPath $signedApkPath -ExpectedVersion $version

    Push-Location $ProjectRoot
    try {
        & npm run test:android-release -- --apk $signedApkPath
        if ($LASTEXITCODE -ne 0) {
            throw 'Tracked Android APK release verification failed.'
        }
    } finally {
        Pop-Location
    }

    New-Item -ItemType Directory -Path $artifactRoot -Force | Out-Null
    Copy-Item -LiteralPath $signedApkPath -Destination $artifactPath -Force
    $sha256 = Get-Sha256 -Path $artifactPath
    [IO.File]::WriteAllText($checksumPath, "$sha256  $artifactName`n", [Text.UTF8Encoding]::new($false))
} finally {
    foreach ($entry in $previousSigningEnvironment.GetEnumerator()) {
        [Environment]::SetEnvironmentVariable($entry.Key, $entry.Value, 'Process')
    }
}

Write-Output "Signed Android APK: $artifactPath"
Write-Output "SHA-256 checksum: $checksumPath"

if ($Publish) {
    Publish-AndroidRelease -Root $ProjectRoot -Repo $Repository -ReleaseTag $Tag -ApkPath $artifactPath -ChecksumPath $checksumPath
}
