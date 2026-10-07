# Round 2 — Root Causes From Production Logs

Every symptom you reported traced to four concrete defects. All are fixed and
covered by regression tests (`apps/api/tests/test_socket_and_call_state.py`).

Source: `F:\startup\backendlogs.txt`.

---

## 1. Every WebSocket was rejected with 403  ← biggest one

```
INFO: ('122.164.80.135', 0) - "WebSocket /socket.io/?EIO=4&transport=websocket" 403
INFO: connection rejected (403 Forbidden)
```

Repeated ~50 times in the log. **No socket ever connected on a phone.**

`config.py` returned `["*"]` for `SOCKETIO_CORS_ORIGINS=*`. engine.io only treats
the **bare string** `"*"` as "allow everything"; a list is matched by exact
membership, so `["*"]` rejects every real Origin:

```python
if self.cors_allowed_origins is None:      allowed = default_origins
elif self.cors_allowed_origins == '*':     allowed = None          # <-- only string
elif isinstance(self.cors_allowed_origins, list): allowed = [...] # exact match
```

Proof: a client sending **no** `Origin` connected fine; adding any `Origin`
produced 403. React Native always sends one.

**This one bug caused most of what you saw:**

| Symptom | Why |
|---|---|
| Model shows Busy, never clears | `creator_status` updates are pushed over the socket that never connected |
| "Active" never shows | `mark_creator_online` relies on socket `authenticate` + heartbeat |
| Reject never reached the caller (rang the full 45s) | `call_rejected` is a socket event |
| No incoming-call screen on some attempts | `incoming_call` is a socket event |

**Fix:** return the string `"*"`. Verified by replaying engine.io's own logic and
by running a server with the production config — `http://localhost`,
`https://voxra-dkfe.onrender.com` and `null` all connect now (all three 403'd
before).

---

## 2. `/calls/{id}/accept` returned 500 → "failed to join room"

```
ERROR:app.services.agora_service:Agora token build failed
  File "/app/app/services/agora_service.py", line 49, in build_rtc_token
    from agora_token_builder import RtcTokenBuilder, Role_Publisher, Role_Subscriber
ImportError: cannot import name 'Role_Publisher' from 'agora_token_builder'
INFO: POST /api/calls/call_426a973aa3ad/accept HTTP/1.1" 500 Internal Server Error
```

`agora-token-builder==1.0.0` exports only `AccessToken`, `RtcTokenBuilder`,
`RtmTokenBuilder`. There is **no** `Role_Publisher` — the role is a plain
integer (`1` = publisher, `2` = subscriber).

So the receiver tapped Accept, the server 500'd while minting the token, the
client showed "Could not start call", and nothing joined the room.

**Fix:** use `ROLE_PUBLISHER = 1` / `ROLE_SUBSCRIBER = 2` constants. Also added a
loud 500 when `AGORA_APP_CERTIFICATE` is missing — a misconfigured server should
say so rather than surfacing as a vague client-side join failure.

---

## 3. That 500 is why the model was stuck on Busy

`accept_call` flipped the row to `ACCEPTED` **before** minting tokens:

```python
result = await db.call_records.find_one_and_update(... {"status": "ACCEPTED"} ...)
tokens = agora_service.build_rtc_token(...)   # <-- raised ImportError
```

The call stayed `ACCEPTED` forever. `get_creator_status` counts
`ACCEPTED` as BUSY, and the sweeper only cleaned those after **3 hours** — so the
creator was unringable for the rest of the session.

**Fixes (defence in depth):**
- Mint tokens **first**. If it fails the row stays `RINGING`, which the ring
  timeout and sweeper already handle.
- Sweeper now clears stale `ACCEPTED` rows after **2 minutes** (was 3 hours).
- Sweeper checks the LIVE billing heartbeat (Redis key refreshed each minute)
  instead of waiting 3 hours.
- `get_creator_status` **self-heals on read**: a `RINGING` row past its timeout,
  or an `ACCEPTED` row that never went LIVE, is finalised on the spot. The state
  can no longer get permanently stuck.
- Browse's busy query is now time-bounded, so a stale row cannot render BUSY.

---

## 4. Permission popups repeated, and "calls" sent you to Settings

Three separate problems:

1. **No "already asked this session" guard.** `_layout` called
   `ensureAllPermissions()` on every `user` change, and `ensureCallPermissions()`
   ran again on call start. Android auto-denies a second request, so it looked
   like nagging.
2. **Rationale shown even when granted.** The notification path checked
   `PermissionsAndroid.check()` correctly but the others didn't short-circuit
   early enough, so a popup could appear with nothing to ask for.
3. **Phone account sent you to Settings.** A Telecom phone account is *not* a
   runtime permission — there is no toggle in Settings for it, so the button did
   nothing. It can only be granted through `registerPhoneAccount()`, which
   triggers the real system dialog.

**Fixes:**
- Silent early-return when already granted. Never show a rationale if there is
  nothing to ask.
- Straight to the system dialog otherwise. Our own Alert appears **only** when
  the OS will not prompt again (`NEVER_ASK_AGAIN`), where Settings is the only
  route.
- Session-scoped "already asked" set — no repeat prompts in one run.
- `ensurePhoneAccount()` calls `registerPhoneAccount()` to raise the real
  Android dialog, then polls for the granted account.

Bonus bug found while tracing this: **`registerAndroidEvents()` was never
called.** Without it CallKeep's `hasListeners` stays `false`, so
`VoiceConnectionService.setPhoneAccountHandle()` is never set and *all* CallKeep
events are dropped. Added, along with `answerCall` / `endCall` /
`didPerformEndCallAction` listeners so lock-screen actions reach the app.

---

## 5. Caller now detects rejection without the socket

Even with sockets fixed, the caller's UI depended entirely on `call_rejected`.
It now polls `/calls/active` every 2.5s while ringing and distinguishes:

- `REJECTED` → "Call declined"
- `MISSED` / `CANCELLED` / no call → "No answer"
- past the deadline → "No answer"

So a swallowed event can no longer leave the caller ringing for 45s.

---

## Verification

| Check | Result |
|---|---|
| API import + `compileall` | pass |
| Regression tests | **28 passed** (was 13) |
| Mobile / admin / web `tsc` | pass |
| `expo-doctor` | 21/21 |
| `expo prebuild --platform android` | pass |
| Socket handshake with `Origin` | pass (was 403) |
| Agora token mint (no ImportError) | pass |

## Deploy checklist

1. **Redeploy the API.** Fixes 1–3 are server-side and are what unblock calls.
2. Confirm `AGORA_APP_CERTIFICATE` is set on Render — without it the new guard
   returns a clear 500 instead of a failed join.
3. Set `REDIS_URL` (or `UPSTASH_*`). Presence still needs it; `healthz` reports
   `redis_ok`.
4. Rebuild the app for fixes 4–5 (permissions + caller polling).
5. Clear any currently-stuck call: admin → force-offline on the model, or wait for
   the new 2-minute sweep after deploy.

## Still needs device confirmation

The socket fix is proven at the protocol level here, but these need a phone:

- Model is not BUSY after a failed/rejected call
- Active filter populates once a creator is genuinely online
- Phone-account dialog appears **once**, never sends you to Settings
- No repeat notification prompt after granting
- Rejection reaches the caller within a few seconds
