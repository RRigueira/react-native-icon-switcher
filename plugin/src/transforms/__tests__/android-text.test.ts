import fs from 'fs';
import path from 'path';

import { AndroidConfig, XML } from '@expo/config-plugins';

import { applyAndroidManifest } from '../android';
import {
  __androidTextTesting,
  __detectApplicationIndentationForTests,
  __parseManifestStructureForTests,
  patchAndroidManifestText,
} from '../android-text';
import { TransformError } from '../errors';
import type { ResolvedConfig } from '../../types';
import { halloweenOnlyConfig, sampleConfig } from '../sampleConfigs';

const manifestFixturesDir = path.join(
  __dirname,
  '../../__fixtures__/manifests'
);
const customizedManifestPath = path.join(
  __dirname,
  '../../__fixtures__/customized-manifest/AndroidManifest.xml'
);
const twoSpaceManifestPath = path.join(
  __dirname,
  '../../__fixtures__/two-space-manifest/AndroidManifest.xml'
);
const fourSpaceManifestPath = path.join(
  __dirname,
  '../../__fixtures__/four-space-manifest/AndroidManifest.xml'
);

function listManifestFixtures(): string[] {
  return fs
    .readdirSync(manifestFixturesDir)
    .filter((name) => name.endsWith('.xml'))
    .map((name) => path.join(manifestFixturesDir, name));
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function normalizeApplicationSiblings(
  manifest: AndroidConfig.Manifest.AndroidManifest
): AndroidConfig.Manifest.AndroidManifest {
  const next = deepClone(manifest);
  const application = next.manifest.application?.[0];
  if (!application) {
    return next;
  }
  const aliases = application['activity-alias'] ?? [];
  aliases.sort((a, b) =>
    String(a.$?.['android:name']).localeCompare(String(b.$?.['android:name']))
  );
  application['activity-alias'] = aliases;
  const meta = application['meta-data'] ?? [];
  meta.sort((a, b) =>
    String(a.$?.['android:name']).localeCompare(String(b.$?.['android:name']))
  );
  application['meta-data'] = meta;
  return next;
}

describe('android text patch helpers', () => {
  it('covers internal indent and self-closing helpers', () => {
    expect(
      __androidTextTesting.mapIndexThroughRemovals(10, [{ start: 0, end: 2 }])
    ).toBe(8);
    expect(__androidTextTesting.selfClosingForAttributeValue('x', '/>')).toBe(
      '/>'
    );
    expect(__androidTextTesting.selfClosingForAttributeValue('', '/>')).toBe(
      ' />'
    );
    expect(__androidTextTesting.detectSelfClosingSuffix('<x a="1"/>')).toBe(
      '/>'
    );
    expect(__androidTextTesting.detectSelfClosingSuffix('<x a="1" />')).toBe(
      ' />'
    );
    expect(__androidTextTesting.joinNonEmptyLines(['a', '  ', 'b'], '\n')).toBe(
      'a\nb'
    );
  });
});

describe('patchAndroidManifestText', () => {
  it('matches applyAndroidManifest semantics for stock fixtures', async () => {
    for (const fixturePath of listManifestFixtures()) {
      const xml = await fs.promises.readFile(fixturePath, 'utf8');
      const patched = patchAndroidManifestText(xml, sampleConfig);
      const parsedOriginal = await XML.parseXMLAsync(xml);
      const expected = applyAndroidManifest(parsedOriginal, sampleConfig);
      const parsedPatched = await XML.parseXMLAsync(patched);
      expect(normalizeApplicationSiblings(parsedPatched)).toEqual(
        normalizeApplicationSiblings(expected)
      );
    }
  });

  it('is byte-identical on a second patch', async () => {
    const xml = await fs.promises.readFile(listManifestFixtures()[0], 'utf8');
    const once = patchAndroidManifestText(xml, sampleConfig);
    const twice = patchAndroidManifestText(once, sampleConfig);
    expect(twice).toBe(once);
  });

  it('preserves comments and formatting outside edited regions', () => {
    const original = fs.readFileSync(customizedManifestPath, 'utf8');
    const patched = patchAndroidManifestText(original, sampleConfig);
    for (const line of original.split(/\r\n|\n/)) {
      if (line.includes('<!--')) {
        expect(patched).toContain(line);
      }
    }
    expect(patched).toContain('.LegacyShortcut');
    expect(patched).toContain('android:host="share.example.com"');
    expect(patched).toMatch(/\n {4}<\/application>/);
    expect(patchAndroidManifestText(patched, sampleConfig)).toBe(patched);
  });

  it('keeps two-space closing application indentation without whitespace-only insert lines', () => {
    const original = fs.readFileSync(twoSpaceManifestPath, 'utf8');
    const patched = patchAndroidManifestText(original, sampleConfig);
    expect(patched).toMatch(/\n {2}<\/application>\n/);
    const betweenActivityAndClose = patched.split(/\r\n|\n/).slice(
      patched
        .split(/\r\n|\n/)
        .findIndex((line) => line.includes('.MainActivity')),
      patched
        .split(/\r\n|\n/)
        .findIndex((line) => line.includes('</application>'))
    );
    for (const line of betweenActivityAndClose) {
      if (
        line.includes('com.iconswitcher.') ||
        line.includes('activity-alias')
      ) {
        expect(line.trim().length).toBeGreaterThan(0);
      }
    }
    expect(patchAndroidManifestText(patched, sampleConfig)).toBe(patched);
  });

  it('nests alias children one indent step below activity-alias', () => {
    for (const fixturePath of [twoSpaceManifestPath, fourSpaceManifestPath]) {
      const original = fs.readFileSync(fixturePath, 'utf8');
      const patched = patchAndroidManifestText(original, sampleConfig);
      const closeStart = patched.lastIndexOf('</application>');
      const { childIndent, indentStep } =
        __detectApplicationIndentationForTests(patched, closeStart);
      const aliasLine = patched
        .split(/\r\n|\n/)
        .find((line) =>
          line.includes('<activity-alias android:name=".IconSwitcher_default"')
        );
      expect(aliasLine?.startsWith(childIndent)).toBe(true);
      const innerLine = patched
        .split(/\r\n|\n/)
        .find((line) => line.includes('<intent-filter>'));
      expect(innerLine?.startsWith(childIndent + indentStep)).toBe(true);
      const deepestLine = patched
        .split(/\r\n|\n/)
        .find((line) => line.includes('android.intent.action.MAIN'));
      expect(
        deepestLine?.startsWith(childIndent + indentStep + indentStep)
      ).toBe(true);
    }
  });

  it('supports CRLF manifests and tab-indented application children', () => {
    const crlf = fs
      .readFileSync(twoSpaceManifestPath, 'utf8')
      .replace(/\n/g, '\r\n');
    const patched = patchAndroidManifestText(crlf, sampleConfig);
    expect(patched).toContain('\r\n');
    expect(patched).toMatch(/\r\n {2}<\/application>/);

    const tabIndented = fs
      .readFileSync(twoSpaceManifestPath, 'utf8')
      .replace(/^ {2}/gm, '\t');
    const tabPatched = patchAndroidManifestText(tabIndented, sampleConfig);
    expect(tabPatched).toContain(
      '<activity-alias android:name=".IconSwitcher_default"'
    );
  });

  it('detects indent step from application nesting when no intent-filter sample exists', () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="com.example.demo">
  <application>
    <service android:name=".DemoService" />
  </application>
</manifest>`;
    const close = xml.lastIndexOf('</application>');
    const { childIndent, indentStep } = __detectApplicationIndentationForTests(
      xml,
      close
    );
    expect(childIndent).toBe('    ');
    expect(indentStep).toBe('  ');
  });

  it('writes an empty skipBrands meta-data value with a spaced self-closing suffix', () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="com.example.demo">
  <application>
    <activity android:name=".MainActivity" android:exported="true"/>
    <meta-data android:name="com.iconswitcher.icons" android:value="default"/>
    <meta-data android:name="com.iconswitcher.applyOn" android:value="background"/>
    <meta-data android:name="com.iconswitcher.skipBrands" android:value=""/>
  </application>
</manifest>`;
    const patched = patchAndroidManifestText(xml, {
      ...sampleConfig,
      android: { ...sampleConfig.android, skipBrands: [] },
    });
    expect(patched).toContain(
      'android:name="com.iconswitcher.skipBrands" android:value="" />'
    );
  });

  it('uses compact self-closing tag style when the manifest does', () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="com.example.demo">
  <application>
    <activity android:name=".MainActivity" android:exported="true"/>
  </application>
</manifest>`;
    const patched = patchAndroidManifestText(xml, sampleConfig);
    expect(patched).toContain('android.intent.action.MAIN"/>');
    expect(patched).not.toContain('MAIN" />');
  });

  it('replaces an existing marked alias block in place at the original offset', () => {
    const original = fs.readFileSync(twoSpaceManifestPath, 'utf8');
    const once = patchAndroidManifestText(original, sampleConfig);
    const withStaleAlias = once.replace(
      'android:value="default"',
      'android:value="stale-default"'
    );
    const patched = patchAndroidManifestText(withStaleAlias, sampleConfig);
    expect(patched).toContain('android:value="default"');
    expect(patched).not.toContain('stale-default');
  });

  it('throws TransformError when application is missing', () => {
    expect(() =>
      patchAndroidManifestText('<manifest package="x" />', sampleConfig)
    ).toThrow(TransformError);
  });

  it('throws when launcher activity cannot be resolved', () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="com.example.demo">
  <application>
    <activity android:name=".NotLauncher" android:exported="true"></activity>
  </application>
</manifest>`;
    expect(() => patchAndroidManifestText(xml, sampleConfig)).toThrow(
      /launcher activity/
    );
  });

  it('skips in-place meta replacement when values are unchanged', () => {
    const original = fs.readFileSync(customizedManifestPath, 'utf8');
    const once = patchAndroidManifestText(original, sampleConfig);
    const twice = patchAndroidManifestText(once, sampleConfig);
    expect(twice).toBe(once);
  });

  it('throws for unknown launcher intent-filter categories in text patch', () => {
    const xml = fs.readFileSync(customizedManifestPath, 'utf8');
    const customized = xml.replace(
      '<category android:name="android.intent.category.LAUNCHER" />',
      '<category android:name="android.intent.category.LAUNCHER" />\n                <category android:name="android.intent.category.CUSTOM" />'
    );
    expect(() => patchAndroidManifestText(customized, sampleConfig)).toThrow(
      /Unrecognized category/
    );
  });

  it('resolves launcher activity from default IconSwitcher alias target', () => {
    let xml = fs.readFileSync(customizedManifestPath, 'utf8');
    xml = xml.replace(
      /\s*<intent-filter>\s*<action android:name="android.intent.action.MAIN" \/>\s*<category android:name="android.intent.category.LAUNCHER" \/>\s*<\/intent-filter>/,
      ''
    );
    xml = xml.replace(
      '    </application>',
      `        <activity-alias android:name=".IconSwitcher_default" android:targetActivity=".MainActivity" android:exported="true">
            <meta-data android:name="com.iconswitcher.icon" android:value="default" />
        </activity-alias>
    </application>`
    );
    const patched = patchAndroidManifestText(xml, sampleConfig);
    expect(patched).toContain('.IconSwitcher_default');
    expect(patched).toContain('android:targetActivity=".MainActivity"');
  });

  it('records application meta-data spans for explicit close tags', () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="com.example.demo">
  <application>
    <activity android:name=".MainActivity" android:exported="true"/>
    <meta-data android:name="com.iconswitcher.icons" android:value="default"></meta-data>
  </application>
</manifest>`;
    const structure = __parseManifestStructureForTests(xml);
    expect(structure.iconSwitcherMetaData).toHaveLength(1);
  });

  it('records self-closing application meta-data spans', () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="com.example.demo">
  <application>
    <activity android:name=".MainActivity" android:exported="true"/>
    <meta-data android:name="com.iconswitcher.icons" android:value="default"/>
  </application>
</manifest>`;
    const structure = __parseManifestStructureForTests(xml);
    expect(structure.iconSwitcherMetaData).toHaveLength(1);
    expect(structure.markedActivityAliases).toHaveLength(0);
  });

  it('handles self-closing application meta-data elements', () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="com.example.demo">
  <application>
    <activity android:name=".MainActivity" android:exported="true"/>
    <meta-data android:name="com.iconswitcher.icons" android:value="stale"/>
    <meta-data android:name="com.iconswitcher.applyOn" android:value="immediate"/>
    <meta-data android:name="com.iconswitcher.skipBrands" android:value=""/>
  </application>
</manifest>`;
    const patched = patchAndroidManifestText(xml, sampleConfig);
    expect(patched).toContain('android:value="default,halloween"');
    expect(patched).toContain('android:value="background"');
    expect(patched).not.toContain('android:value="stale"');
    expect(patchAndroidManifestText(patched, sampleConfig)).toBe(patched);
  });

  it('replaces existing com.iconswitcher application meta-data in place', () => {
    const original = fs.readFileSync(customizedManifestPath, 'utf8');
    const once = patchAndroidManifestText(original, sampleConfig);
    const withMeta = once.replace(
      'android:value="default,halloween"',
      'android:value="stale"'
    );
    const patched = patchAndroidManifestText(withMeta, sampleConfig);
    expect(patched).toContain('android:value="default,halloween"');
    expect(patched).not.toContain('android:value="stale"');
  });

  it('omits activity-alias entries for icons without Android art', () => {
    const mixed: ResolvedConfig = {
      ...sampleConfig,
      icons: [
        sampleConfig.icons[0],
        {
          name: 'ios_only',
          isDefault: false,
          ios: { light: 'icons/halloween.png' },
          android: null,
        },
        sampleConfig.icons[1],
      ],
    };
    const original = fs.readFileSync(customizedManifestPath, 'utf8');
    const patched = patchAndroidManifestText(original, mixed);
    expect(patched).not.toContain('.IconSwitcher_ios_only');
    expect(patched).toContain('.IconSwitcher_halloween');
  });

  it('drops marked aliases removed from config', () => {
    const original = fs.readFileSync(customizedManifestPath, 'utf8');
    const withAliases = patchAndroidManifestText(original, sampleConfig);
    const trimmed = patchAndroidManifestText(withAliases, halloweenOnlyConfig);
    expect(trimmed).not.toContain('.IconSwitcher_halloween');
    expect(trimmed).toContain('.IconSwitcher_default');
  });

  it('throws when manifest XML is not well-formed', () => {
    expect(() =>
      __parseManifestStructureForTests('<manifest><application></manifest>')
    ).toThrow();
  });

  it('parses xmlns-style attribute objects from sax', () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="com.example.demo">
  <application>
    <activity android:name=".MainActivity" android:exported="true"/>
  </application>
</manifest>`;
    const structure = __parseManifestStructureForTests(xml);
    expect(structure.activities[0]?.name).toBe('.MainActivity');
  });

  it('uses default indentation when application open tag is missing', () => {
    const xml = '<manifest package="x"></manifest>';
    const close = xml.lastIndexOf('</application>');
    expect(__detectApplicationIndentationForTests(xml, close)).toEqual({
      childIndent: '    ',
      indentStep: '  ',
    });
  });

  it('derives indent step from child indent width when nesting pattern is absent', () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="com.example.demo">
  <application android:label="App">
    <receiver android:name=".BootReceiver" />
  </application>
</manifest>`;
    const close = xml.lastIndexOf('</application>');
    const { indentStep } = __detectApplicationIndentationForTests(xml, close);
    expect(indentStep).toBe('  ');
  });

  it('throws for unknown launcher intent-filter actions in text patch', () => {
    const xml = fs.readFileSync(customizedManifestPath, 'utf8');
    const customized = xml.replace(
      '<action android:name="android.intent.action.MAIN" />',
      '<action android:name="android.intent.action.MAIN" />\n                <action android:name="android.intent.action.CUSTOM" />'
    );
    expect(() => patchAndroidManifestText(customized, sampleConfig)).toThrow(
      TransformError
    );
  });
});
