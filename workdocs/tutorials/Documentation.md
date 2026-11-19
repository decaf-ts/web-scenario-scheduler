# Maintaining scheduler documentation

`npm run docs` assembles `README.md` from the files listed in
`workdocs/Readme.md`, then uses TypeDoc to generate `docs/` from the TypeScript
source. Edit the maintained Markdown includes rather than the generated README.

`workdocs/typedoc.json` defines the package, CLI, and Luz scenario entry points.
The generated site includes the guides in `workdocs/tutorials/`. Available test
and coverage reports are copied into the site; a clean documentation build does
not require reports, a desktop, or portal credentials.

## Public API comments

TypeDoc reads TypeScript signatures directly, including interfaces, generics,
and return types. Use comments to describe behavior, arguments with constraints,
side effects, cancellation, and errors that a caller needs to handle. Add
`@param`, `@returns`, `@example`, and `@see` where they clarify the API. Mark
implementation details with `@internal` when they should be omitted from the
public site. No framework-specific declaration or menu tags are required.

Keep runnable CLI examples aligned with `--help` and the actual package exports.
A generic scenario must export a `StoryboardScenario` definition from
`@decaf-ts/for-testing/ui`. Target-specific instructions and selectors belong
under the matching `src/scenarios/<target>/` directory and its maintained guides.

## Verification

```bash
npm run docs
npm run check:package
```

The package audit expects a production build. `npm run prepare-release` also
checks lint, types, dependency advisories, tests, coverage, documentation, and
package contents. CI uses headless browser fixtures with dummy credentials.
Real browser/tray checks remain separate manual tasks, described in the
developer guide. Do not add private configuration, environment files, browser
profiles, CAPTCHA responses, or real confirmation codes to examples or fixtures.

The documentation toolchain uses TypeDoc's maintained default theme. The previous
Better Docs theme and TaffyDB were removed because their dependency tree contained
known vulnerabilities. Do not reinstall them to build this package's docs.
