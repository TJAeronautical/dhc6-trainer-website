# DHC-6 Trainer Website

Static marketing and compliance website for the DHC-6 Trainer Android app.

Live URLs:

- Homepage: https://dhc6-trainer.netlify.app
- Privacy Policy: https://dhc6-trainer.netlify.app/privacy.html
- Account/Data Deletion: https://dhc6-trainer.netlify.app/account-deletion.html

Developer: TJ Aeronautical  
Support: tj.aeronautical@outlook.com

## Deployment

Static HTML site intended for Netlify deployment from GitHub.

## Current status

- Android closed testing in progress.
- Play Store link placeholder should be replaced once the public listing or approved testing link is ready.
- Screenshot assets are stored in `assets/screenshots/`.


## GitHub Pages migration

This build is GitHub Pages-ready. It includes `.nojekyll`, relative links, and a simple `404.html`. Enable Pages from the `main` branch `/root` folder.


## 2026 Website Hub Patch

This patch expands the static site into the official DHC-6 Trainer hub:

- `index.html` — revised homepage for Mobile + Desktop + Live Preview strategy
- `mobile.html` — Google Play conversion page
- `desktop.html` — desktop release/download guidance page
- `live.html` — limited live web trainer preview plan
- `changelog.html` — release/status page

Desktop installers are not included. Build them from the Compose Desktop native distribution task and then replace the placeholder desktop download buttons with real release links.
