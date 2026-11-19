import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { after, test } from "node:test";
import { StoryboardRunner } from "@decaf-ts/for-testing/ui";

const require = createRequire(import.meta.url);
const pkg = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url))
);
const temporary = mkdtempSync(join(tmpdir(), "scheduler-distribution-"));
after(() => rmSync(temporary, { recursive: true, force: true }));

for (const [name, file] of [
  ["ESM", "lib/esm/index.js"],
  ["CommonJS", "lib/cjs/index.cjs"],
  ["ESM bundle", "dist/scheduler.js"],
  ["CommonJS bundle", "dist/scheduler.cjs"],
]) {
  test(`${name} exposes the supported public API and executes an imported Storyboard`, async () => {
    const api = file.endsWith(".cjs")
      ? require(resolve(file))
      : await import(pathToFileURL(resolve(file)).href);
    assert.equal(api.VERSION, pkg.version);
    assert.equal(api.default.name(), "scheduler");
    for (const member of [
      "loadScenario",
      "runScenario",
      "createLuzStoryboard",
      "createLuzSession",
      "loadAppointmentConfig",
      "createAppointmentTray",
    ])
      assert.equal(typeof api[member], "function", member);
    const scenario = join(temporary, `${name.replaceAll(" ", "-")}.mjs`);
    writeFileSync(
      scenario,
      `export default { id: "distribution", section: "Tests", title: "Repeat", route: "", flow: {
      initial: "check", state: () => ({ count: 0 }),
      tasks: { check: ({ state, args }) => { if (args[0] !== "fixture") throw Error("arguments lost"); state.count++; } },
      conditions: { again: ({state}) => state.count < 3 },
      states: { check: { actions: [{type: "task", name: "check"}], transitions: [{when: "again", to: "check"}, {to: null}] } }
    } };`
    );
    assert.equal((await api.loadScenario(scenario)).id, "distribution");
    await api.runScenario(scenario, ["fixture"]);
  });
  test(`${name} runs the Luz graph through its public session-factory contract`, async () => {
    const api = file.endsWith(".cjs")
      ? require(resolve(file))
      : await import(pathToFileURL(resolve(file)).href);
    let running = true,
      checks = 0,
      closed = 0,
      keptAlive = 0,
      waiting = true;
    const scenario = api.createLuzStoryboard(async () => ({
      page: {},
      running: () => running,
      authenticated: async () => true,
      login: async () => {},
      signInTick: async () => {},
      prepareSearch: async () => {},
      beginCycle: () => {},
      search: async () => {
        checks++;
        if (checks === 2) running = false;
        return false;
      },
      beginWait: () => {
        waiting = true;
      },
      pollWait: () => {},
      waiting: () => waiting,
      searchRequested: () => false,
      keepAliveDue: () => true,
      visitKeepAlive: async () => {
        keptAlive++;
        waiting = false;
      },
      waitTick: async () => {},
      returnToSearch: async () => {},
      discardCandidate: () => {},
      hasCandidate: () => false,
      recursive: () => false,
      accepted: () => false,
      pollApproval: async () => {},
      book: async () => {},
      confirmed: async () => false,
      confirmationPending: () => false,
      tightenCutoff: () => {},
      pollPause: async () => {},
      recover: async (error) => {
        throw error;
      },
      reportFatal: (error) => {
        throw error;
      },
      close: async () => {
        closed++;
      },
    }));
    await StoryboardRunner.runScenario(scenario, { args: [] });
    assert.equal(checks, 2);
    assert.equal(keptAlive, 1);
    assert.equal(closed, 1);
  });
}
