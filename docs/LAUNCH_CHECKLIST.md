# Launch checklist

## Calling / notifications
- [ ] Android 12–15: killed app receives data-only FCM → full-screen Notifee call UI
- [ ] Accept / Decline from notification actions
- [ ] Foreground socket incoming call (no double screens)
- [ ] Android LIVE call keeps Notifee foreground service (`ongoing_calls`)
- [ ] App relaunch mid-LIVE restores via `GET /calls/active` → call-screen + Agora rejoin
- [ ] iOS CallKit via CallKeep in EAS build (`react-native-callkeep`)
- [ ] 45s miss timeout clears ring lock
- [ ] Busy / DND / concurrent ring races

## Billing
- [ ] Prepaid first minute on connect
- [ ] Server minute tick continues if client backgrounded
- [ ] Low balance warning + end with no double commission
- [ ] Disconnect / force-end finalize ledger once

## Wallet
- [ ] Package recharge success credits once (duplicate webhook safe)
- [ ] Custom amount recharge
- [ ] Deep link `voxora://wallet` return + auto verify-pending
- [ ] Minutes estimate from last-viewed creator rate
- [ ] Failed / pending verify-pending recovery

## Auth / safety
- [ ] MessageCentral OTP in production (`dev` false; no universal 123456)
- [ ] OTP send rate-limited (5 / 10 min)
- [ ] Call initiate + recharge rate-limited
- [ ] Post-call report + block
- [ ] Admin bootstrap disabled (`ALLOW_ADMIN_BOOTSTRAP=false` / `ENVIRONMENT=production`)

## Admin
- [ ] Overview charts match Mongo aggregates
- [ ] Live Ops: miss rate, FCM ok/fail, stuck BUSY + force-offline
- [ ] Force-end live call
- [ ] Approve creator → push
- [ ] Withdrawal mark-paid / reject refund
- [ ] Health shows Redis + socket counts

## UI / polish
- [ ] Custom fonts (Fraunces + Manrope) on login/browse/wallet/call
- [ ] Skeleton loaders on browse; recharge success motion
- [ ] No prod “signaling only” / dev OTP toast

## Compliance / store
- [ ] Privacy + Terms screens
- [ ] Account deletion endpoint
- [ ] Store screenshots / data safety forms ([STORE_ASSETS.md](./STORE_ASSETS.md))
- [ ] Min version force-update verified
- [ ] Soft-launch monitoring against Live Ops for 48h
