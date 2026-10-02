# Simple Talk — Fan (user) flow

Validation script for a later agent session. Use two Android phones on a native build (`com.simple_talk.app`), not Expo Go. Expo Go has no Firebase or Notifee, so killed-state ringing cannot pass there.

Roles in this document:

- **Fan** — account created with role Fan (`user_type=user`). Spendable wallet only.
- **Creator** — an already approved creator who is Available, used as the other party.
- **Admin** — Simple Talk admin dashboard.

API base used by the app: `https://voxra-dkfe.onrender.com` (prefix `/api`).

Pass a step only after the expected result is visible on the device or in the API/admin. Record the call id, balances before and after, and a screenshot or log line for money and notification steps.

## 0. Device setup

| ID | Check | Pass when |
| --- | --- | --- |
| U-0.1 | Install the native Android build on the fan phone and the creator phone | Both show Simple Talk, package `com.simple_talk.app` |
| U-0.2 | Fan grants notifications when asked | Android notification permission is Allowed. Rationale text mentions missing calls in the background |
| U-0.3 | Fan can reach Settings if they deny mic or camera later | Deny once, confirm the call does not start, then allow from the system prompt or App info |
| U-0.4 | Creator is approved, Available, audio and video rates set, and has a push token | Creator status dot is available. A test push can be delivered |
| U-0.5 | Fan has no spendable balance at the start | Wallet shows ₹0 spendable |

Permissions the fan must be able to grant, with the in-app explanation before the system dialog:

- Notifications (`POST_NOTIFICATIONS`) — so a call or account alert can arrive. Asked around login/home and again before a call.
- Microphone (`RECORD_AUDIO`) — before an audio or video call.
- Camera (`CAMERA`) — before a video call only.
- Full-screen incoming call (`USE_FULL_SCREEN_INTENT`) — required for the WhatsApp-style ring when the app is closed. Confirm the channel “incoming calls” is allowed and full-screen intents are not blocked in Android settings.
- While a call is live, a foreground service uses microphone, camera, and phone-call types. The ongoing call notification must stay visible if the fan leaves the call screen.

## 1. Login and profile

| ID | Step | Expected | Edge cases |
| --- | --- | --- | --- |
| U-1.1 | Open the app with no session | Login screen. Brand is Simple Talk | Kill and reopen still shows login |
| U-1.2 | Enter 9 digits, or a number starting with 0–5 | Send OTP stays blocked or the API rejects it | Paste `+91` and spaces; only a 10-digit Indian mobile starting 6–9 is accepted |
| U-1.3 | Choose **Fan**, enter a valid number, send OTP | SMS arrives. OTP field accepts 4 digits. Verify stays disabled until 4 digits | Resend is disabled for 30 seconds. A 6th send inside 10 minutes returns HTTP 429. More than 10 verify attempts in 10 minutes returns 429 |
| U-1.4 | Enter a wrong OTP | Error, no session | Dev OTP `7723` is always accepted (hardcoded). Production uses the real SMS code for any other input |
| U-1.5 | Enter the correct OTP | Land on complete profile if name is missing | Token is stored as `simpletalk_token`. An old `voxora_token` still signs the same user in |
| U-1.6 | Complete profile: name under 2 characters | Blocked | |
| U-1.7 | Name of at least 2 characters, optional photo | Photo picker asks for photo permission. Deny: toast “Photo permission required”, profile can still be saved without a photo. Allow: photo uploads | Username taken returns a clear error |
| U-1.8 | Save as Fan | Home is the Browse tab. No pricing, selfie, or pending-approval screen | Force-quit on complete profile and reopen: login is skipped and complete profile resumes until `profile_complete` is true |

## 2. Browse creators

| ID | Step | Expected | Edge cases |
| --- | --- | --- | --- |
| U-2.1 | Open Browse | Only approved creators. Status dot for Available, On a call, Do not disturb, Offline | Search is debounced. Sort Popular and Price works. Empty search shows the list again |
| U-2.2 | Open a creator profile | Name, photo, bio, audio rate, video rate, rating, follow | Rate line shows the creator receives about 85% |
| U-2.3 | Follow and unfollow | Following tab gains and loses that creator | Follow a creator, kill the app, reopen: follow is still there |
| U-2.4 | Creator is DND, busy, or offline | Call button does not start a paid call | Offline may still be callable if the product allows push-wake. Busy and DND must return a clear error and must not debit the wallet |
| U-2.5 | Second fan calls the same creator while the first ring is up | Second call is rejected. Message that the creator is receiving another call. No second ring | |

## 3. Wallet recharge

Fans pay only from **spendable balance**. They have no earnings wallet and no withdraw button.

| ID | Step | Expected | Edge cases |
| --- | --- | --- | --- |
| U-3.1 | Open Wallet before any recharge | Spendable ₹0. No earnings card | |
| U-3.2 | Start a call with balance below 30 seconds of the selected rate | HTTP 402. Message includes the minimum rupees and the per-minute rate. Call is not created | Example: ₹10/min requires at least ₹5.00 |
| U-3.3 | Recharge with a pack and with a custom amount | Payment page opens. After success, spendable balance increases by that amount and a RECHARGE transaction appears | Cancel the payment: balance unchanged. Replay the same success webhook: balance increases once |
| U-3.4 | Return to the app from the payment page | App shows the new balance without a reinstall | Deep link scheme is `simpletalk://` |
| U-3.5 | Filter transactions | ALL, RECHARGE, CALL, GIFT, WITHDRAW show the right rows | |

Referral, if used: apply a code, recharge for the first time, fan spendable increases by ₹20 once. A second recharge does not pay it again. Self-referral does not pay.

## 4. Outgoing call

Do this once for **audio** and once for **video**.

| ID | Step | Expected | Edge cases |
| --- | --- | --- | --- |
| U-4.1 | First call ever | Pre-call disclaimer: 18+ and the other person may record. Cancel does not create a call. Continue proceeds. “Don’t show again” skips it next time | |
| U-4.2 | Audio: deny microphone | Call does not join. Toast asks for microphone permission | Allow on the second attempt and the call proceeds |
| U-4.3 | Video: allow mic, deny camera | Call does not join until camera is allowed | |
| U-4.4 | After permissions, fan taps audio or video | Fan sees Ringing and hears ringback. Creator’s phone rings. Wallet is **not** debited while ringing | Fan cancels while ringing: status CANCELLED, both sides leave, balance unchanged |
| U-4.5 | Creator does nothing for 45 seconds | Status MISSED. Fan leaves the ringing UI. Balance unchanged | |
| U-4.6 | Creator declines | Fan sees the call ended. Balance unchanged | |
| U-4.7 | Creator accepts | Both enter the call room. Agora connects. Fan status becomes Connected. Screenshot and screen recording are blocked on the call screen | If accept works but media fails, the error is visible and the call can be ended without a stuck ring lock |

## 5. Inside the call room (fan)

| ID | Step | Expected | Edge cases |
| --- | --- | --- | --- |
| U-5.1 | Call screen controls | Mute, End, and Gift are visible. Video calls also show Cam off / Cam on | Gift before the call is live shows “Gifts available during live call” and does not debit |
| U-5.2 | Mute | Creator stops hearing the fan. Unmute restores audio | Toggle several times. Button icon matches mute state |
| U-5.3 | Camera | Cam off stops the fan’s video. Cam on restores it. Remote view still shows the creator when their camera is on | Switch off and on during the same call |
| U-5.4 | Live spendable balance | The balance on the call screen matches the wallet. It updates when a minute is billed and when a gift is sent | Pull the wallet in another session after the call: same number |
| U-5.5 | Minute billing | At the **start of each live minute**, exactly one per-minute rate is deducted from spendable balance. Socket `call_prepaid_billed` arrives with `minute`, `amount` = rate, `balance`, and `total_billed` | Record balance at t=0, t=60, t=120. Fail if minute 1 is skipped, if two rates are taken at the same boundary, or if ringing time was charged. Insufficient balance ends the call for both with `ENDED_INSUFFICIENT_BALANCE` and stops further debits |
| U-5.6 | Low balance | When fewer than 2 minutes remain, the fan sees a low-balance warning | The call still ends cleanly at zero instead of going negative |
| U-5.7 | Gift ₹10, ₹25, ₹50, ₹100, ₹250 | Each debit equals the full gift. Balance updates. Animation plays. Creator receives the gift event | Gift larger than balance: no debit, “Insufficient balance”. Gift after hang-up: rejected, “Call not live” |
| U-5.8 | End call | Confirm dialog. Both leave the room. Fan can rate, report, or block | Android back asks for confirmation and does not leave a live Agora room |
| U-5.9 | Network drop | Reconnecting banner for about 20 seconds. If the peer returns, the call continues and billing does not double-charge the gap incorrectly | If the grace expires, status ends as a disconnect and both wallets stop changing |
| U-5.10 | Kill the fan app during a live call and reopen | The live call is restored or a clear ended state is shown. It must not be possible to start a second call to the same creator while this one is still live | |

After the call, history shows the creator, duration, and the amount actually billed. A CALL debit transaction exists for that total. The creator’s earnings are not visible on the fan wallet.

## 6. What the fan should observe on the creator side

These are fan-flow checks that the other phone must satisfy:

| ID | Check | Pass when |
| --- | --- | --- |
| U-6.1 | App in foreground | In-app incoming screen: caller name, audio or video, Accept and Decline, ringtone and vibration |
| U-6.2 | App in background | A high-priority call notification appears. Tapping it opens Accept / Decline |
| U-6.3 | App killed (swiped away) | A full-screen incoming call still appears, including on the lock screen, the way a WhatsApp call does. Accept cold-starts the app and joins the same call id. Decline works without the creator having to log in again (`decline_token`) |
| U-6.4 | Notification permission denied on the creator phone | The socket incoming screen still works while the app is open. Killed-state ring fails visibly; do not mark U-6.3 as passed |
| U-6.5 | Creator accepts | Both are in the same Agora channel. Creator sees Mute, camera (video), a Gifts control, and End. Fan balance on the fan phone and creator gift total stay in sync |

## 7. In-app and push notifications (fan)

| ID | Event | Android push | In-app Updates screen |
| --- | --- | --- | --- |
| U-7.1 | Followed creator goes available | Push if the fan allowed notifications | A row in Updates |
| U-7.2 | Admin broadcast to users | Push title and body match | Same title and body in Updates, unread until seen |
| U-7.3 | Call events | Incoming ring is a call notification, not a generic tray item that can be missed | Missed call is visible in history even if the push was missed |

Fail U-7 if the push arrives and the Updates list stays empty, or the reverse, for account notifications. Call rings are allowed to be call-channel notifications rather than Updates rows, but they must still arrive when the app is killed.

## 8. Fan checklist (sign-off)

- [ ] U-0 permissions recorded
- [ ] U-1 OTP, rate limits, profile resume
- [ ] U-2 browse, follow, busy/DND block
- [ ] U-3 recharge once-only, 402 when balance is too low
- [ ] U-4 audio and video: disclaimer, permissions, cancel, timeout, decline, accept
- [ ] U-5 mute, camera, gift presets, live balance, one debit per minute, low balance, end, 20s reconnect
- [ ] U-6 foreground, background, and killed-state ring
- [ ] U-7 push and in-app notifications
- [ ] History and wallet filters match the call and the gifts

## Code validation (2 Oct 2026)

Checked against the mobile app and API. This is a source review, not a two-phone run. “Pass” means the code implements the step. “Fail” means a later device run should treat it as a bug.

| ID | Result | What the code actually does |
| --- | --- | --- |
| U-0.1 | Pass | `app.json` package is `com.simple_talk.app`. Killed-state ring needs a native build. |
| U-0.2 | Pass | `ensureNotificationPermission` explains missing a call in the background, then asks Firebase. It runs after login in `app/_layout.tsx`, and again inside `ensureCallPermissions`. If the Firebase native module is missing it returns true and does not ask. |
| U-0.3 | Partial | Denying mic or camera in `startCall` stops the call with “Permissions required for calls”. There is no Settings button on that path. Only the creator selfie flow opens Settings. |
| U-0.4 | Pass | Browse and profile read creator status. Push is sent only when `push_tokens.device_push_token` exists. |
| U-0.5 | Pass | New wallet is created with `balance: 0`. Fan wallet screen labels it “Spendable (calls & gifts)” and hides the earnings card. |
| U-1.1 | Pass | No token redirects to login. Brand text is `APP_NAME` (Simple Talk). |
| U-1.2 | Pass | `nationalDigits` strips a leading `91` from a 12-digit paste, so `+91 98765 43210` becomes `9876543210`. A typed 9-digit number or one starting 0–5 is rejected by `phoneOk`. |
| U-1.3 | Pass | SMS path, 4-digit cap, and 30s resend match. Send limit is 5 / 10 min and verify limit is 10 / 10 min, both HTTP 429. The verify button is disabled until 4 digits. |
| U-1.4 | Pass | Bad OTP is HTTP 400 and no token is stored. `7723` is always accepted (hardcoded dev OTP). |
| U-1.5 | Pass | Incomplete profile goes to complete-profile. Token key is `simpletalk_token`. Hydration still reads `voxora_token`, then replaces it. |
| U-1.6 | Pass | Client and `CompleteProfileRequest` both require 2 characters. |
| U-1.7 | Pass | Denied photo permission toasts “Photo permission required” and does not block save. Username collision is HTTP 409 “Username taken”, shown in the toast. |
| U-1.8 | Pass | Fan save goes to `/`, and index sends a finished fan to Browse. Quit before `profile_complete` resumes complete-profile. |
| U-2.1 | Pass | Browse query is `is_approved: true`. Dots use ACTIVE, BUSY, OFFLINE, DND. Search debounce is 350ms. Sort chips are Popular and Price. Clearing search reloads the list. |
| U-2.2 | Pass | Profile shows name, photo, bio, both rates, rating, follow, and “Creator receives ~85% after platform fee”. |
| U-2.3 | Pass | Follow is stored in `follows` and the Following tab reads that collection, so it survives a restart. |
| U-2.4 | Partial | DND and BUSY are blocked in the app and in `is_creator_available`, with no debit. OFFLINE is also blocked by the app (`startCall` treats OFFLINE as unavailable) even though the API would still allow a push-wake call. The button is only faded, not disabled, but `startCall` re-checks status and alerts. |
| U-2.5 | Pass | Redis ring lock, or a Mongo `RINGING` row, returns HTTP 409 “Creator is receiving another call”. |
| U-3.1 | Pass | Fan UI has spendable only. Withdraw is inside `isCreator`. |
| U-3.2 | Pass | Minimum is 30 seconds of the rate. ₹10/min requires ₹5.00. HTTP 402 includes the minimum and the rate. No call row is inserted. |
| U-3.3 | Pass | Packs and a custom amount of at least ₹10 open `payment_url`. Success credits once: a second webhook sees `metadata.status == SUCCESS` and does not credit again. Cancel leaves the row PENDING. A pack credits amount plus bonus (₹199 pack credits ₹209). The RECHARGE row is the credited total, not the amount paid. |
| U-3.4 | Pass | Return URL containing `wallet` runs `verifyPending` and reloads. Scheme used in the toast is `simpletalk://wallet`. |
| U-3.5 | Pass | Filters are ALL, RECHARGE, CALL, GIFT, WITHDRAW, matched with `type.includes(filter)`. Fan call debits are `CALL_DEBIT`. Gifts are `GIFT_DEBIT`. A fan has no withdraw row. |
| U-4.1 | Pass | Disclaimer is “Before you call”, includes 18+ and that peers may record. Cancel returns before `initiate`. “Don't show again” sets `call_disclaimer_dont_show`. “I agree” shows it again next time. |
| U-4.2 | Pass | Mic is requested before `initiate`. Deny never creates the call. |
| U-4.3 | Pass | Video also requires camera before `initiate`. |
| U-4.4 | Pass | After accept path is not used yet: fan screen plays ringback while status starts with “Ring”. Push plus `incoming_call` socket. `total_amount` stays 0 until `prepaid-start`. Cancel calls `POST /calls/{id}/cancel`. |
| U-4.5 | Pass | `call_ring_timeout_seconds` is 45, then `miss_call`. Fan listens for `call_missed` and leaves. No debit before prepaid-start. |
| U-4.6 | Pass | `call_rejected` toasts “Call declined” and leaves. No prepaid-start, so no debit. |
| U-4.7 | Partial | Accept emits `call_accepted`. Fan calls `prepaid-start`, then joins Agora. Screenshot block is `useSecureCallScreen` on the call screen and the incoming screen. If Agora errors, production still sets status “Connected”. A media failure after the first minute is billed does not refund that minute. |
| U-5.1 | Pass | Mute, Gift, End, and Cam on video. Gift tap before `isLive` toasts and does not call the API. |
| U-5.2 | Pass | `muteLocalAudioStream` toggles with the icon. |
| U-5.3 | Pass | `muteLocalVideoStream` toggles. Remote view is bound to `remoteUid`. |
| U-5.4 | Pass | Call screen shows `bal ₹{balance}` from `call_prepaid_billed` and `gift_sent`. It is not loaded from the wallet API at join, so it can read ₹0 until the first bill event. |
| U-5.5 | Pass | Minute 1 is debited inside `prepaid_start` when the creator accepts. Minute 2+ is billed by the server loop every 60s. The fan phone also calls `POST /calls/{id}/bill-minute` every 60s, but `bill_next_minute` atomically requires `last_billed_minute < next` **and** `last_billing_time <= now-55s`, so a duplicate tick at a boundary does not debit twice. The receiver does not run a bill timer. Insufficient balance finalizes `ENDED_INSUFFICIENT_BALANCE` and emits `call_ended_insufficient_balance` to both. `atomic_debit` cannot go negative. |
| U-5.6 | Pass | Warning fires when `balance / rate < 2`, toast “Low balance” plus “{n} min left”. |
| U-5.7 | Pass | Presets are 10, 25, 50, 100, 250. Full amount is debited. `gift_sent` / `gift_received` carry amount, earnings, and balance. HTTP 402 shows “Insufficient balance”. Non-live call is HTTP 400 “Call not live”. |
| U-5.8 | Pass | End uses a confirm dialog. Hardware back on a live call also confirms. Review screen is the next route for a normal end. |
| U-5.9 | Pass | Peer offline or connection lost starts a 20s timer, then `handle-disconnect`. Remote uid returning clears it and calls reconnect. Billing is not paused during the grace, so a minute boundary inside those 20s still charges. |
| U-5.10 | Pass | Relaunch calls `GET /calls/active`. LIVE or ACCEPTED pushes the call screen again. A second initiate still hits the ring lock while that call is RINGING. A LIVE creator is BUSY, so the client blocks another call. |
| U-6.1 | Pass | Foreground socket pushes `/incoming-call` and shows a Notifee call notification with Accept and Decline. Ringtone is on that screen. |
| U-6.2 | Pass | Same Notifee notification, channel “Incoming Calls”, importance HIGH, category CALL. |
| U-6.3 | Partial | Full-screen action, 45s timeout, and background decline via `decline_token` are in `index.js` and `IncomingCallService`. Accept from a killed process depends on the Notifee event opening the app with the pending call. That path is written; it is not proven on a device here. |
| U-6.4 | Pass | Without notification permission, Notifee cannot show the killed-state UI. The in-app screen still opens when the socket is connected. |
| U-6.5 | Pass | Both join `channel_{callId}`. Creator controls are Mute, Cam on video, Gifts, End. Gift totals move from the same socket payload. |
| U-7.1 | Pass | `notify_followers_creator_online` writes `notifications` and sends a push. Limited to once per creator per 10 minutes, and to 2000 followers. |
| U-7.2 | Pass | Admin broadcast writes a push and an Updates row with `read: false`, and emits `new_notification` for a live toast/badge. The Updates screen marks all read on open and supports per-item delete. |
| U-7.3 | Pass | Incoming push is data-only on channel `incoming_calls`, then Notifee draws the call UI. Missed calls are in call history with status and amount. History is not filtered to missed-only. |

Referral code matches the note: own code is rejected, first successful recharge pays the referrer ₹25 and the fan ₹20 once, onto spendable balance.

Call earnings are still one `CALL_CREDIT` at hang-up, about 85% of `total_amount`. Gifts are an immediate `GIFT_CREDIT`. Do not look for per-minute creator earnings during the call.
