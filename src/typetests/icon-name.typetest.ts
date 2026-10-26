import 'react-native-icon-switcher';
import IconSwitcher from 'react-native-icon-switcher';

declare module 'react-native-icon-switcher' {
  interface Register {
    icons: 'default' | 'halloween' | 'midnight';
  }
}

IconSwitcher.set('halloween');
// @ts-expect-error icon name must come from Register.icons
IconSwitcher.set('typo');
