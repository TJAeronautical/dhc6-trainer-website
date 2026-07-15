# DHC-6 Trainer Desktop Release Operations Checklist

This document defines how DHC-6 Trainer desktop releases are handled until the private licensing backend is deployed.

## Release status

The Windows desktop app is a controlled-access product for approved users.

Primary users:
- DHC-6 / Twin Otter pilots
- Instructors
- Training organizations
- Approved desktop testers
- Classroom / briefing-room users

Public pages:
- https://dhc6trainer.com/desktop.html
- https://dhc6trainer.com/access.html

Future backend:
- https://api.dhc6trainer.com

## Installer file rules

Desktop installer files must not be committed to the website repository.

Do not commit:
- downloads/desktop/*.exe
- downloads/desktop/*.msi
- downloads/desktop/*.dmg
- downloads/desktop/*.deb

Current Windows installer names:
- DHC6TrainerDesktop-1.6.9.exe
- DHC6TrainerDesktop-1.6.9.msi

Before every push, confirm:
- git status --ignored
- git ls-files downloads/desktop

Expected:
- Installer files may appear under ignored files.
- Installer files must not appear in git ls-files.

## Manual request workflow

User flow:
1. User visits desktop.html.
2. User clicks request desktop access.
3. User opens access.html.
4. User submits or copies request details.
5. Admin reviews request manually.
6. If approved, admin sends controlled installer access by email.

Request should include:
- Name
- Email
- Role or organization
- Intended use
- Preferred installer type: EXE or MSI

## Manual approval checklist

Before issuing access, check:
- Is the requester legitimate?
- Do they have a clear DHC-6 / Twin Otter training use case?
- Is the request for personal study, instructor use, or organization use?
- Do they understand this is training support only?
- Do they need EXE or MSI?
- Should access be temporary or ongoing?

Decision:
- Approved
- Hold for more information
- Declined

## Distribution options

Recommended now:
- Private cloud storage with expiring links.

Acceptable:
- Direct transfer only if file size allows.
- GitHub Releases only as admin backup, not as protected public website links.

Do not place public GitHub release installer links on the website.

## Checksums

Generate SHA256 checksums for each installer before issuing access:
- Get-FileHash .\DHC6TrainerDesktop-1.6.9.exe -Algorithm SHA256
- Get-FileHash .\DHC6TrainerDesktop-1.6.9.msi -Algorithm SHA256

Store checksums privately with the release notes.

## Private access register

Track approvals outside the public repo.

Suggested private file:
- DesktopAccessRegister.xlsx
- DesktopAccessRegister.csv

Do not commit this file.

Suggested columns:
- Request date
- Name
- Email
- Organization
- Role
- Intended use
- Installer type
- Version issued
- Approval status
- Access link issued
- Link expiry
- Notes

## Future backend plan

Future domain:
- https://api.dhc6trainer.com

Recommended stack:
- Cloudflare Workers for API
- Cloudflare R2 for private installer storage
- Cloudflare D1 or KV for license/access records
- Cloudflare Turnstile for abuse protection

Future backend endpoints:
- POST /desktop/request-access
- POST /desktop/verify-license
- POST /desktop/download
- POST /admin/issue-license
- POST /admin/revoke-license

Backend responsibilities:
- Store approved users
- Validate email and license key
- Issue short-lived signed download URLs
- Track download attempts
- Rate-limit abuse
- Revoke access when needed

Backend must not expose:
- Permanent installer URLs
- Storage credentials
- License secrets
- Admin-only data
- Raw customer lists

## Release day checklist

Before issuing desktop access:
- Build EXE/MSI.
- Confirm app opens on Windows.
- Confirm version shown in app.
- Confirm installer names are correct.
- Generate SHA256 checksums.
- Store installers outside Git repo.
- Confirm installers are ignored and untracked.
- Confirm website has no public installer links.
- Upload installer to private storage.
- Create expiring private link.
- Send approved user email.
- Record approval in private access register.

## Approved user email template

Subject:
DHC-6 Trainer Desktop Access

Message:
Hello,

Your DHC-6 Trainer desktop access request has been reviewed and approved.

Version:
DHC6TrainerDesktop 1.6.9

Installer:
[EXE/MSI]

Download:
[private time-limited link]

Important:
DHC-6 Trainer is a study and training-support tool only. It is not an approved AFM, QRH, MEL, checklist, company manual, or operational authority. Always use approved aircraft documents, company procedures, and applicable regulations for actual aircraft operation.

Regards,
TJ Aeronautical
