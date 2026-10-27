# react-native-icon-switcher

Switch the app icon at runtime on React Native and Expo from one config file, with native wiring generated for you.

[![npm version](https://img.shields.io/npm/v/react-native-icon-switcher.svg)](https://www.npmjs.com/package/react-native-icon-switcher)
[![npm license](https://img.shields.io/npm/l/react-native-icon-switcher.svg)](https://www.npmjs.com/package/react-native-icon-switcher)
[![CI](https://github.com/RRigueira/react-native-icon-switcher/actions/workflows/ci.yml/badge.svg)](https://github.com/RRigueira/react-native-icon-switcher/actions/workflows/ci.yml)
[![Expo config plugin](https://img.shields.io/badge/Expo-config%20plugin-4630EB)](https://docs.expo.dev/config-plugins/introduction/)
[![New Architecture](https://img.shields.io/badge/New%20Architecture-required-222)](https://reactnative.dev/docs/the-new-architecture/landing-page)

## What it does / doesn't

**Does:** bundle alternate launcher icons in your app binary and switch between them at runtime from JavaScript, using one shared config for Expo prebuild and bare React Native (`sync` CLI). Build time generates iOS alternate icon sets, Android `activity-alias` entries, and typed icon names — no hand-editing `Info.plist`, `AndroidManifest.xml`, or Xcode icon build settings.

**Doesn't:** download or set icons that are not in the binary; hide Apple's system “You have changed the icon” alert (private API); or run in **Expo Go** (use a development build / prebuild). Remote artwork still has to be baked in at build time — the optional `syncIcon` helper only chooses among bundled names.

## Installation

### Expo

```sh
npx expo install react-native-icon-switcher
```

Add the config plugin in `app.json` / `app.config.ts` and pass the icon config as its options (same shape as [Config](#config)):

```ts
export default {
  expo: {
    plugins: [
      [
        'react-native-icon-switcher',
        {
          icons: {
            halloween: './assets/icons/halloween.png',
          },
          android: { applyOn: 'background' },
        },
      ],
    ],
  },
};
```

Then run `npx expo prebuild` or use a development build. Expo Go is not supported.

The plugin only reads its inline options; it does not look for `icon-switcher.config.ts` on its own. To keep the config in its own file (for example to share it with the `sync` CLI), import it in `app.config.ts` with the explicit extension:

```ts
import iconSwitcherConfig from './icon-switcher.config.ts';

export default {
  expo: {
    plugins: [['react-native-icon-switcher', iconSwitcherConfig]],
  },
};
```

Expo transpiles `app.config.ts` but not the files it imports, so this relies on Node's built-in TypeScript type stripping (Node 22.18 or later). On older Node versions, write the config as `icon-switcher.config.js` instead.

### Bare React Native

```sh
yarn add react-native-icon-switcher
# or: npm install react-native-icon-switcher

cd ios && pod install
```

Create `icon-switcher.config.ts` at the project root (see [Config](#config)), then after every config change:

```sh
npx react-native-icon-switcher sync
```

Use `npx react-native-icon-switcher sync --check` in CI to fail when generated native files or `icon-switcher.d.ts` are out of date.

```sh
react-native-icon-switcher sync [--check] [--project-root <dir>] [--config <path>]
```

| Flag | Default | Description |
| --- | --- | --- |
| `--check` | off | Write nothing; print each out-of-date path and exit `1` if any. |
| `--project-root <dir>` | current directory | App root containing `ios/` and `android/` (useful in monorepos). |
| `--config <path>` | first of `icon-switcher.config.{ts,js,mjs,cjs}` in the project root | Config file to load. TypeScript is loaded directly, with no compile step. |

Exit codes: `0` success (or no drift with `--check`), `1` drift found by `--check`, `2` invalid arguments, config errors, or an unexpected project layout. Without `--check` it prints `updated N files, unchanged M`.

**No `expo` package is required** for bare apps: this library is a TurboModule with a standalone `sync` CLI. You only need `expo` if you opt into the Expo config plugin workflow.

See `example/` (Expo) and `example-bare/` (bare CLI + `sync`) in this repo.

## Config

Bare apps use `icon-switcher.config.ts` at the project root. Expo apps pass the same shape as plugin options (or import that file, see [Expo](#expo)).

`defineIcons` has no runtime effect: it returns its argument unchanged and exists so TypeScript checks the object as you write it (misspelled keys, wrong `applyOn` values, a missing adaptive `background`) and offers autocomplete. Value rules are checked when `sync` or `expo prebuild` runs, and every problem is reported at once.

```ts
import { defineIcons } from 'react-native-icon-switcher/config';

export default defineIcons({
  default: './assets/icons/default.png',
  icons: {
    halloween: './assets/icons/halloween.png',
    midnight: {
      ios: './assets/icons/midnight-ios.png',
      android: {
        foreground: './assets/icons/midnight-fg.png',
        background: '#0B1020',
      },
    },
  },
  ios: { flattenOn: '#FFFFFF' },
  android: { applyOn: 'background', skipBrands: [] },
});
```

| Option | Default | Description |
| --- | --- | --- |
| `default` | _(unset)_ | Primary icon. Icon names must match `/^[a-z][a-z0-9_]*$/`; `default` is reserved for the primary icon. |
| `icons` | _(required)_ | Map of alternate name → square PNG path (1024×1024 ideal) or per-platform `IconSpec`. |
| `ios.flattenOn` | `#FFFFFF` | Background colour when flattening transparent pixels onto the iOS master. |
| `android.applyOn` | `'background'` | `'background'`: queue PackageManager updates until the app backgrounds (recommended). `'immediate'`: apply during `set()` (can close the visible activity — see [Android guide](docs/guides/android.md)). |
| `android.skipBrands` | `[]` | Lower-cased `Build.BRAND` values where switching is disabled at runtime (`isSupported` → `false`). |

Per-icon `ios` / `android` fields accept a path or structured variants (`IosIconVariants`, `AndroidAdaptiveIcon`) as in `IconSwitcherConfig` (`react-native-icon-switcher/config` types).

**Default icon ownership (Expo):** when your Expo config defines `icon` or `android.adaptiveIcon`, Expo owns the default launcher assets and this library does not overwrite `AppIcon.appiconset` or `ic_launcher*`. You may omit `default` in plugin config (recommended). If you set both Expo's icon and `default`, paths must match per platform after resolving to absolute paths — otherwise sync/prebuild fails with a config error. If Expo has no icon fields, set `default` and the plugin writes default assets.

**Default icon ownership (bare):** `sync` writes default assets only when `default` is set in the config.

Icons with no art for a platform are omitted from that platform's generated outputs.

**Validation:** `sync` and the Expo plugin fail if `icons` is empty, a name does not match `/^[a-z][a-z0-9_]*$/` or uses `default`, a colour is not `#RGB` / `#RRGGBB`, an image file does not exist, or Expo's default icon and `default` point at different files.

**Android reserved names:** names may not be `round`, `foreground`, `background`, or `monochrome`, nor end in `_round`, `_foreground`, `_background`, or `_monochrome`.

**Android adaptive icons:** layers are 108×108 dp, but launchers show only the central 72×72 dp and then mask it (circle, squircle, …). Keep logos and text inside that centre, about the middle two thirds of the image. A plain path (no `foreground` / `background`) is used as a legacy square icon. To fit artwork that fills its square, scale it into the centre of the `background` image on a matching colour and use a transparent `foreground`.

**Variants (experimental):** iOS `dark` / `tinted` and Android `monochrome` (themed icons, Android 13+) are generated when set, but have not yet been verified on devices.

### What `sync` and the plugin generate

| | iOS | Android |
| --- | --- | --- |
| Images | `AppIcon-<name>.appiconset` in `Images.xcassets` (1024 px, flattened onto `ios.flattenOn`) | `mipmap-*/ic_launcher_<name>*` in five densities, plus `mipmap-anydpi-v26` adaptive XML |
| Registration | `ASSETCATALOG_COMPILER_ALTERNATE_APPICON_NAMES` and `ASSETCATALOG_COMPILER_INCLUDE_ALL_APPICON_ASSETS` build settings | One `activity-alias` per icon, `.IconSwitcher_<name>`; `MainActivity` loses its launcher filter |
| Runtime list | `IconSwitcherIcons` array in `Info.plist` | `com.iconswitcher.*` meta-data in `AndroidManifest.xml` |
| Types | `icon-switcher.d.ts` at the project root | same file |

Xcode generates `CFBundleIcons` from the build settings, so the library does not write it. Other content in these files is left as it is: comments, formatting, and the quoting CocoaPods applies to the pbxproj, so `sync --check` stays clean after `pod install`. In bare apps, commit the generated files. With Expo prebuild, commit `icon-switcher.d.ts`; native folders follow your usual prebuild policy.

## Usage

```ts
import IconSwitcher, {
  IconSwitcherError,
  type IconName,
} from 'react-native-icon-switcher';

if (IconSwitcher.isSupported) {
  const names = IconSwitcher.list(); // 'default' first, then config order
  const current = await IconSwitcher.getCurrent();
  const { status } = await IconSwitcher.set('halloween' as IconName);
  // status: 'applied' | 'pending'
  await IconSwitcher.reset();
  await IconSwitcher.applyPending(); // Android: flush queued change; iOS: 'none'
}
```

## API reference

| Method | Returns | Notes |
| --- | --- | --- |
| `IconSwitcher.isSupported` | `boolean` | `false` when the TurboModule is missing (web, Expo Go, unlink), the device brand is skipped, or iOS reports `supportsAlternateIcons` as `false`. |
| `IconSwitcher.list()` | `IconName[]` | Bundled icon names; `default` first. |
| `IconSwitcher.getCurrent()` | `Promise<IconName>` | |
| `IconSwitcher.set(name)` | `Promise<{ status: 'applied' \| 'pending' }>` | Android with `applyOn: 'background'` → `pending` until background or `applyPending()`. |
| `IconSwitcher.reset()` | same as `set('default')` | |
| `IconSwitcher.applyPending()` | `Promise<{ status: 'applied' \| 'none' }>` | Android: apply queued icon when not in the foreground; iOS: always `{ status: 'none' }`. |

Throws `IconSwitcherError` with a `code` field (native rejections are mapped in JS).

### Errors (`IconSwitcherError.code`)

| JS code | Native code | When |
| --- | --- | --- |
| `unsupported` | `ERR_UNSUPPORTED` | Module unavailable or brand skipped |
| `unknown_icon` | `ERR_UNKNOWN_ICON` | Name not in the bundle (also thrown synchronously from JS if not in `list()`) |
| `os_rejected` | `ERR_OS_REJECTED` | OS failure or read-back mismatch |
| `foreground` | `ERR_FOREGROUND` | Android: `applyPending()` while the app is visible |

Unknown native codes map to `os_rejected`.

### Typed icon names (`icon-switcher.d.ts`)

`sync` and the Expo plugin generate `icon-switcher.d.ts` at the project root:

```ts
import 'react-native-icon-switcher';

declare module 'react-native-icon-switcher' {
  interface Register {
    icons: 'default' | 'halloween' | 'midnight';
  }
}
```

Commit this file and reference `IconName` from `react-native-icon-switcher` for autocomplete on `set`, `getCurrent`, and `reset`.

### Remote helper (`react-native-icon-switcher/remote`)

`syncIcon` fetches a choice from your backend, validates it against `list()`, and calls `set` when needed. It does not download new artwork.

```ts
import { syncIcon } from 'react-native-icon-switcher/remote';

const unsubscribe = await syncIcon({
  fetchChoice: async () => {
    const res = await fetch('https://api.example.com/icon');
    return (await res.json()).iconName as string;
  },
  storage: AsyncStorage, // optional; default: in-memory
  retryAfterMs: 24 * 60 * 60 * 1000, // skip re-apply after failure
  onError: (err) => console.warn(err),
});
// call unsubscribe() to remove iOS AppState listener
```

`onError` receives errors from `fetchChoice` or storage, and failures from `set()` as an `IconSwitcherError` with its `code` (for example `os_rejected`, `unsupported`, or `foreground`). After `set` fails for a given icon name, that name is not retried until `retryAfterMs` elapses (default 24 hours).

On **iOS**, the helper runs when the app is `active` and subscribes to `AppState`. On **Android**, it runs once when called (`set` may still return `pending`).

Each run does nothing when `fetchChoice` returns `null`, `undefined`, `''`, or a name not in `list()`, or when the choice is already current. A `pending` result is not recorded as applied.

`storage` is any object with async `getItem(key): Promise<string | null>` and `setItem(key, value): Promise<void>` (`SyncIconStorage`), such as `@react-native-async-storage/async-storage`. The helper uses the keys `icon-switcher:lastApplied` and `icon-switcher:lastFailed`. With the default in-memory storage, the retry block lasts only as long as that `syncIcon` call, so a restart retries straight away.

## Testing with Jest

Ship a CommonJS mock that never loads native code:

```ts
jest.mock(
  'react-native-icon-switcher',
  () => require('react-native-icon-switcher/jest')
);
```

Helpers (see `jest/index.d.ts`):

```ts
import IconSwitcher, {
  IconSwitcherError,
  __setState,
  __reset,
} from 'react-native-icon-switcher/jest';

beforeEach(() => {
  __reset();
});

it('applies a pending switch', async () => {
  __setState({
    setImpl: async (name) => {
      __setState({ current: name });
      return { status: 'applied' };
    },
  });

  await IconSwitcher.set('halloween');
  expect(await IconSwitcher.getCurrent()).toBe('halloween');
});
```

`__setState(partial)` merges onto defaults (`isSupported: true`, `iconNames: ['default', 'halloween']`, `current: 'default'`). Customize `setImpl` and `applyPendingImpl` for async behaviour.

## Platform notes

### iOS

- Apple shows a system alert when the icon changes. **`set()` resolves only after the user dismisses that alert** — `await IconSwitcher.set()` can take as long as the alert stays on screen (often ~0.5 s after tapping OK).
- There is no supported way to hide this alert.

### Android

Deferred apply, task recreation when aliases toggle, the `applyPending()` foreground guard, cold-start behaviour, and launcher shortcuts are documented in [docs/guides/android.md](docs/guides/android.md).

Summary: with default `applyOn: 'background'`, `set()` returns `pending` and the launcher updates after the user leaves the app; the process usually survives but the next open may look like a cold start. `applyPending()` in the foreground is refused with `foreground`.

## Requirements

- **New Architecture (TurboModule) required** — React Native **≥ 0.82** (developed with **0.88**).
- **iOS 15.1+** (React Native's `min_ios_version_supported`) and **Android minSdk 24**. On Android the module adds `androidx.lifecycle:lifecycle-process` to detect when the app goes to the background.
- **Expo SDK ≥ 52** when using the config plugin (optional peer; developed with **SDK 58**).
- **Expo Go is not supported** — use a development build or bare native project.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)
