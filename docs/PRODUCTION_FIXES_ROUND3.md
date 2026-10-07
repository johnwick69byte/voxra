# Round 3 — Push Notifications, Signup Photo, Closed-App Calls

Three separate reports, three distinct root causes. All fixed and pinned by tests
(`apps/api/tests/test_push_delivery.py`).

---

## 1. No push for "creator online" or "account approved"

First, the server was fine:

```
GET /api/healthz
{"ok":true,"service":"simpletalk-api","redis_configured":true,
 "redis_ok":true,"firebase_configured":true}
```

The problem was on the **device**, and it was two bugs.

### Bug A — foreground pushes were never drawn

This is the main one. Android behaves differently per app state:

| App state | Who displays the notification |
|---|---|
| Background / killed | **Android**, from the system tray |
| **Foreground** | **Nobody** — it arrives in `onMessage` and is silently dropped unless the app draws it |

Our `onMessage` handler only ever looked for calls:

```js
function routeIfCall(data) {
  if (data && data.type === "incoming_call") {
    emitCallRoute({ ...data, action: "ring" });
  }
}
```

So while you were using the app, "creator is online" and "you're approved"
arrived, matched nothing, and vanished. That is exactly the case you hit — you
were in the app when the model came online and was approved.

**Fix:** `src/services/inAppNotifications.ts` draws every non-call push via
Notifee on the `app_notifications` channel, with the same white silhouette icon,
per-type title/body copy, and expandable text for long broadcasts.

### Bug B — tapping the notification did nothing

`getInitialNotification` and `onNotificationOpenedApp` also only handled calls.
A tap on "you're approved" opened the app and left you on whatever screen you
had. Now non-call taps land on the notification centre, buffered through
`src/services/navigationQueue.ts` so a tap that cold-starts the app still
navigates once the router mounts.

### Bug C — a token registered while notifications were denied

`registerDevicePushToken()` ran in parallel with the permission request. On
Android 13+, `getToken()` **succeeds even when POST_NOTIFICATIONS is denied** —
you get a valid token that the server happily pushes to, and Android drops every
message. Registration now awaits the permission and skips when refused, so a
useless token is never stored.

Also added `onTokenRefresh` upload. FCM rotates tokens (reinstall, restore, long
idle); without this the server keeps pushing to a dead token and the user
silently stops receiving notifications forever.

### Bug D — silent `sent=0`

Your log showed:

```
follower online notify creator=usr_99176d51618a sent=0
```

That is ambiguous: no followers, or followers with no token? Both looked
identical. The log now distinguishes them:

```
follower online notify creator=… followers=3 sent=0 no_token=3
```

The approval path is the same — it now warns explicitly when a user has no push
token, or when the send fails.

**Note on creator-online pushes:** they go to *followers*. If nobody follows the
account, there is nobody to notify — that is what `sent=0` may have meant. The
new log line makes it obvious either way.

---

## 2. Profile photo step removed from signup

`app/(auth)/complete-profile.tsx` had an "Add photo" picker **below** the
Fan/Creator cards. Removed.

- Fans never need a photo to call.
- Creators set theirs during photo upload in creator onboarding, where the
  images are actually required for review.

Removed the picker, the `pickAvatar` handler, the `expo-image-picker` import and
the `picture` state. The Fan/Creator selection is untouched.

---

## 3. Incoming call with the app closed

Re-audited end to end with `scripts/audit_incoming_call.py`. The full chain is
in place:

```
1. SERVER PAYLOAD
   notification block      : YES      (data-only is undeliverable when stopped)
   android delivery prio   : high     (wakes the device)
   notification_priority   : PRIORITY_MAX
   visibility              : PUBLIC   (shows on the lock screen)
   channel_id              : incoming_calls_v1
   small icon              : ic_notification
   ttl                     : 45s      (stale rings expire)

2. CLIENT HANDLERS
   killed + tap         getInitialNotification     OK
   background + tap     onNotificationOpenedApp    OK
   foreground           onMessage                  OK
   background delivery  setBackgroundMessageHandler OK

3. CALLKEEP (full-screen call UI)
   registerAndroidEvents bound    OK
   displayIncomingCall used       OK
   answer listener                OK
   end listener                   OK
   phone account ensure           OK
```

Why this now works with the app closed:

1. The ring is a **notification message**, so Android renders it from the tray
   without the app running. (A data-only message is simply not delivered to a
   stopped app — the original bug.)
2. `priority: high` wakes the device; `PRIORITY_MAX` + `visibility: PUBLIC` make
   it a lock-screen heads-up alert, not a silent tray entry.
3. Tapping routes to the call screen through the same dedup path as the socket,
   so the call screen opens exactly once.
4. CallKeep registers a Telecom phone account (the real system dialog, not
   Settings) and now calls `registerAndroidEvents()`, so the lock-screen answer /
   decline buttons actually work.

**Reminder:** fake-data-only-free delivery also needs `google-services.json` to
contain the `com.simple_talk.app` client. If the token never registers, the
`no push token registered` warning will now tell you.

---

## Verification

| Check | Result |
|---|---|
| API import + `compileall` | pass |
| Tests | **46 passed** (was 28) |
| Mobile / admin / web `tsc` | pass |
| `expo-doctor` | 21/21 |
| `expo prebuild` | pass |
| Android resource validator | pass |
| Incoming-call chain audit | all OK |

New tests in `apps/api/tests/test_push_delivery.py` cover: foreground display,
tap routing for all three states, navigation buffering, permission-before-token
ordering, token refresh, server-side logging, photo removal, and the killed-app
call path.

## What to do next

1. **Redeploy the API** — the logging changes (Bug D) need it.
2. **Rebuild the app** — Bugs A–C and the signup change are client-side.
3. Follow the model account to test the online push (you must follow them from
   the fan account, or there is nobody to notify).
4. Check Render logs after approval — you should see either `sent=1`, or a clear
   `no push token registered for user …`.
