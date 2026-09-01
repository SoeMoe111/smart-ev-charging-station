# Firebase integration setup

This branch connects the existing GitHub Pages interface to Firebase while
retaining local demo mode as a connection-failure fallback.

## Console settings

1. Enable **Authentication > Sign-in method > Anonymous**.
2. Publish `database.rules.json` in **Realtime Database > Rules**.
3. Confirm the registered web app is `smart-ev-github-web`.
4. Confirm `firebase-config.js` matches that web app configuration.

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
is still controlled by Authentication and Realtime Database rules.
