import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import process from "node:process";
import { join, resolve } from "node:path";
import { after, test } from "node:test";

// Exercise the actual distributable binaries: Jest's transform can hide CJS/ESM import bugs.
const temporary = mkdtempSync(join(tmpdir(), "scheduler scenarios # "));
after(() => rmSync(temporary, { recursive: true, force: true }));
function fixture(name, source) {
  const path = join(temporary, name);
  writeFileSync(path, source);
  return path;
}
const printArgs = `{
  id: "example", section: "Tests", title: "Definition", route: "",
  flow: {
    initial: "print", state: () => ({}),
    tasks: { print: async ({ args }) => { await new Promise(r => setTimeout(r, 10)); console.log(JSON.stringify(args)); } },
    states: { print: { actions: [{ type: "task", name: "print" }], transitions: [{ to: null }] } }
  }
}`;
mkdirSync(join(temporary, "directory.mjs"));
const scenarios = [
  fixture("default.mjs", `await Promise.resolve(); export default ${printArgs};`),
  fixture("named.mjs", `export const storyboard = ${printArgs};`),
  fixture("commonjs.cjs", `module.exports = ${printArgs};`),
  fixture("named.cjs", `exports.storyboard = ${printArgs};`),
  fixture("transpiled.cjs", `exports.default = ${printArgs};`),
  fixture("javascript.js", `module.exports = ${printArgs};`),
];
function invoke(format, args, options = {}) {
  const bin = resolve(format === "cjs" ? "lib/cjs/bin/cli.cjs" : "lib/esm/bin/cli.js");
  const result = spawnSync(process.execPath, [bin, ...args], { encoding: "utf8", timeout: 10_000, ...options });
  assert.ifError(result.error);
  return result;
}

for (const format of ["cjs", "esm"]) {
  for (const scenario of scenarios) {
    test(`${format} CLI imports ${scenario} and awaits it with unchanged arguments`, () => {
      const args = ["--config", "a file.json", "positional", "--custom=value", "-x"];
      const result = invoke(format, ["run", scenario, ...args]);
      assert.equal(result.status, 0, result.stderr || String(result.error));
      assert.deepEqual(JSON.parse(result.stdout), args);
    });
  }

  test(`${format} CLI accepts a relative file directly and an option separator`, () => {
    const result = invoke(format, ["./default.mjs", "--", "--help", "value"], { cwd: temporary });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), ["--help", "value"]);
  });

  test(`${format} direct-file syntax forwards scenario help without a separator`, () => {
    const result = invoke(format, [scenarios[0], "--help"]);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), ["--help"]);
  });

  test(`${format} CLI runs JavaScript in an ESM package`, () => {
    const file = fixture(`esm-${format}.js`, `export default ${printArgs};`);
    writeFileSync(join(temporary, "package.json"), '{"type":"module"}');
    try {
      const result = invoke(format, ["run", file]);
      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(JSON.parse(result.stdout), []);
    } finally {
      rmSync(join(temporary, "package.json"));
    }
  });

  const failures = [
    ["missing.mjs", null, /ENOENT/],
    ["directory.mjs", null, /must be a file/],
    ["invalid.mjs", "export default {};", /must export a StoryboardScenario/],
    ["failure.mjs", `const scenario = ${printArgs}; scenario.flow.tasks.print = async () => { throw new Error("scenario failed"); }; export default scenario;`, /scenario failed/],
    ["function.mjs", "export default async () => {};", /must export a StoryboardScenario/],
    ["import-failure.mjs", "throw new Error('import failed');", /import failed/],
    ["uncompiled.ts", "export default () => {};", /Compile TypeScript first/],
    ["syntax.mjs", "export default (", /Unexpected/],
  ];
  for (const [name, source, expected] of failures) {
    test(`${format} CLI reports ${name} and exits unsuccessfully`, () => {
      const file = source === null ? join(temporary, name) : fixture(name, source);
      const result = invoke(format, ["run", file]);
      assert.equal(result.status, 1, result.stderr);
      assert.match(result.stderr, expected);
    });
  }

  test(`${format} MyLuz scenario file exposes its own options`, () => {
    const file = resolve(format === "cjs" ? "lib/cjs/scenarios/luz/index.cjs" : "lib/esm/scenarios/luz/index.js");
    const result = invoke(format, ["run", file, "--help"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /--before/);
    assert.match(result.stdout, /--recursive/);
  });

  for (const target of ["luz", "myluz"]) {
    test(`${format} package exports the ${target} scenario entry`, () => {
      const specifier = `@decaf-ts/scheduler/scenarios/${target}`;
      const source = format === "cjs"
        ? `const { default: run } = require(${JSON.stringify(specifier)}); console.log(Boolean(run.flow && run.id === "luz-appointments"));`
        : `import run from ${JSON.stringify(specifier)}; console.log(Boolean(run.flow && run.id === "luz-appointments"));`;
      const result = spawnSync(process.execPath, ["--input-type", format === "cjs" ? "commonjs" : "module", "-e", source], {
        encoding: "utf8", timeout: 10_000,
      });
      assert.ifError(result.error);
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stdout.trim(), "true");
    });
  }

  test(`${format} CLI retains the MyLuz shortcut`, () => {
    const result = invoke(format, ["myluz", "--help"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /--kind/);
  });
}

test("loading the CLI does not load browser or native scenario dependencies", () => {
  const cli = resolve("lib/cjs/cli/index.cjs");
  const result = spawnSync(process.execPath, ["-e", `
    require(${JSON.stringify(cli)});
    const loaded = Object.keys(require.cache);
    if (loaded.some(file => /playwright|for-os|for-testing|scenarios[/\\\\]luz[/\\\\]scenario/.test(file))) {
      throw new Error('CLI eagerly loaded scenario dependencies');
    }
  `], { encoding: "utf8", timeout: 10_000 });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
});
