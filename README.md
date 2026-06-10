# DHC-6 Trainer Website

Static public hub for DHC-6 Trainer.

## Added in this patch

- `mobile.html` for Play Store/mobile positioning.
- `desktop.html` for desktop subscription, licence verification, and installed-app launch.
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

## Website-to-desktop launch

The live website now exposes installed-app launch links using:

```text
dhc6trainer://live
```

Buttons with `data-desktop-launch` try that protocol first and fall back to
`live.html` if the installed desktop app does not respond. The desktop app
should register the `dhc6trainer` URL protocol and route `/live` to its main
trainer/home experience. Do not pass licence keys or customer data through this
URL; activation still happens inside the desktop app.
