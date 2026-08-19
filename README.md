# Voxora

Instant audio & video calling between fans and creators. Greenfield rebuild — no appointments.

## Monorepo

| Path | Description |
|------|-------------|
| `apps/api` | FastAPI + Socket.IO + Redis + MongoDB |
| `apps/mobile` | Expo (React Native) — user & creator |
| `apps/admin` | Vite admin ops dashboard |
| `packages/shared-types` | Shared TypeScript types |

## Quick start

```bash
# Infra
docker compose up -d

# API
cd apps/api && python -m venv .venv && .venv/Scripts/activate  # Windows
pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:socket_app --reload --port 8000

# Admin
cd apps/admin && npm install && npm run dev

# Mobile
cd apps/mobile && yarn && npx expo start
```

## Brand

- Package (Android): `com.voxora.app`
- Bundle (iOS): `com.voxora.app`
- Scheme: `voxora://`
