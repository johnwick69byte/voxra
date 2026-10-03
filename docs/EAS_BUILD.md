# EAS / Dev client build

> Full, current instructions (profiles, env, icons, store) are in
> [BUILD_AND_RELEASE.md](./BUILD_AND_RELEASE.md). This file is a quick reference.

## Why
`react-native-agora`, `@notifee/react-native`, `@react-native-firebase/*`, and
`react-native-callkeep` require a **custom native build**. Expo Go will only do
signaling.

## Profiles (`eas.json`)
| Profile | Output | Use |
|---------|--------|-----|
| `development` | APK (dev client) | Hot reload + native modules |
| `preview` | APK | Internal QA |
| `production` | **AAB** | Play Store |
| `production-apk` | APK | Production code, direct install/QA |

All profiles carry the public `EXPO_PUBLIC_*` env values inline.

## Build
```bash
cd apps/mobile

# Internal test APK
eas build -p android --profile preview

# Production APK (test) / AAB (store)
eas build -p android --profile production-apk
eas build -p android --profile production

# Submit the AAB
eas submit -p android --profile production
```

Local native:
```bash
npx expo prebuild
npx expo run:android
```

## Production API env checklist
See §5 of [BUILD_AND_RELEASE.md](./BUILD_AND_RELEASE.md) for the complete,
current list (includes `CASHFREE_*` and `RECHARGE_*`).

## Device QA
Follow [CALL_FLOW_TESTS.md](./CALL_FLOW_TESTS.md),
[FCM_DEVICE_QA.md](./FCM_DEVICE_QA.md),
[STORE_ASSETS.md](./STORE_ASSETS.md), and
[LAUNCH_CHECKLIST.md](./LAUNCH_CHECKLIST.md).
