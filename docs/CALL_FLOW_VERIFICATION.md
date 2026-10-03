# Call Experience — Verification & Fix Plan

Source-verified against `apps/mobile` (call-screen, incoming-call, push, agora,
CallKeep, Notifee, foreground service) and `celebconnect-v2/frontend`
(`NativeCallScreen.tsx`, `app/_layout.tsx`) plus the API call/socket/push code.
Severity: **P0** broken/insecure, **P1** broken behaviour, **P2** old-feature
parity, **P3** polish.

---

## 1. Push notifications

### 1.1 Verified wiring (works)
- Token registered on login (`_layout` → `registerDevicePushToken` → `POST /profile/push-token`).
- Server sends **data-only** high-priority FCM for `incoming_call`
  (`push_service.send_push(..., data_only=True, channel_id="incoming_calls")`).
- `index.js` registers `setBackgroundMessageHandler` → saves pending call +
  `showIncomingCallNotification` (Notifee full-screen CALL category).
- `consumePendingCall` on launch routes to `/incoming-call`.

### 1.2 Bugs / gaps

| ID | Sev | Finding | Fix |
|----|-----|---------|-----|
| P-1 | P1 | `push_service.send_push` calls the **blocking** `messaging.send()` inside an async function, stalling the event loop on every push | Wrap in `await asyncio.to_thread(messaging.send, message)` |
| P-2 | P1 | Ring tone is a **remote URL** (`actions.google.com/...ogg`). Offline or blocked → silent ring. Old app used a reliable bundled sound | Bundle a local ringtone asset and loop it; keep the URL as last-resort fallback |
| P-3 | P1 | Notifee channel `incoming_calls_v1` uses `importance: HIGH` only; not `MAX`, no `loopSound`, no `bypassDnd`, no `ongoing` sound loop. Not truly WhatsApp-style | `importance: MAX`, `category: CALL`, `vibration: true`, `sound: 'default'`, `fullScreenAction` + `pressAction: { id:'default', launchActivity:'default' }`, and `timeoutAfter` in sync with `CALL_RING_TIMEOUT_SECONDS` |
| P-4 | P1 | No dedup guard between a socket `incoming_call` and a pending-call push on launch → possible **double navigation** to `/incoming-call` | Track `lastHandledCallIdRef` (like old `_layout`) and ignore duplicate call_ids within a window |
| P-5 | P2 | iOS has **no VoIP/PushKit**; data-only APNs won't reliably wake a killed app | Out of scope now; document. Android is the target |
| P-6 | P3 | Server `channel_id="incoming_calls"` vs client channel `incoming_calls_v1` mismatch (harmless while data-only, but fragile if a notification payload is ever added) | Align names |

---

## 2. Multiple fans calling the same creator

**Verified: mostly correct.**
- `initiate_call` takes a **Redis ring lock** `ring:{receiver}` (`SET NX EX`),
  else a Mongo `RINGING` fallback → returns **409 "receiving another call"**.
- `is_creator_available` blocks `BUSY` (ring lock **or** an existing
  RINGING/ACCEPTED/LIVE call) and `DND`.
- Accept clears the ring lock; BUSY then derives from the active-call query.

**Bugs / gaps**

| ID | Sev | Finding | Fix |
|----|-----|---------|-----|
| M-1 | P1 | If the `call_records` insert fails after the ring lock is taken, the lock is **not released** → creator stuck "receiving another call" until TTL | Wrap insert in try/except and `_clear_ring_lock` on failure |
| M-2 | P2 | No server-side guard preventing a **creator** (or a user already on a call) from placing a new outgoing call | Add a check: if the caller already has an ACCEPTED/LIVE call, return 409 |
| M-3 | P3 | Sweeper clears RINGING >2 min and ACCEPTED/LIVE >3h; ring timeout is 45s so the 2-min path rarely fires. Fine, but the client has no "no accept event" timeout beyond the server | Add a client-side 45s guard that calls `callsAPI.active()` and leaves if not RINGING/LIVE |

---

## 3. Call screen — buttons, room, media

### 3.1 Verified
- Room: both sides join `channel_{callId}`; caller joins on `call_accepted`,
  receiver on mount with accept tokens. `prepaid-start` fires only for the caller
  after media join. Relaunch restores via `GET /calls/active`.
- Buttons present: **Mute**, **Cam on/off** (video), **Gift** (caller) /
  earnings chip (receiver), **End**. Hardware back + `beforeRemove` confirm end.

### 3.2 Bugs / gaps

| ID | Sev | Finding | Fix |
|----|-----|---------|-----|
| C-1 | P2 | **No tap-to-hide controls** and no auto-hide. User asked: one tap hides, next tap shows. Old screen had `showControls` + 5s `controlsTimeoutRef` | Add `controlsVisible` state; tap on the background toggles; auto-hide after ~5s; any control press resets the timer; never hide while the gift sheet is open |
| C-2 | P2 | **No speaker toggle** (old `toggleSpeaker` → `setEnableSpeakerphone`) | Add a Speaker button + Agora `setEnableSpeakerphone` |
| C-3 | P2 | **No switch-camera** for video (old `switchCamera`) | Add a flip-camera button + Agora `switchCamera()` |
| C-4 | P1 | Gift-received does **not** update the creator's live `earnings_balance` (only the session total) — panel can look stale until the next minute | On `gift_received`, also set `earningsBalance` from a refreshed wallet (or include `earnings_balance` in the gift payload) |
| C-5 | P2 | `onGiftSent` closes over a **stale `totalBilled`** (effect deps `[callId]`) → billing display can regress | Read from the store inside the handler instead of the captured value |
| C-6 | P3 | `localPip` shows whenever `videoOn` even if the remote hasn't joined | Gate on `remoteUid != null` |
| C-7 | P3 | No "Connecting…" watchdog; if `call_accepted` is lost the caller stays on "Ringing…" forever | 12s watchdog after accept → re-check `/calls/active`, else leave |
| C-8 | P3 | Controls overlap the timer on small screens; no safe-area padding | Add `useSafeAreaInsets` bottom padding to the controls bar |

---

## 4. Live wallet (both sides)

| ID | Sev | Finding | Fix |
|----|-----|---------|-----|
| W-1 | OK | Caller shows spendable `wallet ₹`, updated from `call_prepaid_billed.balance` and gifts | — |
| W-2 | OK | Creator shows live `earnings ₹`, seeded on join and updated from `call_prepaid_billed.earnings_balance` | — |
| W-3 | P1 | Creator earnings only refresh on the minute tick or gift; a gift that predates join can be missed | Refresh wallet on `AppState` active (already partly done) + on every `gift_received` (ties to C-4) |

---

## 5. Gift animations

| ID | Sev | Finding | Fix |
|----|-----|---------|-----|
| G-1 | OK | Caller gets `gift_sent` → `GiftBurst` "Sent"; receiver gets `gift_received` → "Got". Server emits **once each** (no call-room duplicate like the old app, so no dedup needed) | — |
| G-2 | P2 | Animation is a simple rising pill; old app had a spring scale + emoji burst over the avatar | Enrich `GiftBurst` (bigger burst, icon variety per amount, held longer for larger gifts) |
| G-3 | P3 | Gift sheet is caller-only (per product decision); receiver chip just toasts | Keep; consider a received-gifts list modal (old had one) |

---

## 6. Old-code feature parity checklist

| Feature | Old | New | Action |
|---------|-----|-----|--------|
| Speaker toggle | ✅ | ❌ | Add (C-2) |
| Switch camera | ✅ | ❌ | Add (C-3) |
| Tap-to-hide controls + auto-hide | ✅ | ❌ | Add (C-1) |
| Received-gifts list modal | ✅ | ❌ | Optional (G-3) |
| Call-connect watchdog | ✅ | ❌ | Add (C-7) |
| Duplicate incoming-call dedup | ✅ | ❌ | Add (P-4) |
| Killed-state full-screen ring | ✅ | Partial | Harden Notifee (P-3) |
| iOS VoIP push | ✅ (CallKit) | ❌ | Document (P-5) |
| Ring lock + 409 | ✅ | ✅ | Harden failure path (M-1) |
| Per-minute billing + live wallets | ✅ | ✅ (fixed earlier) | — |

---

## 7. Implementation order

1. **P-1, P-2, P-3, P-4** — push + killed-state ring hardening (highest impact).
2. **C-1, C-2, C-3** — call UI controls (tap-to-hide, speaker, switch camera).
3. **C-4, C-5, W-3** — live earnings accuracy.
4. **M-1, M-2, C-7** — concurrency + watchdog.
5. **G-2, C-6, C-8, P-6, M-3** — polish.

Acceptance checks live in `docs/CALL_FLOW_TESTS.md` (add a `## Call UI` and
`## Push` section per the table above).

### Open questions
1. iOS killed-state ringing in scope now? (Plan assumes Android-first.)
2. Keep the gift as caller-only? (Assumed yes.)
3. Add a bundled ringtone asset? (Plan assumes yes; needs the `.mp3`/`.wav` added to `assets/`.)
