#!/usr/bin/env node
/**
 * Interactive integration check for the compiled Rust tray addon and the
 * TypeScript appointment tray adapter. It requires a graphical desktop tray
 * and asks the operator to activate four actions.
 */
const process = globalThis.process;
import { createAppointmentTray } from "../lib/esm/scenarios/luz/tray.js";

const smokeOnly = process.argv.includes("--smoke");
const timeoutMs = Number(process.env.SCHEDULER_TRAY_TEST_TIMEOUT_MS || 90_000);
const expectedActions = [
  { id: "open", instruction: "activate the MyLuz desktop notification to open the browser" },
  { id: "search", instruction: "click the tray icon and choose “Search now”" },
  { id: "accept", instruction: "open the tray menu and choose “Accept appointment”" },
  { id: "quit", instruction: "open the tray menu and choose “Quit”" },
];

let tray;
const actions = [];
let wake;

function waitForAction(expected) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const poll = () => {
      const index = actions.indexOf(expected);
      if (index >= 0) {
        actions.splice(index, 1);
        resolve();
        return;
      }
      if (Date.now() >= deadline) {
        reject(new Error(`Timed out waiting for tray menu action "${expected}".`));
        return;
      }
      wake = setTimeout(poll, 100);
    };
    poll();
  });
}

async function main() {
  tray = await createAppointmentTray((action) => actions.push(action));
  if (!tray.available) {
    throw new Error("The native tray could not be created. Build it with npm run os:install and run this check in a desktop session.");
  }

  tray.setAcceptEnabled(false);
  if (smokeOnly) {
    tray.setStatus("Tray integration smoke check");
    tray.setAcceptEnabled(true, "Accept appointment (smoke check)");
    tray.notify("MyLuz tray test", "Rust delivered this test notification through the operating system.");
    await new Promise((resolve) => setTimeout(resolve, 750));
    console.log("PASS: native Rust tray created, updated, notified, and closed through the TypeScript adapter.");
    return;
  }

  for (const [index, step] of expectedActions.entries()) {
    if (step.id === "open") tray.notify("MyLuz tray test", "Activate this notification to test opening the browser from a popup.");
    if (step.id === "accept") tray.setAcceptEnabled(true);
    tray.setStatus(`Tray integration check ${index + 1}/${expectedActions.length}: ${step.id}`);
    console.log(`Step ${index + 1}/${expectedActions.length}: ${step.instruction}.`);
    await waitForAction(step.id);
    console.log(`Received native tray action: ${step.id}`);
  }
  console.log("PASS: Rust tray, menu events, and the TypeScript appointment tray adapter are integrated.");
}

try {
  await main();
  process.exitCode = 0;
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  if (wake) clearTimeout(wake);
  tray?.close();
}

