/**
 * Tests for the published Jest mock at jest/index.js.
 */

const mock = require('../../jest/index.js') as typeof import('../../jest');

describe('jest mock (react-native-icon-switcher/jest)', () => {
  afterEach(() => {
    mock.__reset();
  });

  it('defaults to supported with default and halloween icons', () => {
    expect(mock.IconSwitcher.isSupported).toBe(true);
    expect(mock.IconSwitcher.list()).toEqual(['default', 'halloween']);
  });

  it('__setState changes current and set behaviour', async () => {
    mock.__setState({
      current: 'halloween',
      setImpl: async () => ({ status: 'pending' }),
    });
    await expect(mock.IconSwitcher.getCurrent()).resolves.toBe('halloween');
    await expect(mock.IconSwitcher.set('halloween')).resolves.toEqual({
      status: 'pending',
    });
  });

  it('__reset restores defaults', async () => {
    mock.__setState({ isSupported: false });
    mock.__reset();
    expect(mock.IconSwitcher.isSupported).toBe(true);
    await expect(mock.IconSwitcher.getCurrent()).resolves.toBe('default');
  });
});
