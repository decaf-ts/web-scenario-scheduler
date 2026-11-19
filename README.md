# Scheduler

MyLuz appointment and exam scheduling with a visible browser, native desktop
notifications, and explicit appointment approval.


![Licence](https://img.shields.io/github/license/decaf-ts/web-scenario-scheduler.svg?style=plastic)
![GitHub language count](https://img.shields.io/github/languages/count/decaf-ts/web-scenario-scheduler?style=plastic)
![GitHub top language](https://img.shields.io/github/languages/top/decaf-ts/web-scenario-scheduler?style=plastic)

[![Build & Test](https://github.com/decaf-ts/web-scenario-scheduler/actions/workflows/jest-coverage.yaml/badge.svg?event=pull_request)](https://github.com/decaf-ts/web-scenario-scheduler/actions/workflows/jest-coverage.yaml)
[![CodeQL](https://github.com/decaf-ts/web-scenario-scheduler/actions/workflows/codeql-analysis.yml/badge.svg)](https://github.com/decaf-ts/web-scenario-scheduler/actions/workflows/codeql-analysis.yml)[![Snyk Analysis](https://github.com/decaf-ts/web-scenario-scheduler/actions/workflows/snyk-analysis.yaml/badge.svg)](https://github.com/decaf-ts/web-scenario-scheduler/actions/workflows/snyk-analysis.yaml)
[![Release](https://github.com/decaf-ts/web-scenario-scheduler/actions/workflows/release-on-merge-pr.yml/badge.svg?event=pull_request)](https://github.com/decaf-ts/web-scenario-scheduler/actions/workflows/release-on-merge-pr.yml)

![Open Issues](https://img.shields.io/github/issues/decaf-ts/web-scenario-scheduler.svg)
![Closed Issues](https://img.shields.io/github/issues-closed/decaf-ts/web-scenario-scheduler.svg)
![Pull Requests](https://img.shields.io/github/issues-pr-closed/decaf-ts/web-scenario-scheduler.svg)
![Maintained](https://img.shields.io/badge/Maintained%3F-yes-green.svg)

![Forks](https://img.shields.io/github/forks/decaf-ts/web-scenario-scheduler.svg)
![Stars](https://img.shields.io/github/stars/decaf-ts/web-scenario-scheduler.svg)
![Watchers](https://img.shields.io/github/watchers/decaf-ts/web-scenario-scheduler.svg)

![Node Version](https://img.shields.io/badge/dynamic/json.svg?url=https%3A%2F%2Fraw.githubusercontent.com%2Fdecaf-ts%2Fweb-scenario-scheduler%2Fmaster%2Fpackage.json&label=Node&query=$.engines.node&colorB=blue)
![NPM Version](https://img.shields.io/badge/dynamic/json.svg?url=https%3A%2F%2Fraw.githubusercontent.com%2Fdecaf-ts%2Fweb-scenario-scheduler%2Fmaster%2Fpackage.json&label=NPM&query=$.engines.npm&colorB=purple)

Documentation [here](https://decaf-ts.github.io/web-scenario-scheduler/), Test results [here](https://decaf-ts.github.io/web-scenario-scheduler/workdocs/reports/html/test-report.html) and Coverage [here](https://decaf-ts.github.io/web-scenario-scheduler/workdocs/reports/coverage/lcov-report/index.html)



### Description

`@decaf-ts/scheduler` runs file-based JavaScript scenarios and ships the MyLuz
appointment and exam scheduler. It provides
`decaf scheduler myluz`, the standalone `decaf-scheduler myluz` executable,
and composable command/configuration APIs. Browser actions use
`@decaf-ts/for-testing/ui`; native trays and notifications come directly from
`@decaf-ts/for-os`. No runtime dependency on `@decaf-ts/with-ai` is required.


### How to Use

```bash
npm install
npm run build:prod
npm run browser:install
cp myluz.config.example.json myluz.config.json
npm run myluz:start -- --config ./myluz.config.json --env-file .env.secret
# With this package installed in the Decaf CLI environment:
decaf scheduler myluz --help
# Standalone executable:
decaf-scheduler myluz --help
```

Native trays and notifications use `@decaf-ts/for-os`. Decaf overrides ensure one
version per package. Its normal postinstall
configures the native addon; run `npm run os:install` to require or repair setup.
A graphical desktop is required for the browser and tray.

This candidate requires companion package releases before a clean registry
installation; see the [release prerequisites](https://github.com/decaf-ts/web-scenario-scheduler/blob/master/workdocs/tutorials/For%20Developers.md#release-prerequisites).

#### Run a scenario file

The CLI imports a local `StoryboardScenario` definition from
`@decaf-ts/for-testing/ui` and delegates execution to `StoryboardRunner.runScenario`.
Compile TypeScript before passing it to the CLI. `.js`, `.mjs`, and `.cjs` follow
Node's ESM/CommonJS rules, including relative imports and top-level await.

```bash
decaf-scheduler run ./scenarios/example.js --custom-option value
decaf-scheduler ./scenarios/example.js --custom-option value
decaf scheduler run ./scenarios/example.js --custom-option value
decaf-scheduler run ./lib/esm/scenarios/luz/index.js --config ./myluz.config.json
```

Export the definition as `default`, `storyboard`, or `scenario`. CommonJS can
use `module.exports = definition` or `exports.storyboard = definition`.
TypeScript's compiled `exports.default` is supported. Arbitrary runner functions
are not accepted. Arguments after the filename reach tasks as `context.args`;
an optional leading `--` separator is removed. Import and execution failures
produce a nonzero exit status.

```ts
import type { StoryboardScenario } from "@decaf-ts/for-testing/ui";

const storyboard: StoryboardScenario<{ checks: number }> = {
  id: "example", section: "Examples", title: "Repeat checks", route: "",
  flow: {
    initial: "check",
    state: () => ({ checks: 0 }),
    tasks: { check: ({ state, args }) => { state.checks++; console.log(args); } },
    conditions: { again: ({ state }) => state.checks < 3 },
    states: {
      check: {
        actions: [{ type: "task", name: "check" }],
        transitions: [{ when: "again", to: "check" }, { to: null }],
      },
    },
  },
};
export default storyboard;
```

The optional `flow` adds named states, ordered conditional transitions, shared
state, named tasks, and error transitions (`onError`). A transition to `null`
finishes the workflow. Optional `stopWhen` names a condition checked before
every state/action. `initialize` and `finalize` manage resources; `finalize`
runs on success, failure, and cancellation. `runScenario(file, args, signal)` and
the shared runner accept an `AbortSignal`. Tasks can use `context.signal` for
cooperative cancellation. Browser actions use the supplied `context.page`; the
workflow runner never creates, clears, or closes a browser context itself.
Tasks can also run without a browser, Jest, or Playwright Test. The original
screenshot/guide runner continues to use `runWithPage` for definitions without
`flow`.

All Luz-specific code is in `src/scenarios/luz/`: `scenario.ts` is the Storyboard
state graph and `index.ts` exports it. `session.ts` implements browser and tray
operations, while `command.ts` parses Luz options. The graph describes initial
login and manual verification waiting, search and approval, booking confirmation,
earlier-date cutoff updates, read-only keep-alive visits, and repeated searches.
The same persistent session is reused until Quit or cancellation. Bounded DOM
settling and selector polling remain implementation details of the adapter.

The package exports `@decaf-ts/scheduler/scenarios/luz` (with `scenarios/myluz`
as an alias), and retains `decaf-scheduler myluz` as a shortcut. The loader APIs
are exported from `@decaf-ts/scheduler/cli`.

This change requires the companion `@decaf-ts/for-testing@1.3.8` update in
`../testing`. Release that package before publishing/installing this scheduler
from the registry. Local verification uses the companion package's built output.

#### MyLuz appointment watcher

Luz notifications request **60 seconds** by default. Set `notificationTimeoutMs`
in the JSON config to adjust the duration; `0` requests no expiry. The native
service still controls presentation. A live Plasma test confirmed a 60.1-second
notification lifetime with the 60-second setting.

The companion `for-os` notification fixes must be released and pinned before
shipping this behavior on all platforms; published 0.2.9 predates those fixes.

The live portal uses two query steps. The watcher fills hospital, specialty,
consultation, doctor and insurer, then clicks **Continuar**. The portal initially
selects its first available appointment date. The watcher reads that date from
Pikaday's `data-pika-*` attributes and checks the requested interval. It never
changes the calendar month or selects another day. An initial date outside the
interval means wait and query again. Optional time bounds apply to the slots on
that displayed day.

A confirmed booking becomes the exclusive cutoff for subsequent attempts,
including bookings approved manually. Equal or later dates are rejected. With
`--recursive`, the first in-range date is approved automatically and subsequent
attempts can only book strictly earlier dates after confirmation. An initial
`--before` is optional, and can represent an appointment you already have.

Set `browserVisibility` in JSON or override it with
`--browser-visibility when-needed|always|manual`:

- `when-needed` (default): start minimized, show for CAPTCHA/MFA or required
  manual sign-in, then minimize after verification completes.
- `always`: start visible and leave visibility under your control.
- `manual`: start minimized and open only through a notification or tray Open.

Notification clicks and tray **Open MyLuz** restore/focus the browser in every
mode. An explicit Open stays visible during ordinary work; automatic minimization
occurs when an automatically raised verification step finishes. Minimizing a window
you opened explicitly returns subsequent steps to the background. Routine actions
use background input even after Open, so switching to another application does
not let the watcher reclaim focus.

Visibility is enforced before and after each browser action and navigation. Background
steps use native dropdown change handlers and DOM activation without desktop
pointer input: Chromium restores minimized windows for ordinary Playwright
pointer clicks. Select2 receives its normal selection/change events with
`noFocus`, and dependent filters wait for the preceding requests to finish.
Page scripts cannot raise the window themselves. Verification and explicit Open
restore normal visible browser interaction. Closing the managed browser stops
the watcher; minimizing it lets the loop continue.


`decaf scheduler myluz` runs its browser steps through `@decaf-ts/for-testing/ui`'s scenario action engine in a visible Chromium profile. With the default when-needed visibility, it stays minimized during searches and session-continuity navigation, comes forward for verification, and minimizes again after verification. On Linux, activating a desktop notification or choosing **Open MyLuz** from the tray restores and focuses the browser; on other platforms, use the tray menu to open it. It identifies the current page before acting and reuses an existing MyLuz tab in its persistent profile, so a restart can resume at login, MFA, the booking form, or results. It signs in using credentials from environment variables, waits for you to complete MFA in the browser, and opens **Marcar** (the booking route; **Agenda** is the existing-appointments list). It searches using configured filters on a loop (minimum interval: five minutes). The example config enables `keepAlive` visits to configured read-only account pages every minute. It rotates through those pages until the next query is due, then restores the appointment or exam search form and searches again. Page navigation is allowed to settle before the watcher reads controls or starts another search. When a matching available result appears, Linux desktop notifications offer **Accept appointment** and **See appointment** actions; activating the notification opens the browser, and the tray menu provides the same actions on every supported platform. **Accept appointment** clicks the configured booking button. Review the browser confirmation after the click. A session timeout pauses the watcher and sends a desktop notification so you can sign in again. The Rust tray addon sends OS notifications for confirmation required, human verification required, blocked/rate-limited access, and available appointments.

Copy `myluz.config.example.json` to `myluz.config.json`, then configure the visible selectors and values for hospital, specialty, consultation, doctor, insurance, date interval, and optional time interval. Defaults are Hospital da Luz Lisboa, Ortopedia, the portal’s exact consultation label `Consulta de Ortopedia - Ombro e Cotovelo`, Eduardo Carpinteiro, Multicare, and December 2026. The example config includes the observed Select2 fields, Continue/Back controls, Pikaday selected day, and schedule card selectors. Exam and final booking/confirmation selectors still require verification against those portal screens. Date text inputs are optional when the portal exposes the Pikaday calendar. Set `bookingKind` to `exam` and configure `search.exam`, `selectors.examSearch`, and `selectors.exam` to use the portal's exam booking flow. The default navigation selector opens **Marcar**. Each configured dropdown value must exactly match one available option before the watcher selects it; unmatched or ambiguous values stop the search. Between dependent dropdowns, the watcher waits for the chosen label and refreshed options to settle. Store `MYLUZ_USERNAME` and `MYLUZ_PASSWORD` in `.env.secret` (the default env file) or another dotenv file; credentials are not stored in the JSON config. Shell environment variables override values from the file:

```bash
npm run browser:install
npm run os:install
npm run build:prod
decaf scheduler myluz --config ./myluz.config.json --env-file .env.secret
# Or specify a separate file: --env-file ~/.config/myluz/credentials.env
# Only consider dates before the cutoff (exclusive):
decaf scheduler myluz --before 2026-12-31
# Repeatedly book a found date, then tighten the cutoff to that date and search earlier.
decaf scheduler myluz --recursive
# Or start with an existing appointment as an exclusive cutoff:
decaf scheduler myluz --before 2026-12-31 --recursive
# Use the configured exam workflow instead of appointments:
decaf scheduler myluz --kind exam
```

`--recursive` requires verified selected-date and booking-confirmation selectors; it can start from the configured interval without `--before`. It submits a found booking automatically, advances the exclusive cutoff only after the portal's confirmation is visible, and leaves prior bookings unchanged. Configure the portal's response cadence responsibly; the watcher enforces a five-minute minimum and stops on access-denied, CAPTCHA, or rate-limit signals. It does not attempt to disguise automation or bypass site protections.

The watcher uses ordinary visible browser behavior, preserves the site's normal session storage, and never attempts to hide automation, bypass bot checks, or create random browsing activity. Interactive human-verification challenges require manual completion in the visible browser; the watcher holds the session open and resumes only after the page changes. It stops on HTTP 403/429 or the configured blocked-page selector instead of retrying. Outside `--recursive`, the tray's accepted booking action is the only automated action that submits a booking. Both modes wait for confirmation before narrowing the cutoff. Recursive mode submits each progressively earlier slot after the configured result action and proceeds only after the configured confirmation selector appears; verify every booking in the browser.

#### Validation

```bash
npm run test:unit -- --runInBand
npm run prepare-it-tests
npm run build:prod
npm run coverage
npm run docs
npm run check:package
```

These automated checks run headless against local browser fixtures with dummy
credentials and simulated CAPTCHA/MFA. They reject requests outside the fixture
origin and use a fake native tray; CI needs no MyLuz credentials or human input.
`npm run prepare-release` runs the full lint, typecheck, production build, tests,
coverage, documentation, and package audit. Compiled tests require a build first.

Desktop checks are separate and opt-in: `npm run tray:integration -- --smoke`.
The desktop smoke check creates and updates the real tray, dispatches a native
notification, and disposes its resources. Run `npm run tray:integration` without
`--smoke` to manually verify notification and menu action delivery. The per-action
timeout defaults to 90 seconds; override `SCHEDULER_TRAY_TEST_TIMEOUT_MS` to change it.
Notification buttons are Linux-only; macOS and Windows use the tray menu.
Private `myluz.config.json` and `.env.secret` files are ignored by Git and excluded
from the published package. Credentials remain in the environment or dotenv file.


### Related

[![Readme Card](https://github-readme-stats.vercel.app/api/pin/?username=decaf-ts&repo=web-scenario-scheduler)](https://github.com/decaf-ts/web-scenario-scheduler)

### Social

[![LinkedIn](https://img.shields.io/badge/LinkedIn-0077B5?style=for-the-badge&logo=linkedin&logoColor=white)](https://www.linkedin.com/in/TiagoVenceslau/)




#### Languages

![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black)
![NodeJS](https://img.shields.io/badge/Node.js-43853D?style=for-the-badge&logo=node.js&logoColor=white)
![ShellScript](https://img.shields.io/badge/Shell_Script-121011?style=for-the-badge&logo=gnu-bash&logoColor=white)

## Getting help

If you have bug reports, questions or suggestions, please [create a new issue](https://github.com/decaf-ts/web-scenario-scheduler/issues/new/choose).

## Contributing

I am grateful for any contributions made to this project. Please read [the contributing guide](https://github.com/decaf-ts/web-scenario-scheduler/blob/master/workdocs/tutorials/Contributing.md) to get started.

## Supporting

The first and easiest way you can support it is by [Contributing](./workdocs/tutorials/Contributing.md). Even just finding a typo in the documentation is important.

Financial support is always welcome and helps keep both me and the project alive and healthy.

So if you can, if this project in any way. either by learning something or simply by helping you save precious time, please consider donating.

## License

This project is released under the [MIT License](./LICENSE.md).

By developers, for developers...