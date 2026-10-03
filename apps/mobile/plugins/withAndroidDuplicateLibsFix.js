const { withAppBuildGradle } = require('expo/config-plugins');

/**
 * Fix duplicate native library conflicts (e.g., libaosl.so from Agora packages).
 * Safe no-op when the conflict is absent.
 */
const withAndroidDuplicateLibsFix = (config) => {
  return withAppBuildGradle(config, (config) => {
    let buildGradle = config.modResults.contents;

    if (buildGradle.includes("pickFirst 'lib/**/libaosl.so'")) {
      return config;
    }

    const pickFirstDirectives = `
        pickFirst 'lib/**/libaosl.so'
        pickFirst 'lib/arm64-v8a/libaosl.so'
        pickFirst 'lib/armeabi-v7a/libaosl.so'
        pickFirst 'lib/x86/libaosl.so'
        pickFirst 'lib/x86_64/libaosl.so'`;

    if (buildGradle.includes('packaging {')) {
      buildGradle = buildGradle.replace(
        /(packaging\s*\{[^}]*)/,
        `$1${pickFirstDirectives}
`
      );
    } else if (buildGradle.includes('namespace ')) {
      buildGradle = buildGradle.replace(
        /(namespace\s+['"][^'"]+['"])/,
        `$1

    packaging {${pickFirstDirectives}
    }`
      );
    } else if (buildGradle.includes('defaultConfig')) {
      buildGradle = buildGradle.replace(
        /(\s+)(defaultConfig\s*\{)/,
        `$1packaging {${pickFirstDirectives}
    }
$1$2`
      );
    } else {
      buildGradle = buildGradle.replace(
        /(android\s*\{)/,
        `$1
    packaging {${pickFirstDirectives}
    }`
      );
    }

    config.modResults.contents = buildGradle;
    return config;
  });
};

module.exports = withAndroidDuplicateLibsFix;
