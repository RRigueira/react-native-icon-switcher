import type { TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';

export interface IconSwitcherConstants {
  isSupported: boolean;
  iconNames: string[];
}

export interface Spec extends TurboModule {
  getConstants(): IconSwitcherConstants;
  getCurrent(): Promise<string>;
  // Plain `string` status keeps codegen parsers happy on older RN versions.
  set(name: string): Promise<{ status: string }>;
  applyPending(): Promise<{ status: string }>;
}

export default TurboModuleRegistry.get<Spec>('IconSwitcher');
