import fs from 'fs';
import path from 'path';

import plist from '@expo/plist';

import { __plistPatchTesting, patchInfoPlistText } from '../plist-patch';
import { formatPlistLikeXcode } from '../plist-format';
import { sampleConfig } from '../sampleConfigs';

const customizedPlistPath = path.join(
  __dirname,
  '../../__fixtures__/customized-plist/Info.plist'
);
const twoSpacePlistPath = path.join(
  __dirname,
  '../../__fixtures__/two-space-plist/Info.plist'
);

describe('patchInfoPlistText', () => {
  it('returns original xml when parsed plist already matches applyInfoPlist', () => {
    const alreadyMigrated = `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0">
<dict>
  <key>IconSwitcherIcons</key>
  <array>
    <string>default</string>
    <string>halloween</string>
  </array>
</dict>
</plist>
`;
    expect(patchInfoPlistText(alreadyMigrated, sampleConfig)).toBe(
      alreadyMigrated
    );
  });

  it('returns the original bytes when applyInfoPlist is a no-op', () => {
    const original = fs.readFileSync(twoSpacePlistPath, 'utf8');
    const migrated = patchInfoPlistText(original, sampleConfig);
    expect(patchInfoPlistText(migrated, sampleConfig)).toBe(migrated);
    const customized = fs.readFileSync(customizedPlistPath, 'utf8');
    const once = patchInfoPlistText(customized, sampleConfig);
    const twice = patchInfoPlistText(once, sampleConfig);
    expect(twice).toBe(once);
  });

  it('only adds IconSwitcherIcons lines for a tab-indented plist', () => {
    const original = fs.readFileSync(customizedPlistPath, 'utf8');
    const patched = patchInfoPlistText(original, sampleConfig);
    for (const line of original.split(/\r\n|\n/)) {
      if (line.trim()) {
        expect(patched).toContain(line);
      }
    }
    expect(patched).toContain('\t<key>IconSwitcherIcons</key>');
    expect(patched).toContain('<string>halloween</string>');
  });

  it('updates an existing IconSwitcherIcons block in place', () => {
    const original = fs.readFileSync(customizedPlistPath, 'utf8');
    const withIcons = patchInfoPlistText(original, sampleConfig);
    const trimmed: typeof sampleConfig = {
      ...sampleConfig,
      icons: [sampleConfig.icons[0]],
    };
    const updated = patchInfoPlistText(withIcons, trimmed);
    expect(updated).toContain('<string>default</string>');
    expect(updated).not.toContain('<string>halloween</string>');
    expect(updated).toContain('\t<key>CFBundleDevelopmentRegion</key>');
  });

  it('removes legacy CFBundleIcons blocks from text', () => {
    const original = fs.readFileSync(customizedPlistPath, 'utf8');
    const legacy = original.replace(
      '<key>ExampleEmptyString</key>',
      `<key>CFBundleIcons</key>
	<dict>
		<key>CFBundlePrimaryIcon</key>
		<dict>
			<key>CFBundleIconName</key>
			<string>AppIcon</string>
		</dict>
	</dict>
	<key>ExampleEmptyString</key>`
    );
    const patched = patchInfoPlistText(legacy, sampleConfig);
    expect(patched).not.toContain('<key>CFBundleIcons</key>');
    expect(patched).toContain('IconSwitcherIcons');
  });

  it('uses spaces for indent detection when the plist has no tabs', () => {
    const spaced = `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0">
<dict>
  <key>CFBundleName</key>
  <string>Example</string>
</dict>
</plist>
`;
    const patched = patchInfoPlistText(spaced, sampleConfig);
    expect(patched).toContain('  <key>IconSwitcherIcons</key>');
  });

  it('supports CRLF line endings', () => {
    const crlf = fs
      .readFileSync(customizedPlistPath, 'utf8')
      .replace(/\n/g, '\r\n');
    const patched = patchInfoPlistText(crlf, sampleConfig);
    expect(patched).toContain('\r\n');
    expect(patched).toContain('IconSwitcherIcons');
  });

  it('removes legacy CFBundleIcons~ipad blocks from text', () => {
    const original = fs.readFileSync(customizedPlistPath, 'utf8');
    const legacy = original.replace(
      '<key>ExampleEmptyString</key>',
      `<key>CFBundleIcons~ipad</key>
	<dict>
		<key>CFBundlePrimaryIcon</key>
		<dict>
			<key>CFBundleIconName</key>
			<string>AppIcon</string>
		</dict>
	</dict>
	<key>ExampleEmptyString</key>`
    );
    const patched = patchInfoPlistText(legacy, sampleConfig);
    expect(patched).not.toContain('CFBundleIcons~ipad');
  });

  it('returns the original xml when IconSwitcherIcons is already correct', () => {
    const original = fs.readFileSync(customizedPlistPath, 'utf8');
    const patched = patchInfoPlistText(original, sampleConfig);
    expect(patchInfoPlistText(patched, sampleConfig)).toBe(patched);
  });

  it('uses IconSwitcherIcons array item indent when updating an existing block', () => {
    const spacedIcons = `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0">
<dict>
  <key>IconSwitcherIcons</key>
  <array>
      <string>default</string>
  </array>
</dict>
</plist>
`;
    const patched = patchInfoPlistText(spacedIcons, sampleConfig);
    expect(patched).toContain('      <string>default</string>');
    expect(patched).toContain('      <string>halloween</string>');
  });

  it('removes legacy keys without blank lines and leaves IconSwitcherIcons bytes alone', () => {
    const original = fs.readFileSync(twoSpacePlistPath, 'utf8');
    const iconsBlock = _iconSwitcherIconsBlock(original);
    const patched = patchInfoPlistText(original, sampleConfig);
    expect(patched).not.toContain('CFBundleIcons');
    expect(patched).not.toContain('CFBundleIcons~ipad');
    expect(patched).not.toMatch(/\n\s*\n\s*<\/dict>/);
    expect(_iconSwitcherIconsBlock(patched)).toBe(iconsBlock);
  });

  it('handles plists without a trailing newline', () => {
    const original = fs.readFileSync(customizedPlistPath, 'utf8').trimEnd();
    const patched = patchInfoPlistText(original, sampleConfig);
    expect(patched).toContain('IconSwitcherIcons');
    expect(patchInfoPlistText(patched, sampleConfig)).toBe(patched);
  });

  it('replaces existing application meta-data values in place for manifests via plist icons list', () => {
    const original = fs.readFileSync(customizedPlistPath, 'utf8');
    const once = patchInfoPlistText(original, sampleConfig);
    const stale = once.replace(
      '<string>halloween</string>',
      '<string>stale</string>'
    );
    const patched = patchInfoPlistText(stale, sampleConfig);
    expect(patched).toContain('<string>halloween</string>');
    expect(patched).not.toContain('<string>stale</string>');
  });
});

describe('plist patch helpers', () => {
  it('covers indent, eol, and block removal edge cases', () => {
    expect(__plistPatchTesting.detectEol('a\r\nb')).toBe('\r\n');
    expect(
      __plistPatchTesting.detectPlistIndentation('<dict>\n<key>A</key>', '\n')
        .keyIndent
    ).toBe('\t');
    expect(
      __plistPatchTesting.removePlistKeyBlock(
        '<key>Missing</key>',
        'Nope',
        '\n'
      )
    ).toBe('<key>Missing</key>');
    expect(
      __plistPatchTesting.removePlistKeyBlock(
        '<key>A</key><string>x</string>',
        'A',
        '\n'
      )
    ).toContain('<key>A</key>');
    expect(
      __plistPatchTesting.replacePlistKeyValue(
        '<key>A</key><string>old</string>',
        'B',
        'new',
        '\n'
      )
    ).toBe('<key>A</key><string>old</string>');
    expect(
      __plistPatchTesting.insertBeforeRootDictClose(
        '<plist><dict></dict></plist>',
        'block',
        '\t',
        '\n'
      )
    ).toContain('block');
    expect(
      __plistPatchTesting.insertBeforeRootDictClose(
        'no plist',
        'block',
        '\t',
        '\n'
      )
    ).toBe('no plist');
    const nested = `<plist><dict><dict></dict></dict></plist>`;
    expect(
      __plistPatchTesting.insertBeforeRootDictClose(nested, 'x', '\t', '\n')
    ).toContain('x');
    expect(
      __plistPatchTesting.removePlistKeyBlock(
        '<key>CFBundleIcons</key>\n<dict>\n<key>A</key>\n<dict>\n</dict>\n</dict>',
        'CFBundleIcons',
        '\n'
      )
    ).not.toContain('CFBundleIcons');
    expect(
      __plistPatchTesting.replacePlistKeyValue(
        '<key>IconSwitcherIcons</key><array></array>',
        'IconSwitcherIcons',
        '<key>IconSwitcherIcons</key><array><string>a</string></array>',
        '\n'
      )
    ).toContain('<string>a</string>');
    expect(
      __plistPatchTesting.replacePlistKeyValue(
        '<key>A</key>',
        'A',
        'next',
        '\n'
      )
    ).toBe('<key>A</key>');
    expect(
      __plistPatchTesting.detectPlistIndentation('<dict>\n  <key>A</key>', '\n')
        .indentStep
    ).toBe('  ');
    expect(
      __plistPatchTesting.collapseBlankLinesBeforeDictClose(
        '<dict>\n<key>A</key>\n\n</dict>\n</plist>',
        '\n'
      )
    ).toBe('<dict>\n<key>A</key>\n</dict>\n</plist>');
    expect(
      __plistPatchTesting.readIconSwitcherIconsFromText('<key>Other</key>')
    ).toEqual([]);
    expect(
      __plistPatchTesting.readIconSwitcherIconsFromText(
        '<key>IconSwitcherIcons</key><array></array>'
      )
    ).toEqual([]);
    expect(
      __plistPatchTesting.detectPlistIndentation(
        fs.readFileSync(twoSpacePlistPath, 'utf8'),
        '\n'
      ).indentStep
    ).toBe('  ');
    expect(
      __plistPatchTesting.iconSwitcherArrayItemIndent(
        '<key>IconSwitcherIcons</key><array><string>x</string></array>',
        '\n'
      )
    ).toBeNull();
    expect(
      __plistPatchTesting.removePlistKeyBlock(
        '<key>CFBundleIcons</key><dict><dict></dict>',
        'CFBundleIcons',
        '\n'
      )
    ).toContain('CFBundleIcons');
    expect(
      __plistPatchTesting.detectPlistIndentation(
        '<dict>\n<key>Only</key>\n<string>x</string>',
        '\n'
      ).indentStep
    ).toBe('\t');
    expect(
      __plistPatchTesting.detectPlistIndentation(
        '<plist><dict>\n\t<key>A</key>\n\t<array>\n\t\t<string>x</string>\n\t</array>\n</dict></plist>',
        '\n'
      ).indentStep
    ).toBe('\t');
    expect(
      __plistPatchTesting.removePlistKeyBlock(
        '<key>A</key>\r\n<dict>\r\n</dict>',
        'A',
        '\r\n'
      )
    ).toBe('');
    expect(
      formatPlistLikeXcode(
        '<?xml version="1.0"?>\n<plist version="1.0">\n<dict>\n<key>A</key>\n<dict>\n<key>B</key>\n<string>1</string>\n</dict>\n</dict>\n</plist>'
      )
    ).toContain('\t</dict>');
    expect(
      formatPlistLikeXcode(
        '<?xml version="1.0"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">\n<dict>\n<key>A</key>\n<string>1</string>\n</dict>\n</plist>'
      )
    ).toContain('<!DOCTYPE plist');
    expect(
      __plistPatchTesting.detectPlistIndentation(
        '<plist><dict>\n    <key>IconSwitcherIcons</key>\n    <array>\n        <string>a</string>\n    </array>\n    <key>Other</key>\n</dict></plist>',
        '\n'
      ).indentStep
    ).toBe('    ');
    expect(
      __plistPatchTesting.detectPlistIndentation(
        '<plist><dict>\n    <key>OnlyKey</key>\n    <string>x</string>\n</dict></plist>',
        '\n'
      ).indentStep
    ).toBe('  ');
    expect(
      __plistPatchTesting.iconSwitcherArrayItemIndent(
        '<key>IconSwitcherIcons</key><array></array>',
        '\n'
      )
    ).toBeNull();
    expect(
      __plistPatchTesting.iconSwitcherArrayItemIndent(
        '<key>IconSwitcherIcons</key><string>orphan</string>',
        '\n'
      )
    ).toBeNull();
    expect(
      __plistPatchTesting.readIconSwitcherIconsFromText(
        '<key>IconSwitcherIcons</key><string>not-array</string>'
      )
    ).toEqual([]);
    expect(
      __plistPatchTesting.replacePlistKeyValue(
        '<key>IconSwitcherIcons</key><array><array><string>nested</string></array></array>',
        'IconSwitcherIcons',
        '<key>IconSwitcherIcons</key><array><string>flat</string></array>',
        '\n'
      )
    ).toContain('<string>flat</string>');
    expect(
      __plistPatchTesting.insertBeforeRootDictClose(
        '<plist><dict><key>A</key></plist>',
        'block',
        '  ',
        '\n'
      )
    ).toBe('<plist><dict><key>A</key></plist>');
  });
});

function _iconSwitcherIconsBlock(xml: string): string {
  const start = xml.indexOf('<key>IconSwitcherIcons</key>');
  const end = xml.indexOf('</array>', start);
  if (start === -1 || end === -1) {
    return '';
  }
  return xml.slice(start, end + '</array>'.length);
}

describe('formatPlistLikeXcode', () => {
  it('skips blank lines in plist.build output', () => {
    const built = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>

	<key>A</key>
	<string>1</string>
</dict>
</plist>`;
    expect(formatPlistLikeXcode(built)).not.toContain('\n\n\t<key>');
  });

  it('uses tabs under the root dict and adds a trailing newline', () => {
    const object = { CFBundleName: 'Example', CFBundleVersion: '1' };
    const built = plist.build(object);
    const formatted = formatPlistLikeXcode(built);
    expect(formatted.endsWith('\n')).toBe(true);
    expect(formatted).toContain('<dict>\n\t<key>CFBundleName</key>');
    expect(formatted).toMatch(/^<plist version="1.0">\n<dict>/m);
  });
});
