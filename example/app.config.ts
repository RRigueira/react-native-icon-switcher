import type { ExpoConfig } from 'expo/config';

const config: ExpoConfig = {
  name: 'IconSwitcher Example',
  slug: 'react-native-icon-switcher-example',
  version: '1.0.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'light',
  ios: {
    supportsTablet: true,
    bundleIdentifier: 'com.iconswitcher.example',
  },
  android: {
    package: 'com.iconswitcher.example',
    adaptiveIcon: {
      backgroundColor: '#E6F4FE',
      foregroundImage: './assets/android-icon-foreground.png',
      backgroundImage: './assets/android-icon-background.png',
      monochromeImage: './assets/android-icon-monochrome.png',
    },
  },
  web: {
    favicon: './assets/favicon.png',
  },
  plugins: [
    [
      'react-native-icon-switcher',
      {
        icons: {
          halloween: './assets/icons/halloween.png',
          midnight: {
            ios: './assets/icons/midnight.png',
            android: {
              foreground: './assets/icons/midnight.png',
              background: '#0B1020',
            },
          },
          ghost: './assets/icons/ghost.png',
        },
        ios: {
          flattenOn: '#FFFFFF',
        },
        android: {
          applyOn: 'background',
        },
      },
    ],
  ],
};

export default config;
