const fs = require("fs");
const path = require("path");
const {
  withAndroidManifest,
  withDangerousMod,
  AndroidConfig,
} = require("expo/config-plugins");

const ASSET_ROOT = path.join(__dirname, "..", "assets", "notification");
const ICON_NAME = "ic_notification.png";
const DENSITIES = ["mdpi", "hdpi", "xhdpi", "xxhdpi", "xxxhdpi"];
const RES_NAME = "ic_notification";
const ACCENT = "#0F766E";

/**
 * Installs the white notification small icons (assets/notification/<dpi>/) into
 * the Android native project as drawable-<dpi>/ic_notification.png, and points
 * the manifest's default notification icon/color at them.
 *
 * Why this is manual: `expo-notifications` is not installed (the app drives
 * @notifee/react-native directly), and the top-level `expo.notification` app
 * config key was removed -- current Expo rejects it at prebuild. The
 * `notification` config plugin that key used to imply is the only supported way,
 * so we do the equivalent ourselves.
 *
 * Android tints status-bar notification icons and discards colour, so these
 * must be flat white silhouettes on transparency -- not the launcher icon.
 * Without a default icon, background pushes render as an unreadable white blob.
 *
 * Regenerate the sources with:  python scripts/gen_notification_icons.py
 */
const withAndroidNotificationIcon = (config) => {
  // 1. Declare the default icon so FCM/Notifee picks it up automatically.
  config = withAndroidManifest(config, (cfg) => {
    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(
      cfg.modResults
    );
    application.$ = application.$ || {};

    const defaults = [
      { name: "android.default_notification_icon", res: `@drawable/${RES_NAME}` },
      { name: "android.default_notification_color", res: ACCENT },
    ];

    for (const { name, res } of defaults) {
      const existing = (application["meta-data"] || []).find(
        (m) => m.$?.["android:name"] === name
      );
      if (existing) {
        existing.$["android:resource"] = res;
      } else {
        application["meta-data"] = application["meta-data"] || [];
        application["meta-data"].push({
          $: { "android:name": name, "android:resource": res },
        });
      }
    }

    return cfg;
  });

  // 2. Copy the density-bucketed PNGs into the native res/ tree.
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
          console.warn(
            `[withAndroidNotificationIcon] missing ${src} - run ` +
              `python scripts/gen_notification_icons.py`
          );
          continue;
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
