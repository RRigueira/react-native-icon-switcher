jest.mock('../NativeIconSwitcher', () =>
  jest.requireActual('../__mocks__/NativeIconSwitcher')
);
jest.mock('react-native', () => {
  const listeners: Array<(state: string) => void> = [];
  return {
    Platform: { OS: 'android' },
    AppState: {
      currentState: 'active',
      addEventListener: jest.fn(
        (_event: string, handler: (state: string) => void) => {
          listeners.push(handler);
          return {
            remove: jest.fn(() => {
              const idx = listeners.indexOf(handler);
              if (idx >= 0) listeners.splice(idx, 1);
            }),
          };
        }
      ),
      __emit: (state: string) => {
        for (const h of listeners) h(state);
      },
      __clearListeners: () => {
        listeners.length = 0;
      },
    },
  };
});

import {
  mockNativeState,
  _resetMockState,
} from '../__mocks__/NativeIconSwitcher';
import { syncIcon, type SyncIconStorage } from '../remote/index';

async function _flushAsync(): Promise<void> {
  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
}

function createRecordingStorage(): SyncIconStorage & {
  store: Map<string, string>;
} {
  const store = new Map<string, string>();
  return {
    store,
    getItem: async (key) => store.get(key) ?? null,
    setItem: async (key, value) => {
      store.set(key, value);
    },
  };
}

beforeEach(() => {
  _resetMockState();
  jest.clearAllMocks();
  jest.useRealTimers();
  const rn = jest.requireMock('react-native') as {
    Platform: { OS: string };
    AppState: { currentState: string; __clearListeners?: () => void };
  };
  rn.AppState.__clearListeners?.();
  rn.Platform.OS = 'android';
  rn.AppState.currentState = 'active';
});

describe('syncIcon', () => {
  it('returns without calling set when fetchChoice is empty', async () => {
    await syncIcon({ fetchChoice: async () => '' });
    expect(mockNativeState.setCalls).toHaveLength(0);
  });

  it('returns without calling set when fetchChoice is null', async () => {
    await syncIcon({ fetchChoice: async () => null });
    expect(mockNativeState.setCalls).toHaveLength(0);
  });

  it('returns without calling set when the native module is unsupported', async () => {
    mockNativeState.isSupported = false;
    await syncIcon({ fetchChoice: async () => 'halloween' });
    expect(mockNativeState.setCalls).toHaveLength(0);
  });

  it('does not block set when lastFailed names a different icon', async () => {
    const storage = createRecordingStorage();
    await storage.setItem(
      'icon-switcher:lastFailed',
      JSON.stringify({ name: 'default', at: Date.now() })
    );
    const fetchChoice = jest.fn(async () => 'halloween');
    await syncIcon({ fetchChoice, storage, retryAfterMs: 60_000 });
    expect(mockNativeState.setCalls).toEqual(['halloween']);
  });

  it('decodes legacy plain-text lastFailed values', async () => {
    const storage = createRecordingStorage();
    await storage.setItem('icon-switcher:lastFailed', 'halloween');
    mockNativeState.setImpl = async () => {
      throw Object.assign(new Error('fail'), { code: 'ERR_OS_REJECTED' });
    };
    await syncIcon({
      fetchChoice: async () => 'halloween',
      storage,
      retryAfterMs: 60_000,
    });
    expect(mockNativeState.setCalls).toEqual(['halloween']);
  });

  it('ignores malformed lastFailed storage payloads', async () => {
    const storage = createRecordingStorage();
    await storage.setItem('icon-switcher:lastFailed', '{"wrong":true}');
    const fetchChoice = jest.fn(async () => 'halloween');
    await syncIcon({ fetchChoice, storage });
    expect(mockNativeState.setCalls).toEqual(['halloween']);
  });

  it('ignores unknown icon names without calling native set', async () => {
    const fetchChoice = jest.fn(async () => 'unknown_remote');
    await syncIcon({ fetchChoice });
    expect(fetchChoice).toHaveBeenCalled();
    expect(mockNativeState.setCalls).toHaveLength(0);
  });

  it('does not retry a name that previously failed within retryAfterMs', async () => {
    const storage = createRecordingStorage();
    mockNativeState.setImpl = async () => {
      throw Object.assign(new Error('fail'), { code: 'ERR_OS_REJECTED' });
    };
    const fetchChoice = jest.fn(async () => 'halloween');
    await syncIcon({ fetchChoice, storage, retryAfterMs: 60_000 });
    expect(mockNativeState.setCalls).toEqual(['halloween']);

    mockNativeState.setCalls = [];
    mockNativeState.setImpl = async () => ({ status: 'applied' });
    await syncIcon({ fetchChoice, storage, retryAfterMs: 60_000 });
    expect(mockNativeState.setCalls).toHaveLength(0);
  });

  it('retries a failed name after retryAfterMs', async () => {
    jest.useFakeTimers();
    const storage = createRecordingStorage();
    mockNativeState.setImpl = async () => {
      throw Object.assign(new Error('fail'), { code: 'ERR_OS_REJECTED' });
    };
    const fetchChoice = jest.fn(async () => 'halloween');
    await syncIcon({ fetchChoice, storage, retryAfterMs: 1_000 });
    expect(mockNativeState.setCalls).toEqual(['halloween']);

    mockNativeState.setCalls = [];
    mockNativeState.setImpl = async () => ({ status: 'applied' });
    jest.advanceTimersByTime(1_001);
    await syncIcon({ fetchChoice, storage, retryAfterMs: 1_000 });
    expect(mockNativeState.setCalls).toEqual(['halloween']);
  });

  it('skips set when getCurrent already matches the choice', async () => {
    mockNativeState.current = 'halloween';
    const fetchChoice = jest.fn(async () => 'halloween');
    await syncIcon({ fetchChoice });
    expect(mockNativeState.setCalls).toHaveLength(0);
  });

  it('re-applies after manual reset when remote choice differs from getCurrent', async () => {
    const storage = createRecordingStorage();
    await storage.setItem('icon-switcher:lastApplied', 'halloween');
    mockNativeState.current = 'default';

    const fetchChoice = jest.fn(async () => 'halloween');
    await syncIcon({ fetchChoice, storage });
    expect(mockNativeState.setCalls).toEqual(['halloween']);
  });

  it('does not record lastApplied when set returns pending', async () => {
    const storage = createRecordingStorage();
    mockNativeState.setImpl = async () => ({ status: 'pending' });
    const fetchChoice = jest.fn(async () => 'halloween');
    await syncIcon({ fetchChoice, storage });
    expect(mockNativeState.setCalls).toEqual(['halloween']);
    expect(storage.store.get('icon-switcher:lastApplied')).toBeUndefined();
  });

  it('routes fetchChoice rejections to onError without throwing', async () => {
    const onError = jest.fn();
    const fetchChoice = jest.fn(async () => {
      throw new Error('network');
    });
    await expect(syncIcon({ fetchChoice, onError })).resolves.toBeDefined();
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'network' })
    );
    expect(mockNativeState.setCalls).toHaveLength(0);
  });

  it('does not run overlapping active handlers concurrently', async () => {
    const rn = jest.requireMock('react-native') as {
      Platform: { OS: string };
      AppState: { currentState: string; __emit: (s: string) => void };
    };
    rn.Platform.OS = 'ios';

    let resolveSet: (() => void) | undefined;
    mockNativeState.setImpl = () =>
      new Promise<{ status: 'applied' }>((resolve) => {
        resolveSet = () => resolve({ status: 'applied' });
      });

    const fetchChoice = jest.fn(async () => 'halloween');
    await syncIcon({ fetchChoice });
    await _flushAsync();
    expect(mockNativeState.setCalls).toHaveLength(1);

    rn.AppState.__emit('active');
    await _flushAsync();
    expect(mockNativeState.setCalls).toHaveLength(1);

    resolveSet?.();
    await _flushAsync();
  });

  it('returns a cleanup function that unsubscribes AppState listeners', async () => {
    const rn = jest.requireMock('react-native') as {
      AppState: { __clearListeners?: () => void };
    };
    const fetchChoice = jest.fn(async () => 'halloween');
    const cleanup = await syncIcon({ fetchChoice });
    expect(typeof cleanup).toBe('function');
    cleanup();
    rn.AppState.__clearListeners?.();
  });

  it('on iOS waits for active AppState before calling set', async () => {
    const rn = jest.requireMock('react-native') as {
      Platform: { OS: string };
      AppState: { currentState: string; __emit: (s: string) => void };
    };
    rn.Platform.OS = 'ios';
    rn.AppState.currentState = 'background';

    const fetchChoice = jest.fn(async () => 'halloween');
    await syncIcon({ fetchChoice });
    expect(mockNativeState.setCalls).toHaveLength(0);

    rn.AppState.currentState = 'active';
    rn.AppState.__emit('active');
    await _flushAsync();
    expect(mockNativeState.setCalls).toEqual(['halloween']);
  });
});
