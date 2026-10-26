import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { loadIconSwitcherConfig, resolveConfigPath } from '../load-config';
import { ProjectLayoutError } from '../paths';

async function _tmpdir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'ris-config-'));
}

describe('resolveConfigPath', () => {
  it('resolves an explicit relative path under projectRoot', async () => {
    const root = await _tmpdir();
    const custom = path.join(root, 'nested', 'mine.config.js');
    await fs.mkdir(path.dirname(custom), { recursive: true });
    await fs.writeFile(custom, 'export default {};\n', 'utf8');

    expect(resolveConfigPath(root, 'nested/mine.config.js')).toBe(custom);
  });

  it('accepts an absolute explicit path', async () => {
    const root = await _tmpdir();
    const abs = path.join(root, 'abs.config.mjs');
    await fs.writeFile(abs, 'export default {};\n', 'utf8');
    expect(resolveConfigPath(root, abs)).toBe(abs);
  });

  it('throws when an explicit config file is missing', async () => {
    const root = await _tmpdir();
    expect(() => resolveConfigPath(root, 'missing.ts')).toThrow(
      ProjectLayoutError
    );
  });

  it('prefers icon-switcher.config.js over later candidates', async () => {
    const root = await _tmpdir();
    await fs.writeFile(
      path.join(root, 'icon-switcher.config.cjs'),
      'module.exports = {};\n',
      'utf8'
    );
    await fs.writeFile(
      path.join(root, 'icon-switcher.config.js'),
      'module.exports = {};\n',
      'utf8'
    );
    expect(resolveConfigPath(root)).toBe(
      path.join(root, 'icon-switcher.config.js')
    );
  });

  it('throws when no config file exists', async () => {
    const root = await _tmpdir();
    expect(() => resolveConfigPath(root)).toThrow(
      /Could not find icon-switcher/
    );
  });
});

describe('loadIconSwitcherConfig', () => {
  it('loads default export from .mjs config', async () => {
    const root = await _tmpdir();
    const configPath = path.join(root, 'icon-switcher.config.mjs');
    await fs.writeFile(
      configPath,
      `export default { icons: { spooky: './x.png' } };\n`,
      'utf8'
    );
    const cfg = loadIconSwitcherConfig(configPath);
    expect(cfg.icons).toEqual({ spooky: './x.png' });
  });

  it('loads module.exports from .cjs config', async () => {
    const root = await _tmpdir();
    const configPath = path.join(root, 'icon-switcher.config.cjs');
    await fs.writeFile(
      configPath,
      `module.exports = { icons: { winter: './y.png' } };\n`,
      'utf8'
    );
    const cfg = loadIconSwitcherConfig(configPath);
    expect(cfg.icons).toEqual({ winter: './y.png' });
  });

  it('rejects configs that do not export an object', async () => {
    const root = await _tmpdir();
    const configPath = path.join(root, 'icon-switcher.config.js');
    await fs.writeFile(configPath, `module.exports = null;\n`, 'utf8');
    expect(() => loadIconSwitcherConfig(configPath)).toThrow(
      /must export a default object/
    );
  });
});
