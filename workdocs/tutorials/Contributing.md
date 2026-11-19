# Contributing

Use Node.js 24 and npm 10+.

```bash
git clone https://github.com/decaf-ts/web-scenario-scheduler.git
cd web-scenario-scheduler
npm ci
npm run prepare-it-tests
npm run prepare-release
```

The current candidate needs companion package releases before a fresh registry
install can succeed. Follow the [release prerequisites](https://github.com/decaf-ts/web-scenario-scheduler/blob/master/workdocs/tutorials/For%20Developers.md#release-prerequisites)
in the developer guide.

Automated tests use local, headless browser fixtures and dummy credentials.
No MyLuz account, desktop tray, CAPTCHA, or confirmation code is needed. Manual
live checks are separate; never add real credentials or browser profiles to a
contribution.

Keep changes focused and add meaningful regression coverage for changed behavior.
Update the maintained files under `workdocs/`; `npm run docs` regenerates README
and API documentation. Open a [pull request](https://github.com/decaf-ts/web-scenario-scheduler/compare)
and require successful CI before merging. Contributions use the repository's
MIT license.

Merging a pull request can trigger the configured release workflows. Check the
companion package versions, clean installation, and release prerequisites before
merging a release candidate. See the developer and documentation guides for the
supported public entry points and validation commands.
