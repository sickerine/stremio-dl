$ErrorActionPreference = "Stop"

$repo = "sickerine/stremio-dl"
$api = "https://api.github.com/repos/$repo/releases/latest"
$asset = "stremio-dl-windows-x64.exe"
$installDir = "$env:LOCALAPPDATA\stremio-dl"

Write-Host "Fetching latest release..."
$release = Invoke-RestMethod -Uri $api
$url = ($release.assets | Where-Object { $_.name -eq $asset }).browser_download_url

if (-not $url) {
    Write-Host "Could not find $asset in latest release" -ForegroundColor Red
    exit 1
}

$version = $release.tag_name
Write-Host "Latest: $version ($asset)"

# Kill running instance
Get-Process -Name "stremio-dl*" -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 1

# Download
New-Item -ItemType Directory -Path $installDir -Force | Out-Null
$dest = "$installDir\stremio-dl.exe"
Write-Host "Downloading..."
Invoke-WebRequest -Uri $url -OutFile $dest

Write-Host "Installed to $dest"

# Run
Start-Process -FilePath $dest
Write-Host "Done - $version is running" -ForegroundColor Green
