import fs from 'fs';
import os from 'os';
import path from 'path';

import { compileModsAsync, withPlugins } from '@expo/config-plugins';

import { applyAndroidManifest } from '../transforms/android';
import { applyInfoPlist } from '../transforms/ios';
import { renderTypes } from '../transforms/types';
import { sampleConfig } from '../transforms/sampleConfigs';

const mockResolveConfig = jest.fn(
  (_cfg: unknown, _ctx: unknown) => sampleConfig
);

jest.mock('../core/validate', () => ({
  resolveConfig: (cfg: unknown, ctx: unknown) => mockResolveConfig(cfg, ctx),
}));

const mockPlanAssets = jest.fn(() => ({ assets: [] }));
const mockWriteAssets = jest.fn(async () => []);

jest.mock('../core/assets', () => ({
  planAssets: (...args: unknown[]) => mockPlanAssets(...args),
  writeAssets: (...args: unknown[]) => mockWriteAssets(...args),
}));

describe('withIconSwitcher building blocks', () => {
  beforeEach(() => {
    mockResolveConfig.mockClear();
    mockPlanAssets.mockReset();
    mockPlanAssets.mockReturnValue({ assets: [] });
    mockWriteAssets.mockClear();
  });

  it('wires transform helpers used by the plugin', () => {
    const types = renderTypes(sampleConfig);
    expect(types).toContain('halloween');
    expect(typeof applyAndroidManifest).toBe('function');
    expect(typeof applyInfoPlist).toBe('function');
  });

  it('does not pass expoDefault when Expo has no icon config', async () => {
    const withIconSwitcher = require('../index').default;
    const projectRoot = path.join(__dirname, '..');
    const config = withPlugins(
      {
        name: 'test',
        slug: 'test',
        version: '1.0.0',
        _internal: { projectRoot, isDebug: false },
      },
      [[withIconSwitcher, { icons: { halloween: 'icons/halloween.png' } }]]
    );

    await compileModsAsync(config, {
      projectRoot,
      platforms: ['android'],
      introspect: true,
    });

    const ctx = mockResolveConfig.mock.calls[0]?.[1] as {
      expoDefault?: unknown;
    };
    expect(ctx.expoDefault).toBeUndefined();
  });

  it('passes expoDefault from Expo icon config into resolveConfig', async () => {
    const withIconSwitcher = require('../index').default;
    const projectRoot = path.join(__dirname, '..');
    const config = withPlugins(
      {
        name: 'test',
        slug: 'test',
        version: '1.0.0',
        icon: './assets/icon.png',
        _internal: { projectRoot, isDebug: false },
      },
      [[withIconSwitcher, { icons: { halloween: 'icons/halloween.png' } }]]
    );

    await compileModsAsync(config, {
      projectRoot,
      platforms: ['android'],
      introspect: true,
    });

    expect(mockResolveConfig).toHaveBeenCalled();
    const ctx = mockResolveConfig.mock.calls[0]?.[1] as {
      expoDefault?: unknown;
    };
    expect(ctx.expoDefault).toBe('./assets/icon.png');
  });

  it('passes adaptiveIcon-only expoDefault into resolveConfig', async () => {
    const withIconSwitcher = require('../index').default;
    const projectRoot = path.join(__dirname, '..');
    const config = withPlugins(
      {
        name: 'test',
        slug: 'test',
        version: '1.0.0',
        android: {
          adaptiveIcon: {
            foregroundImage: './assets/adaptive-fg.png',
            backgroundColor: '#112233',
          },
        },
        _internal: { projectRoot, isDebug: false },
      },
      [[withIconSwitcher, { icons: { halloween: 'icons/halloween.png' } }]]
    );

    await compileModsAsync(config, {
      projectRoot,
      platforms: ['android'],
      introspect: true,
    });

    const ctx = mockResolveConfig.mock.calls[0]?.[1] as {
      expoDefault?: { android?: { foreground: string; background: string } };
    };
    expect(ctx.expoDefault).toEqual({
      android: {
        foreground: './assets/adaptive-fg.png',
        background: '#112233',
      },
    });
  });

  it('passes combined Expo icon and adaptiveIcon as expoDefault', async () => {
    const withIconSwitcher = require('../index').default;
    const projectRoot = path.join(__dirname, '..');
    const config = withPlugins(
      {
        name: 'test',
        slug: 'test',
        version: '1.0.0',
        icon: './assets/icon.png',
        android: {
          adaptiveIcon: {
            foregroundImage: './assets/adaptive-fg.png',
            backgroundImage: './assets/adaptive-bg.png',
          },
        },
        _internal: { projectRoot, isDebug: false },
      },
      [[withIconSwitcher, { icons: { halloween: 'icons/halloween.png' } }]]
    );

    await compileModsAsync(config, {
      projectRoot,
      platforms: ['ios'],
      introspect: true,
    });

    const ctx = mockResolveConfig.mock.calls[0]?.[1] as {
      expoDefault?: { ios?: string; android?: { foreground: string } };
    };
    expect(ctx.expoDefault).toEqual({
      ios: './assets/icon.png',
      android: {
        foreground: './assets/adaptive-fg.png',
        background: './assets/adaptive-bg.png',
      },
    });
  });

  it('does not inject CFBundleIcons via applyInfoPlist', () => {
    const plist = applyInfoPlist(
      { CFBundleName: 'Example' },
      sampleConfig
    ) as Record<string, unknown>;
    expect(plist.IconSwitcherIcons).toEqual(['default', 'halloween']);
    expect(plist.CFBundleIcons).toBeUndefined();
  });

  it('runs Android and iOS mods in one compileModsAsync call', async () => {
    const withIconSwitcher = require('../index').default;
    const projectRoot = path.join(__dirname, '..');
    const config = withPlugins(
      {
        name: 'test',
        slug: 'test',
        version: '1.0.0',
        _internal: { projectRoot, isDebug: false },
      },
      [[withIconSwitcher, { icons: { halloween: 'icons/halloween.png' } }]]
    );

    await compileModsAsync(config, {
      projectRoot,
      platforms: ['android', 'ios'],
      introspect: true,
    });
    expect(mockResolveConfig.mock.calls.length).toBeGreaterThan(0);
  });

  it('runs iOS plist and Xcode mods', async () => {
    const withIconSwitcher = require('../index').default;
    const projectRoot = path.join(__dirname, '..');
    const config = withPlugins(
      {
        name: 'test',
        slug: 'test',
        version: '1.0.0',
        _internal: { projectRoot, isDebug: false },
      },
      [[withIconSwitcher, { icons: { halloween: 'icons/halloween.png' } }]]
    );

    await compileModsAsync(config, {
      projectRoot,
      platforms: ['ios'],
      introspect: true,
    });
    expect(mockResolveConfig.mock.calls.length).toBeGreaterThan(0);
  });

  it('does not rewrite icon-switcher.d.ts when content is unchanged', async () => {
    const withIconSwitcher = require('../index').default;
    const projectRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'icon-switcher-plugin-')
    );
    const typesPath = path.join(projectRoot, 'icon-switcher.d.ts');
    const expected = renderTypes(sampleConfig);
    fs.writeFileSync(typesPath, expected, 'utf8');
    const beforeMtime = fs.statSync(typesPath).mtimeMs;

    const manifestDir = path.join(projectRoot, 'android/app/src/main');
    fs.mkdirSync(manifestDir, { recursive: true });
    fs.copyFileSync(
      path.join(__dirname, '../__fixtures__/manifests/AndroidManifest.xml'),
      path.join(manifestDir, 'AndroidManifest.xml')
    );

    const config = withPlugins(
      {
        name: 'test',
        slug: 'test',
        version: '1.0.0',
        _internal: { projectRoot, isDebug: false },
      },
      [[withIconSwitcher, { icons: { halloween: 'icons/halloween.png' } }]]
    );

    await compileModsAsync(config, { projectRoot, platforms: ['android'] });
    expect(fs.statSync(typesPath).mtimeMs).toBe(beforeMtime);
  });

  it('filters asset plans to Android outputs in the Android dangerous mod', async () => {
    mockPlanAssets.mockReturnValue({
      assets: [
        { relativePath: 'AppIcon.appiconset/icon.png' },
        { relativePath: 'mipmap-mdpi/ic_launcher.png' },
      ],
    });
    const withIconSwitcher = require('../index').default;
    const projectRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'icon-switcher-filter-')
    );
    const manifestDir = path.join(projectRoot, 'android/app/src/main');
    fs.mkdirSync(manifestDir, { recursive: true });
    fs.copyFileSync(
      path.join(__dirname, '../__fixtures__/manifests/AndroidManifest.xml'),
      path.join(manifestDir, 'AndroidManifest.xml')
    );

    const config = withPlugins(
      {
        name: 'test',
        slug: 'test',
        version: '1.0.0',
        _internal: { projectRoot, isDebug: false },
      },
      [[withIconSwitcher, { icons: { halloween: 'icons/halloween.png' } }]]
    );

    await compileModsAsync(config, { projectRoot, platforms: ['android'] });
    expect(mockWriteAssets).toHaveBeenCalled();
    const androidPlan = mockWriteAssets.mock.calls[0]?.[0] as {
      assets: { relativePath: string }[];
    };
    expect(androidPlan.assets).toHaveLength(1);
    expect(androidPlan.assets[0]?.relativePath).toContain('mipmap');
  });

  it('filters asset plans to iOS outputs in the iOS dangerous mod', async () => {
    mockPlanAssets.mockReturnValue({
      assets: [
        { relativePath: 'AppIcon.appiconset/icon.png' },
        { relativePath: 'mipmap-mdpi/ic_launcher.png' },
      ],
    });
    const { __setGetIosSourceRootForTests } = require('../index');
    const withIconSwitcher = require('../index').default;
    const projectRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'icon-switcher-filter-ios-')
    );
    fs.cpSync(
      path.join(__dirname, '../__fixtures__/bare-project'),
      projectRoot,
      { recursive: true }
    );
    __setGetIosSourceRootForTests(() => path.join(projectRoot, 'ios/Fixture'));

    const config = withPlugins(
      {
        name: 'test',
        slug: 'test',
        version: '1.0.0',
        _internal: { projectRoot, isDebug: false },
      },
      [[withIconSwitcher, { icons: { halloween: 'icons/halloween.png' } }]]
    );

    await compileModsAsync(config, { projectRoot, platforms: ['ios'] });
    __setGetIosSourceRootForTests(undefined);
    const iosPlan = mockWriteAssets.mock.calls[0]?.[0] as {
      assets: { relativePath: string }[];
    };
    expect(iosPlan.assets).toHaveLength(1);
    expect(iosPlan.assets[0]?.relativePath).toContain('.appiconset');
  });

  it('writes icon-switcher.d.ts from the Android dangerous mod', async () => {
    const withIconSwitcher = require('../index').default;
    const projectRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'icon-switcher-plugin-')
    );
    const typesPath = path.join(projectRoot, 'icon-switcher.d.ts');
    const manifestDir = path.join(projectRoot, 'android/app/src/main');
    fs.mkdirSync(manifestDir, { recursive: true });
    fs.copyFileSync(
      path.join(__dirname, '../__fixtures__/manifests/AndroidManifest.xml'),
      path.join(manifestDir, 'AndroidManifest.xml')
    );

    const config = withPlugins(
      {
        name: 'test',
        slug: 'test',
        version: '1.0.0',
        _internal: { projectRoot, isDebug: false },
      },
      [[withIconSwitcher, { icons: { halloween: 'icons/halloween.png' } }]]
    );

    await compileModsAsync(config, { projectRoot, platforms: ['android'] });

    expect(fs.existsSync(typesPath)).toBe(true);
    expect(fs.readFileSync(typesPath, 'utf8')).toContain("'halloween'");
  });
});
