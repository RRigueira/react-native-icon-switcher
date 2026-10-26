import { defineIcons } from '../config';

describe('defineIcons', () => {
  it('returns the same config object', () => {
    const cfg = { icons: { halloween: 'icons/halloween.png' } };
    expect(defineIcons(cfg)).toBe(cfg);
  });
});
