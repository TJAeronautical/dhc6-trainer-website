# DHC-6 Trainer API Backend Plan

Target domain: `api.dhc6trainer.com`  
Stack: Cloudflare Worker + D1 + R2  
Status: Planning only. Do not build or deploy from this document unless explicitly instructed.

## Purpose

The backend exists to support controlled desktop-app release access without placing protected installer binaries in the public GitHub repository or public website.

The first production version should:

1. Receive desktop access requests from the public website.
2. Store requests in Cloudflare D1.
3. Support manual approval or rejection.
4. Generate short-lived installer download access for approved users only.
5. Stream private installers from Cloudflare R2 only after approval checks pass.
6. Log request, approval, token, and download events.

The public website must continue to avoid direct `.exe`, `.msi`, `.dmg`, or `.deb` links.

## Architecture

```text
dhc6trainer.com              Public Cloudflare Pages website
api.dhc6trainer.com          Cloudflare Worker API
D1                            Requests, approvals, releases, tokens, audit log
R2                            Private desktop installer storage
Email                         Manual approval emails first; automated email later
```

Recommended R2 bucket:

```text
dhc6-trainer-private-releases
```

Recommended R2 object layout:

```text
desktop/windows/1.7.0/DHC6TrainerDesktop-1.7.0.exe
desktop/windows/1.7.0/DHC6TrainerDesktop-1.7.0.msi
desktop/windows/1.7.0/manifest.json
desktop/windows/1.7.0/checksums.txt
```

R2 installer objects must remain private. Do not enable public bucket access for installers.

## API endpoints

### Public endpoints

#### `GET /health`

Basic service health check.

Example response:

```json
{
  "ok": true,
  "service": "dhc6-trainer-api",
  "version": "1"
}
```

#### `POST /v1/desktop/access-requests`

Receives desktop access requests from `access.html`.

Example request:

```json
{
  "name": "Trevor Smith",
  "email": "pilot@example.com",
  "organization": "Example Air",
  "role": "Pilot",
  "platform": "windows",
  "installerType": "exe",
  "reason": "Desktop evaluation for DHC-6 recurrent prep"
}
```

Example response:

```json
{
  "ok": true,
  "requestId": "req_...",
  "status": "pending"
}
```

Initial validation rules:

```text
name: required
email: required, valid email format
platform: windows only for first release
installerType: exe | msi for first release
reason: optional
```

Reject unavailable platforms with `400`.

#### `GET /v1/desktop/releases`

Public metadata only. Do not return protected download links.

Example response:

```json
{
  "current": {
    "version": "1.7.0",
    "platforms": ["windows"],
    "installerTypes": ["exe", "msi"],
    "releaseNotes": "Desktop trainer build for controlled release."
  }
}
```

#### `POST /v1/desktop/download-token`

Approved user requests short-lived installer access.

Example request:

```json
{
  "email": "pilot@example.com",
  "accessCode": "one-time-or-issued-code",
  "platform": "windows",
  "installerType": "exe"
}
```

Example response:

```json
{
  "ok": true,
  "downloadUrl": "https://api.dhc6trainer.com/v1/desktop/download/dl_...",
  "expiresAt": "2026-06-03T12:00:00Z"
}
```

Rules:

```text
User must have an approved access request.
Access code must match the stored hash.
Installer type must be approved for that user.
A short-lived download token is generated and stored as a hash.
```

Recommended token lifetime:

```text
15 minutes for normal generated links
24 hours maximum for manually emailed access links
```

#### `GET /v1/desktop/download/:token`

Streams the private installer from R2 after validation.

Rules:

```text
Token must exist.
Token must not be expired.
Token must not be revoked.
Token must not exceed max use count.
Token must belong to an approved access request.
Requested release/platform/installer type must match approval.
Every successful and failed attempt must be logged.
```

### Admin endpoints

For v1, protect admin endpoints with a strong Worker secret:

```text
Authorization: Bearer <ADMIN_API_TOKEN>
```

Later this can move to Cloudflare Access or a real admin portal.

#### `GET /v1/admin/access-requests`

List access requests.

Useful filters:

```text
?status=pending
?email=pilot@example.com
?limit=50
```

#### `POST /v1/admin/access-requests/:id/approve`

Approve a request and issue an access code.

Example request:

```json
{
  "approvedInstallerTypes": ["exe", "msi"],
  "notes": "Approved for Windows desktop evaluation."
}
```

Example response:

```json
{
  "ok": true,
  "status": "approved",
  "accessCode": "generated-code"
}
```

The access code must only be shown once and stored as a hash.

#### `POST /v1/admin/access-requests/:id/reject`

Reject a request.

Example request:

```json
{
  "reason": "Unable to verify request."
}
```

#### `POST /v1/admin/releases`

Register private installer metadata after the installer has been uploaded to R2.

Example request:

```json
{
  "version": "1.7.0",
  "platform": "windows",
  "installerType": "exe",
  "r2ObjectKey": "desktop/windows/1.7.0/DHC6TrainerDesktop-1.7.0.exe",
  "sha256": "actual-sha256-here",
  "sizeBytes": 123456789,
  "isActive": true
}
```

#### `GET /v1/admin/audit-log`

Review request, approval, token, and download activity.

## D1 schema

### `desktop_access_requests`

```sql
CREATE TABLE desktop_access_requests (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,

  name TEXT NOT NULL,
  email TEXT NOT NULL,
  organization TEXT,
  role TEXT,
  platform TEXT NOT NULL,
  installer_type TEXT NOT NULL,
  reason TEXT,

  status TEXT NOT NULL DEFAULT 'pending',
  approved_at TEXT,
  approved_by TEXT,
  rejected_at TEXT,
  rejected_reason TEXT,

  access_code_hash TEXT,
  notes TEXT,

  ip_hash TEXT,
  user_agent TEXT
);
```

Status values:

```text
pending
approved
rejected
revoked
```

### `desktop_releases`

```sql
CREATE TABLE desktop_releases (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  version TEXT NOT NULL,

  platform TEXT NOT NULL,
  installer_type TEXT NOT NULL,
  r2_object_key TEXT NOT NULL,

  sha256 TEXT,
  size_bytes INTEGER,
  release_notes TEXT,
  is_active INTEGER NOT NULL DEFAULT 0
);
```

### `download_tokens`

```sql
CREATE TABLE download_tokens (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,

  request_id TEXT NOT NULL,
  release_id TEXT NOT NULL,

  token_hash TEXT NOT NULL,
  max_uses INTEGER NOT NULL DEFAULT 1,
  used_count INTEGER NOT NULL DEFAULT 0,
  last_used_at TEXT,

  revoked_at TEXT,

  FOREIGN KEY (request_id) REFERENCES desktop_access_requests(id),
  FOREIGN KEY (release_id) REFERENCES desktop_releases(id)
);
```

### `audit_log`

```sql
CREATE TABLE audit_log (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,

  actor_type TEXT NOT NULL,
  actor_ref TEXT,
  action TEXT NOT NULL,

  target_type TEXT,
  target_id TEXT,

  ip_hash TEXT,
  user_agent TEXT,
  metadata_json TEXT
);
```

Actor types:

```text
public_user
approved_user
admin
system
```

Recommended actions:

```text
access_request_created
access_request_approved
access_request_rejected
access_request_revoked
download_token_created
download_started
download_denied
release_registered
release_activated
```

## Approval workflow

### Phase 1: manual-safe workflow

```text
1. User opens desktop.html.
2. User clicks Request desktop access.
3. access.html submits POST /v1/desktop/access-requests.
4. Worker stores request in D1 as pending.
5. Owner reviews pending requests through admin endpoint or exported list.
6. Owner approves request.
7. Worker generates access code.
8. Owner emails approved user using the existing approved-user template.
9. User enters email + access code.
10. Worker creates short-lived download token.
11. User downloads EXE/MSI through /v1/desktop/download/:token.
12. Every access attempt is logged.
```

### Phase 2: semi-automated workflow

```text
1. Admin approves request.
2. Worker sends approval email automatically.
3. Email contains short-lived access link.
4. Link opens a download choice page.
5. User selects EXE or MSI.
6. Token is generated and installer streams from R2.
```

### Phase 3: release portal

```text
1. Admin login.
2. Release upload/register screen.
3. Approve/revoke users.
4. View download logs.
5. Rotate active release version.
```

## Installer access flow

Recommended flow:

```text
Public page
  -> Request desktop access
    -> D1 pending request
      -> Manual admin approval
        -> access code issued
          -> user requests token
            -> D1 verifies approval
              -> short-lived download token
                -> Worker streams private R2 object
```

Avoid:

```text
Website link -> /downloads/desktop/DHC6TrainerDesktop-1.7.0.exe
```

Do not commit installer files to GitHub.
Do not expose permanent R2 public URLs.

## Security rules

### Access control

```text
Admin endpoints require Authorization: Bearer <ADMIN_API_TOKEN>.
Installer objects stay in private R2.
Download tokens are random, hashed in D1, short-lived, and single-use by default.
Access codes are hashed in D1, never stored as plain text.
Every download attempt is logged.
Revoked users cannot generate new download tokens.
```

### Abuse prevention

```text
Rate-limit POST /v1/desktop/access-requests by IP hash and email.
Rate-limit POST /v1/desktop/download-token by IP hash and email.
Reject duplicate pending requests from the same email.
Reject excessive failed access-code attempts.
Keep request body size small.
Validate platform and installer type against an allowlist.
```

### Privacy

Store only what is needed:

```text
name
email
organization
role
platform
installer preference
reason
approval status
audit metadata
```

Hash IP addresses instead of storing raw IP addresses where practical.

### CORS

Allow public browser requests only from:

```text
https://dhc6trainer.com
https://www.dhc6trainer.com
```

Do not use wildcard CORS for admin endpoints.

### Secrets

Use Cloudflare Worker secrets for:

```text
ADMIN_API_TOKEN
TOKEN_SIGNING_SECRET
ACCESS_CODE_PEPPER
EMAIL_API_KEY later, if email sending is automated
```

Never commit secrets to GitHub.

## Implementation order

### Step 1: planning files only

Track this document in the website repo as:

```text
API_BACKEND_PLAN.md
```

No Worker code yet.

### Step 2: create separate backend folder later

When implementation is approved, use:

```text
backend/dhc6-api-worker
```

Keep backend code separate from public website HTML.

### Step 3: create Worker skeleton later

Planned structure:

```text
backend/
  dhc6-api-worker/
    src/
      index.ts
      routes/
        health.ts
        desktopAccess.ts
        admin.ts
      lib/
        cors.ts
        auth.ts
        ids.ts
        crypto.ts
        validation.ts
        audit.ts
    migrations/
      0001_initial.sql
    wrangler.toml
    package.json
```

### Step 4: add D1 schema

Create D1 database and migration only after the schema is final.

### Step 5: add R2 bucket binding

Bind private release bucket to Worker.

### Step 6: implement public request endpoint

Build:

```text
GET /health
POST /v1/desktop/access-requests
GET /v1/desktop/releases
```

### Step 7: implement admin approval endpoints

Build:

```text
GET /v1/admin/access-requests
POST /v1/admin/access-requests/:id/approve
POST /v1/admin/access-requests/:id/reject
```

### Step 8: implement download-token flow

Build:

```text
POST /v1/desktop/download-token
GET /v1/desktop/download/:token
```

### Step 9: connect website form

Patch only:

```text
access.html
desktop.html if needed
```

The public pages should still make it clear that desktop access is controlled and manually approved.

### Step 10: local test later

```powershell
cd "C:\Android Studio\DHC-6-Trainer-Website-GitHub\backend\dhc6-api-worker"

npm install
npx wrangler dev
```

### Step 11: deploy later

```powershell
npx wrangler deploy
```

Then connect:

```text
api.dhc6trainer.com
```

### Step 12: production verification later

```powershell
Invoke-RestMethod "https://api.dhc6trainer.com/health"
```

Then test request creation, admin approval, token generation, and installer download using a non-public test installer file first.

## First release recommendation

Keep v1 intentionally small:

```text
GET  /health
POST /v1/desktop/access-requests
GET  /v1/admin/access-requests
POST /v1/admin/access-requests/:id/approve
POST /v1/desktop/download-token
GET  /v1/desktop/download/:token
```

Do not add login, subscriptions, automated billing, or organization management in the first backend pass.

The first backend should do one controlled job:

```text
approved user -> short-lived installer access -> private R2 download
```
