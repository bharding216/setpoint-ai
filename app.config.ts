import type { ExpoConfig, ConfigContext } from 'expo/config';

const IS_DEV = process.env.APP_VARIANT === 'development';
const BUNDLE_ID = IS_DEV ? 'com.toddly.setpointai.dev' : 'com.toddly.setpointai';

const VERSION = '1.1';

// Google Sign-In requires the reversed iOS client ID as a URL scheme
const GOOGLE_IOS_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID ?? '';
const GOOGLE_IOS_REVERSED_ID = GOOGLE_IOS_CLIENT_ID
  ? GOOGLE_IOS_CLIENT_ID.split('.').reverse().join('.')
  : '';

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
    supportsTablet: false,
    bundleIdentifier: BUNDLE_ID,
    usesAppleSignIn: true,
    infoPlist: {
      ITSAppUsesNonExemptEncryption: false,
      ...(GOOGLE_IOS_REVERSED_ID
        ? {
            CFBundleURLTypes: [
              {
                CFBundleURLSchemes: [GOOGLE_IOS_REVERSED_ID],
              },
            ],
          }
        : {}),
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
    'expo-apple-authentication',
    'expo-web-browser',
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
