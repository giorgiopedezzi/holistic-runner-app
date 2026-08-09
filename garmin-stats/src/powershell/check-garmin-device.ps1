param (
    [string]$DeviceName  # optional — if given, only this device is considered; otherwise auto-detect
)

# Lightweight presence check for the "Sync from device" button — walks the
# same MTP shell path as activities-file-extractor.ps1 but never copies
# anything, so it stays fast. Emits a single JSON line on stdout.
#
# Auto-detects the device by protocol rather than requiring its exact name:
# real drives report IsFileSystem = $true, MTP/portable devices report
# $false — that's what actually distinguishes "a USB device via MTP" from
# a local disk, without hardcoding (or mismatching) a name up front.

function Fail($reason) {
    Write-Output ('{"connected":false,"reason":"' + $reason + '"}')
    exit 0
}

try {
    $shell = New-Object -ComObject Shell.Application
    $computer = $shell.NameSpace(0x11) # 0x11 = 'This PC'

    $candidates = @($computer.Items() | Where-Object { -not $_.IsFileSystem })
    if ($DeviceName) {
        $named = @($candidates | Where-Object { $_.Name -eq $DeviceName })
        if ($named.Count -gt 0) { $candidates = $named }
    }

    if ($candidates.Count -eq 0) { Fail "device_not_found" }

    foreach ($device in $candidates) {
        $storage = $device.GetFolder.Items() | Where-Object { $_.Name -eq 'Internal Storage' }
        if (-not $storage) { continue }

        $garminDir = $storage.GetFolder.Items() | Where-Object { $_.Name -eq 'GARMIN' }
        if (-not $garminDir) { continue }

        $activityDir = $garminDir.GetFolder.Items() | Where-Object { $_.Name -eq 'Activity' }
        if (-not $activityDir) { continue }

        $escapedName = $device.Name -replace '\\', '\\\\' -replace '"', '\"'
        Write-Output ('{"connected":true,"name":"' + $escapedName + '"}')
        exit 0
    }

    Fail "activity_folder_not_found"
} catch {
    Fail "exception"
}
