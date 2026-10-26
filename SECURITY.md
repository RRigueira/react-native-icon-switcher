# Security Policy

## Supported versions

The latest **0.x** minor release receives security fixes.

## Reporting a vulnerability

Please use [GitHub private vulnerability reporting](https://github.com/RRigueira/react-native-icon-switcher/security/advisories/new).

Do **not** open a public issue for security reports.

Acknowledgement is expected within **7 days** (best-effort; single maintainer).

## Scope

### In scope

- Native config edits (AndroidManifest, Info.plist, Xcode project) that weaken the app, such as exporting components that should not be exported.
- Crashes or denial of service triggered through the public API or the remote helper.
- Supply-chain issues in the published npm package, the config plugin or the `sync` CLI.
- Anything in this library's code that causes App Store or Play Store rejection.

### Out of scope

The iOS "You have changed the icon" alert, and Android's behaviour of closing the task that was launched from a disabled alias. Both are platform behaviour and are documented.
