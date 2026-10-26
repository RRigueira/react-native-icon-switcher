jest.mock('../NativeIconSwitcher', () =>
  jest.requireActual('../__mocks__/NativeIconSwitcher')
);

import native from '../NativeIconSwitcher';
import IconSwitcher, { IconSwitcherError } from '../index';
import {
  mockNativeState,
  _resetMockState,
} from '../__mocks__/NativeIconSwitcher';

beforeEach(() => {
  _resetMockState();
});

describe('IconSwitcher.set', () => {
  it('rejects unknown icon names in JS without calling native set', async () => {
    await expect(
      IconSwitcher.set('not_in_list' as 'default')
    ).rejects.toMatchObject({
      code: 'unknown_icon',
    });
    expect(mockNativeState.setCalls).toHaveLength(0);
  });

  it('short-circuits when unsupported without calling native set', async () => {
    mockNativeState.isSupported = false;
    await expect(IconSwitcher.set('default')).rejects.toMatchObject({
      code: 'unsupported',
    });
    expect(mockNativeState.setCalls).toHaveLength(0);
  });

  it('maps native ERR_OS_REJECTED to os_rejected', async () => {
    mockNativeState.setImpl = async () => {
      const err = new Error('OS said no');
      (err as Error & { code: string }).code = 'ERR_OS_REJECTED';
      throw err;
    };
    await expect(IconSwitcher.set('halloween')).rejects.toMatchObject({
      code: 'os_rejected',
    });
    expect(mockNativeState.setCalls).toEqual(['halloween']);
  });

  it('maps an unknown native error code to os_rejected', async () => {
    mockNativeState.setImpl = async () => {
      const err = new Error('mystery');
      (err as Error & { code: string }).code = 'ERR_SOMETHING_ELSE';
      throw err;
    };
    await expect(IconSwitcher.set('halloween')).rejects.toMatchObject({
      code: 'os_rejected',
    });
  });

  it('maps native ERR_UNKNOWN_ICON to unknown_icon', async () => {
    mockNativeState.setImpl = async () => {
      const err = new Error('native unknown');
      (err as Error & { code: string }).code = 'ERR_UNKNOWN_ICON';
      throw err;
    };
    await expect(IconSwitcher.set('halloween')).rejects.toMatchObject({
      code: 'unknown_icon',
    });
  });

  it('reset calls set with default', async () => {
    await IconSwitcher.reset();
    expect(mockNativeState.setCalls).toEqual(['default']);
  });
});

describe('IconSwitcher.getCurrent', () => {
  it('returns the native icon name', async () => {
    mockNativeState.current = 'halloween';
    await expect(IconSwitcher.getCurrent()).resolves.toBe('halloween');
  });

  it('maps native failures through mapNativeError', async () => {
    const err = new Error('native');
    (err as Error & { code: string }).code = 'ERR_UNKNOWN_ICON';
    jest
      .spyOn(native as NonNullable<typeof native>, 'getCurrent')
      .mockRejectedValueOnce(err);
    await expect(IconSwitcher.getCurrent()).rejects.toMatchObject({
      code: 'unknown_icon',
    });
  });
});

describe('IconSwitcher.applyPending', () => {
  it('returns the native promise result', async () => {
    mockNativeState.applyPendingImpl = async () => ({ status: 'applied' });
    await expect(IconSwitcher.applyPending()).resolves.toEqual({
      status: 'applied',
    });
    expect(mockNativeState.applyPendingCalls).toBe(1);
  });

  it('maps native ERR_FOREGROUND to foreground', async () => {
    mockNativeState.applyPendingImpl = async () => {
      const err = new Error('in foreground');
      (err as Error & { code: string }).code = 'ERR_FOREGROUND';
      throw err;
    };
    await expect(IconSwitcher.applyPending()).rejects.toMatchObject({
      code: 'foreground',
    });
    expect(mockNativeState.applyPendingCalls).toBe(1);
  });
});

describe('IconSwitcherError', () => {
  it('exposes the code on the error instance', () => {
    const err = new IconSwitcherError('unsupported');
    expect(err.code).toBe('unsupported');
    expect(err).toBeInstanceOf(Error);
  });
});
