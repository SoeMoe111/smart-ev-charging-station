# Firebase integration setup

This branch connects the existing GitHub Pages interface to Firebase while
retaining local demo mode as a connection-failure fallback.

## Console settings

1. Enable **Authentication > Sign-in method > Anonymous**.
2. Enable **Authentication > Sign-in method > Email/Password**.
3. Create the project-owner account in **Authentication > Users**.
4. Confirm that account has UID `fM6p0sQzQbaqKAmuQFGA6mNolJU2`.
5. Publish `database.rules.json` in **Realtime Database > Rules**.
6. Add `soemoe111.github.io` under **Authentication > Settings > Authorized domains**.
7. Confirm the registered web app is `smart-ev-github-web`.
8. Confirm `firebase-config.js` matches that web app configuration.

Never store the owner password in GitHub, JavaScript, Realtime Database or
ESP32 firmware. The website accepts it only in the Firebase sign-in dialog.

## Access model

- Public visitors automatically receive an anonymous Firebase account.
- Anonymous visitors can view the demo schedule, create a booking and cancel
  only the booking created by their current browser account.
- Only the exact owner UID above can clear all bookings, manage RFID users,
  view access events or write station data.
- The RFID administration page is hidden until the owner signs in.
- Use demonstration names and plate numbers only because the shared booking
  schedule is readable by authenticated visitors.
- A separate device identity will be added before ESP32 telemetry is allowed
  to write directly to `stations/`.

## Realtime Database paths

```text
bookings/{bookingId}
rfidUsers/{normalizedUid}
accessEvents/{eventId}
stations/demo-station/slots/slot1
stations/demo-station/slots/slot2
stations/demo-station/sessions/{sessionId}
stations/demo-station/faults/{faultId}
```

## Slot telemetry shape

```json
{
  "state": "ready",
  "relay": false,
  "protection": "normal",
  "voltage": 4.8,
  "current": 0.01,
  "power": 0.048,
  "temperature": 27,
  "soc": 43,
  "updatedAt": 0
}
```

The browser Firebase configuration is not a server password. Database access
is controlled by Authentication and Realtime Database rules. Restrict the web
API key to the project web domains and required Firebase APIs in Google Cloud
before the final demonstration.
