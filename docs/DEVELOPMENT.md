# Voxora development guide

## Stack
- **API:** FastAPI + Socket.IO + MongoDB + Redis (`apps/api`)
- **Mobile:** Expo 54 / React Native (`apps/mobile`) — brand **Voxora**, scheme `voxora://`
- **Admin:** Vite React (`apps/admin`)

## Phase checklist (implemented in scaffold)
- [x] Phase 0 — monorepo, docker compose, CI, design tokens, modular API
- [x] Phase 1 — OTP auth, profile, browse/follow, DND, Redis presence
- [x] Phase 2 — call state machine, server billing loop, FCM/Notifee incoming calls, decline_token
- [x] Phase 3 — recharge packages, Trustope/dev payment, idempotent credit
- [x] Phase 4 — admin overview (real analytics), live ops, force-end, audit, health
- [x] Phase 5 — force-update gate, privacy/terms, launch docs & test matrix

## Local run
```bash
docker compose up -d
cd apps/api && pip install -r requirements.txt && uvicorn app.main:socket_app --reload --port 8000
cd apps/admin && npm i && npm run dev
cd apps/mobile && yarn && EXPO_PUBLIC_API_URL=https://voxra-dkfe.onrender.com/api npx expo start
```

Bootstrap admin: open admin → **Bootstrap first admin** (or `POST /api/admin/bootstrap`).

Dev OTP: `123456`

## Store / launch notes
- Android package / iOS bundle: `com.voxora.app`
- Configure Firebase, Agora, Trustope, ImageKit in `apps/api/.env`
- EAS: set projectId in `app.json`; add CallKit/ConnectionService native modules for production ringing UX
- Load-test ring + bill paths before soft launch
- Soft launch monitoring: Admin → Live ops + Health

## Test matrix
See [LAUNCH_CHECKLIST.md](./LAUNCH_CHECKLIST.md)
