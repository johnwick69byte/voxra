# Incoming Call Delivery & Duplicate-Screen Fix

## Root cause

The receiver had four independent paths that could each decide to show an
incoming call:

1. socket event `incoming_call` (`_layout.tsx`),
2. an FCM notification tap buffered by `callRouter.ts`,
3. `consumePendingCall()` on a cold start,
4. the `/calls/active` recovery request in `_layout.tsx`.

Path 4 bypassed the `claimCall`/`incomingOpen` guard used by the socket path and
called `router.push("/incoming-call")` directly. On a cold start the app could
therefore push **two** incoming screens for the same call.

When the top screen accepted, `router.replace("/call-screen")` exposed the lower
screen. Its “store is now empty” effect called `router.back()` and popped the
newly opened call screen, revealing the second incoming screen again. The second
Accept then hit `409 Call not ringing` (or re-joined Agora with the same uid),
which produced the Agora error and left the caller alone in a blank room.

Android also had two native/UI layers competing with the in-app screen:
CallKeep/Telecom and a Notifee full-screen notification. The FCM ring itself was
data-only, which relies on Android starting a headless JS task; on many devices
that task never runs for a killed app, so an offline creator with working
internet received nothing.

## Implemented flow

### One incoming-call gate

`app/_layout.tsx` now has one `openIncoming()` function. It:

- ignores the event if a call is already active or another incoming screen is
  open;
- sets `incomingOpen` synchronously **before** navigating;
- is used by the socket event, `callRouter` tap, persisted pending payload and
  `/calls/active` recovery;
- verifies notification taps with `/calls/active` before showing a screen, so a
  tap racing the ring timeout cannot open a dead call;
- opens `call-screen` directly if the call was already accepted.

`app/incoming-call.tsx` has a second safety net: a module-level
`visibleIncomingCallId` removes any duplicate route, and a stale screen may only
call `router.back()` while it is focused and no call is active. It can never pop
the live call screen.

`app/call-screen.tsx` has a matching `mountedCallScreenId` guard, and the
`call_accepted` handler processes a call id once. One call screen owns one Agora
join.

### Accept is idempotent

`call_service.accept_call` now accepts the receiver when the call is `RINGING`,
`ACCEPTED` or `LIVE`:

- first accept performs the atomic `RINGING -> ACCEPTED` transition, clears the
  ring lock, emits `call_accepted`, and returns the receiver token;
- a retry returns fresh receiver credentials with `already_accepted: true`, so a
  duplicate tap no longer becomes a 409 or a second Agora join;
- terminal/rejected/cancelled calls still return 409.

The client also recovers from a 409 by checking `/calls/active` and opening the
call screen if the call is already accepted.

### Background/killed delivery

Incoming calls are sent as **FCM notification messages**, not data-only:

- backend: `data_only=False`, `channel_id="incoming_calls_v2"`,
  `sound="sound_effect"`, high priority, 45s TTL, tag `call_id`;
- Android/iOS draw the notification even when the app process is killed;
- Android `index.js` background handler only persists the payload for cold-start
  recovery; it never draws a second notification;
- foreground `onMessage` routes the call into the same `openIncoming()` gate and
  lets the in-app screen play the ringtone;
- a tap cold-starts/background-resumes through
  `getInitialNotification` / `onNotificationOpenedApp`.

CallKeep/Telecom is no longer used for incoming calls. This removes the native
second call UI and the phone-account prompt.

### Custom sound

`apps/mobile/assets/sounds/sound_effect.mp3` is copied into native builds by
`apps/mobile/plugins/withNotificationSound.js`:

- Android: `android/app/src/main/res/raw/sound_effect.mp3`
- iOS: the app bundle + Xcode Copy Bundle Resources

`notificationChannels.ts` creates **`incoming_calls_v2`** with
`AndroidImportance.MAX` and `sound: "sound_effect"`. A new channel id is
required because Android freezes a channel’s sound after creation; existing
installs would keep the old default sound on `incoming_calls_v1`.

`push_service` derives the iOS name (`sound_effect.mp3`) and uses the Android
raw name (`sound_effect`) from the same `sound` argument.

### Offline push reliability

- Calls use `send_to_user`, so an FCM token reported as dead is purged instead
  of retried forever.
- The app re-uploads its FCM token on every foreground (`AppState` active), so a
  token rotation while backgrounded cannot silently break delivery.
- Permissions are still requested before `getToken()`, because Android 13+
  returns a token even when notification permission is denied.
- A creator who is offline but has working internet now gets an OS-drawn
  notification; no socket or headless JS is required.

## Verification checklist

Run these before shipping:

1. `cd apps/api && python -m pytest tests -q`
2. `cd apps/mobile && npx tsc --noEmit`
3. `cd apps/mobile && npm run verify:android` (runs prebuild and checks the
   custom raw sound)
4. Build with EAS (Expo Go cannot test Firebase/Notifee/Agora).
5. On the receiver device, test:
   - foreground: one incoming screen, one ringtone;
   - background: one notification with `sound_effect`, tap opens one screen;
   - killed: one notification with `sound_effect`, tap cold-starts one screen;
   - tap Accept twice / tap notification then Accept: one call screen, one Agora
     join, no 409, caller and receiver hear each other;
   - caller cancels and receiver declines: notification/screen clears, no stale
     pending call on next launch;
   - `/calls/active` recovery: relaunch during `RINGING`, `ACCEPTED` and `LIVE`.
6. Android channel note: a device that already created `incoming_calls_v2` with
   the wrong sound cannot be fixed by editing the channel. Bump the channel id
   or clear app data/reinstall.

## Files

- `apps/mobile/app/_layout.tsx`
- `apps/mobile/app/incoming-call.tsx`
- `apps/mobile/app/call-screen.tsx`
- `apps/mobile/src/services/callNavigation.ts`
- `apps/mobile/src/services/IncomingCallService.ts`
- `apps/mobile/src/services/notificationChannels.ts`
- `apps/mobile/index.js`
- `apps/mobile/plugins/withNotificationSound.js`
- `apps/api/app/services/call_service.py`
- `apps/api/app/services/push_service.py`
