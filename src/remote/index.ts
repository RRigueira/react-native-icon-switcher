import { AppState, Platform } from 'react-native';

import IconSwitcher from '../index';
import type { IconName } from '../register';

const STORAGE_KEY_APPLIED = 'icon-switcher:lastApplied';
const STORAGE_KEY_FAILED = 'icon-switcher:lastFailed';

const DEFAULT_RETRY_AFTER_MS = 24 * 60 * 60 * 1000;

export interface SyncIconStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

export interface SyncIconOptions {
  fetchChoice: () => Promise<string | null | undefined>;
  storage?: SyncIconStorage;
  /** How long to skip re-applying a name after `set` failed. Default 24 h. */
  retryAfterMs?: number;
  onError?: (error: unknown) => void;
}

function _createMemoryStorage(): SyncIconStorage {
  const data = new Map<string, string>();
  return {
    getItem: async (key) => data.get(key) ?? null,
    setItem: async (key, value) => {
      data.set(key, value);
    },
  };
}

function _encodeFailed(name: string): string {
  return JSON.stringify({ name, at: Date.now() });
}

function _decodeFailed(
  raw: string | null
): { name: string; at: number } | null {
  if (!raw || raw.length === 0) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as { name?: string; at?: number };
    if (typeof parsed.name === 'string' && typeof parsed.at === 'number') {
      return { name: parsed.name, at: parsed.at };
    }
  } catch {
    // legacy: plain icon name with no timestamp — eligible for retry immediately
    return { name: raw, at: 0 };
  }
  return null;
}

function _isFailedBlocked(
  failed: { name: string; at: number } | null,
  choice: string,
  retryAfterMs: number
): boolean {
  if (!failed || failed.name !== choice) {
    return false;
  }
  return Date.now() - failed.at < retryAfterMs;
}

// Shared by every syncIcon instance: callers restart syncIcon when their inputs change, and an
// older instance's run can still be waiting on the OS (iOS shows an alert per set call). Running
// one at a time lets the next run see the icon the previous one applied.
let _queue: Promise<void> = Promise.resolve();

function _enqueue(task: () => Promise<void>): Promise<void> {
  const next = _queue.then(task, task);
  _queue = next.catch(() => {});
  return next;
}

/**
 * Fetches the remote icon choice, validates it, and applies it via {@link IconSwitcher}.
 * iOS: runs while the app is `active`. Android: calls `set` immediately (native may defer).
 */
export async function syncIcon(options: SyncIconOptions): Promise<() => void> {
  const storage = options.storage ?? _createMemoryStorage();
  const retryAfterMs = options.retryAfterMs ?? DEFAULT_RETRY_AFTER_MS;
  // A throwing onError must never break syncIcon or surface as an unhandled rejection.
  const reportError = (error: unknown): void => {
    try {
      options.onError?.(error);
    } catch {
      // Ignored on purpose.
    }
  };

  let inFlight = false;
  let stopped = false;

  const _apply = async (): Promise<void> => {
    try {
      // Unsubscribed while queued: the caller has moved on to a newer syncIcon.
      if (stopped) {
        return;
      }
      const choice = await options.fetchChoice();
      if (stopped) {
        return;
      }
      if (choice == null || choice === '') {
        return;
      }
      if (!IconSwitcher.list().includes(choice as IconName)) {
        return;
      }
      if (!IconSwitcher.isSupported) {
        return;
      }

      const failedRaw = await storage.getItem(STORAGE_KEY_FAILED);
      const failed = _decodeFailed(failedRaw);
      if (_isFailedBlocked(failed, choice, retryAfterMs)) {
        return;
      }

      const current = await IconSwitcher.getCurrent();
      if (choice === current) {
        await storage.setItem(STORAGE_KEY_APPLIED, choice);
        return;
      }

      try {
        const result = await IconSwitcher.set(choice as IconName);
        if (result.status === 'pending') {
          return;
        }
        await storage.setItem(STORAGE_KEY_APPLIED, choice);
        await storage.setItem(STORAGE_KEY_FAILED, '');
      } catch (error) {
        await storage.setItem(STORAGE_KEY_FAILED, _encodeFailed(choice));
        reportError(error);
      }
    } catch (error) {
      reportError(error);
    }
  };

  const run = async (): Promise<void> => {
    if (inFlight || stopped) {
      return;
    }
    inFlight = true;
    try {
      await _enqueue(_apply);
    } finally {
      inFlight = false;
    }
  };

  const runWhenActive = (): void => {
    if (AppState.currentState === 'active') {
      void run();
    }
  };

  if (Platform.OS === 'ios') {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void run();
      }
    });
    runWhenActive();
    return () => {
      stopped = true;
      subscription.remove();
    };
  }

  await run();
  return () => {
    stopped = true;
  };
}
