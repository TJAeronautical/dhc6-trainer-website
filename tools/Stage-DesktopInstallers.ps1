<#
Stage-DesktopInstallers.ps1
Copies built desktop installers into the website downloads/desktop folder and writes a SHA-256 manifest.
#>
param(
    [Parameter(Mandatory=$true)][string]$InstallerDir,
    [string]$WebsiteRoot = (Get-Location).Path,
    [string]$Version = "1.7.0"
)
$ErrorActionPreference = "Stop"
$target = Join-Path $WebsiteRoot "downloads\desktop"
New-Item -ItemType Directory -Force -Path $target | Out-Null

$patterns = @("*.exe","*.msi","*.dmg","*.deb")
foreach ($pattern in $patterns) {
    Get-ChildItem $InstallerDir -Recurse -Filter $pattern | ForEach-Object {
        $ext = $_.Extension.ToLowerInvariant()
        $name = switch ($ext) {
            ".exe" { "DHC6TrainerDesktop-$Version.exe" }
            ".msi" { "DHC6TrainerDesktop-$Version.msi" }
            ".dmg" { "DHC6TrainerDesktop-$Version.dmg" }
            ".deb" { "DHC6TrainerDesktop-$Version.deb" }
        }
        Copy-Item $_.FullName (Join-Path $target $name) -Force
    }
}

$manifest = Get-ChildItem $target -File | Where-Object { $_.Extension -in ".exe", ".msi", ".dmg", ".deb" } | ForEach-Object {
    [ordered]@{
        file = $_.Name
        bytes = $_.Length
        sha256 = (Get-FileHash $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    }
}
$manifest | ConvertTo-Json -Depth 4 | Set-Content (Join-Path $target "RELEASE_MANIFEST.json") -Encoding UTF8
Write-Host "Website desktop downloads updated at $target" -ForegroundColor Green
