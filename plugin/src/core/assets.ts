import crypto from 'node:crypto';
import type { Dirent } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

import sharp from 'sharp';

import type { HexColor, ResolvedConfig, ResolvedIcon } from '../types';

const LEGACY_DENSITIES: { folder: string; size: number }[] = [
  { folder: 'mipmap-mdpi', size: 48 },
  { folder: 'mipmap-hdpi', size: 72 },
  { folder: 'mipmap-xhdpi', size: 96 },
  { folder: 'mipmap-xxhdpi', size: 144 },
  { folder: 'mipmap-xxxhdpi', size: 192 },
];

const ADAPTIVE_DENSITIES: { folder: string; size: number }[] = [
  { folder: 'mipmap-mdpi', size: 108 },
  { folder: 'mipmap-hdpi', size: 162 },
  { folder: 'mipmap-xhdpi', size: 216 },
  { folder: 'mipmap-xxhdpi', size: 324 },
  { folder: 'mipmap-xxxhdpi', size: 432 },
];

const PNG_OPTIONS = { compressionLevel: 9, adaptiveFiltering: false } as const;

/** Legacy launcher canvas (API 24–25), matching Android Studio Image Asset at 48 dp. */
const LEGACY_CANVAS_DP = 48;
const LEGACY_SQUARE_INSET_DP = 5;
const LEGACY_SQUARE_BODY_DP = 38;
const LEGACY_SQUARE_RADIUS_DP = 3;
const LEGACY_ROUND_INSET_DP = 2;
const LEGACY_ROUND_DIAMETER_DP = 44;
const ADAPTIVE_LAYER_DP = 108;
const ADAPTIVE_VIEWPORT_DP = 72;
/** Drop shadow tuned to match Image Asset exports at xxxhdpi. */
export const LEGACY_SHADOW_OFFSET_Y_DP = 0.75;
export const LEGACY_SHADOW_BLUR_DP = 1;
export const LEGACY_SHADOW_OPACITY = 0.25;
/**
 * Largest per-channel difference at which two PNGs still count as the same
 * image. libvips resampling rounds slightly differently on arm64 and x86, so
 * icons generated on a Mac and re-generated in Linux CI can differ by a level
 * or two without any visible change.
 */
export const PNG_PIXEL_TOLERANCE = 3;

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

/** True when both buffers are PNGs of the same size whose pixels differ by at most `PNG_PIXEL_TOLERANCE`. */
export async function pngsMatchWithinTolerance(
  a: Buffer,
  b: Buffer
): Promise<boolean> {
  if (
    !a.subarray(0, 8).equals(PNG_SIGNATURE) ||
    !b.subarray(0, 8).equals(PNG_SIGNATURE)
  ) {
    return false;
  }
  const [left, right] = await Promise.all(
    [a, b].map((buf) =>
      sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    )
  );
  if (
    left!.info.width !== right!.info.width ||
    left!.info.height !== right!.info.height
  ) {
    return false;
  }
  for (let i = 0; i < left!.data.length; i += 1) {
    if (Math.abs(left!.data[i]! - right!.data[i]!) > PNG_PIXEL_TOLERANCE) {
      return false;
    }
  }
  return true;
}

export type IosVariant = 'light' | 'dark' | 'tinted';

export type AssetJob =
  | {
      kind: 'ios-png';
      iconName: string;
      isDefault: boolean;
      variant: IosVariant;
      sourcePath: string;
      flattenOn: HexColor;
      width: number;
      height: number;
    }
  | {
      kind: 'ios-contents';
      iconName: string;
      isDefault: boolean;
      variants: IosVariant[];
    }
  | {
      kind: 'android-legacy';
      iconName: string;
      isDefault: boolean;
      round: boolean;
      sourcePath: string;
      density: string;
      size: number;
      backgroundColor?: HexColor;
      backgroundImagePath?: string;
    }
  | {
      kind: 'android-adaptive-foreground';
      iconName: string;
      isDefault: boolean;
      sourcePath: string;
      density: string;
      size: number;
    }
  | {
      kind: 'android-adaptive-background-image';
      iconName: string;
      isDefault: boolean;
      sourcePath: string;
      density: string;
      size: number;
    }
  | {
      kind: 'android-adaptive-xml';
      iconName: string;
      isDefault: boolean;
      round: boolean;
      backgroundIsColor: boolean;
      hasMonochrome: boolean;
    }
  | {
      kind: 'android-colors-xml';
      entries: { resourceName: string; color: HexColor }[];
    };

export interface PlannedAsset {
  /** Path relative to `iosAssetCatalog` or `androidResDir`. */
  relativePath: string;
  job: AssetJob;
}

export interface AssetPlan {
  projectRoot: string;
  flattenOn: HexColor;
  assets: PlannedAsset[];
}

export interface WrittenFile {
  relativePath: string;
  absolutePath: string;
  sha256: string;
}

function _iosSetFolder(icon: ResolvedIcon): string {
  return icon.isDefault
    ? 'AppIcon.appiconset'
    : `AppIcon-${icon.name}.appiconset`;
}

function _androidBaseName(icon: ResolvedIcon): string {
  return icon.isDefault ? 'ic_launcher' : `ic_launcher_${icon.name}`;
}

function _colorResourceName(icon: ResolvedIcon): string {
  return icon.isDefault
    ? 'icon_switcher_default_background'
    : `icon_switcher_${icon.name}_background`;
}

function _iosVariants(
  icon: ResolvedIcon
): { variant: IosVariant; source: string }[] {
  if (!icon.ios) {
    return [];
  }
  const out: { variant: IosVariant; source: string }[] = [
    { variant: 'light', source: icon.ios.light },
  ];
  if (icon.ios.dark) {
    out.push({ variant: 'dark', source: icon.ios.dark });
  }
  if (icon.ios.tinted) {
    out.push({ variant: 'tinted', source: icon.ios.tinted });
  }
  return out;
}

function _legacySource(icon: ResolvedIcon): string | null {
  const android = icon.android;
  if (!android) {
    return null;
  }
  if ('legacy' in android) {
    return android.legacy;
  }
  return null;
}

function _hasAdaptive(icon: ResolvedIcon): boolean {
  const android = icon.android;
  return android !== null && !('legacy' in android);
}

export function planAssets(
  cfg: ResolvedConfig,
  projectRoot: string
): AssetPlan {
  const assets: PlannedAsset[] = [];
  const colorEntries: { resourceName: string; color: HexColor }[] = [];

  for (const icon of cfg.icons) {
    const setFolder = _iosSetFolder(icon);
    const iosVariants = _iosVariants(icon);
    if (iosVariants.length > 0) {
      for (const { variant, source } of iosVariants) {
        const filename =
          variant === 'light'
            ? 'AppIcon-1024.png'
            : `AppIcon-1024-${variant}.png`;
        assets.push({
          relativePath: path.join(setFolder, filename),
          job: {
            kind: 'ios-png',
            iconName: icon.name,
            isDefault: icon.isDefault,
            variant,
            sourcePath: source,
            flattenOn: cfg.ios.flattenOn,
            width: 1024,
            height: 1024,
          },
        });
      }
      assets.push({
        relativePath: path.join(setFolder, 'Contents.json'),
        job: {
          kind: 'ios-contents',
          iconName: icon.name,
          isDefault: icon.isDefault,
          variants: iosVariants.map((v) => v.variant),
        },
      });
    }

    const legacySource = _legacySource(icon);
    if (legacySource) {
      const base = _androidBaseName(icon);
      for (const { folder, size } of LEGACY_DENSITIES) {
        for (const round of [false, true]) {
          assets.push({
            relativePath: path.join(
              folder,
              `${base}${round ? '_round' : ''}.png`
            ),
            job: {
              kind: 'android-legacy',
              iconName: icon.name,
              isDefault: icon.isDefault,
              round,
              sourcePath: legacySource,
              density: folder,
              size,
            },
          });
        }
      }
    }

    if (_hasAdaptive(icon)) {
      const android = icon.android as Exclude<
        ResolvedIcon['android'],
        null | { legacy: string }
      >;
      const base = _androidBaseName(icon);
      const backgroundIsColor =
        typeof android.background === 'string' &&
        android.background.startsWith('#');
      const backgroundImagePath =
        typeof android.background === 'string' &&
        !android.background.startsWith('#')
          ? android.background
          : undefined;

      for (const { folder, size } of LEGACY_DENSITIES) {
        for (const round of [false, true]) {
          assets.push({
            relativePath: path.join(
              folder,
              `${base}${round ? '_round' : ''}.png`
            ),
            job: {
              kind: 'android-legacy',
              iconName: icon.name,
              isDefault: icon.isDefault,
              round,
              sourcePath: android.foreground,
              density: folder,
              size,
              backgroundColor: backgroundIsColor
                ? (android.background as HexColor)
                : undefined,
              backgroundImagePath,
            },
          });
        }
      }

      for (const { folder, size } of ADAPTIVE_DENSITIES) {
        assets.push({
          relativePath: path.join(folder, `${base}_foreground.png`),
          job: {
            kind: 'android-adaptive-foreground',
            iconName: icon.name,
            isDefault: icon.isDefault,
            sourcePath: android.foreground,
            density: folder,
            size,
          },
        });
        if (
          typeof android.background === 'string' &&
          !android.background.startsWith('#')
        ) {
          assets.push({
            relativePath: path.join(folder, `${base}_background.png`),
            job: {
              kind: 'android-adaptive-background-image',
              iconName: icon.name,
              isDefault: icon.isDefault,
              sourcePath: android.background,
              density: folder,
              size,
            },
          });
        }
        if (android.monochrome) {
          assets.push({
            relativePath: path.join(folder, `${base}_monochrome.png`),
            job: {
              kind: 'android-adaptive-foreground',
              iconName: icon.name,
              isDefault: icon.isDefault,
              sourcePath: android.monochrome,
              density: folder,
              size,
            },
          });
        }
      }

      if (backgroundIsColor) {
        colorEntries.push({
          resourceName: _colorResourceName(icon),
          color: android.background as HexColor,
        });
      }

      for (const round of [false, true]) {
        assets.push({
          relativePath: path.join(
            'mipmap-anydpi-v26',
            `${base}${round ? '_round' : ''}.xml`
          ),
          job: {
            kind: 'android-adaptive-xml',
            iconName: icon.name,
            isDefault: icon.isDefault,
            round,
            backgroundIsColor,
            hasMonochrome: Boolean(android.monochrome),
          },
        });
      }
    }
  }

  if (colorEntries.length > 0) {
    const unique = new Map<string, HexColor>();
    for (const e of colorEntries) {
      unique.set(e.resourceName, e.color);
    }
    assets.push({
      relativePath: path.join('values', 'icon_switcher_colors.xml'),
      job: {
        kind: 'android-colors-xml',
        entries: [...unique.entries()].map(([resourceName, color]) => ({
          resourceName,
          color,
        })),
      },
    });
  }

  return {
    projectRoot,
    flattenOn: cfg.ios.flattenOn,
    assets,
  };
}

function _hexToRgb(hex: HexColor): { r: number; g: number; b: number } {
  let normalized = hex.slice(1);
  if (normalized.length === 3) {
    normalized = normalized
      .split('')
      .map((c) => c + c)
      .join('');
  }
  const num = Number.parseInt(normalized, 16);
  return {
    r: (num >> 16) & 0xff,
    g: (num >> 8) & 0xff,
    b: num & 0xff,
  };
}

async function _flattenPng(
  sourceAbs: string,
  flattenOn: HexColor,
  width: number,
  height: number
): Promise<Buffer> {
  const { r, g, b } = _hexToRgb(flattenOn);
  const background = await sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r, g, b },
    },
  })
    .png(PNG_OPTIONS)
    .toBuffer();

  const resized = await sharp(sourceAbs)
    .resize(width, height, {
      fit: 'contain',
      background: { r, g, b, alpha: 0 },
    })
    .png()
    .toBuffer();

  return sharp(background)
    .composite([{ input: resized, blend: 'over' }])
    .removeAlpha()
    .png(PNG_OPTIONS)
    .toBuffer();
}

function _legacyDpToPx(dp: number, canvasPx: number): number {
  return Math.round((dp * canvasPx) / LEGACY_CANVAS_DP);
}

function _legacyShapeLayout(
  canvasPx: number,
  round: boolean
): { inset: number; bodyPx: number; radiusPx: number } {
  if (round) {
    const inset = _legacyDpToPx(LEGACY_ROUND_INSET_DP, canvasPx);
    const bodyPx = _legacyDpToPx(LEGACY_ROUND_DIAMETER_DP, canvasPx);
    return { inset, bodyPx, radiusPx: bodyPx / 2 };
  }
  return {
    inset: _legacyDpToPx(LEGACY_SQUARE_INSET_DP, canvasPx),
    bodyPx: _legacyDpToPx(LEGACY_SQUARE_BODY_DP, canvasPx),
    radiusPx: _legacyDpToPx(LEGACY_SQUARE_RADIUS_DP, canvasPx),
  };
}

function _legacyShapeMaskSvg(
  bodyPx: number,
  round: boolean,
  radiusPx: number
): Buffer {
  if (round) {
    const r = bodyPx / 2;
    return Buffer.from(
      `<svg width="${bodyPx}" height="${bodyPx}"><circle cx="${r}" cy="${r}" r="${r}" fill="white"/></svg>`
    );
  }
  return Buffer.from(
    `<svg width="${bodyPx}" height="${bodyPx}"><rect width="${bodyPx}" height="${bodyPx}" rx="${radiusPx}" ry="${radiusPx}" fill="white"/></svg>`
  );
}

async function _legacyMaskedContent(
  content: Buffer,
  bodyPx: number,
  round: boolean,
  radiusPx: number
): Promise<Buffer> {
  const mask = _legacyShapeMaskSvg(bodyPx, round, radiusPx);
  return sharp(content)
    .resize(bodyPx, bodyPx, { fit: 'cover' })
    .ensureAlpha()
    .composite([{ input: mask, blend: 'dest-in' }])
    .png()
    .toBuffer();
}

function _boxBlurLine(
  src: Uint8Array,
  size: number,
  radius: number,
  horizontal: boolean
): Uint8Array {
  const out = new Uint8Array(src.length);
  const window = radius * 2 + 1;
  for (let line = 0; line < size; line += 1) {
    const at = (i: number) => (horizontal ? line * size + i : i * size + line);
    let sum = 0;
    for (let i = -radius; i <= radius; i += 1) {
      if (i >= 0 && i < size) {
        sum += src[at(i)]!;
      }
    }
    for (let i = 0; i < size; i += 1) {
      out[at(i)] = Math.floor(sum / window);
      const leaving = i - radius;
      const entering = i + radius + 1;
      if (leaving >= 0) {
        sum -= src[at(leaving)]!;
      }
      if (entering < size) {
        sum += src[at(entering)]!;
      }
    }
  }
  return out;
}

/**
 * Black drop shadow of the shape on a transparent canvas. The blur is done in
 * integer arithmetic here rather than with an SVG filter: librsvg's float blur
 * produced different bytes on macOS and Linux, which broke `sync --check` in CI.
 */
async function _legacyShadowLayer(
  canvasPx: number,
  shapeMarkup: string,
  offsetY: number,
  blurPx: number
): Promise<Buffer> {
  const shapeSvg = Buffer.from(
    `<svg width="${canvasPx}" height="${canvasPx}" xmlns="http://www.w3.org/2000/svg">${shapeMarkup}</svg>`
  );
  const shape = await sharp(shapeSvg)
    .ensureAlpha()
    .extractChannel(3)
    .raw()
    .toBuffer();

  // Three box-blur passes approximate a Gaussian.
  const radius = Math.max(1, Math.round(blurPx / 2));
  let alpha: Uint8Array = Uint8Array.from(shape);
  for (let pass = 0; pass < 3; pass += 1) {
    alpha = _boxBlurLine(alpha, canvasPx, radius, true);
    alpha = _boxBlurLine(alpha, canvasPx, radius, false);
  }

  const opacity256 = Math.round(LEGACY_SHADOW_OPACITY * 256);
  const rgba = Buffer.alloc(canvasPx * canvasPx * 4);
  for (let y = 0; y < canvasPx; y += 1) {
    const sourceY = y - offsetY;
    if (sourceY < 0 || sourceY >= canvasPx) {
      continue;
    }
    for (let x = 0; x < canvasPx; x += 1) {
      const a = alpha[sourceY * canvasPx + x]!;
      rgba[(y * canvasPx + x) * 4 + 3] = Math.floor((a * opacity256) / 256);
    }
  }

  return sharp(rgba, {
    raw: { width: canvasPx, height: canvasPx, channels: 4 },
  })
    .png()
    .toBuffer();
}

async function _legacyStudioPng(
  content: Buffer,
  canvasPx: number,
  round: boolean
): Promise<Buffer> {
  const { inset, bodyPx, radiusPx } = _legacyShapeLayout(canvasPx, round);
  const masked = await _legacyMaskedContent(content, bodyPx, round, radiusPx);
  const shadowOffsetY = _legacyDpToPx(LEGACY_SHADOW_OFFSET_Y_DP, canvasPx);
  const blurPx = Math.max(1, _legacyDpToPx(LEGACY_SHADOW_BLUR_DP, canvasPx));
  const cx = inset + bodyPx / 2;
  const cy = inset + bodyPx / 2;
  const shapeMarkup = round
    ? `<circle cx="${cx}" cy="${cy}" r="${bodyPx / 2}" fill="#000"/>`
    : `<rect x="${inset}" y="${inset}" width="${bodyPx}" height="${bodyPx}" rx="${radiusPx}" ry="${radiusPx}" fill="#000"/>`;
  const shadowLayer = await _legacyShadowLayer(
    canvasPx,
    shapeMarkup,
    shadowOffsetY,
    blurPx
  );

  return sharp(shadowLayer)
    .composite([{ input: masked, left: inset, top: inset, blend: 'over' }])
    .png(PNG_OPTIONS)
    .toBuffer();
}

async function _adaptiveLayerComposite(
  foregroundAbs: string,
  layerPx: number,
  background: { color: HexColor } | { imageAbs: string }
): Promise<Buffer> {
  let base: Buffer;
  if ('color' in background) {
    const { r, g, b } = _hexToRgb(background.color);
    base = await sharp({
      create: {
        width: layerPx,
        height: layerPx,
        channels: 4,
        background: { r, g, b, alpha: 255 },
      },
    })
      .png()
      .toBuffer();
  } else {
    base = await sharp(background.imageAbs)
      .resize(layerPx, layerPx, { fit: 'cover' })
      .png()
      .toBuffer();
  }

  const foreground = await sharp(foregroundAbs)
    .resize(layerPx, layerPx, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();

  const cropPx = Math.round(
    (layerPx * ADAPTIVE_VIEWPORT_DP) / ADAPTIVE_LAYER_DP
  );
  const cropInset = Math.round((layerPx - cropPx) / 2);
  const composed = await sharp(base)
    .composite([{ input: foreground, blend: 'over' }])
    .png()
    .toBuffer();
  return sharp(composed)
    .extract({
      left: cropInset,
      top: cropInset,
      width: cropPx,
      height: cropPx,
    })
    .png()
    .toBuffer();
}

async function _legacyPng(
  sourceAbs: string,
  size: number,
  round: boolean
): Promise<Buffer> {
  const content = await sharp(sourceAbs).ensureAlpha().png().toBuffer();
  return _legacyStudioPng(content, size, round);
}

async function _legacyCompositePng(
  foregroundAbs: string,
  size: number,
  round: boolean,
  background: { color: HexColor } | { imageAbs: string }
): Promise<Buffer> {
  const layerPx = Math.round((size * ADAPTIVE_LAYER_DP) / LEGACY_CANVAS_DP);
  const viewport = await _adaptiveLayerComposite(
    foregroundAbs,
    layerPx,
    background
  );
  return _legacyStudioPng(viewport, size, round);
}

async function _resizePng(sourceAbs: string, size: number): Promise<Buffer> {
  return sharp(sourceAbs)
    .resize(size, size, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png(PNG_OPTIONS)
    .toBuffer();
}

function _iosContentsJson(variants: IosVariant[]): string {
  const images = variants.map((variant) => {
    const base = {
      idiom: 'universal',
      platform: 'ios',
      size: '1024x1024',
    };
    const filename =
      variant === 'light' ? 'AppIcon-1024.png' : `AppIcon-1024-${variant}.png`;
    if (variant === 'light') {
      return { ...base, filename };
    }
    const appearanceValue = variant === 'dark' ? 'dark' : 'tinted';
    return {
      ...base,
      filename,
      appearances: [{ appearance: 'luminosity', value: appearanceValue }],
    };
  });

  return `${JSON.stringify(
    {
      images,
      info: { version: 1, author: 'xcode' },
    },
    null,
    2
  )}\n`;
}

function _adaptiveXml(
  base: string,
  backgroundIsColor: boolean,
  colorResource: string,
  hasMonochrome: boolean
): string {
  const backgroundRef = backgroundIsColor
    ? `@color/${colorResource}`
    : `@mipmap/${base}_background`;
  const lines = [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">',
    `    <background android:drawable="${backgroundRef}" />`,
    `    <foreground android:drawable="@mipmap/${base}_foreground" />`,
  ];
  if (hasMonochrome) {
    lines.push(
      `    <monochrome android:drawable="@mipmap/${base}_monochrome" />`
    );
  }
  lines.push('</adaptive-icon>', '');
  return lines.join('\n');
}

function _colorsXml(
  entries: { resourceName: string; color: HexColor }[]
): string {
  const lines = ['<?xml version="1.0" encoding="utf-8"?>', '<resources>'];
  for (const { resourceName, color } of entries) {
    lines.push(`    <color name="${resourceName}">${color}</color>`);
  }
  lines.push('</resources>', '');
  return lines.join('\n');
}

async function _writeBuffer(abs: string, data: Buffer): Promise<string> {
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, data);
  return crypto.createHash('sha256').update(data).digest('hex');
}

async function _writeText(abs: string, text: string): Promise<string> {
  const data = Buffer.from(text, 'utf8');
  return _writeBuffer(abs, data);
}

async function _renderJob(
  plan: AssetPlan,
  job: AssetJob
): Promise<Buffer | string> {
  const root = plan.projectRoot;
  switch (job.kind) {
    case 'ios-png':
      return _flattenPng(
        path.join(root, job.sourcePath),
        job.flattenOn,
        job.width,
        job.height
      );
    case 'ios-contents':
      return _iosContentsJson(job.variants);
    case 'android-legacy': {
      const foregroundAbs = path.join(root, job.sourcePath);
      if (job.backgroundColor !== undefined) {
        return _legacyCompositePng(foregroundAbs, job.size, job.round, {
          color: job.backgroundColor,
        });
      }
      if (job.backgroundImagePath !== undefined) {
        return _legacyCompositePng(foregroundAbs, job.size, job.round, {
          imageAbs: path.join(root, job.backgroundImagePath),
        });
      }
      return _legacyPng(foregroundAbs, job.size, job.round);
    }
    case 'android-adaptive-foreground':
    case 'android-adaptive-background-image':
      return _resizePng(path.join(root, job.sourcePath), job.size);
    case 'android-adaptive-xml': {
      const base = job.isDefault
        ? 'ic_launcher'
        : `ic_launcher_${job.iconName}`;
      const colorResource = job.isDefault
        ? 'icon_switcher_default_background'
        : `icon_switcher_${job.iconName}_background`;
      return _adaptiveXml(
        base,
        job.backgroundIsColor,
        colorResource,
        job.hasMonochrome
      );
    }
    case 'android-colors-xml':
      return _colorsXml(job.entries);
    default: {
      const _exhaustive: never = job;
      return _exhaustive;
    }
  }
}

export async function writeAssets(
  plan: AssetPlan,
  opts: { iosAssetCatalog: string; androidResDir: string }
): Promise<WrittenFile[]> {
  const written: WrittenFile[] = [];

  for (const asset of plan.assets) {
    const isIos = asset.relativePath.includes('.appiconset');
    const baseDir = isIos ? opts.iosAssetCatalog : opts.androidResDir;
    const absolutePath = path.join(baseDir, asset.relativePath);
    const payload = await _renderJob(plan, asset.job);
    const sha256 =
      typeof payload === 'string'
        ? await _writeText(absolutePath, payload)
        : await _writeBuffer(absolutePath, payload);
    written.push({
      relativePath: asset.relativePath,
      absolutePath,
      sha256,
    });
  }

  return written;
}

function _iosFilenamesForContentsJob(job: {
  kind: 'ios-contents';
  variants: IosVariant[];
}): Set<string> {
  const keep = new Set<string>(['Contents.json']);
  for (const variant of job.variants) {
    keep.add(
      variant === 'light' ? 'AppIcon-1024.png' : `AppIcon-1024-${variant}.png`
    );
  }
  return keep;
}

/**
 * Remove unreferenced files from managed `.appiconset` folders in `plan`.
 * Returns absolute paths of stale files (removed or that would be removed in check mode).
 */
export async function pruneStaleIosAppIconSets(
  iosAssetCatalog: string,
  plan: AssetPlan,
  opts: { check: boolean }
): Promise<string[]> {
  const staleAbs: string[] = [];

  for (const asset of plan.assets) {
    if (asset.job.kind !== 'ios-contents') {
      continue;
    }
    const setRel = path.dirname(asset.relativePath);
    const setDir = path.join(iosAssetCatalog, setRel);
    const keep = _iosFilenamesForContentsJob(asset.job);

    let entries: Dirent[];
    try {
      entries = await fs.readdir(setDir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const name = entry.name;
      // Only plain files are ours to remove; leave folders and links alone.
      if (!entry.isFile() || keep.has(name)) {
        continue;
      }
      const abs = path.join(setDir, name);
      staleAbs.push(abs);
      if (!opts.check) {
        await fs.unlink(abs);
      }
    }
  }

  return staleAbs;
}

/** Test helper: corner pixel RGB after iOS flatten (alpha removed). */
export async function _readCornerRgb(
  pngPath: string
): Promise<{ r: number; g: number; b: number }> {
  const { data } = await sharp(pngPath)
    .extract({ left: 0, top: 0, width: 1, height: 1 })
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { r: data[0] ?? 0, g: data[1] ?? 0, b: data[2] ?? 0 };
}
