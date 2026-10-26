import { renderTypes } from '../types';
import { sampleConfig } from '../sampleConfigs';

describe('renderTypes', () => {
  it('emits module augmentation for configured icon names', () => {
    const source = renderTypes(sampleConfig);
    expect(source).toMatchInlineSnapshot(`
"import 'react-native-icon-switcher';

declare module 'react-native-icon-switcher' {
  interface Register {
    icons: 'default' | 'halloween';
  }
}
"
`);
  });
});
