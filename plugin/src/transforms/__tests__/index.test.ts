import * as transformsIndex from '../index';

const {
  applyAndroidManifest,
  patchAndroidManifestText,
  applyInfoPlist,
  applyXcodeProject,
  formatPlistLikeXcode,
  patchInfoPlistText,
  renderTypes,
  TransformError,
} = transformsIndex;

describe('transforms index exports', () => {
  it('re-exports the public transform surface', () => {
    expect(typeof applyAndroidManifest).toBe('function');
    expect(typeof patchAndroidManifestText).toBe('function');
    expect(typeof applyInfoPlist).toBe('function');
    expect(typeof applyXcodeProject).toBe('function');
    expect(typeof formatPlistLikeXcode).toBe('function');
    expect(typeof patchInfoPlistText).toBe('function');
    expect(typeof renderTypes).toBe('function');
    expect(TransformError).toBeDefined();
  });
});
