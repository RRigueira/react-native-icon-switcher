import { IconSwitcherError, mapNativeError } from '../errors';

describe('mapNativeError', () => {
  it('returns IconSwitcherError instances from mapNativeError unchanged', () => {
    const original = new IconSwitcherError('foreground', 'wait');
    expect(mapNativeError(original)).toBe(original);
  });

  it('maps native codes and falls back to os_rejected', () => {
    expect(
      mapNativeError({ code: 'ERR_UNKNOWN_ICON', message: 'x' })
    ).toMatchObject({ code: 'unknown_icon' });
    expect(mapNativeError({ code: 'ERR_NOPE' })).toMatchObject({
      code: 'os_rejected',
    });
    expect(mapNativeError('plain')).toMatchObject({ code: 'os_rejected' });
    expect(mapNativeError(new Error('boom'))).toMatchObject({
      code: 'os_rejected',
      message: 'boom',
    });
  });
});
