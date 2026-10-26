import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import sharp from 'sharp';

import { _readCornerRgb, planAssets, writeAssets } from '../assets';
import { resolveConfig } from '../validate';

const PROJECT_ROOT = path.join(__dirname, '../../__fixtures__');

function _resolved() {
  return resolveConfig(
    {
      default: 'icons/default.png',
      icons: { halloween: 'icons/halloween.png' },
      ios: { flattenOn: '#FF00AA' },
    },
    { projectRoot: PROJECT_ROOT }
  );
}

describe('planAssets', () => {
  it('includes expected iOS and Android output paths', () => {
    const plan = planAssets(_resolved(), PROJECT_ROOT);
    const paths = plan.assets.map((a) => a.relativePath.replace(/\\/g, '/'));

    expect(paths).toContain('AppIcon.appiconset/AppIcon-1024.png');
    expect(paths).toContain('AppIcon-halloween.appiconset/AppIcon-1024.png');
    expect(paths).toContain('mipmap-mdpi/ic_launcher.png');
    expect(paths).toContain('mipmap-mdpi/ic_launcher_round.png');
    expect(paths).toContain('mipmap-mdpi/ic_launcher_halloween.png');
    expect(paths).toContain('mipmap-xxhdpi/ic_launcher_halloween_round.png');
  });
});

describe('writeAssets', () => {
  let tmpIos: string;
  let tmpAndroid: string;

  beforeAll(async () => {
    tmpIos = await fs.mkdtemp(path.join(os.tmpdir(), 'aik-ios-'));
    tmpAndroid = await fs.mkdtemp(path.join(os.tmpdir(), 'aik-and-'));
  });

  afterAll(async () => {
    await fs.rm(tmpIos, { recursive: true, force: true });
    await fs.rm(tmpAndroid, { recursive: true, force: true });
  });

  it('flattens iOS alpha onto flattenOn (corner pixel)', async () => {
    const plan = planAssets(_resolved(), PROJECT_ROOT);
    await writeAssets(plan, {
      iosAssetCatalog: tmpIos,
      androidResDir: tmpAndroid,
    });
    const iosPng = path.join(tmpIos, 'AppIcon.appiconset/AppIcon-1024.png');
    const corner = await _readCornerRgb(iosPng);
    expect(corner).toEqual({ r: 255, g: 0, b: 170 });
  });

  it('writes iOS PNGs without an alpha channel', async () => {
    const plan = planAssets(_resolved(), PROJECT_ROOT);
    await writeAssets(plan, {
      iosAssetCatalog: tmpIos,
      androidResDir: tmpAndroid,
    });
    const iosPng = path.join(tmpIos, 'AppIcon.appiconset/AppIcon-1024.png');
    const meta = await sharp(iosPng).metadata();
    expect(meta.channels).toBe(3);
    expect(meta.hasAlpha).toBe(false);
  });

  it('omits default assets when Expo owns the primary icon', () => {
    const resolved = resolveConfig(
      {
        default: 'icons/default.png',
        icons: { halloween: 'icons/halloween.png' },
      },
      {
        projectRoot: PROJECT_ROOT,
        expoDefault: 'icons/default.png',
      }
    );
    const paths = planAssets(resolved, PROJECT_ROOT).assets.map((a) =>
      a.relativePath.replace(/\\/g, '/')
    );
    expect(paths.some((p) => p.startsWith('AppIcon.appiconset'))).toBe(false);
    expect(paths).not.toContain('mipmap-mdpi/ic_launcher.png');
    expect(paths).not.toContain('mipmap-mdpi/ic_launcher_round.png');
    expect(paths).toContain('AppIcon-halloween.appiconset/AppIcon-1024.png');
    expect(paths).toContain('mipmap-mdpi/ic_launcher_halloween.png');
  });

  it('composites adaptive foreground onto background for legacy mipmaps', async () => {
    const resolved = resolveConfig(
      {
        default: {
          android: {
            foreground: 'icons/default.png',
            background: '#00FF00',
          },
        },
        icons: { halloween: 'icons/halloween.png' },
      },
      { projectRoot: PROJECT_ROOT }
    );
    const isolatedAndroid = await fs.mkdtemp(
      path.join(os.tmpdir(), 'aik-adapt-')
    );
    const plan = planAssets(resolved, PROJECT_ROOT);
    await writeAssets(plan, {
      iosAssetCatalog: tmpIos,
      androidResDir: isolatedAndroid,
    });
    const legacy = path.join(isolatedAndroid, 'mipmap-mdpi/ic_launcher.png');
    const corner = await _readCornerRgb(legacy);
    expect(corner).toEqual({ r: 0, g: 255, b: 0 });
    await fs.rm(isolatedAndroid, { recursive: true, force: true });
  });

  it('writes Android legacy sizes', async () => {
    const plan = planAssets(_resolved(), PROJECT_ROOT);
    await writeAssets(plan, {
      iosAssetCatalog: tmpIos,
      androidResDir: tmpAndroid,
    });
    const mdpi = path.join(tmpAndroid, 'mipmap-mdpi/ic_launcher_halloween.png');
    const meta = await sharp(mdpi).metadata();
    expect(meta.width).toBe(48);
    expect(meta.height).toBe(48);
  });

  it('plans dark and tinted iOS variants', () => {
    const resolved = resolveConfig(
      {
        default: 'icons/default.png',
        icons: {
          halloween: {
            ios: {
              light: 'icons/halloween.png',
              dark: 'icons/halloween.png',
              tinted: 'icons/halloween.png',
            },
          },
        },
      },
      { projectRoot: PROJECT_ROOT }
    );
    const paths = planAssets(resolved, PROJECT_ROOT).assets.map((a) =>
      a.relativePath.replace(/\\/g, '/')
    );
    expect(paths).toContain(
      'AppIcon-halloween.appiconset/AppIcon-1024-dark.png'
    );
    expect(paths).toContain(
      'AppIcon-halloween.appiconset/AppIcon-1024-tinted.png'
    );
  });

  it('writes adaptive background images and monochrome layers', async () => {
    const resolved = resolveConfig(
      {
        default: {
          android: {
            foreground: 'icons/default.png',
            background: '#00AAFF',
            monochrome: 'icons/halloween.png',
          },
        },
        icons: { halloween: 'icons/halloween.png' },
      },
      { projectRoot: PROJECT_ROOT }
    );
    const isolatedAndroid = await fs.mkdtemp(
      path.join(os.tmpdir(), 'aik-adapt-full-')
    );
    const plan = planAssets(resolved, PROJECT_ROOT);
    await writeAssets(plan, {
      iosAssetCatalog: tmpIos,
      androidResDir: isolatedAndroid,
    });
    await expect(
      fs.stat(
        path.join(isolatedAndroid, 'mipmap-mdpi/ic_launcher_foreground.png')
      )
    ).resolves.toBeDefined();
    await expect(
      fs.stat(
        path.join(isolatedAndroid, 'mipmap-mdpi/ic_launcher_foreground.png')
      )
    ).resolves.toBeDefined();
    await expect(
      fs.stat(
        path.join(isolatedAndroid, 'mipmap-mdpi/ic_launcher_monochrome.png')
      )
    ).resolves.toBeDefined();
    const colorsXml = await fs.readFile(
      path.join(isolatedAndroid, 'values/icon_switcher_colors.xml'),
      'utf8'
    );
    expect(colorsXml).toContain('icon_switcher_default_background');
    await fs.rm(isolatedAndroid, { recursive: true, force: true });
  });

  it('writes dark variant metadata in iOS Contents.json', async () => {
    const resolved = resolveConfig(
      {
        icons: {
          halloween: {
            ios: { light: 'icons/halloween.png', dark: 'icons/halloween.png' },
          },
        },
      },
      { projectRoot: PROJECT_ROOT }
    );
    const isolatedIos = await fs.mkdtemp(path.join(os.tmpdir(), 'aik-dark-'));
    const plan = planAssets(resolved, PROJECT_ROOT);
    await writeAssets(plan, {
      iosAssetCatalog: isolatedIos,
      androidResDir: tmpAndroid,
    });
    const contents = await fs.readFile(
      path.join(isolatedIos, 'AppIcon-halloween.appiconset/Contents.json'),
      'utf8'
    );
    expect(contents).toContain('"appearance": "luminosity"');
    expect(contents).toContain('"value": "dark"');
    await fs.rm(isolatedIos, { recursive: true, force: true });
  });

  it('composites adaptive legacy mipmaps onto a background image', async () => {
    const resolved = resolveConfig(
      {
        default: {
          android: {
            foreground: 'icons/default.png',
            background: 'icons/halloween.png',
          },
        },
        icons: { halloween: 'icons/halloween.png' },
      },
      { projectRoot: PROJECT_ROOT }
    );
    const isolatedAndroid = await fs.mkdtemp(
      path.join(os.tmpdir(), 'aik-bg-img-')
    );
    const plan = planAssets(resolved, PROJECT_ROOT);
    await writeAssets(plan, {
      iosAssetCatalog: tmpIos,
      androidResDir: isolatedAndroid,
    });
    await expect(
      fs.stat(path.join(isolatedAndroid, 'mipmap-mdpi/ic_launcher.png'))
    ).resolves.toBeDefined();
    await expect(
      fs.stat(
        path.join(isolatedAndroid, 'mipmap-mdpi/ic_launcher_background.png')
      )
    ).resolves.toBeDefined();
    await fs.rm(isolatedAndroid, { recursive: true, force: true });
  });

  it('uses #RGB flatten colour expansion', async () => {
    const resolved = resolveConfig(
      {
        default: 'icons/default.png',
        icons: { halloween: 'icons/halloween.png' },
        ios: { flattenOn: '#F0A' },
      },
      { projectRoot: PROJECT_ROOT }
    );
    const isolatedIos = await fs.mkdtemp(path.join(os.tmpdir(), 'aik-rgb-'));
    const plan = planAssets(resolved, PROJECT_ROOT);
    await writeAssets(plan, {
      iosAssetCatalog: isolatedIos,
      androidResDir: tmpAndroid,
    });
    const corner = await _readCornerRgb(
      path.join(isolatedIos, 'AppIcon.appiconset/AppIcon-1024.png')
    );
    expect(corner).toEqual({ r: 255, g: 0, b: 170 });
    await fs.rm(isolatedIos, { recursive: true, force: true });
  });

  it('produces byte-identical output on second write', async () => {
    const isolatedIos = await fs.mkdtemp(path.join(os.tmpdir(), 'aik-ios2-'));
    const isolatedAndroid = await fs.mkdtemp(
      path.join(os.tmpdir(), 'aik-and2-')
    );
    const plan = planAssets(_resolved(), PROJECT_ROOT);

    const first = await writeAssets(plan, {
      iosAssetCatalog: isolatedIos,
      androidResDir: isolatedAndroid,
    });
    const second = await writeAssets(plan, {
      iosAssetCatalog: isolatedIos,
      androidResDir: isolatedAndroid,
    });

    const hashFirst = new Map(first.map((f) => [f.relativePath, f.sha256]));
    for (const file of second) {
      expect(file.sha256).toBe(hashFirst.get(file.relativePath));
      const bytes = await fs.readFile(file.absolutePath);
      expect(crypto.createHash('sha256').update(bytes).digest('hex')).toBe(
        file.sha256
      );
    }

    await fs.rm(isolatedIos, { recursive: true, force: true });
    await fs.rm(isolatedAndroid, { recursive: true, force: true });
  });
});
