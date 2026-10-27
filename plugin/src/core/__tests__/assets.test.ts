import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import sharp from 'sharp';

import {
  LEGACY_SHADOW_BLUR_DP,
  LEGACY_SHADOW_OFFSET_Y_DP,
  LEGACY_SHADOW_OPACITY,
  _readCornerRgb,
  planAssets,
  pruneStaleIosAppIconSets,
  writeAssets,
} from '../assets';
import { resolveConfig } from '../validate';

const PROJECT_ROOT = path.join(__dirname, '../../__fixtures__');

async function _readRgba(
  pngPath: string,
  x: number,
  y: number
): Promise<{ r: number; g: number; b: number; a: number }> {
  const { data } = await sharp(pngPath)
    .ensureAlpha()
    .extract({ left: x, top: y, width: 1, height: 1 })
    .raw()
    .toBuffer({ resolveWithObject: true });
  return {
    r: data[0] ?? 0,
    g: data[1] ?? 0,
    b: data[2] ?? 0,
    a: data[3] ?? 255,
  };
}

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
    const corner = await _readRgba(legacy, 0, 0);
    expect(corner.a).toBe(0);
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

  it('legacy adaptive mipmaps match Android Studio geometry at xxxhdpi', async () => {
    const fgPath = path.join(PROJECT_ROOT, 'icons/legacy-geo-fg.png');
    const square = 72;
    const margin = 18;
    const layer = margin * 2 + square;
    await sharp({
      create: {
        width: layer,
        height: layer,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .composite([
        {
          input: await sharp({
            create: {
              width: square,
              height: square,
              channels: 4,
              background: { r: 255, g: 0, b: 0, alpha: 255 },
            },
          })
            .png()
            .toBuffer(),
          left: margin,
          top: margin,
        },
      ])
      .png()
      .toFile(fgPath);

    const resolved = resolveConfig(
      {
        default: {
          android: {
            foreground: 'icons/legacy-geo-fg.png',
            background: '#00FF00',
          },
        },
        icons: { halloween: 'icons/halloween.png' },
      },
      { projectRoot: PROJECT_ROOT }
    );
    const isolatedAndroid = await fs.mkdtemp(
      path.join(os.tmpdir(), 'aik-legacy-geo-')
    );
    const plan = planAssets(resolved, PROJECT_ROOT);
    await writeAssets(plan, {
      iosAssetCatalog: tmpIos,
      androidResDir: isolatedAndroid,
    });

    const squarePng = path.join(
      isolatedAndroid,
      'mipmap-xxxhdpi/ic_launcher.png'
    );
    const roundPng = path.join(
      isolatedAndroid,
      'mipmap-xxxhdpi/ic_launcher_round.png'
    );

    expect((await _readRgba(squarePng, 10, 10)).a).toBe(0);
    expect((await _readRgba(squarePng, 30, 30)).a).toBeGreaterThan(200);
    expect((await _readRgba(roundPng, 5, 5)).a).toBe(0);

    const insideSquare = await _readRgba(squarePng, 100, 100);
    expect(insideSquare.a).toBeGreaterThan(200);
    expect(insideSquare.r).toBeGreaterThan(insideSquare.g);

    const belowShape = await _readRgba(squarePng, 96, 175);
    expect(belowShape.a).toBeGreaterThan(0);
    expect(belowShape.a).toBeLessThan(120);

    await fs.rm(fgPath, { force: true });
    await fs.rm(isolatedAndroid, { recursive: true, force: true });
  });

  it('legacy adaptive mipmaps scale geometry at mdpi', async () => {
    const resolved = resolveConfig(
      {
        default: {
          android: {
            foreground: 'icons/default.png',
            background: '#112233',
          },
        },
        icons: { halloween: 'icons/halloween.png' },
      },
      { projectRoot: PROJECT_ROOT }
    );
    const isolatedAndroid = await fs.mkdtemp(
      path.join(os.tmpdir(), 'aik-legacy-mdpi-')
    );
    const plan = planAssets(resolved, PROJECT_ROOT);
    await writeAssets(plan, {
      iosAssetCatalog: tmpIos,
      androidResDir: isolatedAndroid,
    });
    const mdpi = path.join(isolatedAndroid, 'mipmap-mdpi/ic_launcher.png');
    expect((await sharp(mdpi).metadata()).width).toBe(48);
    expect((await _readRgba(mdpi, 2, 2)).a).toBe(0);
    expect((await _readRgba(mdpi, 8, 8)).a).toBeGreaterThan(200);
    await fs.rm(isolatedAndroid, { recursive: true, force: true });
  });

  it('plain legacy path uses full image inside the studio shape', async () => {
    const isolatedAndroid = await fs.mkdtemp(
      path.join(os.tmpdir(), 'aik-legacy-plain-')
    );
    const plan = planAssets(_resolved(), PROJECT_ROOT);
    await writeAssets(plan, {
      iosAssetCatalog: tmpIos,
      androidResDir: isolatedAndroid,
    });
    const png = path.join(
      isolatedAndroid,
      'mipmap-xxxhdpi/ic_launcher_halloween.png'
    );
    expect((await _readRgba(png, 10, 10)).a).toBe(0);
    expect((await _readRgba(png, 100, 100)).a).toBeGreaterThan(200);
    await fs.rm(isolatedAndroid, { recursive: true, force: true });
  });

  it('documents legacy shadow constants for regression tests', () => {
    expect(LEGACY_SHADOW_OFFSET_Y_DP).toBe(0.75);
    expect(LEGACY_SHADOW_BLUR_DP).toBe(1);
    expect(LEGACY_SHADOW_OPACITY).toBe(0.25);
  });

  it('prunes stale files from managed appiconset folders only', async () => {
    const isolatedIos = await fs.mkdtemp(path.join(os.tmpdir(), 'aik-prune-'));
    const defaultSet = path.join(isolatedIos, 'AppIcon.appiconset');
    const devSet = path.join(isolatedIos, 'AppIcon.dev.appiconset');
    await fs.mkdir(defaultSet, { recursive: true });
    await fs.mkdir(devSet, { recursive: true });
    await fs.writeFile(path.join(defaultSet, 'icon-20.png'), 'stale');
    await fs.writeFile(path.join(defaultSet, 'icon-1024.png'), 'stale');
    await fs.writeFile(path.join(devSet, 'extra.png'), 'keep');

    const plan = planAssets(_resolved(), PROJECT_ROOT);
    await writeAssets(plan, {
      iosAssetCatalog: isolatedIos,
      androidResDir: tmpAndroid,
    });
    const removed = await pruneStaleIosAppIconSets(isolatedIos, plan, {
      check: false,
    });
    expect(removed.map((p) => path.basename(p)).sort()).toEqual([
      'icon-1024.png',
      'icon-20.png',
    ]);
    const defaultFiles = await fs.readdir(defaultSet);
    expect(defaultFiles.sort()).toEqual(['AppIcon-1024.png', 'Contents.json']);
    await expect(
      fs.stat(path.join(devSet, 'extra.png'))
    ).resolves.toBeDefined();
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
