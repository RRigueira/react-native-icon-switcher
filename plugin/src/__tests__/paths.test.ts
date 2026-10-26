import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { locateNativePaths } from '../paths';

const BARE_FIXTURE = path.join(__dirname, '../__fixtures__/bare-project');
const PBX_FIXTURE = path.join(
  __dirname,
  '../__fixtures__/bare-project/ios/Fixture.xcodeproj/project.pbxproj'
);

async function _copyBare(): Promise<string> {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'ris-paths-'));
  const projectDir = path.join(tmp, 'app');
  await fs.cp(BARE_FIXTURE, projectDir, { recursive: true });
  return projectDir;
}

describe('locateNativePaths', () => {
  it('resolves paths for a standard bare React Native layout', async () => {
    const projectDir = await _copyBare();
    const paths = locateNativePaths(projectDir);
    expect(paths.infoPlistPath).toContain('Fixture/Info.plist');
    expect(paths.iosAssetCatalog).toContain('Images.xcassets');
    expect(paths.manifestPath).toContain('AndroidManifest.xml');
    expect(paths.androidResDir).toContain('/res');
  });

  it('throws when the ios directory is missing', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ris-no-ios-'));
    await expect(() => locateNativePaths(root)).toThrow(
      /Missing iOS directory/
    );
  });

  it('throws when no xcodeproj exists', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ris-no-xcode-'));
    await fs.mkdir(path.join(root, 'ios'), { recursive: true });
    await expect(() => locateNativePaths(root)).toThrow(
      /Could not find ios\/\*\.xcodeproj/
    );
  });

  it('throws when Info.plist is missing on disk', async () => {
    const projectDir = await _copyBare();
    await fs.rm(path.join(projectDir, 'ios/Fixture/Info.plist'));
    await expect(() => locateNativePaths(projectDir)).toThrow(
      /Missing Info\.plist/
    );
  });

  it('throws when Images.xcassets is missing', async () => {
    const projectDir = await _copyBare();
    await fs.rm(path.join(projectDir, 'ios/Fixture/Images.xcassets'), {
      recursive: true,
      force: true,
    });
    await expect(() => locateNativePaths(projectDir)).toThrow(
      /Missing Images\.xcassets/
    );
  });

  it('throws when INFOPLIST_FILE is missing from build settings', async () => {
    const projectDir = await _copyBare();
    const pbxPath = path.join(
      projectDir,
      'ios/Fixture.xcodeproj/project.pbxproj'
    );
    let text = await fs.readFile(pbxPath, 'utf8');
    text = text.replace(/INFOPLIST_FILE = [^;]+;/g, '');
    await fs.writeFile(pbxPath, text, 'utf8');
    await expect(() => locateNativePaths(projectDir)).toThrow(
      /INFOPLIST_FILE is not set/
    );
  });

  it('throws when Android res directory is missing', async () => {
    const projectDir = await _copyBare();
    await fs.rm(path.join(projectDir, 'android/app/src/main/res'), {
      recursive: true,
      force: true,
    });
    await expect(() => locateNativePaths(projectDir)).toThrow(
      /Missing Android res directory/
    );
  });

  it('throws when AndroidManifest.xml is missing', async () => {
    const projectDir = await _copyBare();
    await fs.rm(
      path.join(projectDir, 'android/app/src/main/AndroidManifest.xml')
    );
    await expect(() => locateNativePaths(projectDir)).toThrow(
      /Missing AndroidManifest\.xml/
    );
  });

  it('skips xcodeproj folders without an application target', async () => {
    const projectDir = await _copyBare();
    const extOnlyDir = path.join(projectDir, 'ios/ExtensionOnly.xcodeproj');
    await fs.mkdir(extOnlyDir, { recursive: true });
    const extPbx = await fs.readFile(PBX_FIXTURE, 'utf8');
    const extensionOnly = extPbx.replace(
      /productType = "com\.apple\.product-type\.application";/g,
      'productType = "com.apple.product-type.app-extension";'
    );
    await fs.writeFile(
      path.join(extOnlyDir, 'project.pbxproj'),
      extensionOnly,
      'utf8'
    );
    const paths = locateNativePaths(projectDir);
    expect(paths.xcodeprojPath).toContain('Fixture.xcodeproj');
  });

  it('throws when two xcodeproj folders both have app targets', async () => {
    const projectDir = await _copyBare();
    const second = path.join(projectDir, 'ios/Second.xcodeproj');
    await fs.cp(path.join(projectDir, 'ios/Fixture.xcodeproj'), second, {
      recursive: true,
    });
    await expect(() => locateNativePaths(projectDir)).toThrow(
      /multiple Xcode projects with app targets/
    );
  });
});
