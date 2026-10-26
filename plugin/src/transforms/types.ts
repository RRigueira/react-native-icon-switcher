import type { ResolvedConfig } from '../types';

export function renderTypes(cfg: ResolvedConfig): string {
  const iconUnion = cfg.icons.map((icon) => `'${icon.name}'`).join(' | ');
  return `import 'react-native-icon-switcher';

declare module 'react-native-icon-switcher' {
  interface Register {
    icons: ${iconUnion};
  }
}
`;
}
