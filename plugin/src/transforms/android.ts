import { AndroidConfig } from '@expo/config-plugins';

import type { ResolvedConfig } from '../types';
import { TransformError } from './errors';

type AndroidManifest = AndroidConfig.Manifest.AndroidManifest;
type ManifestActivityAlias = AndroidConfig.Manifest.ManifestActivityAlias;
type ManifestApplication = AndroidConfig.Manifest.ManifestApplication;
type ManifestIntentFilter = AndroidConfig.Manifest.ManifestIntentFilter;
type ManifestMetaData = AndroidConfig.Manifest.ManifestMetaData;

const MAIN_ACTION = 'android.intent.action.MAIN';
const LAUNCHER_CATEGORY = 'android.intent.category.LAUNCHER';
const ICONKIT_ICON_META = 'com.iconswitcher.icon';
const ICONKIT_ICONS_META = 'com.iconswitcher.icons';
const ICONKIT_APPLY_ON_META = 'com.iconswitcher.applyOn';
const ICONKIT_SKIP_BRANDS_META = 'com.iconswitcher.skipBrands';
const DEFAULT_ALIAS = '.IconSwitcher_default';

const RECOGNIZED_ACTIONS = new Set([MAIN_ACTION]);
const RECOGNIZED_CATEGORIES = new Set([LAUNCHER_CATEGORY]);

export function applyAndroidManifest(
  manifest: AndroidManifest,
  cfg: ResolvedConfig
): AndroidManifest {
  const next: AndroidManifest = JSON.parse(
    JSON.stringify(manifest)
  ) as AndroidManifest;
  const application = _getApplication(next);
  const launcherActivityName = _resolveLauncherActivityName(application);

  _stripLauncherFilters(application, launcherActivityName);
  _syncActivityAliases(application, cfg, launcherActivityName);
  _syncApplicationMetaData(application, cfg);

  return next;
}

function _getApplication(manifest: AndroidManifest): ManifestApplication {
  const application = manifest.manifest.application?.[0];
  if (!application) {
    throw new TransformError('AndroidManifest has no <application> element');
  }
  return application;
}

function _resolveLauncherActivityName(
  application: ManifestApplication
): string {
  const withLauncher = (application.activity ?? []).find((activity) =>
    (activity['intent-filter'] ?? []).some(_isLauncherIntentFilter)
  );
  if (withLauncher?.$?.['android:name']) {
    return withLauncher.$['android:name'];
  }

  const mainActivity = (application.activity ?? []).find(
    (activity) => activity.$?.['android:name'] === '.MainActivity'
  );
  if (mainActivity?.$?.['android:name']) {
    return mainActivity.$['android:name'];
  }

  const defaultAlias = (application['activity-alias'] ?? []).find(
    (alias) => alias.$?.['android:name'] === DEFAULT_ALIAS
  );
  const target = defaultAlias?.$?.['android:targetActivity'];
  if (target) {
    return target;
  }

  throw new TransformError(
    'Could not find launcher activity (no MAIN/LAUNCHER filter, .MainActivity, or default activity-alias)'
  );
}

function _stripLauncherFilters(
  application: ManifestApplication,
  activityName: string
): void {
  const activities = application.activity ?? [];
  const activity = activities.find(
    (item) => item.$?.['android:name'] === activityName
  );
  if (!activity) {
    throw new TransformError(
      `Launcher activity ${activityName} not found in manifest`
    );
  }

  const filters = activity['intent-filter'] ?? [];
  activity['intent-filter'] = filters.filter((filter) => {
    if (!_isLauncherIntentFilter(filter)) {
      return true;
    }
    _assertRecognizedLauncherFilter(filter);
    return false;
  });
}

function _isLauncherIntentFilter(filter: ManifestIntentFilter): boolean {
  const actions = _actionNames(filter);
  const categories = _categoryNames(filter);
  return (
    actions.includes(MAIN_ACTION) && categories.includes(LAUNCHER_CATEGORY)
  );
}

function _assertRecognizedLauncherFilter(filter: ManifestIntentFilter): void {
  const actions = _actionNames(filter);
  const categories = _categoryNames(filter);

  for (const action of actions) {
    if (!RECOGNIZED_ACTIONS.has(action)) {
      throw new TransformError(
        `Unrecognized action in launcher intent-filter: ${action}`
      );
    }
  }
  for (const category of categories) {
    if (!RECOGNIZED_CATEGORIES.has(category)) {
      throw new TransformError(
        `Unrecognized category in launcher intent-filter: ${category}`
      );
    }
  }
}

function _actionNames(filter: ManifestIntentFilter): string[] {
  return (filter.action ?? [])
    .map((item) => item.$?.['android:name'])
    .filter(Boolean) as string[];
}

function _categoryNames(filter: ManifestIntentFilter): string[] {
  return (filter.category ?? [])
    .map((item) => item.$?.['android:name'])
    .filter(Boolean) as string[];
}

function _syncActivityAliases(
  application: ManifestApplication,
  cfg: ResolvedConfig,
  launcherActivityName: string
): void {
  const configuredNames = new Set(
    cfg.icons
      .filter((icon) => icon.isDefault || icon.android !== null)
      .map((icon) => icon.name)
  );
  const existing = application['activity-alias'] ?? [];
  const kept: ManifestActivityAlias[] = [];

  for (const alias of existing) {
    const marker = _readIconKitMarker(alias);
    if (marker === null) {
      kept.push(alias);
      continue;
    }
    if (!configuredNames.has(marker)) {
      continue;
    }
    kept.push(_buildActivityAlias(marker, cfg, launcherActivityName, alias));
  }

  for (const icon of cfg.icons) {
    if (!icon.isDefault && icon.android === null) {
      continue;
    }
    const aliasName = `.IconSwitcher_${icon.name}`;
    const already = kept.some(
      (alias) => alias.$?.['android:name'] === aliasName
    );
    if (!already) {
      kept.push(_buildActivityAlias(icon.name, cfg, launcherActivityName));
    }
  }

  application['activity-alias'] = kept;
}

function _buildActivityAlias(
  iconName: string,
  cfg: ResolvedConfig,
  launcherActivityName: string,
  previous?: ManifestActivityAlias
): ManifestActivityAlias {
  const icon = cfg.icons.find((item) => item.name === iconName);
  const isDefault = icon?.isDefault ?? iconName === 'default';
  const { icon: iconRef, roundIcon } = _mipmapRefs(iconName, isDefault);

  const aliasAttrs: NonNullable<ManifestActivityAlias['$']> & {
    'android:roundIcon': string;
  } = {
    ...(previous?.$ ?? {}),
    'android:name': `.IconSwitcher_${iconName}`,
    'android:targetActivity': launcherActivityName,
    'android:exported': 'true',
    'android:enabled': isDefault ? 'true' : 'false',
    'android:icon': iconRef,
    'android:roundIcon': roundIcon,
  };

  return {
    '$': aliasAttrs,
    'intent-filter': [_launcherIntentFilter()],
    'meta-data': [_iconKitMarkerMeta(iconName)],
  };
}

function _mipmapRefs(
  iconName: string,
  isDefault: boolean
): { icon: string; roundIcon: string } {
  if (isDefault) {
    return {
      icon: '@mipmap/ic_launcher',
      roundIcon: '@mipmap/ic_launcher_round',
    };
  }
  return {
    icon: `@mipmap/ic_launcher_${iconName}`,
    roundIcon: `@mipmap/ic_launcher_${iconName}_round`,
  };
}

function _launcherIntentFilter(): ManifestIntentFilter {
  return {
    action: [{ $: { 'android:name': MAIN_ACTION } }],
    category: [{ $: { 'android:name': LAUNCHER_CATEGORY } }],
  };
}

function _iconKitMarkerMeta(iconName: string): ManifestMetaData {
  return {
    $: {
      'android:name': ICONKIT_ICON_META,
      'android:value': iconName,
    },
  };
}

function _readIconKitMarker(alias: ManifestActivityAlias): string | null {
  const meta = alias['meta-data'] ?? [];
  for (const item of meta) {
    if (item.$?.['android:name'] === ICONKIT_ICON_META) {
      return item.$['android:value'] ?? null;
    }
  }
  return null;
}

function _syncApplicationMetaData(
  application: ManifestApplication,
  cfg: ResolvedConfig
): void {
  const meta = application['meta-data'] ?? [];
  const withoutIconKit = meta.filter(
    (item) =>
      item.$?.['android:name'] !== ICONKIT_ICONS_META &&
      item.$?.['android:name'] !== ICONKIT_APPLY_ON_META &&
      item.$?.['android:name'] !== ICONKIT_SKIP_BRANDS_META
  );

  withoutIconKit.push(
    {
      $: {
        'android:name': ICONKIT_ICONS_META,
        'android:value': _configuredAndroidIconNames(cfg).join(','),
      },
    },
    {
      $: {
        'android:name': ICONKIT_APPLY_ON_META,
        'android:value': cfg.android.applyOn,
      },
    },
    {
      $: {
        'android:name': ICONKIT_SKIP_BRANDS_META,
        'android:value': cfg.android.skipBrands.join(','),
      },
    }
  );

  application['meta-data'] = withoutIconKit;
}

function _configuredAndroidIconNames(cfg: ResolvedConfig): string[] {
  return cfg.icons
    .filter((icon) => icon.isDefault || icon.android !== null)
    .map((icon) => icon.name);
}
