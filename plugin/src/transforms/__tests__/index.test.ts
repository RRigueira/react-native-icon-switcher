import * as transformsIndex from '../index';

const {
  applyAndroidManifest,
  applyInfoPlist,
  applyXcodeProject,
  renderTypes,
  TransformError,
} = transformsIndex;

describe('transforms index exports', () => {
  it('re-exports the public transform surface', () => {
    expect(typeof applyAndroidManifest).toBe('function');
    expect(typeof applyInfoPlist).toBe('function');
    expect(typeof applyXcodeProject).toBe('function');
    expect(typeof renderTypes).toBe('function');
    expect(TransformError).toBeDefined();
  });
});
