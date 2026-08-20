# Staging E2E checklist (Render)

API: https://voxra-dkfe.onrender.com

## Auth
- [ ] Fan: 10-digit phone required; invalid first digit blocked
- [ ] OTP field max 6; verify disabled until 6 digits
- [ ] Resend cooldown 30s; HTTP 429 after 5 sends / 10 min
- [ ] Verify rate limit 10 / 10 min
- [ ] Complete profile: name min 2, optional photo, creator bio
- [ ] Creator quit mid-selfie → reopen resumes to verification/pending
- [ ] Login sheet springs in; Fan/Creator role chips

## Browse / profile
- [ ] Search debounced; sort Popular / Price; status chips
- [ ] Status dots ACTIVE/BUSY/OFFLINE/DND with color crossfade
- [ ] Creator gallery swipe; reviews list; sticky CTA disables when busy/dnd/offline
- [ ] Rates show “Creator receives ~85%” commission hint
- [ ] Creator home: earnings amount, sparkline stub, Available/DND toggle (color-coded)

## Calls — safety
- [ ] First call (or until “Don’t show again”): pre-call disclaimer before initiate/accept
- [ ] During `incoming-call` + `call-screen`: screenshots/screen-record blocked (Android FLAG_SECURE via expo-screen-capture)
- [ ] Incoming ringtone + vibration; accept/decline
- [ ] Caller ringback while Ringing
- [ ] Second concurrent caller blocked (ring lock)
- [ ] Mute / cam / gift / end circular controls
- [ ] Gift presets disabled until LIVE; icons + ~85% hint on sheet
- [ ] Gift send/receive: Reanimated fly animation + haptics on both sides
- [ ] Creator LIVE session shows earnings ticker increments on gifts
- [ ] Back confirms end; 20s reconnect banner; kill+relaunch restores LIVE

## Wallet / money
- [ ] Fan: Spendable balance + recharge packs / custom amount
- [ ] Creator: Earnings card + Withdraw (UPI) → `POST /wallet/withdraw` (min ₹100)
- [ ] Transaction filters: ALL / RECHARGE / CALL / GIFT / WITHDRAW
- [ ] Gift: fan `balance` debit; creator `earnings_balance` credit net of 15%
- [ ] Socket `gift_sent` / `gift_received` include `{amount, earnings, balance}`

## Push / killed-state ring (EAS build only)
- [ ] Firebase **Admin** JSON on Render Secret File → `FIREBASE_CREDENTIALS_PATH` (server send)
- [ ] Mobile **client** `google-services.json` = Android app config from Firebase Console (NOT the service-account JSON)
- [ ] App killed → data-only FCM → Notifee full-screen Accept/Decline
- [ ] Accept cold-start: `index.js` Notifee background event → pending call → join path
- [ ] Decline: `decline_token` path without auth
- See [FCM_DEVICE_QA.md](./FCM_DEVICE_QA.md) for full matrix

## After call / account
- [ ] Review + report/block
- [ ] Call history shows peer, duration, amount
- [ ] Edit profile updates name/username/photo/bio
- [ ] Privacy + Terms readable store-ready copy
