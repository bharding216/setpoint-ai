const { withDangerousMod, withXcodeProject } = require('expo/config-plugins');
const path = require('path');
const fs = require('fs');

/**
 * Copies the StoreKit Configuration file into the Xcode project and sets it
 * in the Run action of the scheme so that StoreKit 2 (and RevenueCat) return
 * locally-defined products during development.
 */
const withStoreKitConfig = (config) => {
  const STOREKIT_FILE = 'SetpointProducts.storekit';

  // Step 1: Copy the .storekit file into the ios project
  config = withXcodeProject(config, async (config) => {
    const project = config.modResults;
    const projectName = config.modRequest.projectName;

    const src = path.resolve(__dirname, '..', 'ios-storekit', STOREKIT_FILE);
    const dest = path.join(
      config.modRequest.platformProjectRoot,
      projectName,
      STOREKIT_FILE,
    );

    fs.copyFileSync(src, dest);

    const appGroup = project.findPBXGroupKey({ name: projectName });
    if (appGroup && !project.findPBXFileReferenceByPath(STOREKIT_FILE)) {
      project.addFile(
        `${projectName}/${STOREKIT_FILE}`,
        appGroup,
        { lastKnownFileType: 'text.json' },
      );
    }

    return config;
  });

  // Step 2: Patch the .xcscheme to reference the StoreKit Configuration
  config = withDangerousMod(config, [
    'ios',
    async (config) => {
      const projectName =
        config.modRequest?.projectName ??
        config.name.replace(/[^a-zA-Z0-9]/g, '');
      const schemesDir = path.join(
        config.modRequest.platformProjectRoot,
        `${projectName}.xcodeproj`,
        'xcshareddata',
        'xcschemes',
      );

      const schemePath = path.join(schemesDir, `${projectName}.xcscheme`);
      if (!fs.existsSync(schemePath)) {
        console.warn(
          `[withStoreKitConfig] Scheme not found at ${schemePath}, skipping`,
        );
        return config;
      }

      let scheme = fs.readFileSync(schemePath, 'utf8');

      // Add the StoreKit configuration to the LaunchAction if not already present
      if (!scheme.includes('storeKitConfigurationFileReference')) {
        const storeKitAttr = `\n      storeKitConfigurationFileReference = "SetpointProducts.storekit"`;
        scheme = scheme.replace(
          /(<LaunchAction\b[^>]*)(>)/,
          `$1${storeKitAttr}$2`,
        );
        fs.writeFileSync(schemePath, scheme, 'utf8');
      }

      return config;
    },
  ]);

  return config;
};

module.exports = withStoreKitConfig;
