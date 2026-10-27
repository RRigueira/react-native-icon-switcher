import type { XcodeProject } from 'xcode';

import type { ResolvedConfig } from '../types';

export function applyInfoPlist(
  plist: Record<string, unknown>,
  cfg: ResolvedConfig
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...plist };

  next.IconSwitcherIcons = cfg.icons
    .filter((icon) => icon.isDefault || icon.ios !== null)
    .map((icon) => icon.name);

  if (_isLegacy01PrimaryIconBundle(next.CFBundleIcons)) {
    delete next.CFBundleIcons;
  }
  if (_isLegacy01PrimaryIconBundle(next['CFBundleIcons~ipad'])) {
    delete next['CFBundleIcons~ipad'];
  }

  return next;
}

export function _isLegacy01PrimaryIconBundle(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const bundle = value as Record<string, unknown>;
  const primary = bundle.CFBundlePrimaryIcon;
  if (!primary || typeof primary !== 'object' || Array.isArray(primary)) {
    return false;
  }
  const primaryIcon = primary as Record<string, unknown>;
  const keys = Object.keys(primaryIcon);
  return keys.length === 1 && primaryIcon.CFBundleIconName === 'AppIcon';
}

export function applyXcodeProject(
  project: XcodeProject,
  cfg: ResolvedConfig
): XcodeProject {
  const alternateNames = cfg.icons
    .filter((icon) => !icon.isDefault && icon.ios !== null)
    .map((icon) => `AppIcon-${icon.name}`)
    .join(' ');

  const [, nativeTarget] = _findFirstApplicationTarget(project);
  const buildConfigurations = _getBuildConfigurationsForListId(
    project,
    nativeTarget.buildConfigurationList
  );

  for (const [, configuration] of buildConfigurations) {
    const settings = configuration.buildSettings;
    const configName = configuration.name ?? settings.PRODUCT_NAME ?? 'unknown';
    if (!settings.ASSETCATALOG_COMPILER_APPICON_NAME) {
      console.warn(
        `[react-native-icon-switcher] Build configuration "${String(configName)}" has no ASSETCATALOG_COMPILER_APPICON_NAME — set the primary app icon in Xcode`
      );
    }
    _setBuildSettingPreservingQuoting(
      settings,
      'ASSETCATALOG_COMPILER_ALTERNATE_APPICON_NAMES',
      alternateNames
    );
    _setBuildSettingPreservingQuoting(
      settings,
      'ASSETCATALOG_COMPILER_INCLUDE_ALL_APPICON_ASSETS',
      'NO'
    );
  }

  return project;
}

function _setBuildSettingPreservingQuoting(
  settings: Record<string, string | undefined>,
  key: string,
  desired: string
): void {
  const existing = settings[key];
  if (existing !== undefined && _unquote(existing) === desired) {
    return;
  }
  settings[key] = _formatXcodeprojBuildSettingValue(desired);
}

function _formatXcodeprojBuildSettingValue(raw: string): string {
  if (!raw) {
    return '';
  }
  if (/^[A-Za-z0-9_$/:.]+$/.test(raw)) {
    return raw;
  }
  const escaped = raw.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `"${escaped}"`;
}

function _findFirstApplicationTarget(
  project: XcodeProject
): [string, { buildConfigurationList: string; name?: string }] {
  const section = project.pbxNativeTargetSection();
  for (const [key, value] of Object.entries(section)) {
    if (key.endsWith('_comment')) {
      continue;
    }
    const target = value as {
      productType?: string;
      buildConfigurationList: string;
      name?: string;
    };
    const productType = _unquote(String(target.productType ?? ''));
    if (productType === 'com.apple.product-type.application') {
      return [key, target];
    }
  }
  throw new Error('Could not find application target in Xcode project');
}

function _getBuildConfigurationsForListId(
  project: XcodeProject,
  configurationListId: string
): [
  string,
  { name?: string; buildSettings: Record<string, string | undefined> },
][] {
  const lists = project.pbxXCConfigurationList();
  const list = lists[configurationListId] as {
    buildConfigurations?: { value: string }[];
  };
  const ids = (list?.buildConfigurations ?? []).map((entry) => entry.value);
  const section = project.pbxXCBuildConfigurationSection();

  return Object.entries(section).filter(([key, value]) => {
    if (key.endsWith('_comment')) {
      return false;
    }
    const item = value as { isa?: string; name?: string };
    return item.isa === 'XCBuildConfiguration' && ids.includes(key);
  }) as [
    string,
    { name?: string; buildSettings: Record<string, string | undefined> },
  ][];
}

function _unquote(value: string): string {
  const match = value.match(/^"(.*)"$/);
  return match?.[1] ?? value;
}
