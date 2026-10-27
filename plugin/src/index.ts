import fs from 'fs';
import path from 'path';

import {
  ConfigPlugin,
  IOSConfig,
  withAndroidManifest,
  withDangerousMod,
  withInfoPlist,
  withXcodeProject,
  createRunOncePlugin,
} from '@expo/config-plugins';

import {
  planAssets,
  pruneStaleIosAppIconSets,
  writeAssets,
  type AssetPlan,
} from './core/assets';
import { resolveConfig } from './core/validate';
import type { IconSwitcherConfig, IconSource } from './types';
import { applyAndroidManifest } from './transforms/android';
import { applyInfoPlist, applyXcodeProject } from './transforms/ios';
import { renderTypes } from './transforms/types';

let _getIosSourceRootForTests: ((projectRoot: string) => string) | undefined;

/** @internal Test hook for locating Images.xcassets without a full Expo iOS tree. */
export function __setGetIosSourceRootForTests(
  resolver: ((projectRoot: string) => string) | undefined
): void {
  _getIosSourceRootForTests = resolver;
}

function _iosSourceRoot(projectRoot: string): string {
  if (_getIosSourceRootForTests) {
    return _getIosSourceRootForTests(projectRoot);
  }
  return IOSConfig.Paths.getSourceRoot(projectRoot);
}

function _buildExpoDefault(config: {
  icon?: unknown;
  android?: { adaptiveIcon?: Record<string, unknown> };
}): IconSource | undefined {
  const icon = config.icon;
  const adaptive = config.android?.adaptiveIcon;
  if (!icon && !adaptive) {
    return undefined;
  }

  const iosPath = typeof icon === 'string' ? icon : undefined;
  const androidAdaptive =
    adaptive && typeof adaptive.foregroundImage === 'string'
      ? {
          foreground: adaptive.foregroundImage as string,
          background:
            (typeof adaptive.backgroundColor === 'string' &&
              adaptive.backgroundColor) ||
            (typeof adaptive.backgroundImage === 'string' &&
              adaptive.backgroundImage) ||
            '#FFFFFF',
        }
      : undefined;

  if (iosPath && !androidAdaptive) {
    return iosPath;
  }
  if (!iosPath && androidAdaptive) {
    return { android: androidAdaptive };
  }
  return {
    ios: iosPath,
    android: androidAdaptive,
  };
}

function _resolve(
  cfg: IconSwitcherConfig,
  projectRoot: string,
  expoDefault?: IconSource
) {
  return resolveConfig(cfg, { projectRoot, expoDefault });
}

function _filterPlan(plan: AssetPlan, platform: 'ios' | 'android'): AssetPlan {
  const assets = plan.assets.filter((asset) => {
    const isIos = asset.relativePath.includes('.appiconset');
    return platform === 'ios' ? isIos : !isIos;
  });
  return { ...plan, assets };
}

function _findIosAssetCatalog(projectRoot: string): string {
  const catalog = path.join(_iosSourceRoot(projectRoot), 'Images.xcassets');
  if (!fs.existsSync(catalog)) {
    throw new Error(`Could not find Images.xcassets at ${catalog}`);
  }
  return catalog;
}

async function _writeTypesIfChanged(
  projectRoot: string,
  resolved: ReturnType<typeof resolveConfig>
): Promise<void> {
  const target = path.join(projectRoot, 'icon-switcher.d.ts');
  const content = renderTypes(resolved);
  let existing: string | undefined;
  try {
    existing = await fs.promises.readFile(target, 'utf8');
  } catch {
    existing = undefined;
  }
  if (existing !== content) {
    await fs.promises.writeFile(target, content, 'utf8');
  }
}

const withIconSwitcher: ConfigPlugin<IconSwitcherConfig> = (config, props) => {
  config = withAndroidManifest(config, (config) => {
    const resolved = _resolve(
      props,
      config.modRequest.projectRoot,
      _buildExpoDefault(config)
    );
    config.modResults = applyAndroidManifest(config.modResults, resolved);
    return config;
  });

  config = withInfoPlist(config, (config) => {
    const resolved = _resolve(
      props,
      config.modRequest.projectRoot,
      _buildExpoDefault(config)
    );
    config.modResults = applyInfoPlist(
      config.modResults,
      resolved
    ) as typeof config.modResults;
    return config;
  });

  config = withXcodeProject(config, (config) => {
    const resolved = _resolve(
      props,
      config.modRequest.projectRoot,
      _buildExpoDefault(config)
    );
    config.modResults = applyXcodeProject(config.modResults, resolved);
    return config;
  });

  config = withDangerousMod(config, [
    'android',
    async (config) => {
      const projectRoot = config.modRequest.projectRoot;
      const resolved = _resolve(props, projectRoot, _buildExpoDefault(config));
      const plan = _filterPlan(planAssets(resolved, projectRoot), 'android');
      const androidResDir = path.join(
        config.modRequest.platformProjectRoot,
        'app',
        'src',
        'main',
        'res'
      );
      await writeAssets(plan, {
        iosAssetCatalog: path.join(projectRoot, '.noop-ios'),
        androidResDir,
      });
      await _writeTypesIfChanged(projectRoot, resolved);
      return config;
    },
  ]);

  config = withDangerousMod(config, [
    'ios',
    async (config) => {
      const projectRoot = config.modRequest.projectRoot;
      const resolved = _resolve(props, projectRoot, _buildExpoDefault(config));
      const plan = _filterPlan(planAssets(resolved, projectRoot), 'ios');
      const iosAssetCatalog = _findIosAssetCatalog(projectRoot);
      await writeAssets(plan, {
        iosAssetCatalog,
        androidResDir: path.join(projectRoot, '.noop-android'),
      });
      await pruneStaleIosAppIconSets(iosAssetCatalog, plan, { check: false });
      await _writeTypesIfChanged(projectRoot, resolved);
      return config;
    },
  ]);

  return config;
};

export default createRunOncePlugin(
  withIconSwitcher,
  'react-native-icon-switcher'
);
