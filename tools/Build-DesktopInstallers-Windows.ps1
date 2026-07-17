<#
Build-DesktopInstallers-Windows.ps1
Run from the ROOT of the DHC-6-Trainer-Desktop project on Windows.
Produces Windows EXE/MSI desktop installers for the Compose Desktop module.
#>
param(
    [string]$ProjectRoot = "",
    [string]$WebsiteRoot = "",
    [string]$Version = "1.7.0"
)

$ErrorActionPreference = "Stop"

function Resolve-DesktopProjectRoot {
    param([string]$RequestedRoot)

    $candidates = @()
    if ($RequestedRoot -ne "") {
        $candidates += $RequestedRoot
    }
    $candidates += (Get-Location).Path
    $candidates += (Join-Path $PSScriptRoot "..\..\DHC-6-Trainer-Desktop")
    $candidates += (Join-Path $PSScriptRoot "..\..\DHC-6-Trainer")

    foreach ($candidate in $candidates) {
        $resolved = Resolve-Path $candidate -ErrorAction SilentlyContinue
        if (!$resolved) { continue }
        $path = $resolved.Path
        $embedded = Join-Path $path "desktop-app"
        if ((Test-Path (Join-Path $path "gradlew.bat")) -and (Test-Path (Join-Path $embedded "build.gradle"))) {
            return $path
        }
        if ((Test-Path (Join-Path $path "gradlew.bat")) -and (Test-Path (Join-Path $path "build.gradle"))) {
            return $path
        }
    }

    throw "Could not find a desktop Gradle project. Pass -ProjectRoot `"C:\Android Studio\DHC-6-Trainer-Desktop`"."
}

$ProjectRoot = Resolve-DesktopProjectRoot $ProjectRoot
Set-Location $ProjectRoot

if (!(Test-Path ".\gradlew.bat")) {
    throw "gradlew.bat was not found in $ProjectRoot."
}

$isEmbeddedModule = Test-Path ".\desktop-app\build.gradle"
$moduleRoot = if ($isEmbeddedModule) { Join-Path $ProjectRoot "desktop-app" } else { $ProjectRoot }
$gradleTasks = if ($isEmbeddedModule) {
    @(":desktop-app:clean", ":desktop-app:packageMsi", ":desktop-app:packageExe")
} else {
    @("clean", "packageMsi", "packageExe")
}

Write-Host "Building DHC-6 Trainer Desktop Windows installers..." -ForegroundColor Cyan
.\gradlew.bat --stop | Out-Null
& .\gradlew.bat @gradleTasks --stacktrace

$distRoot = Join-Path $moduleRoot "build\compose\binaries\main"
$releaseDir = Join-Path $moduleRoot "build\release-installers"
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
