# Incoming Call & Presence — What Was Broken

Fixes for the round of bugs where calls never rang, Active never populated, and
pending creators were stuck. Each entry names the actual cause, so it can be
recognised if it regresses.

---

## 1. Notification permission was never requested on Android

**Symptom:** a rationale popup appeared, then nothing. No system dialog.

`permissions.ts` called `firebase.messaging().requestPermission()`. That method
is **iOS-only** — on Android it returns immediately:

```js
requestPermission(permissions) {
  if (isAndroid) {
    return Promise.resolve(AuthorizationStatus.AUTHORIZED);   // never prompts
  }
```

**Fix:** request `PermissionsAndroid.POST_NOTIFICATIONS` on Android (Android 13+
only; earlier versions have no runtime notification permission). Camera, mic and
notifications are now requested together right after login, instead of at the
moment a call arrives.

---

## 2. Incoming calls never rang on a killed app

**Symptom:** caller hears ringing, receiver sees nothing at all — no screen, no
notification.

The ring was sent as a **data-only** FCM message. Android does not deliver
data-only messages to a force-stopped app; they are only useful while a process
is already alive.

**Fix:** the ring is now a *notification* message (`data_only=False`) with:

| Field | Value | Why |
|---|---|---|
| `android.priority` | `high` | wakes the device |
| `notification_priority` | `max` | heads-up, not a silent tray entry |
| `visibility` | `public` | shows the caller on the lock screen |
| `channel_id` | `incoming_calls_v1` | MAX importance, sound, vibration |
| `ttl` | ring timeout | stops a stale ring arriving late |

Two related defects in the same path:

- **Failed pushes reported success.** When Firebase was not configured, `send_push`
  logged a "dry-run" and returned `True`, so a broken server looked healthy and
  the missing ring was invisible in metrics. It now logs an error and increments
  `metrics:fcm_fail`.
- **`click_action: "OPEN_ACTIVITY"`** was set but no activity declares that
  intent action, so it was ignored. Removed; taps route via the data payload.

---

## 3. Both call participants joined Agora as uid 0

**Symptom:** call connects, screen says Connected, but there is no audio.

`build_rtc_token()` was called without a uid, so both sides joined as `0`. Agora
treats uid 0 as "auto-assign" and the second joiner is taken for a duplicate of
the first, so one participant is evicted.

**Fix:** `agora_service.uid_for_user()` derives a stable, nonzero 31-bit uid from
the user id. Each participant gets its own token, and the peer's uid is returned
alongside so the UI can identify the remote participant.

---

## 4. Full-screen call UI never appeared on Android

**Symptom:** no WhatsApp-style incoming call screen.

`reportIncomingCallToCallKit` was invoked only when `Platform.OS === "ios"`, so
Android never registered the call with Telecom. The `dispatch` is now
unconditional.

CallKeep's `displayIncomingCall` is **silently ignored** without a phone account
(the "Allow Simple Talk to manage calls?" dialog). The app now checks
`hasPhoneAccount()` after login and offers Settings if it is missing, rather than
failing invisibly.

Added the permissions CallKeep needs to `app.json`:
`MANAGE_OWN_CALLS`, `READ_PHONE_NUMBERS`.

---

## 5. Presence: "Active" never populated

Three compounding causes:

1. **Redis may not be configured at all.** `REDIS_URL` / `UPSTASH_*` are
   `sync: false` in `render.yaml`, so they must be set by hand. With no Redis,
   presence keys can never exist. `GET /api/healthz` now reports
   `redis_configured` and `redis_ok`.
2. **A Redis outage wiped everyone's status.** `is_online()` returned `False`
   when Redis was unreachable, and the 60-second reconciler then flipped every
   creator to offline. It now returns `None` for "unknown", and the reconciler
   bails out entirely when Redis is down.
3. **The denormalized `is_online` flag went stale.** It was only written on
   connect/disconnect. The heartbeat now refreshes it, throttled to once per
   minute per user so a 20-second heartbeat is not a Mongo write each time.

The browse list and creator detail screen also subscribe to the `creator_status`
socket event, so ACTIVE/BUSY/DND now update live without a manual refresh.

---

## 6. Pending creators were locked out of the app

**Symptom:** after submitting verification, only the "waiting for approval"
screen was reachable.

`onboarding_status` returned `next_step: "pending_approval"` and `index.tsx`
redirected there, with no way forward.

**Fix:** an unapproved creator is routed to Home and uses the app as a normal
user. They simply cannot receive calls:

- the backend refuses `initiate_call` with a clear message
  ("verification is still under review");
- Home shows a dismissible "Verification under review" banner, driven by
  `calls_blocked` in the onboarding payload;
- the approval screen keeps a "Use the app while you wait" escape hatch.

---

## 7. Ring timeout did not end the call

**Symptom:** after 45 seconds the caller's screen kept ringing.

The caller-side watchdog fired **once at 12 seconds** and then never checked
again, so if the call was still RINGING at that instant it would wait forever.

**Fix:** the caller polls against a real deadline (`RING_DEADLINE_MS`, 50s,
allowing the server's 45s plus slack for the `call_missed` event). The server
remains authoritative via `schedule_ring_timeout`.

The receiver's screen also now stops ringing when the caller cancels — it
subscribes to `call_cancelled` / `call_missed` / `cancel_call_notification`
instead of counting down in isolation.

---

## Still to verify on a device

Nothing here has been exercised on real hardware. Priority order:

1. **Killed-app ring.** Force-stop the app, call it, confirm the notification
   arrives and tapping it opens the call screen.
2. **Phone account.** Confirm the "Allow Simple Talk to manage calls?" dialog
   appears on first login; without it there is no full-screen call UI.
3. **Two-way audio.** Both sides should hear each other (validates the uid fix).
4. **Active filter.** Sign in as a creator, confirm they appear under Active on
   another device, and that calling them flips them to BUSY everywhere.
5. **Reject.** Model declines → caller immediately sees "Call declined" and the
   ring stops.
6. **Timeout.** Nobody answers → both sides give up at ~45s.
