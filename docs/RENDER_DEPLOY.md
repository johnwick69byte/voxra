# Deploy Simple Talk API on Render

**Live API:** https://voxra-dkfe.onrender.com  
**API prefix:** https://voxra-dkfe.onrender.com/api  
**Health:** https://voxra-dkfe.onrender.com/api/healthz

## Render Dashboard → Environment (must set)

| Key | Value |
|-----|--------|
| `BACKEND_URL` | `https://voxra-dkfe.onrender.com` |
| `TRUSTOPE_REDIRECT_URL` | `https://voxra-dkfe.onrender.com/api/wallet/recharge/return` |
| `ENVIRONMENT` | `production` |
| `ALLOW_ADMIN_BOOTSTRAP` | `false` (set `true` only once to create first admin, then off) |
| `DEV_OTP_CODE` | unused — the dev OTP `7723` is hardcoded in `auth_service.py` and works in all environments |
| `CORS_ORIGINS` | `http://localhost:5173,http://localhost:8081,http://127.0.0.1:5173` + your admin host if hosted |
| `SOCKETIO_CORS_ORIGINS` | `*` |
| `FIREBASE_CREDENTIALS_PATH` | `/etc/secrets/firebase-adminsdk.json` (if using Secret File) |

Also ensure these match your local `.env`: Mongo, Upstash Redis (`REDIS_URL` and/or Upstash REST pair), JWT secrets, Agora, MessageCentral, ImageKit, Trustope when ready.

After changing env vars → **Manual Deploy** / restart the service.

## Trustope webhook (when payments enabled)
`https://voxra-dkfe.onrender.com/api/wallet/recharge/webhook`

## Clients (already updated locally)
- Mobile: `EXPO_PUBLIC_API_URL=https://voxra-dkfe.onrender.com/api`
- Admin: `VITE_API_URL=https://voxra-dkfe.onrender.com/api`

Restart Expo / rebuild admin after env changes.

## Notes
- Free Render services sleep when idle; first request can take ~30–60s.
- Never commit `.env` or `firebase-adminsdk.json`.
- **Rate limiting:** when Redis is unavailable the limiter falls back to an in-process
  dict. This is safe on a single instance but is bypassable across multiple
  instances and resets on restart. Keep Redis configured in production if you
  ever scale beyond one instance.
