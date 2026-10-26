import fs from 'node:fs';
import path from 'node:path';

import xcode from 'xcode';

const APP_PRODUCT_TYPE = 'com.apple.product-type.application';

const EXCLUDED_PRODUCT_TYPES = new Set([
  'com.apple.product-type.app-extension',
  'com.apple.product-type.bundle.unit-test',
  'com.apple.product-type.bundle.ui-testing',
]);

export interface NativeProjectPaths {
  projectRoot: string;
  iosDir: string;
  xcodeprojPath: string;
  pbxprojPath: string;
  infoPlistPath: string;
  iosAssetCatalog: string;
  manifestPath: string;
  androidResDir: string;
}

export class ProjectLayoutError extends Error {
  readonly name = 'ProjectLayoutError';

  constructor(message: string) {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

function _unquote(value: string): string {
  return value.replace(/^"/, '').replace(/"$/, '');
}

function _findAppTarget(project: xcode.XcodeProject): {
  uuid: string;
  name: string;
} {
  const nativeTargets = project.pbxNativeTargetSection();
  const targetRefs = project.getFirstProject().firstProject.targets;
  const matches: { uuid: string; name: string }[] = [];

  for (const ref of targetRefs) {
    const uuid = ref.value;
    const native = nativeTargets[uuid];
    if (!native || uuid.endsWith('_comment')) {
      continue;
    }
    const productType = _unquote(String(native.productType ?? ''));
    if (EXCLUDED_PRODUCT_TYPES.has(productType)) {
      continue;
    }
    if (productType === APP_PRODUCT_TYPE) {
      matches.push({ uuid, name: String(native.name) });
    }
  }

  if (matches.length === 0) {
    throw new ProjectLayoutError(
      'Could not find an iOS application target (non-test, non-extension) in the Xcode project'
    );
  }
  if (matches.length > 1) {
    throw new ProjectLayoutError(
      `Found multiple iOS application targets (${matches.map((m) => m.name).join(', ')}); leave only one app target`
    );
  }
  return matches[0]!;
}

function _infoPlistRelativePath(
  project: xcode.XcodeProject,
  targetUuid: string
): string {
  const native = project.pbxNativeTargetSection()[targetUuid];
  if (!native) {
    throw new ProjectLayoutError('Could not read the iOS app target');
  }
  const configListUuid = native.buildConfigurationList;
  const lists = project.pbxXCConfigurationList();
  const list = lists[configListUuid];
  if (!list?.buildConfigurations?.length) {
    throw new ProjectLayoutError(
      'Could not read build configurations for the iOS app target'
    );
  }
  const firstConfig = list.buildConfigurations[0];
  if (!firstConfig) {
    throw new ProjectLayoutError(
      'Could not read build configurations for the iOS app target'
    );
  }
  const configUuid = firstConfig.value;
  const section = project.pbxXCBuildConfigurationSection();
  const config = section[configUuid];
  const infoPlist = config?.buildSettings?.INFOPLIST_FILE;
  if (infoPlist === undefined || infoPlist === '') {
    throw new ProjectLayoutError(
      'INFOPLIST_FILE is not set on the iOS app target build configuration'
    );
  }
  return _unquote(String(infoPlist));
}

function _locateXcodeproj(iosDir: string): string {
  const entries = fs.readdirSync(iosDir);
  const projects = entries
    .filter((name) => name.endsWith('.xcodeproj'))
    .map((name) => path.join(iosDir, name));

  if (projects.length === 0) {
    throw new ProjectLayoutError(
      `Could not find ios/*.xcodeproj under ${iosDir}`
    );
  }

  const withAppTarget: string[] = [];
  for (const xcodeprojPath of projects) {
    const pbxprojPath = path.join(xcodeprojPath, 'project.pbxproj');
    if (!fs.existsSync(pbxprojPath)) {
      continue;
    }
    const project = xcode.project(pbxprojPath);
    project.parseSync();
    try {
      _findAppTarget(project);
      withAppTarget.push(xcodeprojPath);
    } catch (err) {
      if (err instanceof ProjectLayoutError) {
        continue;
      }
      throw err;
    }
  }

  if (withAppTarget.length === 0) {
    throw new ProjectLayoutError(
      `Could not find ios/*.xcodeproj with an application target under ${iosDir}`
    );
  }
  if (withAppTarget.length > 1) {
    throw new ProjectLayoutError(
      `Found multiple Xcode projects with app targets: ${withAppTarget.map((p) => path.basename(p)).join(', ')}`
    );
  }
  return withAppTarget[0]!;
}

export function locateNativePaths(projectRoot: string): NativeProjectPaths {
  const iosDir = path.join(projectRoot, 'ios');
  if (!fs.existsSync(iosDir)) {
    throw new ProjectLayoutError(`Missing iOS directory at ${iosDir}`);
  }

  const xcodeprojPath = _locateXcodeproj(iosDir);
  const pbxprojPath = path.join(xcodeprojPath, 'project.pbxproj');
  const project = xcode.project(pbxprojPath);
  project.parseSync();
  const appTarget = _findAppTarget(project);
  const infoPlistRel = _infoPlistRelativePath(project, appTarget.uuid);
  const infoPlistPath = path.join(iosDir, infoPlistRel);
  if (!fs.existsSync(infoPlistPath)) {
    throw new ProjectLayoutError(`Missing Info.plist at ${infoPlistPath}`);
  }

  const appSourceDir = path.dirname(infoPlistPath);
  const iosAssetCatalog = path.join(appSourceDir, 'Images.xcassets');
  if (!fs.existsSync(iosAssetCatalog)) {
    throw new ProjectLayoutError(
      `Missing Images.xcassets at ${iosAssetCatalog}`
    );
  }

  const manifestPath = path.join(
    projectRoot,
    'android',
    'app',
    'src',
    'main',
    'AndroidManifest.xml'
  );
  if (!fs.existsSync(manifestPath)) {
    throw new ProjectLayoutError(
      `Missing AndroidManifest.xml at ${manifestPath}`
    );
  }

  const androidResDir = path.join(
    projectRoot,
    'android',
    'app',
    'src',
    'main',
    'res'
  );
  if (!fs.existsSync(androidResDir)) {
    throw new ProjectLayoutError(
      `Missing Android res directory at ${androidResDir}`
    );
  }

  return {
    projectRoot,
    iosDir,
    xcodeprojPath,
    pbxprojPath,
    infoPlistPath,
    iosAssetCatalog,
    manifestPath,
    androidResDir,
  };
}
