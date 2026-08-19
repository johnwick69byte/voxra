# EAS / Dev client build

## Why
`react-native-agora`, `@notifee/react-native`, `@react-native-firebase/*`, and `react-native-callkeep` require a **custom native build**. Expo Go will only do signaling.

## One-time setup
```bash
cd apps/mobile
npx eas-cli login
npx eas-cli init   # set projectId in app.json extra.eas.projectId
```

Place secrets (do not commit):
- `google-services.json` (Android)
- `GoogleService-Info.plist` (iOS)
- API `.env`: `AGORA_APP_ID`, `AGORA_APP_CERTIFICATE`, `FIREBASE_CREDENTIALS_PATH`

Mobile env (EAS secrets or `eas.json` env):
```
EXPO_PUBLIC_API_URL=https://your-api.example.com/api
EXPO_PUBLIC_AGORA_APP_ID=...
```

## Profiles (`eas.json`)
| Profile | Use |
|---------|-----|
| `development` | Dev client + internal distribution |
| `preview` | Internal APK QA |
| `production` | Store builds (`autoIncrement: true`) |

## Build
```bash
# Dev client
npx eas build --profile development --platform android

# Preview APK
npx eas build --profile preview --platform android

# Production (store)
npx eas build --profile production --platform all
npx eas submit --profile production --platform android
npx eas submit --profile production --platform ios
```

Local native:
```bash
npx expo prebuild
npx expo run:android
```

## Production API env checklist
```
ENVIRONMENT=production
ALLOW_ADMIN_BOOTSTRAP=false
JWT_SECRET=...
ADMIN_JWT_SECRET=...
MESSAGECENTRAL_*  # real OTP
AGORA_*
FIREBASE_CREDENTIALS_PATH=...
TRUSTOPE_*
IMAGEKIT_*
```

## Device QA
Follow [FCM_DEVICE_QA.md](./FCM_DEVICE_QA.md), [STORE_ASSETS.md](./STORE_ASSETS.md), and [LAUNCH_CHECKLIST.md](./LAUNCH_CHECKLIST.md).
