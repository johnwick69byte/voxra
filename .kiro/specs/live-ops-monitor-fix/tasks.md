# Live Ops Monitor Fix — Tasks

## Task List

- [x] 1 Fix admin monitor token UID (Bug A — Backend)
  - [x] 1.1 Add `ADMIN_MONITOR_UID = 999_999_999` constant to `voxora/apps/api/app/routers/admin.py`
  - [x] 1.2 Update `generate_monitor_token` to call `agora_service.build_rtc_token(channel_name, uid=ADMIN_MONITOR_UID, role="subscriber")`
  - [x] 1.3 Update the response to return `"uid": ADMIN_MONITOR_UID` instead of hardcoded `0`

- [x] 2 Fix admin monitor UID propagation (Bug A — Admin Web Client)
  - [x] 2.1 Update `LiveOps.tsx` to include `uid: String(d.uid)` in the URL params passed to the monitor popup window
  - [x] 2.2 Update `Monitor.tsx` to read `uid` from URL search params
  - [x] 2.3 Update `Monitor.tsx` `client.join` call to use the URL param UID (fallback to `ADMIN_MONITOR_UID = 999_999_999`) instead of hardcoded `0`

- [x] 3 Fix spurious `onUserOffline` disconnect grace (Bug B — Mobile Agora service)
  - [x] 3.1 Add optional `peerUid?: number` field to `AgoraJoinParams` type in `voxora/apps/mobile/src/services/agora.ts`
  - [x] 3.2 Update `onUserOffline` handler in `registerEventHandler` to receive the departing UID and skip `params.onUserOffline?.()` when the departing UID does not match `params.peerUid`

- [x] 4 Fix spurious disconnect grace (Bug B — Mobile call screen)
  - [x] 4.1 Add `peerUidRef = useRef<number | undefined>(undefined)` to `call-screen.tsx`
  - [x] 4.2 Set `peerUidRef.current` from `agora.peer_uid` inside the `onAccepted` socket handler (before `joinMedia` is called)
  - [x] 4.3 Forward `peerUid: peerUidRef.current` to `createAndJoinEngine` inside `joinMedia`

- [x] 5 Harden `finalize_call` creator status reset (Bug C — Backend)
  - [x] 5.1 In `voxora/apps/api/app/services/call_service.py` `finalize_call`, replace the conditional `creator_status` emit with an unconditional `emit_to_user(receiver_id, "creator_status", { "user_id": ..., "status": "ONLINE" })` after `mark_creator_online`

- [x] 6 Enhancement E1 — Fit / Fill video toggle in Monitor popup
  - [x] 6.1 Remove `!important` from the `object-fit: cover` rule in `Monitor.css` and add a `.monitor-cell.fit-mode .monitor-video video` rule with `object-fit: contain`
  - [x] 6.2 Add per-cell `fitModes` state (`Record<number, boolean>`) to `Monitor.tsx`
  - [x] 6.3 Apply `fit-mode` CSS class to `.monitor-cell` when the cell's UID is in `fitModes`
  - [x] 6.4 Add a toggle button inside each `.monitor-cell` that flips the entry in `fitModes` and displays "Fit" or "Fill" based on current state
  - [x] 6.5 Add `.monitor-fit-toggle` styles to `Monitor.css` (position absolute, top-right corner, small button)

- [x] 7 Enhancement E2 — Live Ops auto-refresh and manual refresh
  - [x] 7.1 Change the `setInterval(load, 5000)` call in `LiveOps.tsx` to `setInterval(load, 30_000)`
  - [x] 7.2 Add a "Refresh" button to the `LiveOps.tsx` page header that calls `load()` on click
  - [x] 7.3 Update the subtitle text from "auto-refresh every 5s" to "auto-refresh every 30s"

- [x] 8 Write exploratory bug-condition tests (run on unfixed code to confirm root cause)
  - [x] 8.1 Write a Python test asserting that the unfixed `generate_monitor_token` returns `uid=0` (confirms Bug A)
  - [x] 8.2 Write a JS/TS unit test asserting that the unfixed `onUserOffline` handler calls `scheduleDisconnectGrace` even when the departing UID does not match the peer UID (confirms Bug B)

- [x] 9 Write fix-checking tests (run on fixed code)
  - [x] 9.1 Write a Python unit test asserting that the fixed `generate_monitor_token` returns `uid=999999999` and never returns `uid=0`
  - [x] 9.2 Write a JS/TS unit test asserting that the fixed `onUserOffline` handler does NOT call `scheduleDisconnectGrace` when `departing_uid ≠ peer_uid`
  - [x] 9.3 Write a JS/TS unit test asserting that the fixed `onUserOffline` handler DOES call `scheduleDisconnectGrace` when `departing_uid === peer_uid`
  - [x] 9.4 Write a Python unit test asserting that `finalize_call` emits `creator_status` with `status="ONLINE"` unconditionally

- [x] 10 Write property-based preservation tests
  - [x] 10.1 Write a PBT (Python `hypothesis`) asserting: for any `channel_name`, the fixed `generate_monitor_token` always returns `uid=ADMIN_MONITOR_UID` (Property 1)
  - [x] 10.2 Write a PBT (JS fast-check or similar) asserting: for any `(departing_uid, peer_uid)` pair where `departing_uid ≠ peer_uid`, the fixed handler never calls `scheduleDisconnectGrace` (Property 2)
  - [x] 10.3 Write a PBT asserting: for any `(departing_uid, peer_uid)` pair where `departing_uid === peer_uid`, the fixed handler always calls `scheduleDisconnectGrace` (Property 3)
