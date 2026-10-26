import path from 'node:path';

import { ConfigError } from '../errors';
import { resolveConfig } from '../validate';

const PROJECT_ROOT = path.join(__dirname, '../../__fixtures__');
const FIXTURE = 'icons/halloween.png';

describe('resolveConfig', () => {
  it('rejects invalid icon names', () => {
    expect(() =>
      resolveConfig(
        { icons: { Halloween: FIXTURE } },
        { projectRoot: PROJECT_ROOT }
      )
    ).toThrow(ConfigError);
  });

  it('rejects reserved name default in icons', () => {
    expect(() =>
      resolveConfig(
        { icons: { default: FIXTURE, halloween: FIXTURE } },
        { projectRoot: PROJECT_ROOT }
      )
    ).toThrow(/reserved/);
  });

  it('requires at least one alternate', () => {
    expect(() =>
      resolveConfig({ icons: {} }, { projectRoot: PROJECT_ROOT })
    ).toThrow(/alternate/);
  });

  it('applies ios and android defaults', () => {
    const cfg = resolveConfig(
      {
        icons: { halloween: FIXTURE },
        android: { skipBrands: ['Samsung'] },
      },
      { projectRoot: PROJECT_ROOT }
    );
    expect(cfg.ios.flattenOn).toBe('#FFFFFF');
    expect(cfg.android.applyOn).toBe('background');
    expect(cfg.android.skipBrands).toEqual(['samsung']);
  });

  it('accepts per-platform default icon sources', () => {
    const cfg = resolveConfig(
      {
        default: { ios: FIXTURE, android: FIXTURE },
        icons: { halloween: FIXTURE },
      },
      { projectRoot: PROJECT_ROOT }
    );
    const def = cfg.icons[0];
    expect(def.ios).toEqual({ light: FIXTURE });
    expect(def.android).toEqual({ legacy: FIXTURE });
  });

  it('normalises bare path to ios light and android legacy', () => {
    const cfg = resolveConfig(
      { icons: { halloween: FIXTURE } },
      { projectRoot: PROJECT_ROOT }
    );
    const alt = cfg.icons.find((i) => i.name === 'halloween');
    expect(alt?.ios).toEqual({ light: FIXTURE });
    expect(alt?.android).toEqual({ legacy: FIXTURE });
  });

  it('clears default assets when Expo owns the primary icon', () => {
    const cfg = resolveConfig(
      { icons: { halloween: FIXTURE } },
      {
        projectRoot: PROJECT_ROOT,
        expoDefault: 'icons/default.png',
      }
    );
    const def = cfg.icons[0];
    expect(def.name).toBe('default');
    expect(def.ios).toBeNull();
    expect(def.android).toBeNull();
  });

  it('allows matching default paths that differ only by ./ prefix', () => {
    const cfg = resolveConfig(
      {
        default: './icons/default.png',
        icons: { halloween: FIXTURE },
      },
      {
        projectRoot: PROJECT_ROOT,
        expoDefault: 'icons/default.png',
      }
    );
    const def = cfg.icons[0];
    expect(def.ios).toBeNull();
    expect(def.android).toBeNull();
  });

  it('throws when config default and expo default differ on disk', () => {
    expect(() =>
      resolveConfig(
        {
          default: FIXTURE,
          icons: { spooky: FIXTURE },
        },
        {
          projectRoot: PROJECT_ROOT,
          expoDefault: 'icons/default.png',
        }
      )
    ).toThrow(/Default icon iOS path conflicts/);
  });

  it('rejects Android-reserved icon names and suffixes', () => {
    for (const name of ['round', 'x_round', 'foreground']) {
      expect(() =>
        resolveConfig(
          { icons: { [name]: FIXTURE } },
          { projectRoot: PROJECT_ROOT }
        )
      ).toThrow(ConfigError);
    }
    const cfg = resolveConfig(
      { icons: { rounded: FIXTURE } },
      { projectRoot: PROJECT_ROOT }
    );
    expect(cfg.icons.some((i) => i.name === 'rounded')).toBe(true);
  });

  it('keeps existing app icon when no default sources', () => {
    const cfg = resolveConfig(
      { icons: { halloween: FIXTURE } },
      { projectRoot: PROJECT_ROOT }
    );
    const def = cfg.icons[0];
    expect(def.ios).toBeNull();
    expect(def.android).toBeNull();
  });

  it('rejects invalid ios.flattenOn and android.applyOn values', () => {
    expect(() =>
      resolveConfig(
        { icons: { halloween: FIXTURE }, ios: { flattenOn: 'not-a-color' } },
        { projectRoot: PROJECT_ROOT }
      )
    ).toThrow(/ios\.flattenOn/);

    expect(() =>
      resolveConfig(
        {
          icons: { halloween: FIXTURE },
          android: { applyOn: 'never' as 'background' },
        },
        { projectRoot: PROJECT_ROOT }
      )
    ).toThrow(/android\.applyOn/);
  });

  it('collects dark, tinted, and adaptive background image paths', () => {
    expect(() =>
      resolveConfig(
        {
          icons: {
            halloween: {
              ios: {
                light: FIXTURE,
                dark: 'missing/dark.png',
                tinted: 'missing/tinted.png',
              },
              android: {
                foreground: FIXTURE,
                background: 'missing/bg.png',
              },
            },
          },
        },
        { projectRoot: PROJECT_ROOT }
      )
    ).toThrow(/missing\/dark\.png/);
  });

  it('rejects invalid adaptive background hex on an icon', () => {
    expect(() =>
      resolveConfig(
        {
          icons: {
            halloween: {
              android: {
                foreground: FIXTURE,
                background: '#GGGGGG',
              },
            },
          },
        },
        { projectRoot: PROJECT_ROOT }
      )
    ).toThrow(/android\.background must be a hex colour/);
  });

  it('reports Android default path conflicts against Expo adaptive icon', () => {
    expect(() =>
      resolveConfig(
        {
          default: FIXTURE,
          icons: { spooky: FIXTURE },
        },
        {
          projectRoot: PROJECT_ROOT,
          expoDefault: {
            android: {
              foreground: 'icons/default.png',
              background: '#FFFFFF',
            },
          },
        }
      )
    ).toThrow(/Default icon Android path conflicts/);
  });

  it('ignores hex colour strings when validating image paths', () => {
    const cfg = resolveConfig(
      {
        default: {
          android: {
            foreground: FIXTURE,
            background: '#AABBCC',
          },
        },
        icons: { halloween: FIXTURE },
      },
      { projectRoot: PROJECT_ROOT }
    );
    expect(cfg.icons[0].android).toMatchObject({ background: '#AABBCC' });
  });

  it('lists every missing file in one ConfigError', () => {
    try {
      resolveConfig(
        {
          icons: {
            halloween: 'missing/a.png',
            winter: 'missing/b.png',
          },
        },
        { projectRoot: PROJECT_ROOT }
      );
      fail('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(ConfigError);
      const msg = (e as ConfigError).message;
      expect(msg).toContain('missing/a.png');
      expect(msg).toContain('missing/b.png');
    }
  });
});
