import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Application } from "typedoc";

// Assemble the maintained README includes before generating API documentation.
const includes = readFileSync("workdocs/Readme.md", "utf8");
const readme = includes.replace(/^#include "([^"\n]+)"/gm, (_, file) => readFileSync(file, "utf8"));
writeFileSync("README.md", readme);

const config = JSON.parse(readFileSync("workdocs/typedoc.json", "utf8"));
config.navigationLinks = Object.fromEntries(
  Object.entries(config.navigationLinks).filter(([, href]) =>
    !href.startsWith("workdocs/reports/") || existsSync(href)
  )
);
const app = await Application.bootstrapWithPlugins(config);
const project = await app.convert();
if (!project) throw new Error("TypeDoc conversion failed");
rmSync("docs", { recursive: true, force: true });
await app.generateDocs(project, "docs");
if (app.logger.hasErrors()) throw new Error("TypeDoc generation failed");
for (const directory of ["coverage", "html"]) {
  const source = join("workdocs/reports", directory);
  if (existsSync(source)) {
    const parent = "docs/workdocs/reports";
    mkdirSync(parent, { recursive: true });
    cpSync(source, join(parent, directory), { recursive: true });
  }
}
