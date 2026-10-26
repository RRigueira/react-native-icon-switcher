# Contributing

Contributions are always welcome, no matter how large or small!

We want this community to be friendly and respectful to each other. Please follow it in all your interactions with the project. Before contributing, please read the [code of conduct](./CODE_OF_CONDUCT.md).

## Development workflow

This project is a monorepo managed using [Yarn workspaces](https://yarnpkg.com/features/workspaces). It contains:

- The library package in the root directory (`src/`, `plugin/`, `ios/`, `android/`).
- An Expo example app in `example/`.
- A bare React Native CLI example in `example-bare/` (uses `npx react-native-icon-switcher sync`, no `expo` dependency).

To get started, install the Node version from [`.nvmrc`](./.nvmrc), then:

```sh
yarn
```

After installing, build generated artifacts before running the Expo example, prebuild, or the `sync` CLI:

```sh
yarn build:plugin
# or
yarn prepare
```

`plugin/build` is gitignored; a clean checkout needs `yarn prepare` (which also runs `bob build` for `lib/`). The published CLI is `plugin/build/cli.js` (`npx react-native-icon-switcher sync`).

> Since the project relies on Yarn workspaces, you cannot use [`npm`](https://github.com/npm/cli) for development without manually migrating.

### Example apps

**Expo (`example/`):** linked to the local package. JS changes hot-reload; native changes need a rebuild.

```sh
yarn example start
yarn example ios
yarn example android
```

Open `example/ios/IconSwitcherExample.xcworkspace` or `example/android` in Xcode / Android Studio. Native sources appear under **Development Pods → react-native-icon-switcher**.

**Bare (`example-bare/`):** after `yarn prepare`, from the example directory (or with `--project-root`):

```sh
npx react-native-icon-switcher sync --project-root example-bare
cd example-bare && yarn start
# yarn ios / yarn android from example-bare when wired to the library
```

Re-run `sync` after changing `icon-switcher.config.ts`. Use `sync --check` in CI to ensure committed native files match the config.

### Quality checks

```sh
yarn typecheck
yarn lint
yarn lint --fix   # formatting
yarn test
yarn test --coverage
```

Coverage thresholds (see root `package.json`): **95%** statements/lines, **90%** branches, **85%** functions, across `src/` and `plugin/src/` (with listed exclusions).

Git hooks use [Lefthook](https://github.com/evilmartians/lefthook): pre-commit runs ESLint on staged files and `tsc`; commit-msg runs [commitlint](https://commitlint.js.org/) (conventional commits). Install once with `yarn lefthook install` if hooks are not active.

### Scripts

| Script | Purpose |
| --- | --- |
| `yarn` | Install workspace dependencies |
| `yarn prepare` / `yarn build:plugin` | Build `lib/` and `plugin/build/` |
| `yarn typecheck` | TypeScript (library + plugin) |
| `yarn lint` | ESLint |
| `yarn test` | Jest (runtime JS + plugin transforms) |
| `yarn check:exports` | Smoke-test `package.json` export paths |
| `yarn example …` | Proxy to the Expo example workspace |
| `yarn release` | [release-it](https://github.com/release-it/release-it) version bump (maintainers) |

### Sending a pull request

> **Working on your first pull request?** See [How to Contribute to an Open Source Project on GitHub](https://app.egghead.io/playlists/how-to-contribute-to-an-open-source-project-on-github).

When you open a PR:

- Prefer small, focused changes.
- Run `yarn typecheck`, `yarn lint`, and `yarn test`.
- Update README / guides when behaviour or public API changes.
- Follow the pull request template.
- For large API or architecture changes, open an issue first.

## Releases

Maintainers use `yarn release` ([release-it](https://github.com/release-it/release-it)) on `main` with a clean working tree. It bumps the version, updates `CHANGELOG.md` via conventional changelog, tags, and opens a GitHub release. npm publish is disabled in config until release automation is finalised (`publish: false` in `package.json`).

Commit messages should follow [Conventional Commits](https://www.conventionalcommits.org/) so changelog generation stays accurate.
