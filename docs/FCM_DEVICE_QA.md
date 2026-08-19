# Firebase / FCM device QA (P0)

## Credentials to place

### Backend (`apps/api`)
1. Download Firebase service account JSON
2. Save as e.g. `apps/api/secrets/firebase-adminsdk.json` (do not commit)
3. Set in `.env`:
   ```
   FIREBASE_CREDENTIALS_PATH=./secrets/firebase-adminsdk.json
   ```

### Mobile (`apps/mobile`)
1. Android: put `google-services.json` in project root (referenced from `app.json`)
2. iOS: `GoogleService-Info.plist` + enable Push Notifications + Background Modes (audio, voip, remote-notification)
3. Rebuild with EAS / `expo run:android` — **Expo Go cannot receive data-only FCM + Notifee full-screen**

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
# After API running with Firebase JSON:
# Initiate call to a device with registered FCM token and verify Logcat:
# [IncomingCallService] Notification displayed
# [FGS] start / stop around LIVE
```
