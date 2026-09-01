# Smart EV Charging Station

Fifth Year Electrical Engineering prototype website for shared charging-slot
booking, RFID authorization and live ESP32 station telemetry.

The `firebase-integration` branch adds Firebase Anonymous Authentication,
owner-only Email/Password administration, Realtime Database synchronization
and a local demo fallback when Firebase is unavailable. The owner password is
never stored in the repository. See `FIREBASE_SETUP.md`.
