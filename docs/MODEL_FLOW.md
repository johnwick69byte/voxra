# Simple Talk — Creator (model) flow

Validation script for a later agent session. “Model” in product language is the **Creator** role (`user_type=creator`).

Use a native Android build (`com.simple_talk.app`) on the creator phone and a second phone for the fan. Killed-state ringing, full-screen intent, and Firebase push do not work in Expo Go.

Admin actions happen in the admin dashboard: **Creators** (pending review) and **Withdrawals**.

Pass a step only with the on-device result plus the admin or wallet evidence named in the row.

## 0. Device setup and permissions

| ID | Check | Pass when |
| --- | --- | --- |
| M-0.1 | Fresh install, or a creator account that has never finished onboarding | App opens on login |
| M-0.2 | Notifications allowed | Incoming-call channel exists. Full-screen intents and lock-screen notifications are allowed. Battery restriction is not set to Restricted |
| M-0.3 | Camera allowed for the verification selfie | The in-app explanation mentions video calls and verification. Deny shows “Camera required” and a Settings action. The selfie screen does not upload |
| M-0.4 | Microphone allowed before the first audio call, camera before the first video call | Same rationale dialogs as the fan, then the Android system prompt |
| M-0.5 | Photo library allowed when a profile photo is chosen | Deny does not crash. The rest of the form still submits |

Android permissions this flow must exercise: `POST_NOTIFICATIONS`, `USE_FULL_SCREEN_INTENT`, `CAMERA`, `RECORD_AUDIO`, `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_MICROPHONE`, `FOREGROUND_SERVICE_CAMERA`, `FOREGROUND_SERVICE_PHONE_CALL`, `WAKE_LOCK`, `VIBRATE`.

## 1. Registration

| ID | Step | Expected | Edge cases |
| --- | --- | --- | --- |
| M-1.1 | Choose **Creator**, valid 10-digit mobile, send OTP | SMS arrives. 6-digit OTP. 30-second resend cooldown. Send limit 5 per 10 minutes. Verify limit 10 per 10 minutes | Wrong OTP does not create a profile. Fan OTP on this number must not silently become a creator if a fan account already exists; record what the API actually does |
| M-1.2 | Verify OTP | Complete-profile screen, not Browse | Kill the app on the OTP screen: reopen returns to login, not a half-created session without a token |
| M-1.3 | Name shorter than 2 characters | Save blocked | |
| M-1.4 | Name, username, optional photo, bio | Profile saves. Photo permission follows M-0.5 | Duplicate username is rejected |
| M-1.5 | After save | App does **not** open Browse. Next step is pricing | Force-quit here and reopen: index loads onboarding status and opens pricing, not Browse |

Onboarding order, and the screen a quit must resume:

1. `complete_profile` — name not saved
2. `pricing_setup` — no audio rate yet, or status `pending_profile` / `pending_pricing`
3. `verification_selfie` — rate saved, no selfie, or status `pending_photos`
4. `pending_approval` — selfie submitted (`pending_review`) or rejected
5. Browse — `is_approved` is true

| ID | Quit point | Reopen lands on |
| --- | --- | --- |
| M-1.6 | After OTP, before name | Complete profile |
| M-1.7 | After name, before rates | Pricing setup |
| M-1.8 | After rates, before selfie | Verification selfie |
| M-1.9 | After selfie upload | Pending approval, not a second selfie requirement |
| M-1.10 | After admin approves, reopen | Browse / creator home |

## 2. Rates, selfie, admin approval

| ID | Step | Expected | Edge cases |
| --- | --- | --- | --- |
| M-2.1 | Set audio below ₹3 or video below ₹7 | Rejected if the API minimums are enforced (₹3 audio, ₹7 video) | Empty rate cannot continue |
| M-2.2 | Save valid audio and video rates | Next screen is the live selfie. Instant calls default on | Kill app: resume on selfie, rates still stored |
| M-2.3 | Capture selfie | Camera preview. Upload stores `verification_selfie_url`. Status becomes `pending_review` | Deny camera: no upload. Airplane mode during upload: error, status stays on selfie so they can retry |
| M-2.4 | Pending screen | Creator sees they are waiting. They cannot receive paid calls yet | A fan calling this creator gets “Creator not approved”. No ring, no debit |
| M-2.5 | Admin → Creators | This creator appears with name, phone, rates, and the selfie image | Refresh the dashboard: the row is still there until approve or reject |
| M-2.6 | Admin approves | Profile `is_approved=true`, `verification_status=approved`. Creator gets an Android push “You're approved!” / “Your Simple Talk creator profile is live…” **and** the same item in the in-app Updates list | App killed: push still arrives. Tap opens the app. After reopen, home is Browse, not pending. If push is sent but Updates stays empty, fail this step |
| M-2.7 | Admin rejects instead (use a second test creator) | Creator stays on pending / rejected. They still cannot take calls. A push or in-app notice should say they were rejected | Re-submit path: record whether they can take a new selfie. If the app traps them on pending with no retry, fail this step |

## 3. Creator home, two wallets, availability

Creators have two balances:

- **Spendable (`balance`)** — only for recharges, gifts they send, and calls they place as a fan. Withdrawals must not use this.
- **Earnings (`earnings_balance`)** — call earnings and gifts received. This is the only balance a withdrawal can use.

| ID | Step | Expected | Edge cases |
| --- | --- | --- | --- |
| M-3.1 | Open Wallet | Earnings balance and spendable balance are both visible and labeled differently | A recharge increases spendable only. A completed call increases earnings only |
| M-3.2 | Toggle Available / Do not disturb | Available: fans can call and followers can be notified. DND: new calls are rejected, no ring | Toggle during an incoming ring: the current ring still ends cleanly; the next call obeys the new status |
| M-3.3 | Go Available | Followers receive an Android push and an in-app Updates row | Creator with zero followers: no crash |
| M-3.4 | Edit profile and rates | Name, username, photo, bio, rates save. New rates apply only to the next call | A call already ringing keeps the old rate |

## 4. Incoming call

Repeat with the creator app **open**, **backgrounded**, and **killed**. Repeat audio and video.

| ID | Step | Expected | Edge cases |
| --- | --- | --- | --- |
| M-4.1 | Fan with enough balance calls | Creator sees caller name, photo, and audio or video. Ringtone and vibration. Accept and Decline | Fan balance below 30 seconds of rate: creator never rings |
| M-4.2 | App open | Full-screen in-app incoming UI | A second fan at the same time does not replace the first ring |
| M-4.3 | App backgrounded | Call notification with Accept and Decline. Tapping Accept joins. Tapping Decline ends the call as REJECTED and the fan is told | |
| M-4.4 | App killed | Full-screen incoming UI on the lock screen, without opening Simple Talk first. Accept cold-starts into that call id. Decline works from the notification using `decline_token` even if the auth token is not loaded yet | Deny notification permission and repeat: M-4.4 must fail. Restore permission and repeat until it passes |
| M-4.5 | No answer for 45 seconds | Call becomes MISSED. Ring stops. Fan is not charged. Creator can receive a new call | |
| M-4.6 | Decline | Ring stops on both phones. Fan balance unchanged. Creator can receive another call immediately | |
| M-4.7 | Accept | Both join the same Agora channel. Creator status becomes busy. Screenshot and screen recording are blocked | Accept with mic denied: stay out of the room and show the permission error; the fan must not be left alone in a billed call |

## 5. Inside the call room (creator)

| ID | Step | Expected | Edge cases |
| --- | --- | --- | --- |
| M-5.1 | Controls | Mute, End, and a Gifts control. Video calls also have Cam off / Cam on. There is no “send gift” sheet on the creator side | |
| M-5.2 | Mute and camera | Fan hears mute and sees the camera stop and start. Buttons match the state | |
| M-5.3 | Gifts control before any gift | Shows no gifts yet | |
| M-5.4 | Fan sends ₹100 | Creator sees the gift animation. The Gifts control shows the session total. Toast or the control shows creator earnings of about ₹85 (15% fee). `earnings_balance` increases by that net amount immediately, not at hang-up | Three gifts: session total is the sum of face values; earnings ticker is the sum of net amounts. Fan balance drops by the full face value each time |
| M-5.5 | Minute billing seen from the creator phone | Fan spendable balance drops by one rate at each minute boundary (see fan doc U-5.5). Creator **earnings wallet does not increase per minute during the call**. It increases once when the call ends by about 85% of the total minutes billed | Fail if earnings increase by the gross amount, or if the 15% is taken twice (once on the minute and again at the end) |
| M-5.6 | Fan runs out of balance | Both leave. Status insufficient balance. Creator is paid only for minutes that were actually billed, plus gifts already received | |
| M-5.7 | Creator ends the call | Confirm. Both exit. Fan can review. Creator is Available again unless they had set DND | |
| M-5.8 | Either side kills the app | About 20 seconds to reconnect. After that the call finalizes, the ring lock clears, and a new call can arrive | Creator must not stay BUSY forever |
| M-5.9 | Foreground notification | Leaving the call UI keeps a Simple Talk ongoing-call notification. Ending the call removes it | |

Worked example to write down during the test:

- Rate ₹10/min, live for a little over 2 minutes, gifts ₹100.
- Fan spendable should fall by ₹20 + ₹100 = ₹120, if two minutes were billed.
- Creator earnings should rise by ₹17 (call, 85% of ₹20) + ₹85 (gift) = ₹102.
- Platform keeps ₹3 + ₹15.

If the first minute is only billed at 60 seconds, say so in the result and fail U-5.5 / M-5.5 until one rate is taken at the start of each minute and not twice.

## 6. Withdrawal

| ID | Step | Expected | Edge cases |
| --- | --- | --- | --- |
| M-6.1 | Withdraw ₹99 | Blocked. Minimum is ₹100 | |
| M-6.2 | Withdraw more than earnings | HTTP 402. Earnings unchanged | Spendable balance must not be usable here, even if it is larger |
| M-6.3 | Withdraw ₹100 with a UPI id and account name | Earnings drop by ₹100 immediately (held). A PENDING row appears in admin → Withdrawals with the amount and UPI | Kill the app: the hold remains. A second withdraw of the same rupees fails |
| M-6.4 | Admin marks paid | Status PAID. Creator receives an Android push and an in-app Updates item that the withdrawal was paid | App killed: push still arrives |
| M-6.5 | Admin rejects a different pending request | Status REJECTED. The held amount returns to `earnings_balance`. Creator gets a push and an in-app Updates item | Rejecting an already paid request must not credit the amount again |

## 7. Notification matrix (creator)

| ID | Event | Android push | In-app Updates |
| --- | --- | --- | --- |
| M-7.1 | Incoming call, app killed | Full-screen call notification | Not required as an Updates row if the call UI handled it. Missed calls still show in call history |
| M-7.2 | Admin approves | “You're approved!” | Same copy in Updates |
| M-7.3 | Admin rejects | A rejection notice | Same copy in Updates |
| M-7.4 | Withdrawal paid | Paid notice with amount | Same copy in Updates |
| M-7.5 | Withdrawal rejected | Rejected notice, amount returned | Same copy in Updates |
| M-7.6 | Gift received while backgrounded | Optional if the call is already in the foreground. If the creator is backgrounded but the call is live, the in-call gift UI must still update when they return | Session gift total is correct |
| M-7.7 | Admin broadcast to creators | Push | Updates row |

Fail the row if only one of push or Updates works, except where the table says Updates is not required.

## 8. Creator checklist (sign-off)

- [ ] M-0 permissions, including full-screen intent
- [ ] M-1 OTP as Creator and resume after every quit point M-1.6–M-1.10
- [ ] M-2 rates, selfie, pending row on admin, approve push + in-app, reject path
- [ ] M-3 spendable vs earnings, DND, follower notify
- [ ] M-4 ring in foreground, background, and killed state; decline token; 45s miss
- [ ] M-5 mute, camera, gift button and net earnings, minute debit on the fan, earnings credit at end, reconnect
- [ ] M-6 hold, admin paid, admin reject refunds once
- [ ] M-7 notification matrix

## Code validation (2 Oct 2026)

Checked against the mobile app, API, and admin dashboard. This is a source review, not a two-phone run. “Pass” means the code implements the step. “Fail” means a later device run should treat it as a bug.

| ID | Result | What the code actually does |
| --- | --- | --- |
| M-0.1 | Pass | No token opens login. |
| M-0.2 | Partial | Notification rationale and `POST_NOTIFICATIONS` run after login. Notifee creates channel “Incoming Calls” with a full-screen action only when a call arrives, and only on a native build. The app does not check battery restriction. |
| M-0.3 | Pass | Camera rationale mentions video calls and verification. System deny opens Settings. Selfie upload does not run without a capture. |
| M-0.4 | Pass | Accept on an incoming call asks for the microphone, and for the camera on video, before `POST /calls/{id}/accept`. |
| M-0.5 | Pass | Denied photo library toasts and still allows save without a photo. |
| M-1.1 | Pass | Creator chip is sent as `user_type=creator` only when the phone is new. An existing fan who picks Creator stays a fan. Wrong OTP is HTTP 400 and creates no user. Limits are 5 sends and 10 verifies per 10 minutes. |
| M-1.2 | Pass | Incomplete profile goes to complete-profile. OTP is not stored as a session, so a kill on the OTP screen returns to login. |
| M-1.3 | Pass | Name under 2 characters is blocked on the client and the API. |
| M-1.4 | Pass | Name, username, photo, and creator bio save. Duplicate username is HTTP 409. |
| M-1.5 | Partial | Save goes to pricing, not Browse. A force-quit uses `app/index.tsx`, which reads onboarding status. Logging out and signing in again does not. `login.tsx` sends every `profile_complete` user straight to Browse, including a creator who still needs rates or a selfie. |
| M-1.6 | Pass | `profile_complete` false resumes complete-profile. |
| M-1.7 | Partial | Cold start with no audio rate resumes pricing. A new OTP login after the name was saved skips to Browse. |
| M-1.8 | Partial | Cold start with rates and no selfie resumes the selfie screen. Same login skip as M-1.7. |
| M-1.9 | Partial | Cold start after upload resumes pending approval. Same login skip as M-1.7. |
| M-1.10 | Pass | Approved creator cold start and login both land on Browse. |
| M-2.1 | Fail | Audio below ₹3 or video below ₹7 is not rejected. The API does `max(entered, minimum)` and saves ₹3 / ₹7. An empty field becomes 0 and is raised to the minimum, so it still continues. |
| M-2.2 | Pass | Valid save sets `instant_call_enabled` true and opens the selfie. Rates remain on the profile. |
| M-2.3 | Pass | Front camera, upload sets `verification_selfie_url` and `pending_review`. A failed upload stays on the selfie screen. |
| M-2.4 | Pass | Pending screen says under review. `initiate_call` returns 403 “Creator not approved” before any debit or push. |
| M-2.5 | Fail | Admin Creators lists pending_review rows with name, user id, audio, video, and status. It does not show the phone number or the selfie image. |
| M-2.6 | Fail | Approve sets `is_approved` and `verification_status=approved`, and sends the push “You're approved!” / “Your Simple Talk creator profile is live…”. It does not insert an Updates row. After reopen, onboarding returns home. |
| M-2.7 | Partial | Reject sets `verification_status=rejected` and `is_approved` false. Pending screen says “Verification rejected” and has Retake selfie. There is no push and no Updates row. |
| M-3.1 | Pass | Wallet shows “Spendable (calls & gifts)” and “Creator earnings” only for creators. Recharge credits `balance`. Call earnings credit `earnings_balance` once at hang-up. Gifts credit earnings immediately. Withdraw reads earnings only. |
| M-3.2 | Pass | DND toggle flips `is_dnd`. Leaving DND notifies followers. A new call while DND is 403 and does not ring. Turning DND on does not cancel a ring that already started. |
| M-3.3 | Pass | Followers get a push and an Updates row, at most once per creator per 10 minutes. Zero followers does not throw. |
| M-3.4 | Fail | Profile can edit name, username, photo, and bio. Rates are a separate “Call rates” screen that calls pricing setup. That endpoint always sets `verification_status` back to `pending_photos`, so the next cold start sends an approved creator to the selfie again. A call that already started keeps the rate copied onto the call record. |
| M-4.1 | Pass | Incoming screen shows caller name, photo, and audio or video, with ringtone and vibration. Balance under 30 seconds of the rate never creates the call. |
| M-4.2 | Pass | Foreground socket opens the in-app incoming screen. A second fan gets HTTP 409 while the ring lock is held. |
| M-4.3 | Pass | Notifee shows Accept and Decline. Decline calls `POST /calls/{id}/reject-token` with `decline_token` and no login. Accept stores the call and opens the incoming screen with auto-accept. |
| M-4.4 | Partial | Killed-state path is a data-only FCM message, then a full-screen Notifee notification, then `consumePendingCall` on launch. Decline does not need the auth token. This is written for a native build only. It is not proven on a device here. |
| M-4.5 | Pass | Ring timeout is 45 seconds, then MISSED, lock cleared, no prepaid debit. |
| M-4.6 | Pass | Decline sets REJECTED, tells the fan with `call_rejected`, and clears the lock before any debit. |
| M-4.7 | Pass | Accept is blocked until mic, and camera for video, are granted. The fan is billed only after their own media join (`prepaid-start`). Both use `channel_{callId}`. Screenshot block is on the incoming screen and the call screen. A live or ringing call makes status BUSY. |
| M-5.1 | Pass | Creator sees Mute, Gifts, End, and Cam on video. Gift presets render only when `role === "caller"`. |
| M-5.2 | Pass | Mute and camera call Agora `muteLocalAudioStream` / `muteLocalVideoStream`. |
| M-5.3 | Pass | Gifts control reads “Gifts” until `earningsSession` is above 0, and the toast says “No gifts yet”. |
| M-5.4 | Pass | `gift_received` adds the face value to the session total and the net (about 85%) to the button. `credit_earnings` runs at gift time. |
| M-5.5 | Pass | Minute 1 is debited when the fan’s media joins, not after 60 seconds. Another debit inside 55 seconds is ignored, including the creator phone and the server loop. Creator call earnings are one `CALL_CREDIT` at hang-up, about 85% of `total_amount`. Commission is not applied twice. |
| M-5.6 | Pass | Failed debit finalizes `ENDED_INSUFFICIENT_BALANCE` for both. Earnings use only minutes that were billed. Gifts already credited stay credited. |
| M-5.7 | Pass | End confirms, both get `call_ended`, and the fan is sent to review. Status returns to ACTIVE unless `is_dnd` is set. |
| M-5.8 | Pass | 20-second reconnect grace, then the call finalizes and the BUSY row is no longer RINGING, ACCEPTED, or LIVE. |
| M-5.9 | Pass | `startCallForegroundService` shows an ongoing notification. `stopCallForegroundService` runs when the call screen leaves. |
| M-6.1 | Pass | Client and API both reject under ₹100. |
| M-6.2 | Pass | HTTP 402 if earnings are short. The query debits `earnings_balance` only. |
| M-6.3 | Partial | Earnings drop immediately and admin Withdrawals shows request id, user id, amount, and UPI while status is PENDING. The app does not ask for an account name (`account_name` is optional and not sent). There is no WITHDRAW transaction row, only the held balance. A second withdraw of money that is no longer there returns 402. |
| M-6.4 | Fail | Mark paid sets `PAID` and does not push or write Updates. |
| M-6.5 | Partial | Reject of a PENDING request credits earnings once. Reject of a PAID request does not credit again. Neither case notifies the creator. |
| M-7.1 | Pass | Killed incoming call is a call-channel notification, not an Updates row. Missed calls appear in history. |
| M-7.2 | Fail | Push only. Updates stays empty. |
| M-7.3 | Fail | No push and no Updates row. |
| M-7.4 | Fail | No push and no Updates row. |
| M-7.5 | Fail | No push and no Updates row. The refund itself works. |
| M-7.6 | Pass | `gift_received` is a socket event. Returning to the call screen does not replay gifts that arrived while the socket was disconnected. While the socket stays connected in the background, the totals update. |
| M-7.7 | Pass | Broadcast to `user_type=creator` sends a push and inserts an Updates row. |

The worked example matches the code if two minutes were billed: fan −₹120, creator +₹102, platform +₹18. Do not expect the creator earnings wallet to move on each minute.
