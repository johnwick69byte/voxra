const fs = require("fs");
const path = require("path");
const {
  IOSConfig,
  withDangerousMod,
  withXcodeProject,
} = require("expo/config-plugins");

const SOUND_FILE = "sound_effect.mp3";
const SOUND_SOURCE = path.join(__dirname, "..", "assets", "sounds", SOUND_FILE);

/**
 * Ship the custom incoming-call notification sound with the native app.
 *
 * Android notification channels can only reference a sound that exists as a
 * raw resource (`res/raw/sound_effect.mp3`). Notifee/FCM pass the resource name
 * without the extension. iOS needs the file copied into the app bundle and
 * added to the Xcode target's Copy Bundle Resources phase.
 *
 * Why a config plugin: the app is prebuilt by EAS, so `android/` and `ios/` do
 * not exist in git. Copying the file by hand would be lost on the next build.
 *
 * Android channel sounds are immutable once the channel is created. If the
 * sound ever changes, bump `CHANNEL_INCOMING_CALLS` in
 * src/services/notificationChannels.ts instead of editing the channel in place.
 */
const withNotificationSound = (config) => {
  config = withDangerousMod(config, [
    "android",
    async (cfg) => {
      const rawDir = path.join(
        cfg.modRequest.platformProjectRoot,
        "app",
        "src",
        "main",
        "res",
        "raw"
      );
      if (!fs.existsSync(SOUND_SOURCE)) {
        throw new Error(
          `[withNotificationSound] missing ${SOUND_SOURCE}. ` +
            "The custom call notification sound must be committed."
        );
      }
      fs.mkdirSync(rawDir, { recursive: true });
      fs.copyFileSync(SOUND_SOURCE, path.join(rawDir, SOUND_FILE));
      return cfg;
    },
  ]);

  return withXcodeProject(config, (cfg) => {
    const projectRoot = cfg.modRequest.platformProjectRoot;
    const projectName =
      cfg.modRequest.projectName ||
      IOSConfig.XcodeUtils.getProjectName(projectRoot);
    if (!projectName) {
      throw new Error(
        "[withNotificationSound] could not determine the iOS project name"
      );
    }

    const dest = path.join(projectRoot, projectName, SOUND_FILE);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(SOUND_SOURCE, dest);

    // The file is copied above, then linked into the app target. Without this
    // Xcode resource entry APNs can find the name but the app bundle cannot,
    // so iOS silently falls back to the default sound.
    const project = cfg.modResults;
    const fileRefs = project.pbxFileReferenceSection
      ? project.pbxFileReferenceSection()
      : {};
    const alreadyLinked = Object.values(fileRefs).some(
      (ref) =>
        ref &&
        typeof ref === "object" &&
        String(ref.path || "").replace(/"/g, "") === SOUND_FILE
    );
    if (!alreadyLinked) {
      IOSConfig.XcodeUtils.addResourceFileToGroup({
        filepath: `${projectName}/${SOUND_FILE}`,
        groupName: projectName,
        project,
        isBuildFile: true,
        verbose: false,
      });
    }

    return cfg;
  });
};

module.exports = withNotificationSound;
