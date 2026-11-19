# Scheduler development

`@decaf-ts/scheduler` owns the MyLuz browser scheduler, its CLI, configuration,
tray menus, notifications, and tests. It has no runtime import from with-ai.

## Installation

Use Node.js 24 and npm 10+ for development and CI. Run these commands in `scheduler/`:

```bash
npm install
npm run browser:install
npm run build:prod
npm run start -- myluz --help
```

The browser package is a declared runtime dependency. Chromium is installed
separately with `browser:install`. The `for-os` postinstall configures the native
addon; `npm run os:install` retries setup and requires a working native build.
Follow for-os's platform prerequisites when a bundled native binary is unavailable.
A logged-in desktop session is required for real browser/tray execution.

## Configuration

Copy `myluz.config.example.json` to `myluz.config.json`, configure selectors for
the live portal, and put only your scheduler credentials in `.env.secret`:

```text
MYLUZ_USERNAME=your-account
MYLUZ_PASSWORD=your-password
```

The private config and env file are ignored by Git and excluded from npm packs.
`--env-file` defaults to `.env.secret`; shell variables take precedence. An
optional `MYLUZ_CHROMIUM_EXECUTABLE_PATH` selects an existing browser executable.
Persistent browser profiles remain at the configured `profileDir`, resolved
relative to the configuration file (with `~` expanded).

## Commands and public API

```bash
npm run myluz:start -- --before 2026-12-31
npm run myluz:start -- --before 2026-12-31 --recursive
npm run myluz:start -- --kind exam
```

After installation, use `decaf-scheduler myluz` directly, or
`decaf scheduler myluz` when the package is discoverable by the Decaf CLI.
The package root exports its default Commander tree, `myluzCommand`, the scenario
runner, configuration helpers, date parsing, page classification, and tray adapter.
`@decaf-ts/scheduler/cli` exports the composable CLI tree and command factory.

## Structure

- `src/bin/cli.ts`: standalone executable and failure exit status.
- `src/cli/cli-module.ts`: `scheduler` Commander tree.
- `src/cli/scenario.ts`: Storyboard definition loader and runner delegation.
- `src/scenarios/luz/`: Luz target, with a file-loadable `index.ts`, command
  flags in `command.ts`, declarative Storyboard graph in `scenario.ts`, browser/tray adapter in
  `session.ts`, configuration and date helpers. OS operations come from direct
  `@decaf-ts/for-os` imports; browser actions use `@decaf-ts/for-testing/ui`.
- `tests/unit/cli/`: generic command wiring.
- `tests/unit/scenarios/luz/`: Luz scenario regression tests.
- `tests/runtime/scenario-cli.test.mjs`: compiled ESM/CommonJS scenario loading.
- `tests/integration/luz-browser.test.ts`: real Chromium tests of the adapter and
  calendar against local portal-shaped fixtures; run `npm run browser:install` first.
- `scripts/tray-integration.mjs`: desktop smoke and interactive action check.
- `workdocs/`: maintained module documentation used to assemble README/API docs.

## Automated validation

```bash
npm ci
npm run prepare-it-tests
npm run prepare-release
```

`prepare-it-tests` installs Chromium and its Linux system dependencies. On a local
desktop with those dependencies already installed, `npm run browser:install`
only downloads the browser. `prepare-release` runs lint, TypeScript checks, a dependency audit, a
production build, CLI/distribution tests, source tests with coverage thresholds,
documentation generation, and the package-content audit. `npm test` builds and
runs all tests; `npm run coverage` expects an existing production build.

GitHub's Test Coverage workflow and GitLab's validate job run these checks on
Node.js 24. They need no MyLuz credentials, graphical desktop, CAPTCHA response,
or confirmation code. Browser integration tests run headless against local
portal-shaped fixtures, reject requests to other origins, inject dummy fixture
credentials, and simulate MFA/CAPTCHA page changes within the test. Native tray
and window operations are replaced with test adapters. Coverage uses V8 so that
callbacks serialized into Chromium remain executable.

Compiled CLI tests import temporary ESM and CommonJS scenario files; distribution
tests exercise public library and bundle exports and the Luz Storyboard graph.
Neither suite opens the live portal. Automated checks never execute the desktop
tray script or the real watcher.

For individual suites, use `npm run test:unit -- --runInBand`,
`npm run test:integration -- --runInBand`, `npm run test:cli`, or
`npm run test:dist`. The last two require `npm run build:prod` first.

## Manual desktop and live checks

```bash
npm run tray:integration -- --smoke
# Interactive notification/menu delivery:
npm run tray:integration
```

The full interactive tray check verifies Open, Search, Accept, and Quit actions;
it does not submit real appointments. Real portal runs require manual login/MFA
and configured selectors. The default workflow books only after tray approval;
`--recursive` explicitly opts into repeated confirmed bookings before the cutoff.

The live exam route and final booking/confirmation selectors still need verification
against those portal screens. Local fixtures cover their adapter behavior, but
do not establish that a changed live portal accepts a real booking.

## Release prerequisites

Builds produce ESM, CommonJS, declarations, the standalone executable, and bundled
artifacts. `prepack` builds and audits the package. `check:package` checks every
public export and executable, and rejects private configuration, credential
files, or browser profiles in the npm file list. Decaf overrides keep one version
of each Decaf dependency.

The current candidate requires companion releases before a clean registry install:

1. Publish `@decaf-ts/for-testing@1.3.8` from `../testing`. Its Storyboard workflow
   API is required; the previously published 1.3.7 does not provide it.
2. Release a new `@decaf-ts/for-os` patch containing the notification lifetime
   fixes, then update this package's dependency and lockfile. Published 0.2.9
   predates the fixes, including the Windows notification host lifetime.
3. Refresh the lockfile against those published tarballs, verify a clean `npm ci`,
   rerun `npm run prepare-release`, and build the Docker image.
4. Require successful remote CI before publishing. For the first npm publication,
   configure authentication/trusted publishing for `@decaf-ts/scheduler` using
   `decaf-ts/web-scenario-scheduler` and `publish-on-release.yaml`.

Local checks using built companion packages cannot replace the clean-install and
remote-CI gates. No MyLuz account secrets belong in either CI provider.

## Container execution

Build with `docker build -t decaf-scheduler .` or `npm run docker:build-base`.
The image needs access to the host desktop display and notification bus to run
the watcher; it is not a headless service. Supply private credentials at runtime
rather than copying them into the image.
