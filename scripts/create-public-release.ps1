param(
    [string]$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path,
    [string]$BuildRoot = 'C:\nais2-release-build',
    [string]$OutputRoot = 'C:\nais2-public-release'
)

$ErrorActionPreference = 'Stop'

function Copy-RequiredFile {
    param(
        [string]$Source,
        [string]$Destination
    )

    if (-not (Test-Path -LiteralPath $Source)) {
        throw "Required release artifact is missing: $Source"
    }

    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Destination) | Out-Null
    Copy-Item -LiteralPath $Source -Destination $Destination -Force
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

function Test-FileContainsBytes {
    param(
        [string]$Path,
        [byte[]]$Needle
    )

    if (-not $Needle -or $Needle.Length -eq 0) {
        return $false
    }

    $bytes = [IO.File]::ReadAllBytes($Path)
    if ($bytes.Length -lt $Needle.Length) {
        return $false
    }

    for ($i = 0; $i -le $bytes.Length - $Needle.Length; $i++) {
        $matched = $true
        for ($j = 0; $j -lt $Needle.Length; $j++) {
            if ($bytes[$i + $j] -ne $Needle[$j]) {
                $matched = $false
                break
            }
        }
        if ($matched) {
            return $true
        }
    }

    return $false
}

function Assert-NoReleaseSecrets {
    param(
        [string]$ReleaseRoot
    )

    $secretValues = @(
        @{
            Name = 'TAURI_SIGNING_PRIVATE_KEY'
            Value = [Environment]::GetEnvironmentVariable('TAURI_SIGNING_PRIVATE_KEY', 'Process')
            UserValue = [Environment]::GetEnvironmentVariable('TAURI_SIGNING_PRIVATE_KEY', 'User')
        },
        @{
            Name = 'TAURI_SIGNING_PRIVATE_KEY_PASSWORD'
            Value = [Environment]::GetEnvironmentVariable('TAURI_SIGNING_PRIVATE_KEY_PASSWORD', 'Process')
            UserValue = [Environment]::GetEnvironmentVariable('TAURI_SIGNING_PRIVATE_KEY_PASSWORD', 'User')
        },
        @{
            Name = 'APK_RELEASE_KEY_PASSWORD'
            Value = [Environment]::GetEnvironmentVariable('APK_RELEASE_KEY_PASSWORD', 'Process')
            UserValue = [Environment]::GetEnvironmentVariable('APK_RELEASE_KEY_PASSWORD', 'User')
        },
        @{
            Name = 'ANDROID_KEY_PASSWORD'
            Value = [Environment]::GetEnvironmentVariable('ANDROID_KEY_PASSWORD', 'Process')
            UserValue = [Environment]::GetEnvironmentVariable('ANDROID_KEY_PASSWORD', 'User')
        },
        @{
            Name = 'ANDROID_KEY_BASE64'
            Value = [Environment]::GetEnvironmentVariable('ANDROID_KEY_BASE64', 'Process')
            UserValue = [Environment]::GetEnvironmentVariable('ANDROID_KEY_BASE64', 'User')
        },
        @{
            Name = 'NAIS_KEYSTORE_PASSWORD'
            Value = [Environment]::GetEnvironmentVariable('NAIS_KEYSTORE_PASSWORD', 'Process')
            UserValue = [Environment]::GetEnvironmentVariable('NAIS_KEYSTORE_PASSWORD', 'User')
        },
        @{
            Name = 'NAIS_KEYSTORE_BASE64'
            Value = [Environment]::GetEnvironmentVariable('NAIS_KEYSTORE_BASE64', 'Process')
            UserValue = [Environment]::GetEnvironmentVariable('NAIS_KEYSTORE_BASE64', 'User')
        }
    )

    $needles = @()
    foreach ($secret in $secretValues) {
        $values = @($secret.Value, $secret.UserValue) |
            Where-Object { -not [string]::IsNullOrEmpty($_) } |
            Select-Object -Unique

        $variants = foreach ($value in $values) {
            $value
            $value.Trim()
        }
        $variants = $variants | Where-Object { -not [string]::IsNullOrEmpty($_) } | Select-Object -Unique

        foreach ($variant in $variants) {
            $needles += @{
                Name = "$($secret.Name):utf8"
                Bytes = [Text.Encoding]::UTF8.GetBytes($variant)
            }
            $needles += @{
                Name = "$($secret.Name):utf16le"
                Bytes = [Text.Encoding]::Unicode.GetBytes($variant)
            }
        }
    }

    if ($needles.Count -eq 0) {
        return
    }

    $hits = @()
    foreach ($artifact in Get-ChildItem -LiteralPath $ReleaseRoot -Recurse -File) {
        foreach ($needle in $needles) {
            if (Test-FileContainsBytes -Path $artifact.FullName -Needle $needle.Bytes) {
                $hits += "$($artifact.FullName) [$($needle.Name)]"
            }
        }
    }

    if ($hits.Count -gt 0) {
        throw "Release secret scan failed. Matching secret bytes were found in: $($hits -join '; ')"
    }
}

function Assert-SourceArchiveHasNoPrivateEntries {
    param([string]$ArchivePath)

    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $blockedEntryPatterns = @(
        '(?i)(^|/)\.env(\..*)?$',
        '(?i)(^|/)(nais-release-key|NAIS_KEYSTORE_BASE64\.txt|keystore\.properties)$',
        '(?i)\.(pem|key|jks|keystore|p12|pfx)$'
    )

    $archive = [IO.Compression.ZipFile]::OpenRead($ArchivePath)
    try {
        $privateEntries = foreach ($entry in $archive.Entries) {
            $normalized = $entry.FullName.Replace('\\', '/')
            if ($blockedEntryPatterns | Where-Object { $normalized -match $_ }) {
                $normalized
            }
        }

        if ($privateEntries) {
            throw "Source archive contains private key material: $($privateEntries -join '; ')"
        }
    } finally {
        $archive.Dispose()
    }
}

$packageJson = Get-Content -LiteralPath (Join-Path $ProjectRoot 'package.json') -Raw | ConvertFrom-Json
$version = [string]$packageJson.version
$releaseRoot = Join-Path $OutputRoot "NAIS-blue-$version"
$sourceStage = Join-Path $releaseRoot 'source\NAIS-blue-public-source'
$sourceZip = Join-Path $releaseRoot "source\NAIS-blue_$version-public-source.zip"

if (Test-Path -LiteralPath $releaseRoot) {
    Remove-Item -LiteralPath $releaseRoot -Recurse -Force
}

New-Item -ItemType Directory -Force -Path $releaseRoot | Out-Null

$buildRelease = Join-Path $BuildRoot 'src-tauri\target\release'
$taggerServerExe = Join-Path $buildRelease 'tagger-server.exe'
if (-not (Test-Path -LiteralPath $taggerServerExe)) {
    throw "Required tagger sidecar is missing from release directory: $taggerServerExe"
}

$files = @(
    @{
        Source = Join-Path $buildRelease 'nais2.exe'
        Destination = Join-Path $releaseRoot 'portable\nais2.exe'
        Role = 'portable-exe'
    },
    @{
        Source = Join-Path $buildRelease "bundle\nsis\NAIS-blue_$($version)_x64-setup.exe"
        Destination = Join-Path $releaseRoot "installers\NAIS-blue_$($version)_x64-setup.exe"
        Role = 'nsis-installer'
    },
    @{
        Source = Join-Path $buildRelease "bundle\nsis\NAIS-blue_$($version)_x64-setup.exe.sig"
        Destination = Join-Path $releaseRoot "installers\NAIS-blue_$($version)_x64-setup.exe.sig"
        Role = 'nsis-updater-signature'
    },
    @{
        Source = Join-Path $buildRelease "bundle\msi\NAIS-blue_$($version)_x64_en-US.msi"
        Destination = Join-Path $releaseRoot "installers\NAIS-blue_$($version)_x64_en-US.msi"
        Role = 'msi-installer'
    },
    @{
        Source = Join-Path $buildRelease "bundle\msi\NAIS-blue_$($version)_x64_en-US.msi.sig"
        Destination = Join-Path $releaseRoot "installers\NAIS-blue_$($version)_x64_en-US.msi.sig"
        Role = 'msi-updater-signature'
    }
)

foreach ($file in $files) {
    Copy-RequiredFile -Source $file.Source -Destination $file.Destination
}

New-Item -ItemType Directory -Force -Path $sourceStage | Out-Null

$excludeDirs = @(
    '.git',
    '.omx',
    '.codex',
    'node_modules',
    'dist',
    'src-tauri\target',
    'NAIS-blue-main',
    'stylelab-frontend-sources-20260628-155859'
)

$excludeFiles = @(
    '.env',
    '.env.*',
    'nais-release-key',
    'NAIS_KEYSTORE_BASE64.txt',
    'keystore.properties',
    '*.pem',
    '*.key',
    '*.jks',
    '*.keystore',
    '*.p12',
    '*.pfx',
    '*.sqlite',
    '*.db',
    '*.log',
    '*.cache',
    '*.zip',
    '*.msi',
    '*.exe',
    '*.sig'
)

$robocopyArgs = @($ProjectRoot, $sourceStage, '/E', '/NFL', '/NDL', '/NJH', '/NJS', '/NP')
foreach ($dir in $excludeDirs) {
    $robocopyArgs += '/XD'
    $robocopyArgs += (Join-Path $ProjectRoot $dir)
}
foreach ($file in $excludeFiles) {
    $robocopyArgs += '/XF'
    $robocopyArgs += $file
}

& robocopy @robocopyArgs | Out-Null
if ($LASTEXITCODE -gt 7) {
    throw "robocopy failed with exit code $LASTEXITCODE"
}

Compress-Archive -LiteralPath $sourceStage -DestinationPath $sourceZip -CompressionLevel Optimal -Force
Assert-SourceArchiveHasNoPrivateEntries -ArchivePath $sourceZip
Remove-Item -LiteralPath $sourceStage -Recurse -Force

New-Item -ItemType Directory -Force -Path (Join-Path $releaseRoot 'docs'), (Join-Path $releaseRoot 'checksums') | Out-Null
Copy-RequiredFile -Source (Join-Path $ProjectRoot 'docs\ELO_AUDIT.md') -Destination (Join-Path $releaseRoot 'docs\ELO_AUDIT.md')
Copy-RequiredFile -Source (Join-Path $ProjectRoot 'docs\PATCHING_GUIDE.md') -Destination (Join-Path $releaseRoot 'docs\PATCHING_GUIDE.md')
Copy-RequiredFile -Source (Join-Path $ProjectRoot 'docs\PUBLIC_RELEASE.md') -Destination (Join-Path $releaseRoot 'docs\PUBLIC_RELEASE.md')

$artifactFiles = Get-ChildItem -LiteralPath $releaseRoot -Recurse -File |
    Where-Object { $_.FullName -notlike '*\checksums\SHA256SUMS.txt' -and $_.FullName -notlike '*\release-manifest.json' } |
    Sort-Object FullName

$checksumLines = foreach ($artifact in $artifactFiles) {
    $relative = $artifact.FullName.Substring($releaseRoot.Length + 1).Replace('\', '/')
    "$(Get-Sha256 $artifact.FullName)  $relative"
}

$checksumPath = Join-Path $releaseRoot 'checksums\SHA256SUMS.txt'
Set-Content -LiteralPath $checksumPath -Value $checksumLines -Encoding UTF8

$manifestArtifacts = foreach ($artifact in $artifactFiles) {
    $relative = $artifact.FullName.Substring($releaseRoot.Length + 1).Replace('\', '/')
    [PSCustomObject]@{
        path = $relative
        bytes = $artifact.Length
        sha256 = Get-Sha256 $artifact.FullName
    }
}

$manifest = [PSCustomObject]@{
    product = 'NAIS blue'
    version = $version
    generatedAt = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
    sourcePolicy = 'Clean public source archive excludes dependencies, build output, local caches, private keys, and personal runtime data.'
    artifacts = $manifestArtifacts
}

$manifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $releaseRoot 'release-manifest.json') -Encoding UTF8

Assert-NoReleaseSecrets -ReleaseRoot $releaseRoot

Write-Host "Public release ready: $releaseRoot"
