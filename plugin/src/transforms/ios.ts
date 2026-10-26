import type { XcodeProject } from 'xcode';

import type { ResolvedConfig } from '../types';

const PRIMARY_ICON_NAME = 'AppIcon';

export function applyInfoPlist(
  plist: Record<string, unknown>,
  cfg: ResolvedConfig
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...plist };

  next.IconSwitcherIcons = cfg.icons
    .filter((icon) => icon.isDefault || icon.ios !== null)
    .map((icon) => icon.name);
  next.CFBundleIcons = _ensurePrimaryIconBundle(
    next.CFBundleIcons,
    'CFBundleIcons'
  );

  if (_supportsIpad(next)) {
    next['CFBundleIcons~ipad'] = _mirrorIpadIcons(
      next.CFBundleIcons,
      next['CFBundleIcons~ipad']
    );
  }

  return next;
}

function _ensurePrimaryIconBundle(
  existing: unknown,
  label: string
): Record<string, unknown> {
  const bundle =
    existing && typeof existing === 'object' && !Array.isArray(existing)
      ? { ...(existing as Record<string, unknown>) }
      : {};

  const primary =
    bundle.CFBundlePrimaryIcon && typeof bundle.CFBundlePrimaryIcon === 'object'
      ? { ...(bundle.CFBundlePrimaryIcon as Record<string, unknown>) }
      : {};

  const currentName = primary.CFBundleIconName;
  if (currentName !== undefined && currentName !== PRIMARY_ICON_NAME) {
    console.warn(
      `[react-native-icon-switcher] ${label}.CFBundlePrimaryIcon.CFBundleIconName is "${String(currentName)}"; expected "${PRIMARY_ICON_NAME}" — leaving unchanged`
    );
  } else {
    primary.CFBundleIconName = PRIMARY_ICON_NAME;
  }

  bundle.CFBundlePrimaryIcon = primary;
  return bundle;
}

function _supportsIpad(plist: Record<string, unknown>): boolean {
  const families = plist.UIDeviceFamily;
  if (
    Array.isArray(families) &&
    families.some((value) => value === 2 || value === '2')
  ) {
    return true;
  }
  return plist['UISupportedInterfaceOrientations~ipad'] !== undefined;
}

function _mirrorIpadIcons(
  phoneIcons: unknown,
  existingIpad: unknown
): Record<string, unknown> {
  const phone =
    phoneIcons && typeof phoneIcons === 'object' && !Array.isArray(phoneIcons)
      ? (phoneIcons as Record<string, unknown>)
      : {};
  const ipad =
    existingIpad &&
    typeof existingIpad === 'object' &&
    !Array.isArray(existingIpad)
      ? { ...(existingIpad as Record<string, unknown>) }
      : {};

  ipad.CFBundlePrimaryIcon = phone.CFBundlePrimaryIcon;
  return ipad;
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
    configuration.buildSettings.ASSETCATALOG_COMPILER_ALTERNATE_APPICON_NAMES =
      _formatAlternateAppIconNamesSetting(alternateNames);
    configuration.buildSettings.ASSETCATALOG_COMPILER_INCLUDE_ALL_APPICON_ASSETS =
      'NO';
  }

  return project;
}

function _formatAlternateAppIconNamesSetting(raw: string): string {
  if (!raw) {
    return '';
  }
  if (!raw.includes(' ')) {
    return raw;
  }
  return `"${raw}"`;
}

function _findFirstApplicationTarget(
  project: XcodeProject
): [string, { buildConfigurationList: string }] {
  const section = project.pbxNativeTargetSection();
  for (const [key, value] of Object.entries(section)) {
    if (key.endsWith('_comment')) {
      continue;
    }
    const target = value as {
      productType?: string;
      buildConfigurationList: string;
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
): [string, { buildSettings: Record<string, string | undefined> }][] {
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
    const item = value as { isa?: string };
    return item.isa === 'XCBuildConfiguration' && ids.includes(key);
  }) as [string, { buildSettings: Record<string, string | undefined> }][];
}

function _unquote(value: string): string {
  const match = value.match(/^"(.*)"$/);
  return match?.[1] ?? value;
}
