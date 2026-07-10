<#
.SYNOPSIS
Tracks a connected Android NAIS2 process for idle busy-loop and growth signals.

.DESCRIPTION
This script complements scripts/verify-android-port-contract.mjs: the contract
prevents known mobile regressions statically, while this runtime check samples
the installed app through adb. Keep NAIS2 visible and do not generate images
during the capture, because the thresholds intentionally describe an idle UI.

CSV samples and a JSON summary are written under .artifacts/android-idle unless
-OutputDirectory is supplied. A non-zero exit code means the device disconnected,
the app restarted, CPU stayed busy, or PSS grew beyond the configured idle limit.
#>
[CmdletBinding()]
param(
    [string]$Serial = $env:ANDROID_SERIAL,
    [string]$Package = 'com.sunakgo.nais2',
    [ValidateRange(10, 3600)]
    [int]$DurationSeconds = 60,
    [ValidateRange(1, 60)]
    [int]$IntervalSeconds = 5,
    [ValidateRange(1, 800)]
    [double]$BusyCpuThresholdPercent = 20,
    [ValidateRange(1, 20)]
    [int]$BusyConsecutiveSamples = 3,
    [ValidateRange(1, 4096)]
    [int]$PssGrowthThresholdMiB = 64,
    [string]$OutputDirectory = ''
)

$ErrorActionPreference = 'Stop'
$invariantCulture = [System.Globalization.CultureInfo]::InvariantCulture

$adbCandidates = @(@(
    (Get-Command adb.exe -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -First 1),
    $(if ($env:ANDROID_HOME) { Join-Path $env:ANDROID_HOME 'platform-tools\adb.exe' }),
    $(if ($env:ANDROID_SDK_ROOT) { Join-Path $env:ANDROID_SDK_ROOT 'platform-tools\adb.exe' }),
    $(if ($env:LOCALAPPDATA) { Join-Path $env:LOCALAPPDATA 'Android\Sdk\platform-tools\adb.exe' })
) | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -Unique)

if (-not $adbCandidates) {
    throw 'adb.exe was not found. Set ANDROID_HOME/ANDROID_SDK_ROOT or add platform-tools to PATH.'
}
$adb = $adbCandidates[0]

if (-not $Serial) {
    $connected = @(& $adb devices) |
        ForEach-Object { if ($_ -match '^(\S+)\s+device$') { $Matches[1] } }
    if ($connected.Count -ne 1) {
        throw "Expected exactly one authorized adb device, found $($connected.Count). Pass -Serial explicitly."
    }
    $Serial = $connected[0]
}

function Invoke-Adb {
    param([Parameter(Mandatory = $true)][string[]]$Arguments)

    $output = @(& $adb -s $Serial @Arguments 2>&1)
    if ($LASTEXITCODE -ne 0) {
        throw "adb failed ($LASTEXITCODE): adb -s $Serial $($Arguments -join ' ')`n$($output -join "`n")"
    }
    return $output
}

function Get-AppPid {
    $output = @(& $adb -s $Serial shell pidof $Package 2>$null)
    if ($LASTEXITCODE -ne 0) { return '' }
    return ($output -join '').Trim()
}

function Get-TotalPssKiB {
    $meminfo = Invoke-Adb -Arguments @('shell', 'dumpsys', 'meminfo', $Package)
    foreach ($line in $meminfo) {
        if ($line -match 'TOTAL PSS:\s+(\d+)') {
            return [int64]$Matches[1]
        }
    }
    return $null
}

function Get-ProcessSample {
    param([Parameter(Mandatory = $true)][string]$AppPid)

    $top = Invoke-Adb -Arguments @('shell', 'top', '-b', '-n', '1', '-p', $AppPid)
    $processLine = $top | Where-Object { $_ -match "^\s*$AppPid\s+" } | Select-Object -First 1
    if (-not $processLine) {
        throw "top did not return process $AppPid for $Package."
    }

    $columns = @($processLine.Trim() -split '\s+')
    if ($columns.Count -lt 10) {
        throw "Unexpected Android top output: $processLine"
    }

    $cpu = 0.0
    if (-not [double]::TryParse($columns[8], [System.Globalization.NumberStyles]::Float, $invariantCulture, [ref]$cpu)) {
        throw "Could not parse CPU percentage from Android top output: $processLine"
    }

    $threadCountText = (Invoke-Adb -Arguments @('shell', "ls /proc/$AppPid/task | wc -l")) -join ''
    $threadCount = 0
    [void][int]::TryParse($threadCountText.Trim(), [ref]$threadCount)

    return [pscustomobject]@{
        TimestampUtc = [DateTime]::UtcNow.ToString('o')
        Pid = [int]$AppPid
        State = $columns[7]
        CpuPercent = $cpu
        Resident = $columns[5]
        MemoryPercent = $columns[9]
        TotalPssKiB = Get-TotalPssKiB
        ThreadCount = $threadCount
    }
}

if (-not $OutputDirectory) {
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $OutputDirectory = Join-Path (Join-Path $PSScriptRoot '..\.artifacts\android-idle') $stamp
}
$OutputDirectory = [System.IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null

$initialPid = Get-AppPid
if (-not $initialPid) {
    throw "$Package is not running on $Serial. Launch the app before starting the idle check."
}

$samples = @()
$restartCount = 0
$busyStreak = 0
$maxBusyStreak = 0
$stopwatch = [System.Diagnostics.Stopwatch]::StartNew()

while ($stopwatch.Elapsed.TotalSeconds -lt $DurationSeconds) {
    $currentPid = Get-AppPid
    if (-not $currentPid) {
        throw "$Package stopped during the idle check."
    }
    if ($currentPid -ne $initialPid) {
        $restartCount += 1
        $initialPid = $currentPid
    }

    $sample = Get-ProcessSample -AppPid $currentPid
    $samples += $sample

    if ($sample.CpuPercent -ge $BusyCpuThresholdPercent) {
        $busyStreak += 1
        if ($busyStreak -gt $maxBusyStreak) { $maxBusyStreak = $busyStreak }
    } else {
        $busyStreak = 0
    }

    $samples | Export-Csv -NoTypeInformation -Encoding UTF8 -Path (Join-Path $OutputDirectory 'samples.csv')
    $remainingSeconds = $DurationSeconds - $stopwatch.Elapsed.TotalSeconds
    if ($remainingSeconds -gt 0) {
        Start-Sleep -Seconds ([math]::Min($IntervalSeconds, [math]::Ceiling($remainingSeconds)))
    }
}

$firstPss = $samples[0].TotalPssKiB
$lastPss = $samples[-1].TotalPssKiB
$pssGrowthKiB = if ($null -ne $firstPss -and $null -ne $lastPss) { $lastPss - $firstPss } else { $null }
$pssGrowthLimitKiB = $PssGrowthThresholdMiB * 1024
$busyLoopSuspected = $maxBusyStreak -ge $BusyConsecutiveSamples
$memoryGrowthSuspected = $null -ne $pssGrowthKiB -and $pssGrowthKiB -gt $pssGrowthLimitKiB
$passed = -not $busyLoopSuspected -and -not $memoryGrowthSuspected -and $restartCount -eq 0

$summary = [ordered]@{
    passed = $passed
    serial = $Serial
    package = $Package
    durationSeconds = [math]::Round($stopwatch.Elapsed.TotalSeconds, 1)
    sampleCount = $samples.Count
    maxCpuPercent = ($samples | Measure-Object CpuPercent -Maximum).Maximum
    averageCpuPercent = [math]::Round(($samples | Measure-Object CpuPercent -Average).Average, 3)
    maxBusyStreak = $maxBusyStreak
    restartCount = $restartCount
    firstPssKiB = $firstPss
    lastPssKiB = $lastPss
    pssGrowthKiB = $pssGrowthKiB
    minThreadCount = ($samples | Measure-Object ThreadCount -Minimum).Minimum
    maxThreadCount = ($samples | Measure-Object ThreadCount -Maximum).Maximum
    thresholds = [ordered]@{
        busyCpuPercent = $BusyCpuThresholdPercent
        busyConsecutiveSamples = $BusyConsecutiveSamples
        pssGrowthMiB = $PssGrowthThresholdMiB
    }
}

$summaryPath = Join-Path $OutputDirectory 'summary.json'
$summary | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $summaryPath -Encoding UTF8
$summary | ConvertTo-Json -Depth 4
Write-Host "Android idle samples: $(Join-Path $OutputDirectory 'samples.csv')"
Write-Host "Android idle summary: $summaryPath"

if (-not $passed) {
    exit 2
}
