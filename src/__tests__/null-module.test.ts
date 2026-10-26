jest.mock('../NativeIconSwitcher', () => ({
  __esModule: true,
  default: null,
}));

import IconSwitcher from '../index';

describe('IconSwitcher when native module is null', () => {
  it('reports unsupported and rejects calls', async () => {
    expect(IconSwitcher.isSupported).toBe(false);
    expect(IconSwitcher.list()).toEqual([]);
    await expect(IconSwitcher.getCurrent()).rejects.toMatchObject({
      code: 'unsupported',
    });
    await expect(IconSwitcher.set('default' as never)).rejects.toMatchObject({
      code: 'unsupported',
    });
    await expect(IconSwitcher.applyPending()).rejects.toMatchObject({
      code: 'unsupported',
    });
  });
});
