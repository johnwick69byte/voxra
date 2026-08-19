# Deploy Voxora API on Render

## 1. Push repo to GitHub
```bash
cd f:\startup\voxora
git remote add origin https://github.com/YOUR_USER/voxora.git
git push -u origin main
```

## 2. Create Web Service
- **Root directory:** `apps/api`
- **Runtime:** Docker (uses `apps/api/Dockerfile`)
- Or Blueprint: connect repo and use root `render.yaml`

## 3. Environment variables
Copy from your local `apps/api/.env`, then change:

| Key | Production value |
|-----|------------------|
| `BACKEND_URL` | `https://YOUR-SERVICE.onrender.com` |
| `ENVIRONMENT` | `production` |
| `ALLOW_ADMIN_BOOTSTRAP` | `false` |
| `DEV_OTP_CODE` | *(empty)* |
| `TRUSTOPE_REDIRECT_URL` | `https://YOUR-SERVICE.onrender.com/api/wallet/recharge/return` |
| `CORS_ORIGINS` | your admin URL(s), e.g. `https://voxora-admin.vercel.app` |
| `FIREBASE_CREDENTIALS_PATH` | `/etc/secrets/firebase-adminsdk.json` |

Upstash: set either `REDIS_URL` (`rediss://...`) **or** both `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` (API builds TLS Redis URL automatically).

## 4. Firebase Secret File
Render → Environment → **Secret Files**:
- Filename: `firebase-adminsdk.json`
- Contents: Firebase Admin SDK JSON
- Then `FIREBASE_CREDENTIALS_PATH=/etc/secrets/firebase-adminsdk.json`

## 5. After deploy
1. Point mobile `EXPO_PUBLIC_API_URL` to `https://YOUR-SERVICE.onrender.com/api`
2. Point admin `VITE_API_URL` similarly and rebuild admin
3. Bootstrap admin **once** only if you temporarily set `ALLOW_ADMIN_BOOTSTRAP=true`, then turn it off
4. Hit `GET /api/admin/health` — expect `redis_ok: true`

## Notes
- Free Render web services sleep after idle; first request may be slow. Socket.IO + ringing works better on a paid always-on instance.
- Never commit `.env` or `firebase-adminsdk.json`.
