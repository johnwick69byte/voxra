const fs = require("fs");
const path = require("path");
const {
  withAndroidManifest,
  withAppBuildGradle,
  withDangerousMod,
  AndroidConfig,
} = require("expo/config-plugins");

const SOURCE = path.join(__dirname, "incoming-call");

function copyTree(from, to) {
  if (!fs.existsSync(from)) return;
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dest = path.join(to, entry.name);
    if (entry.isDirectory()) copyTree(src, dest);
    else fs.copyFileSync(src, dest);
  }
}

function ensureService(application, name, body) {
  const services = (application.service = application.service || []);
  if (!services.some((item) => item.$?.["android:name"] === name)) {
    services.push(body);
  }
}

/**
 * Lock-screen incoming call UI. Copies the native sources into the Android
 * project and replaces the stock Firebase messaging service so a killed app
 * still receives the data-only ring.
 */
const withIncomingCallScreen = (config) => {
  config = withDangerousMod(config, [
    "android",
    async (cfg) => {
      const root = cfg.modRequest.platformProjectRoot;
      const javaDir = path.join(
        root,
        "app",
        "src",
        "main",
        "java",
        "com",
        "simple_talk",
        "app"
      );
      const resDir = path.join(root, "app", "src", "main", "res");
      copyTree(path.join(SOURCE, "java"), javaDir);
      copyTree(path.join(SOURCE, "res"), resDir);

      const mainApp = path.join(javaDir, "MainApplication.kt");
      if (fs.existsSync(mainApp)) {
        const source = fs.readFileSync(mainApp, "utf8");
        if (!source.includes("IncomingCallPackage()")) {
          const next = source.replace(
            "PackageList(this).packages.apply {",
            "PackageList(this).packages.apply {\n          add(IncomingCallPackage())"
          );
          if (next !== source) fs.writeFileSync(mainApp, next);
        }
      }
      const gradle = path.join(root, "app", "build.gradle");
      if (fs.existsSync(gradle)) {
        const source = fs.readFileSync(gradle, "utf8");
        if (!source.includes("com.google.firebase:firebase-messaging")) {
          const next = source.replace(
            "dependencies {",
            `dependencies {
    def firebaseAppPackage = new File(rootDir, "../node_modules/@react-native-firebase/app/package.json")
    if (!firebaseAppPackage.exists()) {
        firebaseAppPackage = new File(rootDir, "../../../node_modules/@react-native-firebase/app/package.json")
    }
    def firebaseBom = new groovy.json.JsonSlurper().parse(firebaseAppPackage).sdkVersions.android.firebase
    implementation platform("com.google.firebase:firebase-bom:\${firebaseBom}")
    implementation "com.google.firebase:firebase-messaging"
`
          );
          if (next !== source) fs.writeFileSync(gradle, next);
        }
      }
      return cfg;
    },
  ]);

  config = withAppBuildGradle(config, (cfg) => {
    const contents = cfg.modResults.contents;
    if (!contents.includes("com.google.firebase:firebase-messaging")) {
      cfg.modResults.contents = contents.replace(
        "dependencies {",
        `dependencies {
    def firebaseAppPackage = new File(rootDir, "../node_modules/@react-native-firebase/app/package.json")
    if (!firebaseAppPackage.exists()) {
        firebaseAppPackage = new File(rootDir, "../../../node_modules/@react-native-firebase/app/package.json")
    }
    def firebaseBom = new groovy.json.JsonSlurper().parse(firebaseAppPackage).sdkVersions.android.firebase
    implementation platform("com.google.firebase:firebase-bom:\${firebaseBom}")
    implementation "com.google.firebase:firebase-messaging"
`
      );
    }
    return cfg;
  });

  config = withAndroidManifest(config, (cfg) => {
    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(cfg.modResults);
    const services = (application.service = application.service || []);
    if (
      !services.some(
        (item) =>
          item.$?.["android:name"] ===
            "io.invertase.firebase.messaging.ReactNativeFirebaseMessagingService" &&
          item.$?.["tools:node"] === "remove"
      )
    ) {
      services.push({
        $: {
          "android:name": "io.invertase.firebase.messaging.ReactNativeFirebaseMessagingService",
          "tools:node": "remove",
        },
      });
    }
    ensureService(application, ".IncomingCallMessagingService", {
      $: { "android:name": ".IncomingCallMessagingService", "android:exported": "false" },
      "intent-filter": [{ action: [{ $: { "android:name": "com.google.firebase.MESSAGING_EVENT" } }] }],
    });

    const activities = (application.activity = application.activity || []);
    if (!activities.some((item) => item.$?.["android:name"] === ".IncomingCallActivity")) {
      activities.push({
        $: {
          "android:name": ".IncomingCallActivity",
          "android:excludeFromRecents": "true",
          "android:exported": "false",
          "android:launchMode": "singleTask",
          "android:showWhenLocked": "true",
          "android:turnScreenOn": "true",
          "android:theme": "@style/AppTheme",
        },
      });
    }

    const receivers = (application.receiver = application.receiver || []);
    if (!receivers.some((item) => item.$?.["android:name"] === ".IncomingCallReceiver")) {
      receivers.push({
        $: { "android:name": ".IncomingCallReceiver", "android:exported": "false" },
      });
    }
    return cfg;
  });

  return config;
};

module.exports = withIncomingCallScreen;
