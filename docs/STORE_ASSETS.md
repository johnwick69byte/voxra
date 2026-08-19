# Store assets & soft-launch packaging

## Screenshots (required for stores)

Capture on a real device or EAS build (not Expo Go) with demo accounts:

| Screen | Notes |
|--------|--------|
| Login | Brand-first hero, no OTP filled |
| Browse | 3–5 creators with ACTIVE status |
| Creator profile | Full-bleed photo + rates + CTA |
| Incoming call | Full-screen Accept/Decline |
| In-call | Timer + mute/end (audio preferred for clarity) |
| Wallet | Balance + packs with minutes estimate |

Android: phone + 7" tablet if listing tablet. iOS: 6.7" and 6.1" frames.

Place exports in `apps/mobile/store/screenshots/` (create locally; do not commit PII).

## Privacy / data safety questionnaire

Use in-app screens as source of truth:
- Privacy: `voxora://` → Profile → Privacy policy
- Terms: Profile → Terms of service
- Account deletion: `POST /api/auth/delete-account`

Data collected: phone, name, profile photo, call metadata, payment order ids, FCM tokens.
Sensitive: microphone/camera during calls only.
Sharing: payment processor (Trustope), ImageKit (verification selfies), FCM, Agora RTC.

## Soft-launch monitoring

1. Deploy API with `ENVIRONMENT=production` and `ALLOW_ADMIN_BOOTSTRAP=false`.
2. Watch Admin → Live Ops: miss rate, FCM fail count, stuck BUSY.
3. Confirm wallet deep-link return `voxora://wallet` + verify-pending.
4. Run through [LAUNCH_CHECKLIST.md](./LAUNCH_CHECKLIST.md) on 2 Android + 1 iOS devices.
5. Cap soft launch to invite cohort; raise recharge rate limits only after 48h clean ops.

## EAS production

See [EAS_BUILD.md](./EAS_BUILD.md) — use `--profile production` and submit via `eas submit`.
