import fs from 'fs';
import os from 'os';
import path from 'path';

import plist from '@expo/plist';
import xcode from 'xcode';

import type { ResolvedConfig } from '../../types';
import {
  _isLegacy01PrimaryIconBundle,
  applyInfoPlist,
  applyXcodeProject,
} from '../ios';
import { sampleConfig } from '../sampleConfigs';

const plistPath = path.join(__dirname, '../../__fixtures__/plists/Info.plist');
const pbxprojPath = path.join(
  __dirname,
  '../../__fixtures__/xcodeproj/project.pbxproj'
);

function loadStockPlist(): Record<string, unknown> {
  const raw = fs.readFileSync(plistPath, 'utf8');
  return plist.parse(raw) as Record<string, unknown>;
}

function loadStockProject(): xcode.XcodeProject {
  const project = xcode.project(pbxprojPath);
  project.parseSync();
  return project;
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function projectBuildSettings(
  project: xcode.XcodeProject
): Record<string, string | undefined>[] {
  const section = project.pbxXCBuildConfigurationSection();
  return Object.entries(section)
    .filter(([key]) => !key.endsWith('_comment'))
    .map(
      ([, value]) =>
        (value as { buildSettings: Record<string, string | undefined> })
          .buildSettings
    )
    .filter((settings) => settings.PRODUCT_NAME !== undefined);
}

describe('applyInfoPlist', () => {
  it('matches snapshot after transform', () => {
    const result = applyInfoPlist(loadStockPlist(), sampleConfig);
    expect(result).toMatchSnapshot();
  });

  it('is idempotent', () => {
    const plistInput = loadStockPlist();
    const once = applyInfoPlist(plistInput, sampleConfig);
    const twice = applyInfoPlist(deepClone(once), sampleConfig);
    expect(twice).toEqual(once);
  });

  it('does not write CFBundleAlternateIcons', () => {
    const result = applyInfoPlist(loadStockPlist(), sampleConfig);
    expect(result.CFBundleAlternateIcons).toBeUndefined();
  });

  it('removes legacy 0.1.x CFBundleIcons primary AppIcon shape', () => {
    const plistInput = {
      ...loadStockPlist(),
      'CFBundleIcons': {
        CFBundlePrimaryIcon: { CFBundleIconName: 'AppIcon' },
      },
      'CFBundleIcons~ipad': {
        CFBundlePrimaryIcon: { CFBundleIconName: 'AppIcon' },
      },
    };
    const result = applyInfoPlist(plistInput, sampleConfig);
    expect(result.CFBundleIcons).toBeUndefined();
    expect(result['CFBundleIcons~ipad']).toBeUndefined();
    expect(result.IconSwitcherIcons).toEqual(['default', 'halloween']);
  });

  it('does not treat arbitrary CFBundleIcons shapes as legacy', () => {
    expect(_isLegacy01PrimaryIconBundle(null)).toBe(false);
    expect(_isLegacy01PrimaryIconBundle({ extra: true })).toBe(false);
    expect(
      _isLegacy01PrimaryIconBundle({
        CFBundlePrimaryIcon: { CFBundleIconName: 'AppIcon', extra: true },
      })
    ).toBe(false);
  });

  it('keeps non-legacy CFBundleIcons content untouched', () => {
    const plistInput = {
      ...loadStockPlist(),
      CFBundleIcons: {
        CFBundlePrimaryIcon: { CFBundleIconName: 'AppIcon.dev' },
      },
    };
    const result = applyInfoPlist(plistInput, sampleConfig);
    const primary = (result.CFBundleIcons as Record<string, unknown>)
      .CFBundlePrimaryIcon as Record<string, unknown>;
    expect(primary.CFBundleIconName).toBe('AppIcon.dev');
  });
});

describe('applyXcodeProject', () => {
  it('quotes a single alternate name when it contains characters outside Xcodeproj unquoted set', () => {
    const blackFriday: ResolvedConfig = {
      ...sampleConfig,
      icons: [
        sampleConfig.icons[0],
        {
          name: 'black_friday',
          isDefault: false,
          ios: { light: 'icons/halloween.png' },
          android: { legacy: 'icons/halloween.png' },
        },
      ],
    };
    const project = loadStockProject();
    applyXcodeProject(project, blackFriday);
    const text = project.writeSync();
    expect(text).toContain(
      'ASSETCATALOG_COMPILER_ALTERNATE_APPICON_NAMES = "AppIcon-black_friday";'
    );
  });

  it('sets alternate app icon build settings on Debug and Release', () => {
    const project = loadStockProject();
    applyXcodeProject(project, sampleConfig);
    const settings = projectBuildSettings(project);
    expect(settings.length).toBeGreaterThanOrEqual(2);
    for (const buildSettings of settings) {
      expect(buildSettings.ASSETCATALOG_COMPILER_ALTERNATE_APPICON_NAMES).toBe(
        '"AppIcon-halloween"'
      );
      expect(
        buildSettings.ASSETCATALOG_COMPILER_INCLUDE_ALL_APPICON_ASSETS
      ).toBe('NO');
    }
  });

  it('is idempotent', () => {
    const project = loadStockProject();
    applyXcodeProject(project, sampleConfig);
    const before = deepClone(projectBuildSettings(project));
    applyXcodeProject(project, sampleConfig);
    expect(projectBuildSettings(project)).toEqual(before);
  });

  it('quotes alternate names in pbxproj when multiple alternates have iOS art', () => {
    const twoAlternates: ResolvedConfig = {
      ...sampleConfig,
      icons: [
        ...sampleConfig.icons,
        {
          name: 'midnight',
          isDefault: false,
          ios: { light: 'icons/halloween.png' },
          android: { legacy: 'icons/halloween.png' },
        },
      ],
    };
    const project = loadStockProject();
    applyXcodeProject(project, twoAlternates);
    const text = project.writeSync();
    expect(text).toContain(
      'ASSETCATALOG_COMPILER_ALTERNATE_APPICON_NAMES = "AppIcon-halloween AppIcon-midnight";'
    );

    for (const buildSettings of projectBuildSettings(project)) {
      expect(buildSettings.ASSETCATALOG_COMPILER_ALTERNATE_APPICON_NAMES).toBe(
        '"AppIcon-halloween AppIcon-midnight"'
      );
    }

    const tmpPath = path.join(
      os.tmpdir(),
      `icon-switcher-pbx-${Date.now()}.pbxproj`
    );
    fs.writeFileSync(tmpPath, text);
    const reparsed = xcode.project(tmpPath);
    reparsed.parseSync();
    applyXcodeProject(reparsed, twoAlternates);
    expect(reparsed.writeSync()).toBe(text);
  });

  it('leaves existing equal alternate names setting byte-identical (quoted)', () => {
    const project = loadStockProject();
    applyXcodeProject(project, sampleConfig);
    const podLike = project.writeSync();
    const tmpPath = path.join(
      os.tmpdir(),
      `icon-switcher-pbx-pod-${Date.now()}.pbxproj`
    );
    fs.writeFileSync(tmpPath, podLike);
    const reparsed = xcode.project(tmpPath);
    reparsed.parseSync();
    applyXcodeProject(reparsed, sampleConfig);
    expect(reparsed.writeSync()).toBe(podLike);
  });

  it('leaves existing equal alternate names setting byte-identical (unquoted)', () => {
    const project = loadStockProject();
    applyXcodeProject(project, sampleConfig);
    const unquoted = project
      .writeSync()
      .replace(
        /ASSETCATALOG_COMPILER_ALTERNATE_APPICON_NAMES = "AppIcon-halloween";/g,
        'ASSETCATALOG_COMPILER_ALTERNATE_APPICON_NAMES = AppIcon-halloween;'
      );
    expect(unquoted).not.toContain(
      'ASSETCATALOG_COMPILER_ALTERNATE_APPICON_NAMES = "AppIcon-halloween";'
    );
    const tmpPath = path.join(
      os.tmpdir(),
      `icon-switcher-pbx-unq-${Date.now()}.pbxproj`
    );
    fs.writeFileSync(tmpPath, unquoted);
    const reparsed = xcode.project(tmpPath);
    reparsed.parseSync();
    applyXcodeProject(reparsed, sampleConfig);
    expect(reparsed.writeSync()).toBe(unquoted);
  });

  it('replaces an existing different alternate names value using Xcodeproj quoting', () => {
    const project = loadStockProject();
    applyXcodeProject(project, sampleConfig);
    const section = project.pbxXCBuildConfigurationSection();
    for (const [key, value] of Object.entries(section)) {
      if (key.endsWith('_comment')) {
        continue;
      }
      const item = value as { buildSettings?: Record<string, string> };
      if (item.buildSettings?.PRODUCT_NAME) {
        item.buildSettings.ASSETCATALOG_COMPILER_ALTERNATE_APPICON_NAMES =
          'AppIcon-other';
      }
    }
    applyXcodeProject(project, sampleConfig);
    const text = project.writeSync();
    expect(text).toContain(
      'ASSETCATALOG_COMPILER_ALTERNATE_APPICON_NAMES = "AppIcon-halloween";'
    );
  });

  it('leaves INCLUDE_ALL_APPICON_ASSETS quoting untouched when value is NO', () => {
    const project = loadStockProject();
    applyXcodeProject(project, sampleConfig);
    const section = project.pbxXCBuildConfigurationSection();
    for (const [key, value] of Object.entries(section)) {
      if (key.endsWith('_comment')) {
        continue;
      }
      const item = value as { buildSettings?: Record<string, string> };
      if (item.buildSettings?.PRODUCT_NAME) {
        item.buildSettings.ASSETCATALOG_COMPILER_INCLUDE_ALL_APPICON_ASSETS =
          '"NO"';
      }
    }
    const beforeQuoted = project.writeSync();
    applyXcodeProject(project, sampleConfig);
    expect(project.writeSync()).toBe(beforeQuoted);

    for (const [key, value] of Object.entries(section)) {
      if (key.endsWith('_comment')) {
        continue;
      }
      const item = value as { buildSettings?: Record<string, string> };
      if (item.buildSettings?.PRODUCT_NAME) {
        item.buildSettings.ASSETCATALOG_COMPILER_INCLUDE_ALL_APPICON_ASSETS =
          'NO';
      }
    }
    const beforeUnquoted = project.writeSync();
    applyXcodeProject(project, sampleConfig);
    expect(project.writeSync()).toBe(beforeUnquoted);
  });

  it('warns when a build configuration has no ASSETCATALOG_COMPILER_APPICON_NAME', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const project = loadStockProject();
    const section = project.pbxXCBuildConfigurationSection();
    for (const [key, value] of Object.entries(section)) {
      if (key.endsWith('_comment')) {
        continue;
      }
      const item = value as { buildSettings?: Record<string, string> };
      if (item.buildSettings) {
        delete item.buildSettings.ASSETCATALOG_COMPILER_APPICON_NAME;
      }
    }
    applyXcodeProject(project, sampleConfig);
    expect(
      warn.mock.calls.some((call) =>
        String(call[0]).includes('ASSETCATALOG_COMPILER_APPICON_NAME')
      )
    ).toBe(true);
    warn.mockRestore();
  });

  it('throws when the Xcode project has no application target', () => {
    const project = loadStockProject();
    const section = project.pbxNativeTargetSection();
    for (const key of Object.keys(section)) {
      if (!key.endsWith('_comment')) {
        delete section[key];
      }
    }
    expect(() => applyXcodeProject(project, sampleConfig)).toThrow(
      /application target/
    );
  });

  it('clears alternate app icon build settings when no alternates have iOS art', () => {
    const androidOnly: ResolvedConfig = {
      ...sampleConfig,
      icons: [
        sampleConfig.icons[0],
        {
          name: 'android_only',
          isDefault: false,
          ios: null,
          android: { legacy: 'icons/halloween.png' },
        },
      ],
    };
    const project = loadStockProject();
    applyXcodeProject(project, androidOnly);
    for (const buildSettings of projectBuildSettings(project)) {
      expect(buildSettings.ASSETCATALOG_COMPILER_ALTERNATE_APPICON_NAMES).toBe(
        ''
      );
    }
  });

  it('uses PRODUCT_NAME in warnings when build configuration name is missing', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const project = loadStockProject();
    const section = project.pbxXCBuildConfigurationSection();
    for (const [key, value] of Object.entries(section)) {
      if (key.endsWith('_comment')) {
        continue;
      }
      const item = value as {
        name?: string;
        buildSettings?: Record<string, string>;
      };
      if (item.buildSettings?.PRODUCT_NAME) {
        delete item.name;
        delete item.buildSettings.ASSETCATALOG_COMPILER_APPICON_NAME;
      }
    }
    applyXcodeProject(project, sampleConfig);
    expect(
      warn.mock.calls.some((call) =>
        String(call[0]).includes('ASSETCATALOG_COMPILER_APPICON_NAME')
      )
    ).toBe(true);
    warn.mockRestore();
  });

  it('reads unquoted productType values from pbxproj targets', () => {
    const project = loadStockProject();
    const section = project.pbxNativeTargetSection();
    for (const [key, value] of Object.entries(section)) {
      if (key.endsWith('_comment')) {
        continue;
      }
      const target = value as { productType?: string };
      if (target.productType?.includes('application')) {
        target.productType = 'com.apple.product-type.application';
      }
    }
    expect(() => applyXcodeProject(project, sampleConfig)).not.toThrow();
  });

  it('omits icons without iOS art from plist and alternate build settings', () => {
    const mixed: ResolvedConfig = {
      ...sampleConfig,
      icons: [
        sampleConfig.icons[0],
        {
          name: 'android_only',
          isDefault: false,
          ios: null,
          android: { legacy: 'icons/halloween.png' },
        },
        {
          name: 'spooky',
          isDefault: false,
          ios: { light: 'icons/halloween.png' },
          android: null,
        },
      ],
    };
    const plistResult = applyInfoPlist(loadStockPlist(), mixed);
    expect(plistResult.IconSwitcherIcons).toEqual(['default', 'spooky']);

    const project = loadStockProject();
    applyXcodeProject(project, mixed);
    for (const buildSettings of projectBuildSettings(project)) {
      expect(buildSettings.ASSETCATALOG_COMPILER_ALTERNATE_APPICON_NAMES).toBe(
        '"AppIcon-spooky"'
      );
    }
  });
});
