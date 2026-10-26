import type { IconSwitcherErrorCode } from '../src/errors';

export class IconSwitcherError extends Error {
  readonly code: IconSwitcherErrorCode;
  constructor(code: IconSwitcherErrorCode, message?: string);
}

export type MockIconSwitcherState = {
  isSupported: boolean;
  iconNames: string[];
  current: string;
  setImpl: (name: string) => Promise<{ status: 'applied' | 'pending' }>;
  applyPendingImpl: () => Promise<{ status: 'applied' | 'none' }>;
};

export declare const IconSwitcher: {
  readonly isSupported: boolean;
  list(): string[];
  getCurrent(): Promise<string>;
  set(name: string): Promise<{ status: 'applied' | 'pending' }>;
  reset(): Promise<{ status: 'applied' | 'pending' }>;
  applyPending(): Promise<{ status: 'applied' | 'none' }>;
};

export default IconSwitcher;

export declare function __setState(
  partial: Partial<MockIconSwitcherState>
): void;

export declare function __reset(): void;
