<#
Build-DesktopInstallers-Windows.ps1
Run from the ROOT of the DHC-6-Trainer project on Windows.
Produces Windows EXE/MSI desktop installers for the Compose Desktop module.
#>
param(
    [string]$ProjectRoot = (Get-Location).Path,
    [string]$WebsiteRoot = "",
    [string]$Version = "1.6.9"
)

$ErrorActionPreference = "Stop"
Set-Location $ProjectRoot

if (!(Test-Path ".\gradlew.bat")) {
    throw "gradlew.bat was not found. Run this from the main DHC-6-Trainer project root."
}
if (!(Test-Path ".\desktop-app\build.gradle")) {
    throw "desktop-app/build.gradle was not found. Confirm the desktop-app module is included."
}

Write-Host "Building DHC-6 Trainer Desktop Windows installers..." -ForegroundColor Cyan
.\gradlew.bat --stop | Out-Null
.\gradlew.bat :desktop-app:clean :desktop-app:packageMsi :desktop-app:packageExe --stacktrace

$distRoot = Join-Path $ProjectRoot "desktop-app\build\compose\binaries\main"
$releaseDir = Join-Path $ProjectRoot "desktop-app\build\release-installers"
New-Item -ItemType Directory -Force -Path $releaseDir | Out-Null

$exe = Get-ChildItem $distRoot -Recurse -Filter "*.exe" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
$msi = Get-ChildItem $distRoot -Recurse -Filter "*.msi" | Sort-Object LastWriteTime -Descending | Select-Object -First 1

if ($exe) { Copy-Item $exe.FullName (Join-Path $releaseDir "DHC6TrainerDesktop-$Version.exe") -Force }
if ($msi) { Copy-Item $msi.FullName (Join-Path $releaseDir "DHC6TrainerDesktop-$Version.msi") -Force }

if (!$exe -and !$msi) { throw "Build completed but no EXE/MSI was found under $distRoot" }

$manifest = @()
Get-ChildItem $releaseDir -File | ForEach-Object {
    $manifest += [ordered]@{
        file = $_.Name
        bytes = $_.Length
        sha256 = (Get-FileHash $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    }
}
$manifest | ConvertTo-Json -Depth 4 | Set-Content (Join-Path $releaseDir "RELEASE_MANIFEST.windows.json") -Encoding UTF8

Write-Host "Installers staged at: $releaseDir" -ForegroundColor Green

if ($WebsiteRoot -ne "") {
    $webDownloads = Join-Path $WebsiteRoot "downloads\desktop"
    New-Item -ItemType Directory -Force -Path $webDownloads | Out-Null
    Copy-Item (Join-Path $releaseDir "*") $webDownloads -Force
    Write-Host "Copied installers to website downloads: $webDownloads" -ForegroundColor Green
}
