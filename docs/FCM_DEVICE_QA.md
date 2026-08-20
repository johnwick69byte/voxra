# Firebase / FCM device QA (P0)

## Critical: two different JSON files

Do **not** reuse the Firebase Admin service-account JSON as the mobile Android client file.

| File | Who uses it | What it is | Where |
|------|-------------|------------|--------|
| **Service account** (`*-firebase-adminsdk-*.json`) | API on Render | Private key to **send** FCM | Render Secret File → `FIREBASE_CREDENTIALS_PATH` |
| **`google-services.json`** | Mobile Android app | Client config (project_id, mobilesdk_app_id, api_key) | `apps/mobile/google-services.json` (EAS build) |
| **`GoogleService-Info.plist`** | Mobile iOS app | Client config | `apps/mobile/` + Xcode capabilities |

If you put the **admin** JSON into `google-services.json`, FCM registration and data-only delivery will fail. Regenerate the Android app config from Firebase Console → Project settings → Your apps → Android → Download `google-services.json`.

## Credentials to place

### Backend (`apps/api` / Render)
1. Download Firebase **service account** JSON (Project settings → Service accounts → Generate new private key)
2. Upload as Render **Secret File** (e.g. `/etc/secrets/firebase-adminsdk.json`)
3. Set env:
   ```
   FIREBASE_CREDENTIALS_PATH=/etc/secrets/firebase-adminsdk.json
   ```
4. Confirm admin Live Ops / health shows FCM send success (not credential errors)

### Mobile (`apps/mobile`)
1. Android: put **client** `google-services.json` in project root (referenced from `app.json`)
2. iOS: `GoogleService-Info.plist` + Push Notifications + Background Modes (audio, voip, remote-notification)
3. Rebuild with EAS / `expo run:android` — **Expo Go cannot receive data-only FCM + Notifee full-screen**

## Killed-state ring checklist

| Step | Check |
|------|--------|
| 1 | Creator logged in once so `POST /api/profile/push-token` stored FCM token |
| 2 | Force-stop / swipe-kill creator app |
| 3 | Fan initiates call |
| 4 | API logs FCM send OK (no `messaging/invalid-argument` from bad credentials) |
| 5 | Device shows Notifee full-screen (`incoming_calls_v1`, CALL category) |
| 6 | **Accept** with JS cold: `index.js` `notifee.onBackgroundEvent` saves pending call → app opens → accept path |
| 7 | **Decline** hits `POST /calls/{id}/reject-token` with `decline_token` |
| 8 | Fan cancel while ringing dismisses notification |
| 9 | 45s no answer → MISSED + notification cancelled |

Background registration lives in [`apps/mobile/index.js`](../apps/mobile/index.js) (must stay the Expo entry — handlers before `expo-router/entry`).

## Expected behavior checklist

| Scenario | Expected |
|----------|----------|
| Creator app killed, fan starts call | Data-only FCM → Notifee CALL category full-screen with Accept/Decline |
| Accept from notification | Opens app → incoming/call screen → Agora join |
| Decline from notification | `POST /calls/{id}/reject-token` with `decline_token` (no auth) |
| Fan cancels while ringing | `cancel_call_notification` socket + notification dismissed |
| 45s no answer | MISSED + notification cancelled |
| Creator foreground | Socket `incoming_call` → in-app screen (single listener in `_layout`) |
| LIVE call + app backgrounded (Android) | Notifee foreground service (`ongoing_calls` channel) keeps process alive |
| App killed mid-LIVE then relaunched | `GET /calls/active` → restore to `call-screen` and rejoin Agora |
| iOS incoming (EAS build) | CallKeep `displayIncomingCall` when `react-native-callkeep` is linked |

## Android channels
- `incoming_calls_v1` — high importance, CALL category (`IncomingCallService`)
- `ongoing_calls` — low importance FGS while LIVE (`CallForegroundService`)
- Register push token via `POST /api/profile/push-token` after login

## iOS CallKit / VoIP
- Implemented via `CallKeepService` + `react-native-callkeep` (optional native module).
- No-ops gracefully in Expo Go; requires EAS/dev client.
- Ensure `UIBackgroundModes` includes `voip` + `audio` (already in `app.json`).

## Smoke commands
```bash
# After API running with Firebase Admin JSON on Render:
# Initiate call to a device with registered FCM token and verify Logcat:
# [IncomingCallService] Notification displayed
# [FGS] start / stop around LIVE
```
