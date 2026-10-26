import fs from 'fs';
import os from 'os';
import path from 'path';

import plist from '@expo/plist';
import xcode from 'xcode';

import type { ResolvedConfig } from '../../types';
import { applyInfoPlist, applyXcodeProject } from '../ios';
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

  it('mirrors phone icons onto CFBundleIcons~ipad when iPad is supported', () => {
    const plistInput = {
      ...loadStockPlist(),
      UIDeviceFamily: [1, 2],
    };
    const result = applyInfoPlist(plistInput, sampleConfig);
    const ipad = result['CFBundleIcons~ipad'] as Record<string, unknown>;
    const phone = result.CFBundleIcons as Record<string, unknown>;
    expect(ipad.CFBundlePrimaryIcon).toEqual(phone.CFBundlePrimaryIcon);
  });

  it('detects iPad support via UISupportedInterfaceOrientations~ipad', () => {
    const plistInput = {
      ...loadStockPlist(),
      'UISupportedInterfaceOrientations~ipad': [
        'UIInterfaceOrientationPortrait',
      ],
    };
    const result = applyInfoPlist(plistInput, sampleConfig);
    expect(result['CFBundleIcons~ipad']).toBeDefined();
  });

  it('warns and leaves a mismatched CFBundleIconName unchanged', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const plistInput = {
      ...loadStockPlist(),
      CFBundleIcons: {
        CFBundlePrimaryIcon: { CFBundleIconName: 'LegacyIcon' },
      },
    };
    const result = applyInfoPlist(plistInput, sampleConfig);
    const primary = (result.CFBundleIcons as Record<string, unknown>)
      .CFBundlePrimaryIcon as Record<string, unknown>;
    expect(primary.CFBundleIconName).toBe('LegacyIcon');
    expect(warn.mock.calls[0]?.[0]).toContain('LegacyIcon');
    warn.mockRestore();
  });
});

describe('applyXcodeProject', () => {
  it('sets alternate app icon build settings on Debug and Release', () => {
    const project = loadStockProject();
    applyXcodeProject(project, sampleConfig);
    const settings = projectBuildSettings(project);
    expect(settings.length).toBeGreaterThanOrEqual(2);
    for (const buildSettings of settings) {
      expect(buildSettings.ASSETCATALOG_COMPILER_ALTERNATE_APPICON_NAMES).toBe(
        'AppIcon-halloween'
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
        'AppIcon-spooky'
      );
    }
  });
});
