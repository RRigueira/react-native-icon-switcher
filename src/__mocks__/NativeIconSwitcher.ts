import type { Spec } from '../NativeIconSwitcher';

export const mockNativeState = {
  isSupported: true,
  iconNames: ['default', 'halloween'],
  current: 'default',
  setCalls: [] as string[],
  setImpl: async (
    _name: string
  ): Promise<{ status: 'applied' | 'pending' }> => ({ status: 'applied' }),
  applyPendingCalls: 0,
  applyPendingImpl: async (): Promise<{ status: 'applied' | 'none' }> => ({
    status: 'none',
  }),
};

export function _resetMockState(): void {
  mockNativeState.isSupported = true;
  mockNativeState.iconNames = ['default', 'halloween'];
  mockNativeState.current = 'default';
  mockNativeState.setCalls = [];
  mockNativeState.setImpl = async () => ({ status: 'applied' });
  mockNativeState.applyPendingCalls = 0;
  mockNativeState.applyPendingImpl = async () => ({ status: 'none' });
}

const mockModule: Spec = {
  getConstants: () => ({
    isSupported: mockNativeState.isSupported,
    iconNames: mockNativeState.iconNames,
  }),
  getCurrent: async () => mockNativeState.current,
  set: async (name: string) => {
    mockNativeState.setCalls.push(name);
    return mockNativeState.setImpl(name);
  },
  applyPending: async () => {
    mockNativeState.applyPendingCalls += 1;
    return mockNativeState.applyPendingImpl();
  },
};

export default mockModule;
