# Live Ops Monitor Fix — Bugfix Design

## Overview

When an admin opens the Monitor popup for an active call and then closes it, both call
participants receive a "peer left" notification, their video streams stop, and the call is
terminated. Three distinct defects share the same root event (admin joining the Agora channel as
UID 0):

1. **Silent eviction** — `Monitor.tsx` calls `client.join(appId, channel, token, 0)`. Agora treats
   UID 0 as "auto-assign", which can collide with an existing participant's UID and evict them.
2. **Spurious disconnect grace** — `agora.ts` fires `onUserOffline` for every offline event
   regardless of which UID left. `call-screen.tsx` immediately calls
   `scheduleDisconnectGrace("Peer left the call")`, which after 20 s calls
   `callsAPI.handleDisconnect` → `disconnect_service.start_disconnect_grace` →
   `call_service.finalize_call`, ending a call neither participant wanted to end.
3. **Stuck BUSY status** — `finalize_call` does emit `call_ended` and reset the creator status
   via `presence_service.mark_creator_online`, but when the mobile client's socket connection is
   disrupted (which the spurious disconnect likely caused), that event may not arrive, leaving the
   model's phone stuck on the call screen and their status as BUSY.

Two enhancements are also included:

4. **Fit / Fill video toggle** — `Monitor.css` hard-codes `object-fit: cover` with `!important`,
   giving the admin no way to switch to `object-fit: contain` per stream.
5. **Live Ops auto-refresh** — `LiveOps.tsx` polls every 5 seconds with no manual refresh button.

The fix strategy is minimal and targeted: use a reserved non-zero UID for the admin observer on
both the backend token endpoint and the admin web client, add UID filtering in the mobile Agora
event handler, ensure `call_ended` and status-reset are robust when the socket is stressed, add a
CSS toggle for the monitor popup, and slow the Live Ops poller to 30 s while adding a manual
refresh button.

---

## Glossary

- **Bug_Condition (C)**: The condition that triggers the bug — the admin monitor token is minted
  with `uid=0` and/or the mobile `onUserOffline` handler does not filter by UID.
- **Property (P)**: The desired behavior when the bug condition holds — the admin joins as a
  reserved non-zero UID and non-peer `onUserOffline` events are silently ignored.
- **Preservation**: Existing behaviour that must not change — real peer disconnects must still
  trigger the 20-second disconnect grace, force-end and force-offline must still work, billing and
  socket events must remain unaffected.
- **`generate_monitor_token`**: `POST /admin/calls/generate-token` in
  `voxora/apps/api/app/routers/admin.py` — mints the Agora subscriber token for admin monitoring.
- **`ADMIN_MONITOR_UID`**: A fixed, reserved, non-zero integer (e.g. `999_999_999`) used
  exclusively for admin observer joins. Both the backend and the web client must use the same
  value.
- **`onUserOffline`**: The Agora SDK callback registered in
  `voxora/apps/mobile/src/services/agora.ts` — currently fires without UID filtering.
- **`scheduleDisconnectGrace`**: Function in `voxora/apps/mobile/app/call-screen.tsx` — starts
  the 20-second countdown that ends the call if the peer does not reconnect.
- **`peer_uid`**: The mobile client's local knowledge of the other participant's Agora UID, derived
  from `agora_service.uid_for_user(user_id)` — a stable 31-bit hash, never 0.
- **`finalize_call`**: `call_service.finalize_call` in
  `voxora/apps/api/app/services/call_service.py` — sets the terminal status, emits `call_ended`,
  and resets the creator status.

---

## Bug Details

### Bug Condition

The bug manifests at two points in the code:

**Point A — Backend token mint (`admin.py`):**

```
FUNCTION isBugCondition_AdminUid(X)
  INPUT: X of type MonitorTokenRequest { channel_name: str }
  OUTPUT: boolean

  // The endpoint unconditionally passes uid=0 to build_rtc_token
  RETURN agora_service.build_rtc_token(X.channel_name, uid=0, role="subscriber").uid = 0
END FUNCTION
```

**Point B — Mobile Agora event handler (`agora.ts` + `call-screen.tsx`):**

```
FUNCTION isBugCondition_SpuriousOffline(X)
  INPUT: X of type UserOfflineEvent { departing_uid: number, peer_uid: number }
  OUTPUT: boolean

  // onUserOffline in agora.ts ignores the UID entirely — no peer_uid check
  RETURN X.departing_uid ≠ X.peer_uid
END FUNCTION
```

### Concrete Examples

- **Admin opens monitor for call_abc** → backend returns `uid=0` → `Monitor.tsx` calls
  `client.join(appId, "channel_call_abc", token, 0)` → Agora may evict the participant whose
  derived UID hash happens to equal 0 (or treat it as a duplicate broadcaster).

- **Admin closes monitor** → Agora web SDK fires `client.leave()` → Agora signals all channel
  members that UID 0 has gone offline → mobile's `onUserOffline` fires with `uid=0` (not the
  peer's real UID) → `scheduleDisconnectGrace("Peer left the call")` is called → 20 s later
  `callsAPI.handleDisconnect` ends the active call.

- **Call is force-ended via disconnect grace** → `finalize_call` emits `call_ended` and calls
  `mark_creator_online`, but if the mobile socket is stressed from the spurious event the
  `call_ended` event may not be reliably delivered → model's phone stays stuck on call screen,
  model status remains BUSY.

- **Edge case — admin joins a call that has already ended** → channel is empty, no UID conflict
  occurs; the monitor popup shows "Waiting for streams…" which is correct existing behaviour.

---

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**

- WHEN the actual peer (caller or receiver) leaves the Agora channel during a live call, the
  mobile `onUserOffline` handler SHALL still call `scheduleDisconnectGrace` as before.
- WHEN the 20-second disconnect grace timer expires and the peer has not reconnected, the system
  SHALL still call `callsAPI.handleDisconnect` → `finalize_call` as before.
- WHEN an admin uses the "Force end" button, `admin_force_end` → `finalize_call` SHALL still
  terminate the call immediately.
- WHEN an admin uses the "Force offline" button, `presence_service.force_offline` SHALL still
  reset the creator's status.
- WHEN both participants are connected, the billing loop, call timer, and all socket events
  (billed, low-balance, gift) SHALL continue to function normally.
- WHEN a call ends normally (either participant presses End), the system SHALL navigate to
  call-review and settle earnings correctly.

**Scope:**

All inputs where `isBugCondition_AdminUid` returns `false` (i.e. the token request already uses a
non-zero UID — this cannot happen today but could after future refactoring) must produce the same
token as before. All inputs where `isBugCondition_SpuriousOffline` returns `false` (i.e. the
departing UID equals the peer UID) must still trigger `scheduleDisconnectGrace` exactly as before.

---

## Hypothesized Root Cause

Based on the actual code:

1. **`admin.py` — hardcoded `uid=0` in `generate_monitor_token`**:
   Line `agora_service.build_rtc_token(channel_name, uid=0, role="subscriber")` unconditionally
   passes `uid=0`. The `build_rtc_token` docstring itself warns that "join as 0 on both sides
   makes Agora treat the second joiner as a duplicate of the first and evict one of them". The
   same warning exists in `uid_for_user`. This is the primary root cause.

2. **`agora.ts` — `onUserOffline` discards the departing UID**:
   The registered handler is `onUserOffline: (_conn: any, uid: number, reason: number) => { ... }`
   but the current implementation ignores `uid` entirely and unconditionally calls
   `params.onUserOffline?.()`. The `call-screen.tsx` callback for `onUserOffline` is
   `() => scheduleDisconnectGrace("Peer left the call")` — no UID check, no guard.

3. **`Monitor.tsx` — joins with UID 0**:
   The `client.join(appId, channel, token || null, 0)` call passes 0 as the fourth argument
   (the UID). Even if the backend were fixed to return a non-zero UID in the token payload, the
   web client overrides it with 0 here. Both the backend and the client must be fixed together.

4. **`finalize_call` socket delivery under stress**:
   `finalize_call` in `call_service.py` does emit `call_ended` to both participants and calls
   `mark_creator_online`. However if the spurious `onUserOffline` triggered network-layer
   reconnection logic on the phone, the socket room membership may have changed before the event
   is emitted, causing missed delivery. The fix to prevent the spurious disconnect eliminates the
   root cause; a defensive `creator_status` re-emit in `finalize_call` is an additional safety net.

---

## Correctness Properties

Property 1: Bug Condition A — Admin Monitor Token Uses Reserved Non-Zero UID

_For any_ request to `POST /admin/calls/generate-token` where the current code would return
`uid=0` (i.e. `isBugCondition_AdminUid` returns true), the fixed endpoint SHALL return a token
minted with `uid=ADMIN_MONITOR_UID` (e.g. `999999999`), and the returned `uid` field SHALL equal
`ADMIN_MONITOR_UID` and SHALL NOT be `0`.

**Validates: Requirements 2.1**

Property 2: Bug Condition B — Spurious onUserOffline Does Not Trigger Disconnect Grace

_For any_ Agora `onUserOffline` event where the departing UID does not equal the peer UID
(i.e. `isBugCondition_SpuriousOffline` returns true — the observer or any non-peer left), the
fixed `onUserOffline` handler in `agora.ts` / `call-screen.tsx` SHALL NOT call
`scheduleDisconnectGrace` and the call SHALL continue uninterrupted.

**Validates: Requirements 2.2, 2.3**

Property 3: Preservation — Real Peer Departure Still Triggers Disconnect Grace

_For any_ Agora `onUserOffline` event where the departing UID equals the peer UID
(i.e. `isBugCondition_SpuriousOffline` returns false), the fixed handler SHALL call
`scheduleDisconnectGrace` exactly as the original handler did, and SHALL finalize the call after
20 seconds if the peer does not reconnect.

**Validates: Requirements 3.1**

Property 4: Preservation — `finalize_call` Always Resets Creator Status

_For any_ call finalization path (disconnect grace, force-end, insufficient balance, or normal
end), the fixed `finalize_call` SHALL reliably emit `call_ended` to both participants and SHALL
reset the creator's status to ONLINE, regardless of socket delivery uncertainty.

**Validates: Requirements 2.4, 3.2, 3.5**

---

## Fix Implementation

### Changes Required

Assuming the root cause analysis above is correct:

---

**File**: `voxora/apps/api/app/routers/admin.py`

**Function**: `generate_monitor_token`

**Specific Changes**:

1. **Define `ADMIN_MONITOR_UID` constant at module level** (or import from `agora_service`):
   ```python
   ADMIN_MONITOR_UID = 999_999_999
   ```

2. **Replace `uid=0` with `uid=ADMIN_MONITOR_UID`**:
   ```python
   tokens = agora_service.build_rtc_token(channel_name, uid=ADMIN_MONITOR_UID, role="subscriber")
   ```

3. **Return the real UID in the response** so the web client can use it:
   ```python
   return {
       "success": True,
       "token": tokens.get("token"),
       "appId": tokens.get("app_id"),
       "uid": ADMIN_MONITOR_UID,
       "channel_name": channel_name,
   }
   ```

---

**File**: `voxora/apps/admin/src/pages/Monitor.tsx`

**Function**: `useEffect` (join logic)

**Specific Changes**:

4. **Read the UID from the URL params** (passed by `LiveOps.tsx` when opening the popup):
   The `LiveOps.tsx` already appends `appId`, `channel`, and `token` to the URL. Add `uid` to
   the params string and read it in `Monitor.tsx`:
   ```typescript
   const uid = Number(q.get("uid") || 0);
   ```

5. **Pass the real UID to `client.join`** instead of hardcoded `0`:
   ```typescript
   await client.join(appId, channel, token || null, uid || 999_999_999);
   ```

6. **Update `LiveOps.tsx`** to include `uid` in the monitor URL params:
   ```typescript
   const params = new URLSearchParams({
     appId: d.appId,
     channel: d.channel_name,
     token: d.token,
     uid: String(d.uid),   // add this
   });
   ```

---

**File**: `voxora/apps/mobile/src/services/agora.ts`

**Function**: `createAndJoinEngine` → `registerEventHandler`

**Specific Changes**:

7. **Expose `peer_uid` filtering through `AgoraJoinParams`**:
   ```typescript
   export type AgoraJoinParams = {
     // ... existing fields ...
     peerUid?: number;   // add this
   };
   ```

8. **Filter `onUserOffline` by UID**:
   ```typescript
   onUserOffline: (_conn: any, uid: number) => {
     if (params.peerUid != null && uid !== params.peerUid) return;
     params.onRemoteUid?.(null);
     params.onUserOffline?.();
   },
   ```
   When `peerUid` is provided and the departing UID does not match, the event is silently ignored.

---

**File**: `voxora/apps/mobile/app/call-screen.tsx`

**Function**: `joinMedia`

**Specific Changes**:

9. **Pass `peerUid` to `createAndJoinEngine`**:
   The call screen already knows the peer's Agora UID from the `accept` payload
   (`agora.peer_uid`). Store it in a ref and forward it:
   ```typescript
   const peerUidRef = useRef<number | undefined>(undefined);
   // In onAccepted:
   peerUidRef.current = agora.peer_uid;
   ```
   Then in `joinMedia`:
   ```typescript
   const engine = await createAndJoinEngine({
     // ... existing fields ...
     peerUid: peerUidRef.current,
   });
   ```

---

**File**: `voxora/apps/api/app/services/call_service.py`

**Function**: `finalize_call`

**Specific Changes**:

10. **Add explicit `creator_status` re-emit after `mark_creator_online`**:
    The current code already calls `mark_creator_online` and then emits `creator_status`. No
    structural change is needed — but a defensive `emit_to_user` with `status="ONLINE"` should be
    emitted unconditionally (not gated on `presence_service.get_creator_status`) to ensure the
    mobile client always receives the reset signal:
    ```python
    await presence_service.mark_creator_online(call["receiver_id"])
    await emit_to_user(
        call["receiver_id"],
        "creator_status",
        {"user_id": call["receiver_id"], "status": "ONLINE"},
    )
    ```
    This is a low-risk hardening — the presence value is already ONLINE after `mark_creator_online`.

---

**File**: `voxora/apps/admin/src/pages/LiveOps.tsx`

**Enhancement E2 — Auto-refresh interval and manual refresh button**:

11. **Change `setInterval` from 5 000 ms to 30 000 ms**:
    ```typescript
    const t = setInterval(load, 30_000);
    ```

12. **Add a manual "Refresh" button** next to the page title:
    ```tsx
    <button className="btn ghost" onClick={load}>Refresh</button>
    ```

---

**File**: `voxora/apps/admin/src/pages/Monitor.css`

**Enhancement E1 — Fit / Fill video toggle**:

13. **Remove the hardcoded `object-fit: cover !important`** from `.monitor-video video` so it
    can be overridden by a class applied via React state.

14. **Add CSS classes** for the two modes:
    ```css
    .monitor-video video { width: 100% !important; height: 100% !important; object-fit: cover; }
    .monitor-cell.fit-mode .monitor-video video { object-fit: contain; }
    ```

**File**: `voxora/apps/admin/src/pages/Monitor.tsx`

15. **Add per-cell `fitMode` toggle state** and a toggle button rendered inside each
    `.monitor-cell`:
    ```tsx
    const [fitModes, setFitModes] = useState<Record<number, boolean>>({});
    // In the cell render:
    <div
      key={r.uid}
      className={`monitor-cell${fitModes[r.uid] ? " fit-mode" : ""}`}
    >
      <div id={`remote-video-${r.uid}`} className="monitor-video" />
      <button
        className="monitor-fit-toggle"
        onClick={() => setFitModes(m => ({ ...m, [r.uid]: !m[r.uid] }))}
      >
        {fitModes[r.uid] ? "Fill" : "Fit"}
      </button>
      <span className="monitor-uid">{r.uid}</span>
    </div>
    ```

---

## Testing Strategy

### Validation Approach

The testing strategy follows the bug-condition methodology: first write tests that reproduce the
bug on the **unfixed** code (exploratory / counterexample phase), then fix the code and run fix-
checking tests to confirm the bug is gone, then run preservation tests to confirm nothing
regressed.

---

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples that demonstrate the bug BEFORE implementing the fix. Confirm or
refute the root cause analysis. If refuted, re-hypothesize.

**Test Plan**: Unit tests that call the unfixed `generate_monitor_token` endpoint and assert the
returned UID is non-zero; unit tests that simulate an Agora `onUserOffline` event with a non-peer
UID and assert that `scheduleDisconnectGrace` is NOT called. Both should fail on unfixed code,
confirming the root cause.

**Test Cases**:

1. **Admin token UID is 0 (Bug A)**: Call `generate_monitor_token({ channel_name: "ch_test" })`
   on the unfixed backend and assert `response.uid !== 0`. This WILL FAIL on unfixed code,
   confirming Point A of the root cause.

2. **Non-peer UID triggers grace (Bug B)**: In the mobile test environment, fire
   `onUserOffline` with `uid=999999999` (the admin UID) while `peerUid=123456789`. Assert that
   `scheduleDisconnectGrace` is NOT called. This WILL FAIL on unfixed code because the handler
   ignores the UID.

3. **Monitor.tsx joins with UID 0 (Bug A, client side)**: Inspect the `client.join` call in the
   unfixed `Monitor.tsx` and assert the fourth argument is not 0. This WILL FAIL — it is
   hardcoded to 0.

4. **Edge case — onUserOffline with uid=0**: Fire `onUserOffline` with `uid=0` (the current admin
   join UID) while the peer UID is non-zero. On unfixed code this triggers grace. On fixed code it
   must not.

**Expected Counterexamples**:

- `generate_monitor_token` returns `uid=0`.
- `onUserOffline` with any non-peer UID calls `scheduleDisconnectGrace` unconditionally.
- `Monitor.tsx` passes `0` as the UID to `client.join`.

---

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds, the fixed code produces the
correct behavior.

**Pseudocode:**

```
FOR ALL X WHERE isBugCondition_AdminUid(X) DO
  token ← generate_monitor_token'(X)
  ASSERT token.uid ≠ 0
  ASSERT token.uid = ADMIN_MONITOR_UID  // 999_999_999
END FOR

FOR ALL X WHERE isBugCondition_SpuriousOffline(X) DO
  result ← onUserOffline_handler'(X)
  ASSERT disconnect_grace_scheduled(result) = false
END FOR
```

**Test Cases**:

1. **Admin token returns ADMIN_MONITOR_UID**: After fix, assert `response.uid === 999_999_999`
   and `response.uid !== 0`.
2. **Admin token UID is used in `client.join`**: After fix, assert `Monitor.tsx` reads `uid` from
   URL params and passes it (not 0) to `client.join`.
3. **Non-peer offline event is silently ignored**: After fix, fire `onUserOffline` with
   `uid=999999999`, `peerUid=123456789` — assert `scheduleDisconnectGrace` is NOT called.
4. **`finalize_call` emits ONLINE status**: After fix, call `finalize_call` and assert that the
   `creator_status` socket event is emitted with `status="ONLINE"` unconditionally.

---

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold, the fixed code
produces the same result as the original.

**Pseudocode:**

```
FOR ALL X WHERE NOT isBugCondition_AdminUid(X) DO
  ASSERT generate_monitor_token(X) = generate_monitor_token'(X)
END FOR

FOR ALL X WHERE NOT isBugCondition_SpuriousOffline(X) DO
  ASSERT onUserOffline_handler(X) = onUserOffline_handler'(X)
END FOR
```

**Testing Approach**: Property-based testing is recommended for the `onUserOffline` preservation
check because:

- It generates many random `(departing_uid, peer_uid)` pairs automatically.
- It proves the guard condition does not accidentally filter out real peer disconnects.
- It provides stronger guarantees than a handful of hand-picked UIDs.

**Test Cases**:

1. **Real peer offline still triggers grace**: Fire `onUserOffline` with `uid === peerUid` on
   fixed code. Assert `scheduleDisconnectGrace` IS called.
2. **Force-end still works**: Verify `POST /admin/calls/{id}/force-end` → `admin_force_end` →
   `finalize_call` still ends the call and resets creator status.
3. **Force-offline still works**: Verify `POST /admin/creators/{id}/force-offline` still calls
   `presence_service.force_offline`.
4. **Billing loop unaffected**: Verify that the `start_billing_loop` / `bill_next_minute` cycle
   continues normally when a monitor observer joins and leaves.
5. **Normal call end navigates to review**: Verify that ending a call via `callsAPI.end` still
   calls `finishLeave(true)` → `router.replace("/call-review")`.

---

### Unit Tests

- Test `generate_monitor_token` response: `uid` field equals `ADMIN_MONITOR_UID`, never 0.
- Test `build_rtc_token(channel, uid=ADMIN_MONITOR_UID, role="subscriber")` returns a valid token
  structure with the correct UID.
- Test `onUserOffline` handler: given `peerUid=A` and departing `uid=B` where `A≠B`, assert
  `scheduleDisconnectGrace` is not called.
- Test `onUserOffline` handler: given `peerUid=A` and departing `uid=A`, assert
  `scheduleDisconnectGrace` IS called.
- Test `finalize_call`: assert `creator_status` event with `status="ONLINE"` is always emitted.
- Test `LiveOps.tsx`: assert `setInterval` is called with 30 000 ms, not 5 000 ms.
- Test `Monitor.tsx`: assert UID is read from URL params and passed to `client.join`.

### Property-Based Tests

- **Property 1 (Fix)**: For any `channel_name` string, `generate_monitor_token'` returns
  `uid === ADMIN_MONITOR_UID`. No channel name should produce `uid=0`.
- **Property 2 (Fix)**: For any `(departing_uid, peer_uid)` pair where `departing_uid ≠ peer_uid`,
  the fixed `onUserOffline` handler never calls `scheduleDisconnectGrace`.
- **Property 3 (Preservation)**: For any `(departing_uid, peer_uid)` pair where
  `departing_uid === peer_uid`, the fixed handler always calls `scheduleDisconnectGrace`.
- **Property 4 (Preservation)**: For any sequence of admin join / leave events interleaved with
  billing ticks, `bill_next_minute` continues to return `True` and no spurious `finalize_call`
  is triggered.

### Integration Tests

- **Full monitor open/close cycle**: Admin opens monitor popup → admin UID 999999999 joins →
  admin closes popup → UID 999999999 leaves → mobile `onUserOffline` fires with
  `uid=999999999` → call continues, no `scheduleDisconnectGrace` triggered, no `finalize_call`
  called.
- **Real peer disconnect during monitor observation**: Admin monitor is open → actual peer leaves →
  `onUserOffline` fires with the peer's real UID → `scheduleDisconnectGrace` fires → after 20 s
  `finalize_call` ends the call correctly.
- **Fit/Fill toggle**: Open monitor popup, click "Fit" on a stream cell, assert
  `.monitor-cell.fit-mode` class is applied and video `object-fit` computes to `contain`.
- **Manual refresh**: Click "Refresh" on Live Ops page, assert the API call is made immediately
  without waiting for the 30-second interval.
