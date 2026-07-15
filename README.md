# DHC-6 Trainer Website

Static public hub for DHC-6 Trainer.

## Added in this patch

- `mobile.html` for Play Store/mobile positioning.
- `desktop.html` for desktop installer downloads.
- `live.html` for limited browser trainer preview positioning.
- `changelog.html` for release status.
- `downloads/desktop/` for installer files and release manifest.
- `tools/Build-DesktopInstallers-Windows.ps1` to build Windows desktop installers from the main project.
- `tools/Stage-DesktopInstallers.ps1` to copy installer outputs into this website.

## Desktop installer flow

1. Place this website folder beside your main DHC-6-Trainer project or set `-WebsiteRoot`.
2. From Windows PowerShell in the main project root, run:

```powershell
.\tools\Build-DesktopInstallers-Windows.ps1
```

3. Copy resulting installer files into `downloads/desktop/`.
4. Deploy the website to Netlify/GitHub Pages.

The website links expect these filenames:

- `DHC6TrainerDesktop-1.6.9.exe`
- `DHC6TrainerDesktop-1.6.9.msi`
- `DHC6TrainerDesktop-1.6.9.dmg`
- `DHC6TrainerDesktop-1.6.9.deb`
