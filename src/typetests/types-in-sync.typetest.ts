// plugin/src/types.ts mirrors this package's config types because the plugin is compiled on its
// own (rootDir: plugin/src). This fails typecheck the moment the two copies drift apart.
import type * as Runtime from '../types';
import type * as Plugin from '../../plugin/src/types';

type Equal<X, Y> =
  (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2
    ? true
    : false;

export const typesInSync: [
  Equal<Runtime.IconSource, Plugin.IconSource>,
  Equal<Runtime.IconSwitcherConfig, Plugin.IconSwitcherConfig>,
  Equal<Runtime.ResolvedIcon, Plugin.ResolvedIcon>,
  Equal<Runtime.ResolvedConfig, Plugin.ResolvedConfig>,
] = [true, true, true, true];
