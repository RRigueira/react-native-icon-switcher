import { defineIcons } from 'react-native-icon-switcher/config';

export default defineIcons({
  default: './assets/icons/default.png',
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
});
