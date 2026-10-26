import fs from 'node:fs';
import path from 'node:path';

import { ConfigError } from './errors';
import type {
  AndroidAdaptiveIcon,
  IconSwitcherConfig,
  HexColor,
  IconSource,
  ImagePath,
  IosIconVariants,
  ResolvedConfig,
  ResolvedIcon,
} from '../types';

const ICON_NAME_RE = /^[a-z][a-z0-9_]*$/;
const HEX_COLOR_RE = /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/;
const RESERVED_ANDROID_NAMES = new Set([
  'round',
  'foreground',
  'background',
  'monochrome',
]);
const RESERVED_ANDROID_SUFFIXES = [
  '_round',
  '_foreground',
  '_background',
  '_monochrome',
] as const;

export interface ResolveConfigContext {
  projectRoot: string;
  expoDefault?: IconSource;
}

function _isHexColor(value: string): boolean {
  return HEX_COLOR_RE.test(value);
}

function _normalizeIos(
  ios: ImagePath | IosIconVariants | undefined
): IosIconVariants | null {
  if (ios === undefined) {
    return null;
  }
  if (typeof ios === 'string') {
    return { light: ios };
  }
  return ios;
}

function _normalizeAndroid(
  android: ImagePath | AndroidAdaptiveIcon | undefined
): AndroidAdaptiveIcon | { legacy: ImagePath } | null {
  if (android === undefined) {
    return null;
  }
  if (typeof android === 'string') {
    return { legacy: android };
  }
  return android;
}

function _splitIconSource(source: IconSource): {
  ios: IosIconVariants | null;
  android: AndroidAdaptiveIcon | { legacy: ImagePath } | null;
} {
  if (typeof source === 'string') {
    return {
      ios: { light: source },
      android: { legacy: source },
    };
  }
  return {
    ios: _normalizeIos(source.ios),
    android: _normalizeAndroid(source.android),
  };
}

function _resolvedImagePath(projectRoot: string, rel: string): string {
  return path.resolve(projectRoot, rel);
}

function _imagePathsEqual(projectRoot: string, a: string, b: string): boolean {
  return (
    _resolvedImagePath(projectRoot, a) === _resolvedImagePath(projectRoot, b)
  );
}

function _comparableDefaultPaths(source: IconSource): {
  ios?: string;
  android?: string;
} {
  const { ios, android } = _splitIconSource(source);
  const out: { ios?: string; android?: string } = {};
  if (ios) {
    out.ios = ios.light;
  }
  if (android) {
    out.android = 'legacy' in android ? android.legacy : android.foreground;
  }
  return out;
}

function _validateDefaultMatchesExpo(
  problems: string[],
  projectRoot: string,
  cfgDefault: IconSource,
  expoDefault: IconSource
): void {
  const cfgPaths = _comparableDefaultPaths(cfgDefault);
  const expoPaths = _comparableDefaultPaths(expoDefault);

  if (expoPaths.ios !== undefined && cfgPaths.ios !== undefined) {
    if (!_imagePathsEqual(projectRoot, cfgPaths.ios, expoPaths.ios)) {
      problems.push(
        `Default icon iOS path conflicts: icon-switcher config has "${cfgPaths.ios}", Expo \`icon\` has "${expoPaths.ios}" — remove one or point both at the same file`
      );
    }
  }
  if (expoPaths.android !== undefined && cfgPaths.android !== undefined) {
    if (!_imagePathsEqual(projectRoot, cfgPaths.android, expoPaths.android)) {
      problems.push(
        `Default icon Android path conflicts: icon-switcher config has "${cfgPaths.android}", Expo \`icon\` / \`android.adaptiveIcon\` has "${expoPaths.android}" — remove one or point both at the same file`
      );
    }
  }
}

function _validateAndroidResourceName(problems: string[], name: string): void {
  if (RESERVED_ANDROID_NAMES.has(name)) {
    problems.push(
      `Invalid icon name "${name}": reserved for Android mipmap resources (see Android resource naming rules)`
    );
    return;
  }
  for (const suffix of RESERVED_ANDROID_SUFFIXES) {
    if (name.endsWith(suffix)) {
      problems.push(
        `Invalid icon name "${name}": must not end with "${suffix}" (reserved for Android mipmap resources)`
      );
      return;
    }
  }
}

function _collectPathsFromIos(
  ios: IosIconVariants | null,
  out: string[]
): void {
  if (!ios) {
    return;
  }
  out.push(ios.light);
  if (ios.dark) {
    out.push(ios.dark);
  }
  if (ios.tinted) {
    out.push(ios.tinted);
  }
}

function _collectPathsFromAndroid(
  android: AndroidAdaptiveIcon | { legacy: ImagePath } | null,
  out: string[]
): void {
  if (!android) {
    return;
  }
  if ('legacy' in android) {
    out.push(android.legacy);
    return;
  }
  out.push(android.foreground);
  if (
    typeof android.background === 'string' &&
    !android.background.startsWith('#')
  ) {
    out.push(android.background);
  }
  if (android.monochrome) {
    out.push(android.monochrome);
  }
}

function _validateHexField(
  problems: string[],
  value: string | undefined,
  label: string
): HexColor | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!_isHexColor(value)) {
    problems.push(
      `${label} must be a hex colour (#RGB or #RRGGBB), got "${value}"`
    );
    return undefined;
  }
  return value;
}

function _validateFile(
  problems: string[],
  projectRoot: string,
  rel: string
): void {
  const abs = path.join(projectRoot, rel);
  if (!fs.existsSync(abs)) {
    problems.push(`Missing image file: ${rel}`);
  }
}

export function resolveConfig(
  cfg: IconSwitcherConfig,
  ctx: ResolveConfigContext
): ResolvedConfig {
  const problems: string[] = [];

  if (Object.keys(cfg.icons).length === 0) {
    problems.push('At least one alternate icon must be declared in `icons`');
  }

  for (const name of Object.keys(cfg.icons)) {
    if (name === 'default') {
      problems.push(
        '`default` is reserved and cannot be used as an alternate icon name'
      );
      continue;
    }
    if (!ICON_NAME_RE.test(name)) {
      problems.push(
        `Invalid icon name "${name}": must match /^[a-z][a-z0-9_]*$/`
      );
    }
    _validateAndroidResourceName(problems, name);
  }

  const flattenOn =
    _validateHexField(problems, cfg.ios?.flattenOn, 'ios.flattenOn') ??
    '#FFFFFF';

  const applyOn = cfg.android?.applyOn ?? 'background';
  if (applyOn !== 'background' && applyOn !== 'immediate') {
    problems.push(
      `android.applyOn must be "background" or "immediate", got "${applyOn}"`
    );
  }

  const skipBrands = (cfg.android?.skipBrands ?? []).map((b) =>
    b.toLowerCase()
  );

  const expoOwnsDefault = ctx.expoDefault !== undefined;
  if (cfg.default !== undefined && ctx.expoDefault !== undefined) {
    _validateDefaultMatchesExpo(
      problems,
      ctx.projectRoot,
      cfg.default,
      ctx.expoDefault
    );
  }

  const icons: ResolvedIcon[] = [];

  const defaultSplit =
    !expoOwnsDefault && cfg.default !== undefined
      ? _splitIconSource(cfg.default)
      : { ios: null as IosIconVariants | null, android: null };

  icons.push({
    name: 'default',
    isDefault: true,
    ios: defaultSplit.ios,
    android: defaultSplit.android,
  });

  for (const name of Object.keys(cfg.icons)) {
    const source = cfg.icons[name];
    if (source === undefined) {
      continue;
    }
    const split = _splitIconSource(source);
    icons.push({
      name,
      isDefault: false,
      ios: split.ios,
      android: split.android,
    });
  }

  const paths: string[] = [];
  for (const icon of icons) {
    _collectPathsFromIos(icon.ios, paths);
    _collectPathsFromAndroid(icon.android, paths);
  }
  const uniquePaths = [...new Set(paths)];
  for (const rel of uniquePaths) {
    if (rel.startsWith('#')) {
      continue;
    }
    _validateFile(problems, ctx.projectRoot, rel);
  }

  for (const icon of icons) {
    const android = icon.android;
    if (!android || 'legacy' in android) {
      continue;
    }
    if (
      typeof android.background === 'string' &&
      android.background.startsWith('#')
    ) {
      if (!_isHexColor(android.background)) {
        problems.push(
          `icons.${icon.name}.android.background must be a hex colour or image path`
        );
      }
    }
  }

  if (problems.length > 0) {
    throw new ConfigError(problems.map((p) => `- ${p}`).join('\n'));
  }

  return {
    icons,
    ios: { flattenOn },
    android: {
      applyOn: applyOn as 'background' | 'immediate',
      skipBrands,
    },
  };
}
