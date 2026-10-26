import type { ResolvedConfig } from '../types';

export const sampleConfig: ResolvedConfig = {
  icons: [
    {
      name: 'default',
      isDefault: true,
      ios: { light: 'icons/default.png' },
      android: { legacy: 'icons/default.png' },
    },
    {
      name: 'halloween',
      isDefault: false,
      ios: { light: 'icons/halloween.png' },
      android: { legacy: 'icons/halloween.png' },
    },
  ],
  ios: { flattenOn: '#FFFFFF' },
  android: { applyOn: 'background', skipBrands: ['samsung'] },
};

export const halloweenOnlyConfig: ResolvedConfig = {
  icons: [
    {
      name: 'default',
      isDefault: true,
      ios: { light: 'icons/default.png' },
      android: { legacy: 'icons/default.png' },
    },
  ],
  ios: { flattenOn: '#FFFFFF' },
  android: { applyOn: 'immediate', skipBrands: [] },
};
