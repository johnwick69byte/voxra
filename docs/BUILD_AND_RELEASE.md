# Build & Release Guide — Simple Talk (Android APK / AAB)

Everything needed to build, sign, and test the app. The calling feature
(FCM killed-state ring, Agora room, per-minute billing, live wallets) requires a
**native EAS build** — it does not work in Expo Go.

---

## 0. What is already configured in the repo

| File | Purpose |
|------|---------|
| `apps/mobile/app.json` | name, slug, scheme `simpletalk`, package `com.simple_talk.app`, permissions, plugins, `projectId 17db387a-…`, `owner vik_07` |
| `apps/mobile/eas.json` | `development` (dev client APK), `preview` (internal APK), `production` (AAB), `production-apk` (APK). All profiles carry the public env values |
| `apps/mobile/google-services.json` | Firebase **client** config for `com.simple_talk.app` |
| `apps/mobile/.env` | local dev API + Agora app id |
| `.easignore` | upload allowlist that keeps `google-services.json` but excludes server secrets |
| `apps/mobile/assets/sounds/` | `ringing.mp3`, `incoming-call.mp3` (bundled) |
| `apps/mobile/plugins/withAndroidDuplicateLibsFix.js` | Agora `.so` dedupe |

Env values are embedded in the APK at **build time** (`EXPO_PUBLIC_*` are public,
not secrets). They live in `eas.json` so cloud builds get them automatically.

---

## 1. One-time setup (you)

```powershell
# 1. Confirm login
eas whoami

# 2. Confirm the project is linked (app.json already has the projectId)
eas project:info
```

If `eas project:info` fails, run:
```powershell
eas init --id 17db387a-54a3-4068-9c79-e3a4e1d84454
```

### Firebase (required for the killed-state ring)

**Client config (the app):**
1. Firebase Console → Project settings → Your apps → Android app
   `com.simple_talk.app` → **Download google-services.json**.
2. Replace `apps/mobile/google-services.json` with that file.
3. Confirm it contains only the `com.simple_talk.app` package.

**Server config (the API):** Render builds from GitHub, so your local
`apps/api/firebase-adminsdk.json` never reaches it — it is gitignored and never
committed. Provide the **same file's contents** one of two ways:

- **Option A (Secret File):** Render Dashboard → your service → Environment →
  Secret Files → Add Secret File. Filename `firebase-adminsdk.json`, mount path
  `/etc/secrets/firebase-adminsdk.json`, contents = the JSON from
  `apps/api/firebase-adminsdk.json`. Then set
  `FIREBASE_CREDENTIALS_PATH=/etc/secrets/firebase-adminsdk.json`.
- **Option B (env var):** set `FIREBASE_CREDENTIALS_JSON` to the entire JSON
  string (single line). The server parses it and fixes escaped `\n` in the key.

Both are the **same service-account file** — not a new download. Do not commit
it to git.

#### Option B walkthrough (env var — chosen for this project)

`FIREBASE_CREDENTIALS_JSON` takes precedence over `FIREBASE_CREDENTIALS_PATH`
when both are present, so nothing else needs changing.

1. Copy the value to your clipboard (this writes nothing to disk):
   ```powershell
   cd F:\startup\voxora\apps\api
   python scripts\copy_firebase_env.py
   ```
   Add `--print` if you'd rather read it off the screen. Expected length ≈ 2363
   chars; the script self-checks that it is single-line and that the private key
   round-trips as multiline.
2. Render Dashboard → `voxora-api` → **Environment** → **Add Environment Variable**
   - Key: `FIREBASE_CREDENTIALS_JSON`
   - Value: paste (Ctrl+V)
3. Save. Render redeploys automatically.
4. Leave `FIREBASE_CREDENTIALS_PATH` empty on Render — the JSON wins anyway, and
   an empty value avoids confusion.

Verify after the deploy — log in to the admin dashboard and open the Health
endpoint (`GET /api/admin/health`). The `firebase` block should read:

```json
"firebase": {
  "configured": true,
  "source": "json_env",
  "ready": true,
  "project_id": "studio-7418879095-d1d29",
  "error": null
}
```

- `source: "json_env"` confirms it used the env var, not a file.
- `ready: true` means FCM is live; killed-state ringing will work.

To confirm end-to-end delivery to a real device, call
`POST /api/admin/push-test` with `{"user_id": "<your user id>"}`.

You can re-verify the whole path locally at any time (it performs a real Google
token exchange, so it needs network):

```powershell
python scripts\verify_option_b.py firebase-adminsdk.json --live
```

If you ever paste the value into a `.env` by hand, sanity-check it with
`python scripts\check_firebase_env.py <file-containing-the-one-line-json>`.

Security note: the clipboard value is a live private key. Do not paste it into
Slack, commit it, or paste it into the admin UI. Only into Render's env field.

### Google Play service account (only for `eas submit`)

1. Play Console → Setup → API access → create a service account with
   *Release Manager* role, download the JSON.
2. Save it as `apps/mobile/google-service-account.json` (git-ignored).

---

## 2. Build commands

Run from `F:\startup\voxora\apps\mobile`.

| Goal | Command |
|------|---------|
| Internal test **APK** | `eas build -p android --profile preview` |
| Production **APK** (direct install) | `eas build -p android --profile production-apk` |
| Production **AAB** (Play Store) | `eas build -p android --profile production` |
| Dev client (hot reload + native) | `eas build -p android --profile development` |
| Local build (needs Android SDK) | `eas build -p android --profile preview --local` |
| Check status | `eas build:list` |
| Download latest artifact | `eas build:view` |

The `production` profile uses `app-bundle` (AAB) — that is what Play Store
requires. `production-apk` is the same code as an installable APK for testing.

Versioning: `autoIncrement: true` bumps Android `versionCode` automatically.
Keep `version` in `app.json` as the user-facing number (`1.0.0`).

### Submit to Play (after a production AAB)

```powershell
eas submit -p android --profile production
```

---

## 3. Testing the build on devices

You need **two Android phones** (one fan, one creator) plus the admin dashboard.

1. Install the APK on both phones (share the EAS artifact URL, or `adb install`).
2. Grant **Notifications**, **Microphone**, **Camera**, and allow
   **Full-screen intents** ("Incoming Calls" channel).
3. Keep the API awake (free Render sleeps ~30–60s).

On the **creator** phone:
- Log in as a creator, set rates, submit the selfie, approve in the admin, go
  **Available**.

On the **fan** phone:
- Recharge (Cashfree sandbox returns to `simpletalk://wallet`), then open the
  creator and start an audio call.

Run the matrix in `docs/CALL_FLOW_TESTS.md` (billing, wallets, withdrawal) and
`docs/E2E_CHECKLIST.md` (auth, browse, call safety). The critical ones:

| Check | Pass when |
|-------|-----------|
| Creator app **killed**, fan calls | Full-screen WhatsApp-style ring; Accept cold-starts into the call |
| Decline from lock screen | Call REJECTED without opening the app |
| Minute tick | Fan `wallet` drops by the rate; creator `earnings` rises by 85% |
| Low balance | Warning below 2 minutes; call ends cleanly at ₹0, never negative |
| Gift ₹100 | Fan −₹100; creator +₹85; both see the animation |
| End + review | Review screen; admin rating updates |
| Back button mid-call | "End call?" confirm dialog |

---

## 4. App icons & splash — what exists and what to replace

Current files in `apps/mobile/assets/`:

| File | Required size | Current | Action |
|------|---------------|---------|--------|
| `icon.png` | 1024×1024 (no alpha) | 1024×1024 | Replace with brand icon |
| `adaptive-icon.png` | 1024×1024 (foreground, safe centre 66%) | 1024×1024 | Replace |
| `splash.png` | 1284×1284 (contain) | 1284×1284 | Replace |

Notification icons are **generated, not hand-drawn** — see
`assets/notification/<dpi>/ic_notification.png` (24/36/48/72/96 px, white
Material "call" glyph on transparent). Regenerate at any time with:

```powershell
python apps\mobile\scripts\gen_notification_icons.py
```

They are installed into the native project by
`plugins/withAndroidNotificationIcon.js`, which also sets the manifest's
`android.default_notification_icon` / `..._color`. No action needed unless you
want a different glyph.

Brand palette (from `src/theme/tokens.ts`):
- Deep forest background `#070D0C` / `#0B1F1A`
- Teal brand `#0F766E`, light teal `#2DD4BF`
- Warm copper accent `#E8A87C` / `#D97757`
- Text cream `#F3EFE8`

### Image generation prompts

Use these in any image model (Midjourney / DALL·E / Ideogram / Leonardo), then
resize. Keep the icon **centred with generous padding** — Android masks adaptive
icons into circles/squircles and crops the outer ~25%.

**App icon (1024×1024, no transparency):**
> Premium mobile app icon, dark forest-teal background gradient from #0B1F1A to
> #0F766E, centred minimal emblem of a stylised chat bubble merged with a
> telephone handset, thin warm-copper (#E8A87C) outline, soft inner teal glow,
> flat vector, crisp, no text, no letters, generous safe padding around the
> emblem, high contrast, modern fintech-calling app aesthetic, square 1:1

**Adaptive icon foreground (1024×1024, transparent):**
> Same emblem as the app icon but on a fully transparent background, emblem
> centred within the middle 66% of the square, flat vector, two colours only
> (teal #2DD4BF and copper #E8A87C), no background, no text, 1:1

**Splash screen (1284×1284, dark background):**
> Minimal splash screen artwork, solid deep forest background #0B1F1A with a
> subtle radial teal glow, centred emblem of a minimalist chat-bubble-plus-phone
> glyph in teal #2DD4BF with a warm-copper accent dot, generous empty margin all
> around, premium, calm, no text except optional tiny wordmark "Simple Talk" in
> cream #F3EFE8 beneath, 1:1

**Notification icon (96×96, white glyph on transparent):**
> Flat monochrome white silhouette of a telephone handset inside a rounded chat
> bubble, solid white #FFFFFF only, fully transparent background, no gradients,
> no shadows, no text, bold readable at 24px, centred, 1:1

**Play Store feature graphic (1024×500):**
> Wide feature banner, dark forest-teal gradient, bold cream wordmark "Simple
> Talk", two abstract silhouette call bubbles (one teal one copper) connected by
> a soft glow line, tagline "Instant audio & video with creators", premium,
> modern, 1024×500

**Store screenshots (phone 1080×1920):** capture from the real app, not
generated — see `docs/STORE_ASSETS.md`.

After replacing, the icon/splash take effect on the **next EAS build** (they are
compiled into the native project).

---

## 5. Environment reference

### Mobile (public — embedded at build time; already in `eas.json`)
```
EXPO_PUBLIC_API_URL=https://voxra-dkfe.onrender.com/api
EXPO_PUBLIC_AGORA_APP_ID=8a99158c4edb49da8e2c7dc227973c8f
EXPO_PUBLIC_APP_SCHEME=simpletalk
```

### API (server secrets — Render dashboard)
```
BACKEND_URL=https://voxra-dkfe.onrender.com
ENVIRONMENT=production
ALLOW_ADMIN_BOOTSTRAP=false
MONGODB_URI=…            MONGODB_DB=voxora
REDIS_URL=…              UPSTASH_REDIS_REST_URL=…  UPSTASH_REDIS_REST_TOKEN=…
JWT_SECRET=…             ADMIN_JWT_SECRET=…        CORS_ORIGINS=…
SOCKETIO_CORS_ORIGINS=*
AGORA_APP_ID=…           AGORA_APP_CERTIFICATE=…
MESSAGECENTRAL_CUSTOMER_ID=…  MESSAGECENTRAL_API_KEY=…  MESSAGECENTRAL_EMAIL=…
FIREBASE_CREDENTIALS_PATH=/etc/secrets/firebase-adminsdk.json
# OR FIREBASE_CREDENTIALS_JSON={... entire service-account JSON ... }
CASHFREE_APP_ID=…        CASHFREE_SECRET_KEY=…     CASHFREE_ENVIRONMENT=production
CASHFREE_RETURN_URL=https://voxra-dkfe.onrender.com/api/wallet/recharge/return
CASHFREE_NOTIFY_URL=https://voxra-dkfe.onrender.com/api/wallet/recharge/webhook
IMAGEKIT_PRIVATE_KEY=…   IMAGEKIT_PUBLIC_KEY=…     IMAGEKIT_URL_ENDPOINT=…
COMMISSION_RATE=0.15     CALL_RING_TIMEOUT_SECONDS=45
MIN_AUDIO_RATE=3.0       MIN_VIDEO_RATE=7.0
RECHARGE_COMMISSION_RATE=0.06  RECHARGE_GATEWAY_RATE=0.03  RECHARGE_SERVICE_RATE=0.03
REFERRAL_BONUS_REFERRER=25      REFERRAL_BONUS_REFEREE=20
DEEP_LINK_SCHEME=simpletalk
```

### Admin / Web
```
VITE_API_URL=https://voxra-dkfe.onrender.com/api
```

---

## 6. Steps only you must do (checklist)

- [ ] `eas whoami` shows `vik_07`
- [ ] Replace `apps/mobile/google-services.json` with the current Firebase file
      for `com.simple_talk.app`
- [ ] Give the API the Admin SDK contents: Render Secret File
      `firebase-adminsdk.json` (Option A) **or** `FIREBASE_CREDENTIALS_JSON`
      env var (Option B)
- [ ] Set the API env vars above in Render (`CASHFREE_*` especially)
- [ ] Replace the 3 icon/splash images in `apps/mobile/assets/`
      (`notification-icon.png` is generated — see §4)
- [ ] `eas build -p android --profile production-apk` → install on 2 phones
- [ ] Run the call matrix in `docs/CALL_FLOW_TESTS.md`
- [ ] When green: `eas build -p android --profile production` (AAB)
- [ ] `eas submit -p android --profile production`

---

## 7. Removed app-config keys (do not re-add)

Current Expo SDK rejects these at prebuild, so they must stay out of
`app.json` / `app.config.js`:

| Removed key | Why | Replacement |
|-------------|-----|-------------|
| `expo.notification` | `withAndroidDangerousBaseMod` hard-errors: *"The `notification` property in app config is no longer supported. Use the `expo-notifications` config plugin instead."* | `plugins/withAndroidNotificationIcon.js` copies the drawables and sets `android.default_notification_icon` / `..._color` in the manifest |
| `android.edgeToEdgeEnabled` | Warned as obsolete — Android 16 makes edge-to-edge mandatory | Nothing; edge-to-edge is now the default |

If you ever add `expo-notifications`, delete
`plugins/withAndroidNotificationIcon.js` and use its `icon`/`color` options
instead.

A prebuild warning that is **safe to ignore**:
`For Android 8.0 and above, it is necessary to set the notification icon...`
— it is emitted unconditionally by Expo's notifications base mod whenever the
`notification` config key is absent, even though the manifest default is
correctly set by the plugin above. Confirm the result with:

```powershell
Select-String -Path apps\mobile\android\app\src\main\AndroidManifest.xml -Pattern 'default_notification'
```
