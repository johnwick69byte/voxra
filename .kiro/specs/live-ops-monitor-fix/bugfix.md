# Bugfix Requirements Document

## Introduction

When an admin opens the Monitor popup for an active call in the Live Ops page and then closes it,
both call participants receive a "peer left" notification, their video streams stop, and the call
is terminated — even though neither participant chose to end the call. After the call terminates
this way the model's status remains stuck as "busy" until the model manually reopens the app and
presses End on the call screen.

Three distinct defects share the same root event (admin joining the Agora channel as UID 0):

1. **Silent eviction** — joining as UID 0 can cause Agora to evict one real participant immediately.
2. **Spurious disconnect grace** — when the admin leaves the channel, `onUserOffline` fires on both
   mobile clients without filtering by UID, triggering a 20-second grace period that finalises the
   call via `callsAPI.handleDisconnect`.
3. **Stuck BUSY status** — because the call is ended by the disconnect-grace path rather than by a
   normal `call_ended` socket event, the model's phone does not reliably receive a status-reset
   signal and stays in the BUSY / call-screen state.

Two enhancement requests are also included in the same change set:

4. **Fit / Fill video toggle** — the admin monitor popup currently hard-codes `object-fit: cover`;
   there is no way to switch to `object-fit: contain` per stream.
5. **Live Ops auto-refresh and manual refresh** — the page polls every 5 seconds with no manual
   refresh button, which is noisier than necessary.

---

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN the admin clicks "Monitor" on an active call, THEN the system joins the Agora channel
    with `uid=0`, which Agora may treat as a duplicate of an existing participant and evict one
    real participant from the channel.

1.2 WHEN the admin closes the Monitor popup and the Agora web SDK calls `client.leave()`,
    THEN the system fires `onUserOffline` on every mobile client in the channel regardless of
    which UID left, causing both participants to call `scheduleDisconnectGrace("Peer left the call")`.

1.3 WHEN the 20-second disconnect grace timer expires after the admin leaves,
    THEN the system calls `callsAPI.handleDisconnect` → `disconnect_service.start_disconnect_grace`
    → `call_service.finalize_call`, ending an active call that neither participant wanted to end.

1.4 WHEN `finalize_call` completes via the disconnect-grace path,
    THEN the system does not reliably deliver a `call_ended` socket event to the model's device,
    leaving the model's status as "BUSY" and the model's phone stuck on the call screen.

### Expected Behavior (Correct)

2.1 WHEN the admin requests a monitor token, THEN the system SHALL generate the token with a
    fixed, reserved, non-zero UID (e.g. `999999999`) so that Agora treats the admin as a distinct
    third observer and does not evict any existing participant.

2.2 WHEN `onUserOffline` fires on a mobile client, THEN the system SHALL check whether the
    departing UID matches the expected peer UID for that call; if the departing UID does not
    match (i.e. it is the admin observer UID or any other non-peer UID), the system SHALL ignore
    the event and SHALL NOT schedule a disconnect grace period.

2.3 WHEN the admin closes the Monitor popup and the admin observer leaves the Agora channel,
    THEN the system SHALL NOT end the call, SHALL NOT trigger a disconnect grace period on either
    mobile client, and both participants SHALL continue their call uninterrupted.

2.4 WHEN the call does end (through any legitimate path), THEN the system SHALL reliably emit a
    `call_ended` socket event to both the caller and the receiver so that the model's status is
    reset to "online" without requiring manual intervention.

### Unchanged Behavior (Regression Prevention)

3.1 WHEN the actual peer (caller or receiver) leaves the Agora channel during an active call,
    THEN the system SHALL CONTINUE TO fire `onUserOffline`, schedule the 20-second disconnect
    grace period, and finalise the call if the peer does not reconnect within that window.

3.2 WHEN an admin uses the "Force end" button on the Live Ops page,
    THEN the system SHALL CONTINUE TO terminate the call immediately and reset all participant
    statuses.

3.3 WHEN an admin uses the "Force offline" button for a stuck-BUSY creator,
    THEN the system SHALL CONTINUE TO reset that creator's status to online.

3.4 WHEN both participants are connected and neither has left, the billing loop, call timer, and
    all socket events (billed, low-balance, gift) SHALL CONTINUE TO function normally.

3.5 WHEN a call ends normally (either participant presses End), THEN the system SHALL CONTINUE TO
    navigate to the call-review screen and settle earnings correctly.

---

## Enhancement Requirements

### E1 — Fit / Fill Video Toggle in Monitor Popup

E1.1 WHEN the Monitor popup is displaying a remote video stream,
     THEN the system SHALL provide a toggle button per stream (or a global toggle) that switches
     the video `object-fit` between `cover` (Fill) and `contain` (Fit).

E1.2 WHEN the admin switches the video layout mode,
     THEN the system SHALL apply the new `object-fit` value immediately without reloading the
     stream or rejoining the channel.

### E2 — Live Ops Auto-Refresh and Manual Refresh

E2.1 WHEN the Live Ops page is open, THEN the system SHALL auto-refresh the call list every 30
     seconds (changed from the current 5 seconds).

E2.2 WHEN the Live Ops page is open, THEN the system SHALL display a visible "Refresh" button
     that, when clicked, immediately re-fetches the call list and metrics without waiting for the
     next automatic interval.

---

## Bug Condition Pseudocode

### Bug Condition — Admin UID 0 (Bugs 1.1 and 1.2)

```pascal
FUNCTION isBugCondition_AdminUid(X)
  INPUT: X of type MonitorTokenRequest
  OUTPUT: boolean

  RETURN X.admin_uid = 0
END FUNCTION

// Property: Fix Checking — Admin observer UID must be nonzero and reserved
FOR ALL X WHERE isBugCondition_AdminUid(X) DO
  token ← generate_monitor_token'(X)
  ASSERT token.uid ≠ 0
  ASSERT token.uid = ADMIN_MONITOR_UID  // e.g. 999999999
END FOR

// Property: Preservation Checking
FOR ALL X WHERE NOT isBugCondition_AdminUid(X) DO
  ASSERT generate_monitor_token(X) = generate_monitor_token'(X)
END FOR
```

### Bug Condition — Unfiltered onUserOffline (Bug 1.2 / 1.3)

```pascal
FUNCTION isBugCondition_SpuriousOffline(X)
  INPUT: X of type UserOfflineEvent { departing_uid, peer_uid }
  OUTPUT: boolean

  RETURN X.departing_uid ≠ X.peer_uid
END FUNCTION

// Property: Fix Checking — Non-peer departure must not schedule disconnect grace
FOR ALL X WHERE isBugCondition_SpuriousOffline(X) DO
  result ← onUserOffline_handler'(X)
  ASSERT disconnect_grace_scheduled(result) = false
END FOR

// Property: Preservation Checking — Peer departure must still schedule disconnect grace
FOR ALL X WHERE NOT isBugCondition_SpuriousOffline(X) DO
  ASSERT onUserOffline_handler(X) = onUserOffline_handler'(X)
END FOR
```
