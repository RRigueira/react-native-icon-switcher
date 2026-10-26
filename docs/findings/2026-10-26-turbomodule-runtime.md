# react-native-icon-switcher runtime check (TurboModule) — 2026-10-26

Devices: an iPhone 18 Pro Max simulator on iOS 27, and the `DI_GoogleAPIs_36` emulator (API 36, Pixel Launcher). Debug builds, RN 0.88.

| Check | Expo iOS | Expo Android | Bare iOS (no expo) | Bare Android (no expo) |
|---|---|---|---|---|
| App starts, `isSupported` true | pass | pass | pass | pass |
| `list()` order = config order | pass | pass after the ordering fix | pass | pass |
| `set` | `applied` after the alert is dismissed (midnight) | `pending`, applied on Home (halloween) | `applied` (ghost) | `pending`, applied on Home (ghost) |
| `applyPending()` | `none` | `none`, then `foreground` refusal with the app kept on screen | — | — |
| Process survives the switch | n/a | yes (same PID) | n/a | yes |
| Crashes | none | none | none | none |

## Findings

1. **Bare apps run without Expo.** `example-bare` has no `expo` dependency and starts on both platforms. No `install-expo-modules` step is involved, so the RN 0.88 `SceneDelegate` template needs no changes.
2. **Android activity order is not stable.** `PackageManager` returned the aliases in reverse manifest order. Fixed: the plugin and `sync` now write `com.iconswitcher.icons`, and native code orders by it. Robolectric did not catch this, because it keeps manifest order.
3. **The TurboModule's foreground error message is cleaner.** It is the native message alone, without Expo's "Call to function … has been rejected" wrapper.
4. **In the monorepo, `sync` needs `yarn prepare` first**, because `icon-switcher.config.ts` imports the built `./config` export. CI runs `yarn prepare` before `sync --check`. Published consumers are unaffected.

Not covered yet: real devices, iPad, iOS 18 and 26, OEM launchers other than Pixel Launcher, themed icons, upgrades over an older install, and TestFlight processing.
