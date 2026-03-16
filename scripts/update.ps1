# Usage:
#   Manual:  irm https://raw.githubusercontent.com/sickerine/stremio-dl/main/scripts/update.ps1 | iex
#   Server:  powershell -File update.ps1 -pid 12345

param([int]$pid = 0)

$ErrorActionPreference = "Stop"
$logFile = "$env:TEMP\stremio-dl-update.log"
Start-Transcript -Path $logFile -Append

$repo = "sickerine/stremio-dl"
$api = "https://api.github.com/repos/$repo/releases/latest"
$asset = "stremio-dl-windows-x64.exe"
$installDir = "$env:LOCALAPPDATA\stremio-dl"

Write-Output "Fetching latest release..."
$release = Invoke-RestMethod -Uri $api
$url = ($release.assets | Where-Object { $_.name -eq $asset }).browser_download_url

if (-not $url) {
    Write-Error "Could not find $asset in latest release"
    exit 1
}

$version = $release.tag_name
Write-Output "Latest: $version ($asset)"

# Kill running instance — by exact PID if given, otherwise by name
if ($pid -gt 0) {
    Write-Output "Killing PID $pid..."
    Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue
} else {
    Write-Output "Killing by name..."
    Get-Process -Name "stremio-dl*" -ErrorAction SilentlyContinue | Stop-Process -Force
}
Start-Sleep -Seconds 2

New-Item -ItemType Directory -Path $installDir -Force | Out-Null
$dest = "$installDir\stremio-dl.exe"
Write-Output "Downloading..."
Invoke-WebRequest -Uri $url -OutFile $dest

Write-Output "Launching..."
Start-Process -FilePath $dest
Write-Output "Done - $version"
Stop-Transcript
