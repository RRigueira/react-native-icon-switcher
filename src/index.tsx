import native from './NativeIconSwitcher';
import { IconSwitcherError, mapNativeError } from './errors';
import type { IconName } from './register';

function _constants(): { isSupported: boolean; iconNames: string[] } {
  if (native == null) {
    return { isSupported: false, iconNames: [] };
  }
  return native.getConstants();
}

function _rejectUnsupported(): never {
  throw new IconSwitcherError(
    'unsupported',
    'Alternate app icons are not supported'
  );
}

function _assertKnownIcon(name: string): void {
  if (!_constants().iconNames.includes(name)) {
    throw new IconSwitcherError('unknown_icon', `Unknown icon: ${name}`);
  }
}

const IconSwitcher = {
  get isSupported(): boolean {
    return _constants().isSupported;
  },

  list(): IconName[] {
    return [..._constants().iconNames] as IconName[];
  },

  async getCurrent(): Promise<IconName> {
    if (native == null) {
      _rejectUnsupported();
    }
    try {
      const current = await native.getCurrent();
      return current as IconName;
    } catch (error) {
      throw mapNativeError(error);
    }
  },

  async set(name: IconName): Promise<{ status: 'applied' | 'pending' }> {
    if (!_constants().isSupported) {
      _rejectUnsupported();
    }
    _assertKnownIcon(name as string);
    try {
      const result = await native!.set(name as string);
      return result as { status: 'applied' | 'pending' };
    } catch (error) {
      throw mapNativeError(error);
    }
  },

  async reset(): Promise<{ status: 'applied' | 'pending' }> {
    return IconSwitcher.set('default' as IconName);
  },

  async applyPending(): Promise<{ status: 'applied' | 'none' }> {
    if (native == null) {
      _rejectUnsupported();
    }
    try {
      const result = await native.applyPending();
      return result as { status: 'applied' | 'none' };
    } catch (error) {
      throw mapNativeError(error);
    }
  },
};

export { IconSwitcher, IconSwitcherError };
export type { IconName, Register } from './register';
export default IconSwitcher;
