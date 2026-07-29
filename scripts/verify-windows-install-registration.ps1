[CmdletBinding()]
param(
    [string]$ProductName = 'NAIS blue',
    [string]$ExecutableName = 'Nais_blue.exe',
    [switch]$Repair
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

<#
This Windows-only release check depends on the standard HKCU/HKLM uninstall
registry and the installed executable's version resource. It connects NSIS
registration to the binary users actually launch, preventing portable/QA file
replacement from leaving stale Add/Remove Programs metadata. Audit is the safe
default; -Repair updates only DisplayVersion and verifies the write immediately.
#>

function Get-OptionalRegistryString {
    param(
        [Parameter(Mandatory)] [psobject]$Entry,
        [Parameter(Mandatory)] [string]$Name
    )

    $property = $Entry.PSObject.Properties[$Name]
    if ($null -eq $property -or $null -eq $property.Value) {
        return ''
    }

    return [string]$property.Value
}

$registryRoots = @(
    'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall',
    'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall',
    'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall'
)

$registrations = foreach ($root in $registryRoots) {
    if (-not (Test-Path -LiteralPath $root)) {
        continue
    }

    foreach ($key in Get-ChildItem -LiteralPath $root -ErrorAction Stop) {
        $entry = Get-ItemProperty -LiteralPath $key.PSPath -ErrorAction SilentlyContinue
        if ($null -eq $entry -or (Get-OptionalRegistryString -Entry $entry -Name 'DisplayName') -ne $ProductName) {
            continue
        }

        [pscustomobject]@{
            RegistryPath = $key.PSPath
            Entry = $entry
        }
    }
}

if (@($registrations).Count -eq 0) {
    throw "No Windows uninstall registration was found for '$ProductName'."
}

$results = foreach ($registration in @($registrations)) {
    $installLocation = (Get-OptionalRegistryString -Entry $registration.Entry -Name 'InstallLocation').Trim().Trim('"')
    if ([string]::IsNullOrWhiteSpace($installLocation)) {
        throw "The registration has no InstallLocation: $($registration.RegistryPath)"
    }

    $executablePath = Join-Path $installLocation $ExecutableName
    if (-not (Test-Path -LiteralPath $executablePath -PathType Leaf)) {
        throw "The registered executable does not exist: $executablePath"
    }

    $installedVersion = [string](Get-Item -LiteralPath $executablePath).VersionInfo.FileVersion
    $registeredVersion = Get-OptionalRegistryString -Entry $registration.Entry -Name 'DisplayVersion'
    if ([string]::IsNullOrWhiteSpace($installedVersion)) {
        throw "The installed executable has no FileVersion: $executablePath"
    }

    $status = if ($registeredVersion -eq $installedVersion) { 'matched' } else { 'mismatch' }
    if ($status -eq 'mismatch' -and $Repair) {
        try {
            Set-ItemProperty -LiteralPath $registration.RegistryPath -Name 'DisplayVersion' -Value $installedVersion -ErrorAction Stop
        } catch {
            throw "DisplayVersion repair requires write access to $($registration.RegistryPath). Run an elevated terminal for an all-users install. $($_.Exception.Message)"
        }

        $verifiedVersion = [string](Get-ItemPropertyValue -LiteralPath $registration.RegistryPath -Name 'DisplayVersion' -ErrorAction Stop)
        if ($verifiedVersion -ne $installedVersion) {
            throw "DisplayVersion repair verification failed: expected $installedVersion, found $verifiedVersion."
        }
        $registeredVersion = $verifiedVersion
        $status = 'repaired'
    }

    [pscustomobject]@{
        Status = $status
        ProductName = $ProductName
        RegisteredVersion = $registeredVersion
        ExecutableVersion = $installedVersion
        InstallLocation = $installLocation
        RegistryPath = $registration.RegistryPath
    }
}

$results | Format-Table Status, ProductName, RegisteredVersion, ExecutableVersion, InstallLocation -AutoSize

$mismatches = @($results | Where-Object Status -eq 'mismatch')
if ($mismatches.Count -gt 0) {
    throw "Found $($mismatches.Count) stale Windows uninstall registration(s). Re-run with -Repair using the install scope's registry permissions."
}
