# Android icon switching

This library switches the launcher icon at runtime by enabling one `activity-alias` per icon and disabling the others. Each alias points at your `MainActivity` and carries a marker meta-data entry (`com.iconswitcher.icon`) so only generated aliases are toggled. Component names use the `.IconSwitcher_<name>` pattern.

## How switching works

1. **Aliases** — The build step adds one exported `activity-alias` per configured icon (including `default`). Every alias carries the `MAIN` / `LAUNCHER` intent filter, and `MainActivity` loses it; only the active alias is enabled, and the rest are disabled with `PackageManager.DONT_KILL_APP`.

2. **Deferred apply (default)** — With `android.applyOn: 'background'` (the default), `IconSwitcher.set()` writes the desired icon name to SharedPreferences as `pending` and resolves `{ status: 'pending' }`. The actual PackageManager updates run as soon as the app's last activity stops (including when the user swipes the task away from Recents, before the process is killed), when you call `IconSwitcher.applyPending()` while the app is **not** in the foreground, or as a fallback when `ProcessLifecycleOwner` reaches `onStop` (slightly later than the last activity stop on some devices).

   Listening starts at **process start** via AndroidX App Startup (`com.iconswitcher.IconSwitcherInitializer`, registered in the library manifest under `androidx.startup.InitializationProvider`). If your app removes `InitializationProvider`, keep the initializer `meta-data` entry or rely on the TurboModule calling `onProcessStart()` the first time JavaScript touches `IconSwitcher`.

3. **Read-back** — After every apply, the native layer reads `getComponentEnabledSetting` for every marked alias. If the OS state does not match what was requested, the immediate path rejects with `os_rejected`; the deferred path stores `lastError` in prefs.

4. **Cold start** — When the app is launching into the foreground, native code never calls PackageManager setters. An existing `pending` value stays pending. If PackageManager already reflects a different icon than prefs `current`, that mismatch is stored as `pending` and applied on the next background transition or successful `applyPending()`.

## What a switch does to the running app

Disabling the `activity-alias` that launched the current task makes Android finish that activity immediately (`finish-imm:disabled-package`), even when all changes use `DONT_KILL_APP`. The task is removed from Recents. The **process** usually keeps running, but the next time the user opens the app they get a **new** activity and a **fresh** React Native instance — in-memory UI state is lost.

- **Default `applyOn: 'background'`** — Users typically trigger a switch, then leave the app. Apply happens while they are not looking at the screen, so they do not see the activity finish. When they return, the app may look like a cold start, but the icon on the launcher has updated.

- **`applyPending()` in the foreground** — Applying while `ProcessLifecycleOwner` is at least `STARTED` would close the visible screen and send the user to the home launcher. The API **refuses** in that case: native rejects with `ERR_FOREGROUND`, which maps to the JS error code `foreground`, and `pending` is left unchanged. Use background apply or wait until the app is not visible.

- **`applyOn: 'immediate'`** — `IconSwitcher.set()` applies through PackageManager right away. That has the same foreground effect: the visible screen can close. Only use this if your product accepts that trade-off (e.g. a settings screen that tells the user to reopen the app).

## Home screen and pinned icons

On **Pixel Launcher**, a pinned home screen icon was retargeted to the new alias and kept its place: the log shows “Changing shortcut target due to app component name change”. This was seen on one API 36 emulator; Pixel hardware is not yet checked.

**Other OEM launchers** (Samsung One UI, etc.) have not been verified in this project yet; some may drop or duplicate shortcuts when component names change.

## Configuration reference

In `icon-switcher.config.ts` (bare) or the Expo plugin options:

```ts
android: {
  applyOn: 'background', // or 'immediate'
  skipBrands: ['samsung'], // optional lower-cased Build.BRAND values where switching is disabled
},
```

SharedPreferences file: `icon_switcher`, keys `current`, `pending`, `lastError`.
