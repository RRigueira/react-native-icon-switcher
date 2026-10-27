import fs from 'fs';
import os from 'os';
import path from 'path';

import { compileModsAsync, withPlugins } from '@expo/config-plugins';

import { __setGetIosSourceRootForTests } from '../index';

const BARE_FIXTURE = path.join(__dirname, '../__fixtures__/bare-project');
const ICONS_FIXTURE = path.join(__dirname, '../__fixtures__/icons');

jest.mock('../core/assets', () => ({
  planAssets: jest.fn(() => ({ assets: [] })),
  writeAssets: jest.fn(async () => []),
  pruneStaleIosAppIconSets: jest.fn(async () => []),
}));

describe('withIconSwitcher platform mods (integration)', () => {
  it('runs Info.plist and Xcode project mods on iOS', async () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ris-ios-mods-'));
    fs.cpSync(BARE_FIXTURE, projectRoot, { recursive: true });
    fs.cpSync(ICONS_FIXTURE, path.join(path.dirname(projectRoot), 'icons'), {
      recursive: true,
    });

    const withIconSwitcher = require('../index').default;
    const config = withPlugins(
      {
        name: 'test',
        slug: 'test',
        version: '1.0.0',
        _internal: { projectRoot, isDebug: false },
      },
      [
        [
          withIconSwitcher,
          {
            default: '../icons/default.png',
            icons: { halloween: '../icons/halloween.png' },
          },
        ],
      ]
    );

    await compileModsAsync(config, {
      projectRoot,
      platforms: ['ios'],
      introspect: true,
    });
  });

  it('runs the iOS dangerous mod when Images.xcassets is present', async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ris-ios-danger-'));
    const projectRoot = path.join(tmpRoot, 'app');
    fs.cpSync(BARE_FIXTURE, projectRoot, { recursive: true });
    fs.cpSync(ICONS_FIXTURE, path.join(tmpRoot, 'icons'), { recursive: true });

    __setGetIosSourceRootForTests(() => path.join(projectRoot, 'ios/Fixture'));

    const withIconSwitcher = require('../index').default;
    const config = withPlugins(
      {
        name: 'test',
        slug: 'test',
        version: '1.0.0',
        _internal: { projectRoot, isDebug: false },
      },
      [
        [
          withIconSwitcher,
          {
            default: '../icons/default.png',
            icons: { halloween: '../icons/halloween.png' },
          },
        ],
      ]
    );

    await compileModsAsync(config, { projectRoot, platforms: ['ios'] });
    __setGetIosSourceRootForTests(undefined);
  });

  it('fails the iOS dangerous mod when Images.xcassets is missing', async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ris-ios-miss-'));
    const projectRoot = path.join(tmpRoot, 'app');
    fs.mkdirSync(projectRoot, { recursive: true });
    fs.cpSync(ICONS_FIXTURE, path.join(projectRoot, 'icons'), {
      recursive: true,
    });
    __setGetIosSourceRootForTests(() => projectRoot);

    const withIconSwitcher = require('../index').default;
    const config = withPlugins(
      {
        name: 'test',
        slug: 'test',
        version: '1.0.0',
        _internal: { projectRoot, isDebug: false },
      },
      [
        [
          withIconSwitcher,
          {
            default: 'icons/default.png',
            icons: { halloween: 'icons/halloween.png' },
          },
        ],
      ]
    );

    await expect(
      compileModsAsync(config, { projectRoot, platforms: ['ios'] })
    ).rejects.toThrow(/Could not find Images\.xcassets/);
    __setGetIosSourceRootForTests(undefined);
  });
});
