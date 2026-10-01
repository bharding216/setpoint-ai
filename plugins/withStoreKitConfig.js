const { withDangerousMod, withXcodeProject } = require('expo/config-plugins');
const path = require('path');
const fs = require('fs');

/**
 * Copies the StoreKit Configuration file into the Xcode project and sets it
 * in the scheme so RevenueCat can fetch local products during development.
 *
 * Only has an effect for local builds (npx expo run:ios). StoreKit
 * Configuration files are ignored in archived / EAS builds.
 */
const withStoreKitConfig = (config) => {
  const STOREKIT_FILE = 'SetpointProducts.storekit';

  config = withDangerousMod(config, [
    'ios',
    async (config) => {
      try {
        const platformRoot = config.modRequest.platformProjectRoot;
        const projectName =
          config.modRequest.projectName ??
          config.name.replace(/[^a-zA-Z0-9]/g, '');

        // Copy .storekit file into the app directory
        const src = path.resolve(__dirname, '..', 'ios-storekit', STOREKIT_FILE);
        if (!fs.existsSync(src)) {
          console.warn(`[withStoreKitConfig] ${src} not found, skipping`);
          return config;
        }

        const destDir = path.join(platformRoot, projectName);
        if (!fs.existsSync(destDir)) {
          fs.mkdirSync(destDir, { recursive: true });
        }
        fs.copyFileSync(src, path.join(destDir, STOREKIT_FILE));

        // Patch the .xcscheme to use StoreKit Configuration
        const schemePath = path.join(
          platformRoot,
          `${projectName}.xcodeproj`,
          'xcshareddata',
          'xcschemes',
          `${projectName}.xcscheme`,
        );

        if (fs.existsSync(schemePath)) {
          let scheme = fs.readFileSync(schemePath, 'utf8');
          if (!scheme.includes('storeKitConfigurationFileReference')) {
            scheme = scheme.replace(
              /(<LaunchAction\b[^>]*)(>)/,
              `$1\n      storeKitConfigurationFileReference = "${STOREKIT_FILE}"$2`,
            );
            fs.writeFileSync(schemePath, scheme, 'utf8');
          }
        } else {
          console.warn(
            `[withStoreKitConfig] Scheme not found at ${schemePath}, skipping scheme patch`,
          );
        }
      } catch (err) {
        console.warn('[withStoreKitConfig] Non-fatal error:', err.message);
      }

      return config;
    },
  ]);

  return config;
};

module.exports = withStoreKitConfig;
