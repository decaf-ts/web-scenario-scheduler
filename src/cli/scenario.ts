import { stat } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { StoryboardScenario } from "@decaf-ts/for-testing/ui";

// Keep native import in CommonJS builds, including ESM with top-level await.
const importModule = new Function("specifier", "return import(specifier)") as (
  specifier: string
) => Promise<Record<string, unknown>>;

/** Load a Storyboard definition, never an arbitrary runner function. */
export async function loadScenario(file: string): Promise<StoryboardScenario> {
  const absolute = resolve(file);
  if (![".js", ".mjs", ".cjs"].includes(extname(absolute))) {
    throw new Error(
      `Scenario must be a .js, .mjs, or .cjs file. Compile TypeScript first: ${file}`
    );
  }
  if (!(await stat(absolute)).isFile())
    throw new Error(`Scenario must be a file: ${file}`);
  const module = await importModule(pathToFileURL(absolute).href);
  const commonjs =
    module.default && typeof module.default === "object"
      ? (module.default as Record<string, unknown>)
      : undefined;
  const candidate = [
    commonjs?.default,
    module.default,
    module.storyboard,
    module.scenario,
    commonjs?.storyboard,
    commonjs?.scenario,
  ].find(
    (value) =>
      value &&
      typeof value === "object" &&
      typeof (value as StoryboardScenario).id === "string" &&
      typeof (value as StoryboardScenario).title === "string" &&
      typeof (value as StoryboardScenario).section === "string" &&
      (value as StoryboardScenario).flow
  );
  if (!candidate) {
    throw new Error(
      `Scenario ${file} must export a StoryboardScenario with a flow definition (default, storyboard, or scenario).`
    );
  }
  return candidate as StoryboardScenario;
}

/** Import a definition and delegate its execution to @decaf-ts/for-testing. */
export async function runScenario(
  file: string,
  args: string[] = [],
  signal?: AbortSignal
): Promise<void> {
  const scenario = await loadScenario(file);
  const { StoryboardRunner } = await import("@decaf-ts/for-testing/ui");
  await StoryboardRunner.runScenario(scenario, { args, signal });
}
