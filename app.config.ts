import type { ExpoConfig, ConfigContext } from 'expo/config';

const IS_DEV = process.env.APP_VARIANT === 'development';
const BUNDLE_ID = IS_DEV ? 'com.toddly.setpointai.dev' : 'com.toddly.setpointai';

const VERSION = '1.0';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: IS_DEV ? 'Setpoint AI Dev' : 'Setpoint AI',
  slug: 'setpoint-ai',
  version: VERSION,
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'dark',
  scheme: IS_DEV ? 'setpoint-dev' : 'setpoint',
  ios: {
    supportsTablet: true,
    bundleIdentifier: BUNDLE_ID,
    infoPlist: {
      ITSAppUsesNonExemptEncryption: false,
    },
  },
  android: {
    adaptiveIcon: {
      backgroundColor: '#191818',
      foregroundImage: './assets/android-icon-foreground.png',
      backgroundImage: './assets/android-icon-background.png',
      monochromeImage: './assets/android-icon-monochrome.png',
    },
    package: BUNDLE_ID,
  },
  web: {
    favicon: './assets/favicon.png',
  },
  plugins: [
    [
      'expo-splash-screen',
      {
        backgroundColor: '#191818',
        image: './assets/icon.png',
        imageWidth: 256,
      },
    ],
    [
      'expo-audio',
      {
        microphonePermission: false,
      },
    ],
  ],
  updates: {
    url: 'https://u.expo.dev/4f6e2b3a-633f-4a53-9955-625ef8099684',
  },
  runtimeVersion: {
    policy: 'appVersion',
  },
  extra: {
    appVersion: VERSION,
    isDev: IS_DEV,
    eas: {
      projectId: '4f6e2b3a-633f-4a53-9955-625ef8099684',
    },
  },
});
