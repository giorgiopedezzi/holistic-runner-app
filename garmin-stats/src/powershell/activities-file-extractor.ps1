param (
    [string]$Target,
    [string]$ExistingJsonFiles,
    [string]$DeviceName = "Forerunner 965"
)

# Initialize Windows Shell COM Object to access the Virtual File System
$shell = New-Object -ComObject Shell.Application
$computer = $shell.NameSpace(0x11) # 0x11 = 'This PC' / 'Questo PC'
$garmin = $computer.Items() | Where-Object { $_.Name -eq $DeviceName }

if (-not $garmin) {
    Write-Error "Error: '$DeviceName' not found in 'This PC'. Check USB connection."
    exit 1
}

# Navigate through the MTP folder hierarchy safely
$storage = $garmin.GetFolder.Items() | Where-Object { $_.Name -eq 'Internal Storage' }
if (-not $storage) { Write-Error "Error: 'Internal Storage' not found."; exit 1 }

$garminDir = $storage.GetFolder.Items() | Where-Object { $_.Name -eq 'GARMIN' }
if (-not $garminDir) { Write-Error "Error: 'GARMIN' directory not found."; exit 1 }

$activityDir = $garminDir.GetFolder.Items() | Where-Object { $_.Name -eq 'Activity' }
if (-not $activityDir) { Write-Error "Error: 'Activity' folder not found."; exit 1 }

# Ensure local staging destination folder exists
if (-not (Test-Path -Path $Target)) {
    New-Item -ItemType Directory -Force -Path $Target | Out-Null
}

$destFolder = $shell.NameSpace($Target)
$filesOnDevice = $activityDir.GetFolder.Items()

# Hydrate the high-speed hash map from the temporary configuration file
$existingHash = @{}
if ($ExistingJsonFiles -and (Test-Path -Path $ExistingJsonFiles)) {
    $fileContent = Get-Content -Raw -Path $ExistingJsonFiles
    if ($fileContent) {
        $fileList = ConvertFrom-Json $fileContent
        foreach ($f in $fileList) {
            $existingHash[$f.ToLower()] = $true
        }
    }
}

# Resolve the full set of new files up front so the total is known before
# copying starts (lets the caller show a determinate progress bar).
$newFiles = @($filesOnDevice | Where-Object {
    $_.Name.ToLower().EndsWith(".fit") -and -not $existingHash.ContainsKey($_.Name.ToLower())
})

Write-Output "PROGRESS download 0 $($newFiles.Count)"

$copiedCount = 0
foreach ($file in $newFiles) {
    # 20 = Respond 'Yes to All' for overwrite protections + Hide progress window UI
    $destFolder.CopyHere($file, 20)
    $copiedCount++
    Write-Output "PROGRESS download $copiedCount $($newFiles.Count) $($file.Name)"
}

Write-Output "MTP Sync Finished. Processed $copiedCount new file(s)."
