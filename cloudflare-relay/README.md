# Smart EV Auth + Database Relay

Competition-stable network path:

`ESP32 / GitHub Pages → Smart EV Relay → Firebase Auth + RTDB`

The Myanmar mobile network no longer needs to reach Firebase Authentication or
Realtime Database directly. Firebase Rules still authorize every database
request with the original Firebase ID token.

## Required relay setting

Create a runtime variable named `FIREBASE_API_KEY` using the public Web API key
from this project's `firebase-config.js`. Do not use a service-account key,
database secret, Google password, station password, or refresh token.

The deployed health response must include:

```json
{"ok":true,"service":"smart-ev-relay","authProxy":true}
```

`authProxy:false` means the relay code is running but its required variable is
missing.

## Endpoints

- `GET /health` — local relay readiness only.
- `GET /time` — UTC Unix time fallback when mobile NTP is unavailable.
- `POST /auth/anonymous` — anonymous Firebase login for the public website.
- `POST /auth/signin` — email/password Firebase login for the station/admin.
- `POST /auth/refresh` — refreshes an existing Firebase session.
- `/firebase/<allowed-root>/<path>.json` — authenticated RTDB REST relay.

Only `bookings`, `rfidUsers`, `accessEvents`, and `stations` are accepted as
database roots. Browser CORS is limited to `https://soemoe111.github.io`.
Origin-less ESP32 requests remain restricted by Firebase Rules.

## Local non-destructive verification

```bash
node --check worker.mjs
node --test worker.test.mjs cloudflare-check.test.mjs firebase-service.test.mjs
```

The tests use fake tokens and mocked upstream responses. They do not read,
write, or delete live Firebase data.

## Safe rollout order

1. Keep the flashed V6 firmware and current live website as rollback copies.
2. Deploy `worker.mjs` to the relay service.
3. Add the `FIREBASE_API_KEY` runtime variable and deploy.
4. Confirm `/health` reports `authProxy:true`.
5. Run `cloudflare-check.html`; all four rows must pass without VPN.
6. Publish the matching website files.
7. Compile and upload ESP32 V7, then run the physical safety checklist.

Never make Firebase root rules public to work around a network failure.
