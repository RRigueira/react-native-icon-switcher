import fs from 'fs';
import path from 'path';

import { AndroidConfig, XML } from '@expo/config-plugins';

import { applyAndroidManifest } from '../android';
import { TransformError } from '../errors';
import type { ResolvedConfig } from '../../types';
import { halloweenOnlyConfig, sampleConfig } from '../sampleConfigs';

const manifestPath = path.join(
  __dirname,
  '../../__fixtures__/manifests/AndroidManifest.xml'
);

async function loadStockManifest(): Promise<AndroidConfig.Manifest.AndroidManifest> {
  const xml = await fs.promises.readFile(manifestPath, 'utf8');
  return XML.parseXMLAsync(xml);
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe('applyAndroidManifest', () => {
  it('matches snapshot after transform', async () => {
    const manifest = await loadStockManifest();
    const result = applyAndroidManifest(manifest, sampleConfig);
    expect(result).toMatchSnapshot();
  });

  it('writes com.iconswitcher.icons in resolved config order', async () => {
    const manifest = await loadStockManifest();
    const result = applyAndroidManifest(manifest, sampleConfig);
    const appMeta = result.manifest.application?.[0]?.['meta-data'] ?? [];
    const iconsMeta = appMeta.find(
      (item) => item.$?.['android:name'] === 'com.iconswitcher.icons'
    );
    expect(iconsMeta?.$?.['android:value']).toBe('default,halloween');
  });

  it('is idempotent', async () => {
    const manifest = await loadStockManifest();
    const once = applyAndroidManifest(manifest, sampleConfig);
    const twice = applyAndroidManifest(deepClone(once), sampleConfig);
    expect(twice).toEqual(once);
  });

  it('preserves deep-link VIEW intent filter on MainActivity', async () => {
    const manifest = await loadStockManifest();
    const result = applyAndroidManifest(manifest, sampleConfig);
    const main = result.manifest.application?.[0]?.activity?.find(
      (activity) => activity.$?.['android:name'] === '.MainActivity'
    );
    const viewFilter = (main?.['intent-filter'] ?? []).find((filter) =>
      (filter.action ?? []).some(
        (action) => action.$?.['android:name'] === 'android.intent.action.VIEW'
      )
    );
    expect(viewFilter).toBeDefined();
    expect(viewFilter?.data?.[0]?.$?.['android:scheme']).toBe('myapp');
  });

  it('throws TransformError for unknown launcher intent-filter actions', async () => {
    const manifest = await loadStockManifest();
    const main = manifest.manifest.application?.[0]?.activity?.find(
      (activity) => activity.$?.['android:name'] === '.MainActivity'
    );
    const launcher = (main?.['intent-filter'] ?? []).find((filter) =>
      (filter.action ?? []).some(
        (action) => action.$?.['android:name'] === 'android.intent.action.MAIN'
      )
    );
    launcher?.action?.push({
      $: { 'android:name': 'android.intent.action.CUSTOM' },
    });

    expect(() => applyAndroidManifest(manifest, sampleConfig)).toThrow(
      TransformError
    );
  });

  it('removes activity-alias for icons dropped from config', async () => {
    const manifest = await loadStockManifest();
    const withBoth = applyAndroidManifest(manifest, sampleConfig);
    const trimmed = applyAndroidManifest(
      deepClone(withBoth),
      halloweenOnlyConfig
    );

    const aliases = trimmed.manifest.application?.[0]?.['activity-alias'] ?? [];
    expect(
      aliases.some(
        (alias) => alias.$?.['android:name'] === '.IconSwitcher_halloween'
      )
    ).toBe(false);
    expect(
      aliases.some(
        (alias) => alias.$?.['android:name'] === '.IconSwitcher_default'
      )
    ).toBe(true);
  });

  it('keeps default alias but skips alternates without Android art', async () => {
    const mixed: ResolvedConfig = {
      ...sampleConfig,
      icons: [
        {
          name: 'default',
          isDefault: true,
          ios: { light: 'icons/default.png' },
          android: null,
        },
        {
          name: 'ios_only',
          isDefault: false,
          ios: { light: 'icons/halloween.png' },
          android: null,
        },
        sampleConfig.icons[1],
      ],
    };
    const manifest = await loadStockManifest();
    const result = applyAndroidManifest(manifest, mixed);
    const aliases = result.manifest.application?.[0]?.['activity-alias'] ?? [];
    expect(
      aliases.some(
        (alias) => alias.$?.['android:name'] === '.IconSwitcher_default'
      )
    ).toBe(true);
    expect(
      aliases.some(
        (alias) => alias.$?.['android:name'] === '.IconSwitcher_ios_only'
      )
    ).toBe(false);
    expect(
      aliases.some(
        (alias) => alias.$?.['android:name'] === '.IconSwitcher_halloween'
      )
    ).toBe(true);
  });

  it('throws when the manifest has no application element', async () => {
    const manifest = await loadStockManifest();
    manifest.manifest.application = undefined;
    expect(() => applyAndroidManifest(manifest, sampleConfig)).toThrow(
      /no <application>/
    );
  });

  it('throws when launcher activity cannot be resolved', async () => {
    const manifest = await loadStockManifest();
    const application = manifest.manifest.application?.[0];
    application!.activity = [
      {
        '$': { 'android:name': '.NotMain' },
        'intent-filter': [],
      },
    ];
    application!['activity-alias'] = [];
    expect(() => applyAndroidManifest(manifest, sampleConfig)).toThrow(
      TransformError
    );
  });

  it('preserves custom attributes on refreshed marked activity-alias entries', async () => {
    const manifest = await loadStockManifest();
    const once = applyAndroidManifest(manifest, sampleConfig);
    const application = once.manifest.application?.[0];
    const alias = application?.['activity-alias']?.find(
      (entry) => entry.$?.['android:name'] === '.IconSwitcher_halloween'
    );
    if (alias?.$) {
      alias.$['android:label'] = '@string/halloween';
    }
    const twice = applyAndroidManifest(deepClone(once), sampleConfig);
    const refreshed = twice.manifest.application?.[0]?.['activity-alias']?.find(
      (entry) => entry.$?.['android:name'] === '.IconSwitcher_halloween'
    );
    expect(refreshed?.$?.['android:label']).toBe('@string/halloween');
  });

  it('resolves launcher activity via default IconSwitcher alias target', async () => {
    const manifest = await loadStockManifest();
    const application = manifest.manifest.application?.[0];
    for (const activity of application?.activity ?? []) {
      activity['intent-filter'] = (activity['intent-filter'] ?? []).filter(
        (filter) =>
          !(filter.action ?? []).some(
            (action) =>
              action.$?.['android:name'] === 'android.intent.action.MAIN'
          )
      );
    }
    application!['activity-alias'] = [
      {
        '$': {
          'android:name': '.IconSwitcher_default',
          'android:targetActivity': '.MainActivity',
          'android:exported': 'true',
        },
        'meta-data': [
          {
            $: {
              'android:name': 'com.iconswitcher.icon',
              'android:value': 'default',
            },
          },
        ],
      },
    ];

    const result = applyAndroidManifest(manifest, sampleConfig);
    const aliases = result.manifest.application?.[0]?.['activity-alias'] ?? [];
    expect(
      aliases.some(
        (alias) => alias.$?.['android:name'] === '.IconSwitcher_default'
      )
    ).toBe(true);
  });

  it('throws when the resolved launcher activity is missing from activities', async () => {
    const manifest = await loadStockManifest();
    const application = manifest.manifest.application?.[0];
    application!.activity = [];
    application!['activity-alias'] = [
      {
        '$': {
          'android:name': '.IconSwitcher_default',
          'android:targetActivity': '.MissingLauncher',
          'android:exported': 'true',
        },
        'meta-data': [
          {
            $: {
              'android:name': 'com.iconswitcher.icon',
              'android:value': 'default',
            },
          },
        ],
      },
    ];
    expect(() => applyAndroidManifest(manifest, sampleConfig)).toThrow(
      /Launcher activity/
    );
  });

  it('throws for unknown launcher intent-filter categories', async () => {
    const manifest = await loadStockManifest();
    const main = manifest.manifest.application?.[0]?.activity?.find(
      (activity) => activity.$?.['android:name'] === '.MainActivity'
    );
    const launcher = (main?.['intent-filter'] ?? []).find((filter) =>
      (filter.action ?? []).some(
        (action) => action.$?.['android:name'] === 'android.intent.action.MAIN'
      )
    );
    launcher?.category?.push({
      $: { 'android:name': 'android.intent.category.CUSTOM' },
    });

    expect(() => applyAndroidManifest(manifest, sampleConfig)).toThrow(
      /Unrecognized category/
    );
  });

  it('resolves launcher activity via .MainActivity when MAIN/LAUNCHER is absent', async () => {
    const manifest = await loadStockManifest();
    const application = manifest.manifest.application?.[0];
    for (const activity of application?.activity ?? []) {
      activity['intent-filter'] = (activity['intent-filter'] ?? []).filter(
        (filter) =>
          !(filter.action ?? []).some(
            (action) =>
              action.$?.['android:name'] === 'android.intent.action.MAIN'
          )
      );
    }
    const result = applyAndroidManifest(manifest, sampleConfig);
    const aliases = result.manifest.application?.[0]?.['activity-alias'] ?? [];
    expect(
      aliases.some(
        (alias) => alias.$?.['android:targetActivity'] === '.MainActivity'
      )
    ).toBe(true);
  });

  it('ignores categories without android:name in launcher filters', async () => {
    const manifest = await loadStockManifest();
    const main = manifest.manifest.application?.[0]?.activity?.find(
      (activity) => activity.$?.['android:name'] === '.MainActivity'
    );
    const launcher = (main?.['intent-filter'] ?? []).find((filter) =>
      (filter.action ?? []).some(
        (action) => action.$?.['android:name'] === 'android.intent.action.MAIN'
      )
    );
    launcher?.category?.push({ $: {} });
    expect(() => applyAndroidManifest(manifest, sampleConfig)).not.toThrow();
  });

  it('ignores marked aliases whose icon meta-data has no value', async () => {
    const manifest = await loadStockManifest();
    const application = manifest.manifest.application?.[0];
    application!['activity-alias'] = [
      {
        '$': {
          'android:name': '.IconSwitcher_stale',
          'android:targetActivity': '.MainActivity',
          'android:exported': 'true',
        },
        'meta-data': [
          {
            $: {
              'android:name': 'com.iconswitcher.icon',
            },
          },
        ],
      },
    ];
    const result = applyAndroidManifest(manifest, sampleConfig);
    expect(
      (result.manifest.application?.[0]?.['activity-alias'] ?? []).some(
        (alias) => alias.$?.['android:name'] === '.IconSwitcher_stale'
      )
    ).toBe(true);
  });

  it('ignores launcher intent-filter actions without android:name', async () => {
    const manifest = await loadStockManifest();
    const main = manifest.manifest.application?.[0]?.activity?.find(
      (activity) => activity.$?.['android:name'] === '.MainActivity'
    );
    const launcher = (main?.['intent-filter'] ?? []).find((filter) =>
      (filter.action ?? []).some(
        (action) => action.$?.['android:name'] === 'android.intent.action.MAIN'
      )
    );
    launcher?.action?.push({ $: {} });
    const result = applyAndroidManifest(manifest, sampleConfig);
    expect(result.manifest.application?.[0]?.activity?.[0]).toBeDefined();
  });

  it('does not treat activity-alias without icon marker as managed', async () => {
    const manifest = await loadStockManifest();
    const application = manifest.manifest.application?.[0];
    application!['activity-alias'] = [
      {
        $: {
          'android:name': '.IconSwitcher_orphan',
          'android:targetActivity': '.MainActivity',
          'android:exported': 'true',
        },
      },
    ];
    const result = applyAndroidManifest(manifest, sampleConfig);
    expect(
      (result.manifest.application?.[0]?.['activity-alias'] ?? []).some(
        (alias) => alias.$?.['android:name'] === '.IconSwitcher_orphan'
      )
    ).toBe(true);
  });

  it('resolves launcher via default alias when MAIN activity has no android:name', async () => {
    const manifest = await loadStockManifest();
    const application = manifest.manifest.application?.[0];
    for (const activity of application?.activity ?? []) {
      activity['intent-filter'] = (activity['intent-filter'] ?? []).filter(
        (filter) =>
          !(filter.action ?? []).some(
            (action) =>
              action.$?.['android:name'] === 'android.intent.action.MAIN'
          )
      );
    }
    const main = application?.activity?.find(
      (activity) => activity.$?.['android:name'] === '.MainActivity'
    );
    if (main?.$) {
      delete main.$['android:name'];
    }
    application!['activity-alias'] = [
      {
        '$': {
          'android:name': '.IconSwitcher_default',
          'android:targetActivity': '.MainActivity',
          'android:exported': 'true',
        },
        'meta-data': [
          {
            $: {
              'android:name': 'com.iconswitcher.icon',
              'android:value': 'default',
            },
          },
        ],
      },
    ];
    expect(() => applyAndroidManifest(manifest, sampleConfig)).toThrow(
      /launcher activity/i
    );
  });

  it('does not remove unmarked activity-alias entries', async () => {
    const manifest = await loadStockManifest();
    const application = manifest.manifest.application?.[0];
    application!['activity-alias'] = [
      {
        $: {
          'android:name': '.LegacyAlias',
          'android:targetActivity': '.MainActivity',
          'android:exported': 'true',
        },
      },
    ];

    const result = applyAndroidManifest(manifest, sampleConfig);
    const aliases = result.manifest.application?.[0]?.['activity-alias'] ?? [];
    expect(
      aliases.some((alias) => alias.$?.['android:name'] === '.LegacyAlias')
    ).toBe(true);
  });
});
