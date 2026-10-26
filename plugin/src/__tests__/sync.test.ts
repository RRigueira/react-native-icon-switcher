import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { XML } from '@expo/config-plugins';

import { run } from '../cli';
import { resolveConfig } from '../core/validate';
import { loadIconSwitcherConfig } from '../load-config';
import { syncProject } from '../sync';
import { renderTypes } from '../transforms/types';

const FIXTURES_ROOT = path.join(__dirname, '../__fixtures__');
const BARE_FIXTURE = path.join(FIXTURES_ROOT, 'bare-project');
const ICONS_FIXTURE = path.join(FIXTURES_ROOT, 'icons');

async function _copyBareProject(): Promise<string> {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ris-bare-'));
  const projectDir = path.join(tmpRoot, 'app');
  await fs.cp(BARE_FIXTURE, projectDir, { recursive: true });
  await fs.cp(ICONS_FIXTURE, path.join(tmpRoot, 'icons'), { recursive: true });
  return projectDir;
}

async function _snapshotMtimes(root: string): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  async function walk(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(abs);
      } else {
        const stat = await fs.stat(abs);
        map.set(abs, stat.mtimeMs);
      }
    }
  }
  await walk(root);
  return map;
}

describe('react-native-icon-switcher sync', () => {
  it('first sync writes expected outputs', async () => {
    const projectDir = await _copyBareProject();
    const code = await run(['sync', '--project-root', projectDir]);
    expect(code).toBe(0);

    const manifest = await fs.readFile(
      path.join(projectDir, 'android/app/src/main/AndroidManifest.xml'),
      'utf8'
    );
    const parsed = await XML.parseXMLAsync(manifest);
    const aliases = parsed.manifest.application?.[0]?.['activity-alias'] ?? [];
    expect(aliases.length).toBeGreaterThan(0);

    const plist = await fs.readFile(
      path.join(projectDir, 'ios/Fixture/Info.plist'),
      'utf8'
    );
    expect(plist).toContain('IconSwitcherIcons');

    const halloweenPng = path.join(
      projectDir,
      'ios/Fixture/Images.xcassets/AppIcon-halloween.appiconset/AppIcon-1024.png'
    );
    await expect(fs.stat(halloweenPng)).resolves.toBeDefined();
    await expect(
      fs.stat(path.join(projectDir, 'icon-switcher.d.ts'))
    ).resolves.toBeDefined();
  });

  it('second sync writes 0 updated files', async () => {
    const projectDir = await _copyBareProject();
    await syncProject({ projectRoot: projectDir, check: false });
    const second = await syncProject({ projectRoot: projectDir, check: false });
    expect(second.updated).toBe(0);
  });

  it('--check exits 0 right after sync', async () => {
    const projectDir = await _copyBareProject();
    await run(['sync', '--project-root', projectDir]);
    const code = await run(['sync', '--check', '--project-root', projectDir]);
    expect(code).toBe(0);
  });

  it('--check exits 1 after deleting a generated PNG', async () => {
    const projectDir = await _copyBareProject();
    await run(['sync', '--project-root', projectDir]);
    const png = path.join(
      projectDir,
      'android/app/src/main/res/mipmap-mdpi/ic_launcher_halloween.png'
    );
    await fs.rm(png);
    const code = await run(['sync', '--check', '--project-root', projectDir]);
    expect(code).toBe(1);
  });

  it('--check exits 1 after hand-editing the manifest', async () => {
    const projectDir = await _copyBareProject();
    await run(['sync', '--project-root', projectDir]);
    const manifestPath = path.join(
      projectDir,
      'android/app/src/main/AndroidManifest.xml'
    );
    const xml = await fs.readFile(manifestPath, 'utf8');
    await fs.writeFile(manifestPath, `${xml}\n`, 'utf8');
    const code = await run(['sync', '--check', '--project-root', projectDir]);
    expect(code).toBe(1);
  });

  it('--check writes nothing', async () => {
    const projectDir = await _copyBareProject();
    await run(['sync', '--project-root', projectDir]);
    const before = await _snapshotMtimes(projectDir);
    const code = await run(['sync', '--check', '--project-root', projectDir]);
    expect(code).toBe(0);
    const after = await _snapshotMtimes(projectDir);
    expect(after).toEqual(before);
  });

  it('honours --config when syncing', async () => {
    const projectDir = await _copyBareProject();
    const custom = path.join(projectDir, 'custom.config.ts');
    await fs.writeFile(
      custom,
      `export default {
        default: '../icons/default.png',
        icons: { halloween: '../icons/halloween.png' },
      };\n`,
      'utf8'
    );
    const code = await run([
      'sync',
      '--project-root',
      projectDir,
      '--config',
      custom,
    ]);
    expect(code).toBe(0);
  });

  it('bad icon name exits 2', async () => {
    const projectDir = await _copyBareProject();
    const configPath = path.join(projectDir, 'icon-switcher.config.ts');
    await fs.writeFile(
      configPath,
      `export default { icons: { BadName: '../icons/halloween.png' } };\n`,
      'utf8'
    );
    const code = await run(['sync', '--project-root', projectDir]);
    expect(code).toBe(2);
  });

  it('icon-switcher.d.ts matches renderTypes', async () => {
    const projectDir = await _copyBareProject();
    await run(['sync', '--project-root', projectDir]);
    const configPath = path.join(projectDir, 'icon-switcher.config.ts');
    const raw = loadIconSwitcherConfig(configPath);
    const resolved = resolveConfig(raw, { projectRoot: projectDir });
    const expected = renderTypes(resolved);
    const actual = await fs.readFile(
      path.join(projectDir, 'icon-switcher.d.ts'),
      'utf8'
    );
    expect(actual).toBe(expected);
  });
});
