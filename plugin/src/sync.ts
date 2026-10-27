import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import xcode from 'xcode';

import {
  planAssets,
  pngsMatchWithinTolerance,
  pruneStaleIosAppIconSets,
  writeAssets,
} from './core/assets';
import type { ResolvedConfig } from './types';
import { resolveConfig } from './core/validate';
import { patchAndroidManifestText } from './transforms/android-text';
import { applyXcodeProject } from './transforms/ios';
import { patchInfoPlistText } from './transforms/plist-patch';
import { renderTypes } from './transforms/types';
import { loadIconSwitcherConfig, resolveConfigPath } from './load-config';
import { locateNativePaths } from './paths';

export { ProjectLayoutError } from './paths';

export interface SyncOptions {
  projectRoot: string;
  configPath?: string;
  check: boolean;
}

export interface SyncResult {
  updated: number;
  unchanged: number;
  driftedPaths: string[];
}

async function _readFileIfExists(abs: string): Promise<Buffer | null> {
  try {
    return await fs.readFile(abs);
  } catch {
    return null;
  }
}

function _rel(projectRoot: string, abs: string): string {
  return path.relative(projectRoot, abs).split(path.sep).join('/');
}

async function _applyFileChange(
  _projectRoot: string,
  abs: string,
  next: Buffer | string,
  check: boolean
): Promise<'updated' | 'unchanged'> {
  const nextBuf = typeof next === 'string' ? Buffer.from(next, 'utf8') : next;
  const existing = await _readFileIfExists(abs);
  if (existing !== null && existing.equals(nextBuf)) {
    return 'unchanged';
  }
  // Keep a generated image that only differs by resampling rounding (for
  // example made on another CPU), so --check passes and nothing is rewritten.
  if (
    existing !== null &&
    (await pngsMatchWithinTolerance(existing, nextBuf))
  ) {
    return 'unchanged';
  }
  if (check) {
    return 'updated';
  }
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, nextBuf);
  return 'updated';
}

function _recordOutcome(
  projectRoot: string,
  abs: string,
  outcome: 'updated' | 'unchanged',
  driftedPaths: string[]
): 'updated' | 'unchanged' {
  if (outcome === 'updated') {
    driftedPaths.push(_rel(projectRoot, abs));
    return 'updated';
  }
  return 'unchanged';
}

async function _syncAssets(
  resolved: ResolvedConfig,
  projectRoot: string,
  iosAssetCatalog: string,
  androidResDir: string,
  check: boolean,
  driftedPaths: string[]
): Promise<{ updated: number; unchanged: number }> {
  const plan = planAssets(resolved, projectRoot);
  const tmpRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'icon-switcher-sync-')
  );
  const tmpIos = path.join(tmpRoot, 'ios');
  const tmpAndroid = path.join(tmpRoot, 'android');

  let updated = 0;
  let unchanged = 0;

  try {
    await writeAssets(plan, {
      iosAssetCatalog: tmpIos,
      androidResDir: tmpAndroid,
    });

    for (const asset of plan.assets) {
      const isIos = asset.relativePath.includes('.appiconset');
      const targetAbs = path.join(
        isIos ? iosAssetCatalog : androidResDir,
        asset.relativePath
      );
      const stagedAbs = path.join(
        isIos ? tmpIos : tmpAndroid,
        asset.relativePath
      );
      const staged = await fs.readFile(stagedAbs);
      const outcome = await _applyFileChange(
        projectRoot,
        targetAbs,
        staged,
        check
      );
      if (
        _recordOutcome(projectRoot, targetAbs, outcome, driftedPaths) ===
        'updated'
      ) {
        updated += 1;
      } else {
        unchanged += 1;
      }
    }

    const staleIos = await pruneStaleIosAppIconSets(iosAssetCatalog, plan, {
      check,
    });
    for (const abs of staleIos) {
      driftedPaths.push(_rel(projectRoot, abs));
      updated += 1;
    }
  } finally {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  }

  return { updated, unchanged };
}

async function _syncAndroidManifest(
  resolved: ResolvedConfig,
  manifestPath: string,
  projectRoot: string,
  check: boolean,
  driftedPaths: string[]
): Promise<'updated' | 'unchanged'> {
  const xml = await fs.readFile(manifestPath, 'utf8');
  const nextXml = patchAndroidManifestText(xml, resolved);
  const outcome = await _applyFileChange(
    projectRoot,
    manifestPath,
    nextXml,
    check
  );
  return _recordOutcome(projectRoot, manifestPath, outcome, driftedPaths);
}

async function _syncInfoPlist(
  resolved: ResolvedConfig,
  infoPlistPath: string,
  projectRoot: string,
  check: boolean,
  driftedPaths: string[]
): Promise<'updated' | 'unchanged'> {
  const raw = await fs.readFile(infoPlistPath, 'utf8');
  const nextXml = patchInfoPlistText(raw, resolved);
  const outcome = await _applyFileChange(
    projectRoot,
    infoPlistPath,
    nextXml,
    check
  );
  return _recordOutcome(projectRoot, infoPlistPath, outcome, driftedPaths);
}

async function _syncXcodeProject(
  resolved: ResolvedConfig,
  pbxprojPath: string,
  projectRoot: string,
  check: boolean,
  driftedPaths: string[]
): Promise<'updated' | 'unchanged'> {
  const project = xcode.project(pbxprojPath);
  project.parseSync();
  applyXcodeProject(project, resolved);
  const nextContent = project.writeSync();
  const outcome = await _applyFileChange(
    projectRoot,
    pbxprojPath,
    nextContent,
    check
  );
  return _recordOutcome(projectRoot, pbxprojPath, outcome, driftedPaths);
}

async function _syncTypes(
  resolved: ResolvedConfig,
  projectRoot: string,
  check: boolean,
  driftedPaths: string[]
): Promise<'updated' | 'unchanged'> {
  const typesPath = path.join(projectRoot, 'icon-switcher.d.ts');
  const content = renderTypes(resolved);
  const outcome = await _applyFileChange(
    projectRoot,
    typesPath,
    content,
    check
  );
  return _recordOutcome(projectRoot, typesPath, outcome, driftedPaths);
}

export async function syncProject(opts: SyncOptions): Promise<SyncResult> {
  const projectRoot = path.resolve(opts.projectRoot);
  const configPath = resolveConfigPath(projectRoot, opts.configPath);
  const rawConfig = loadIconSwitcherConfig(configPath);
  const resolved = resolveConfig(rawConfig, { projectRoot });
  const paths = locateNativePaths(projectRoot);

  const driftedPaths: string[] = [];
  let updated = 0;
  let unchanged = 0;

  const assets = await _syncAssets(
    resolved,
    projectRoot,
    paths.iosAssetCatalog,
    paths.androidResDir,
    opts.check,
    driftedPaths
  );
  updated += assets.updated;
  unchanged += assets.unchanged;

  const nativeFiles: { abs: string; outcome: 'updated' | 'unchanged' }[] = [
    {
      abs: paths.manifestPath,
      outcome: await _syncAndroidManifest(
        resolved,
        paths.manifestPath,
        projectRoot,
        opts.check,
        driftedPaths
      ),
    },
    {
      abs: paths.infoPlistPath,
      outcome: await _syncInfoPlist(
        resolved,
        paths.infoPlistPath,
        projectRoot,
        opts.check,
        driftedPaths
      ),
    },
    {
      abs: paths.pbxprojPath,
      outcome: await _syncXcodeProject(
        resolved,
        paths.pbxprojPath,
        projectRoot,
        opts.check,
        driftedPaths
      ),
    },
    {
      abs: path.join(projectRoot, 'icon-switcher.d.ts'),
      outcome: await _syncTypes(
        resolved,
        projectRoot,
        opts.check,
        driftedPaths
      ),
    },
  ];

  for (const file of nativeFiles) {
    if (file.outcome === 'updated') {
      updated += 1;
    } else {
      unchanged += 1;
    }
  }

  return { updated, unchanged, driftedPaths: [...new Set(driftedPaths)] };
}
