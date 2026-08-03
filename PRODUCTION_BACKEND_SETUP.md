# Production backend setup

The Android production endpoints are:

- `https://dhc6trainer.com/api/ai/oral-exam`
- `https://dhc6trainer.com/api/play/validate-purchase`

## Required Cloudflare configuration

Keep these values as encrypted secrets:

- `OPENAI_API_KEY`
- `FIREBASE_WEB_API_KEY`
- `GOOGLE_PLAY_SERVICE_ACCOUNT_EMAIL`
- `GOOGLE_PLAY_SERVICE_ACCOUNT_PRIVATE_KEY`

Add this non-secret text variable in **Workers & Pages > dhc6-trainer-website > Settings > Variables and Secrets**:

- `FIREBASE_PROJECT_NUMBER`: the numeric project number shown in Firebase Console under **Project settings > General > Your project > Project number**.

Optionally add `FIREBASE_ANDROID_APP_ID` with the Android Firebase App ID from the same settings page. When present, the backend also rejects correctly signed App Check tokens issued to any other app in the project.

Do not put secret values in this repository or in `wrangler.jsonc`.

## Deployment verification

1. Deploy the repaired GitHub commit to Cloudflare.
2. Confirm the deployment has all required bindings and receives 100% of production traffic.
3. Confirm an unauthenticated request is rejected:

   ```sh
   curl -i -X POST https://dhc6trainer.com/api/ai/oral-exam \
     -H 'Content-Type: application/json' \
     --data '{"instructions":"test","history":[],"message":"test"}'
   ```

   Expected status: `401` with `firebase_token_missing`.

4. Test both endpoints from a debug build signed into Firebase and configured with the App Check debug provider. Production builds must use Play Integrity.

## Android release configuration

Set only endpoint URLs in the Android project's local `local.properties`:

```properties
ai_examiner_url=https://dhc6trainer.com/api/ai/oral-exam
billing_validation_url=https://dhc6trainer.com/api/play/validate-purchase
```

Then run the Android production gate:

```powershell
.\gradlew.bat playStoreBundle --no-configuration-cache
```
