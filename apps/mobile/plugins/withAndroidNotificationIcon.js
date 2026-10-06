const fs = require("fs");
const path = require("path");
const {
  withAndroidColors,
  withAndroidManifest,
  withDangerousMod,
  AndroidConfig,
} = require("expo/config-plugins");

const ASSET_ROOT = path.join(__dirname, "..", "assets", "notification");
const ICON_NAME = "ic_notification.png";
const DENSITIES = ["mdpi", "hdpi", "xhdpi", "xxhdpi", "xxxhdpi"];
const RES_NAME = "ic_notification";
const ACCENT_COLOR = "#0F766E";
const ACCENT_COLOR_NAME = "notification_accent";

/**
 * Installs the white notification small icons (assets/notification/<dpi>/) into
 * the Android native project as drawable-<dpi>/ic_notification.png, declares the
 * accent as a real color resource, and points the manifest's default
 * notification icon/color at them.
 *
 * Why this is manual: `expo-notifications` is not installed (the app drives
 * @notifee/react-native directly), and the top-level `expo.notification` app
 * config key was removed -- current Expo rejects it at prebuild. The
 * `notification` config plugin that key used to imply is the only supported way,
 * so we do the equivalent ourselves.
 *
 * Note: `android.default_notification_color` takes a *resource reference*
 * (`@color/...`), never a literal hex -- AAPT fails resource linking with
 * "is incompatible with attribute resource (attr) reference" if you pass one.
 *
 * Android tints status-bar notification icons and discards colour, so the icons
 * must be flat white silhouettes on transparency -- not the launcher icon.
 *
 * Regenerate the sources with:  python scripts/gen_notification_icons.py
 */
const withAndroidNotificationIcon = (config) => {
  // 1. Declare the accent colour as a real color resource.
  //    Same shape Expo's own plugins use: assignColorValue takes/returns the
  //    whole mod result. Passing modResults.contents (or wrapping it in
  //    ensureDefaultResourceXML) emits a bogus nested <contents> element.
  config = withAndroidColors(config, (cfg) => {
    cfg.modResults = AndroidConfig.Colors.assignColorValue(cfg.modResults, {
      name: ACCENT_COLOR_NAME,
      value: ACCENT_COLOR,
    });
    return cfg;
  });

  // 2. Point the manifest at the icon drawable and the colour resource.
  config = withAndroidManifest(config, (cfg) => {
    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(
      cfg.modResults
    );
    application.$ = application.$ || {};

    const defaults = [
      {
        name: "android.default_notification_icon",
        res: `@drawable/${RES_NAME}`,
      },
      {
        name: "android.default_notification_color",
        res: `@color/${ACCENT_COLOR_NAME}`,
      },
    ];

    for (const { name, res } of defaults) {
      const metaData = (application["meta-data"] = application["meta-data"] || []);
      const existing = metaData.find((m) => m.$?.["android:name"] === name);
      if (existing) {
        existing.$["android:resource"] = res;
      } else {
        metaData.push({ $: { "android:name": name, "android:resource": res } });
      }
    }

    return cfg;
  });

  // 3. Copy the density-bucketed PNGs into the native res/ tree.
  return withDangerousMod(config, [
    "android",
    async (cfg) => {
      const resDir = path.join(
        cfg.modRequest.platformProjectRoot,
        "app",
        "src",
        "main",
        "res"
      );

      for (const density of DENSITIES) {
        const src = path.join(ASSET_ROOT, density, ICON_NAME);
        if (!fs.existsSync(src)) {
          throw new Error(
            `[withAndroidNotificationIcon] missing ${src} - run ` +
              `python scripts/gen_notification_icons.py`
          );
        }
        const destDir = path.join(resDir, `drawable-${density}`);
        fs.mkdirSync(destDir, { recursive: true });
        fs.copyFileSync(src, path.join(destDir, ICON_NAME));
      }

      return cfg;
    },
  ]);
};

module.exports = withAndroidNotificationIcon;
