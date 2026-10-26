import fs from 'node:fs';
import path from 'node:path';

import { createJiti } from 'jiti';

import type { IconSwitcherConfig } from './types';
import { ProjectLayoutError } from './paths';

const CONFIG_CANDIDATES = [
  'icon-switcher.config.ts',
  'icon-switcher.config.js',
  'icon-switcher.config.mjs',
  'icon-switcher.config.cjs',
] as const;

export function resolveConfigPath(
  projectRoot: string,
  explicit?: string
): string {
  if (explicit) {
    const abs = path.isAbsolute(explicit)
      ? explicit
      : path.join(projectRoot, explicit);
    if (!fs.existsSync(abs)) {
      throw new ProjectLayoutError(`Config file not found at ${abs}`);
    }
    return abs;
  }

  for (const name of CONFIG_CANDIDATES) {
    const candidate = path.join(projectRoot, name);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  throw new ProjectLayoutError(
    `Could not find icon-switcher.config.{ts,js,mjs,cjs} in ${projectRoot}`
  );
}

export function loadIconSwitcherConfig(configPath: string): IconSwitcherConfig {
  const load = createJiti(configPath, { interopDefault: true });
  const loaded: unknown = load(configPath);
  let cfg: unknown =
    loaded &&
    typeof loaded === 'object' &&
    loaded !== null &&
    'default' in loaded &&
    (loaded as { default: unknown }).default !== undefined
      ? (loaded as { default: unknown }).default
      : loaded;
  if (!cfg || typeof cfg !== 'object') {
    throw new ProjectLayoutError(
      `Config at ${configPath} must export a default object`
    );
  }
  return cfg as IconSwitcherConfig;
}
