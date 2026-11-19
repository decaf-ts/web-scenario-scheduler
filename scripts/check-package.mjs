import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import process from "node:process";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const npmCLI = process.env.npm_execpath;
const result = spawnSync(
  npmCLI ? process.execPath : npm,
  [...(npmCLI ? [npmCLI] : []), "pack", "--dry-run", "--ignore-scripts", "--json"],
  { encoding: "utf8", shell: !npmCLI && process.platform === "win32" }
);
assert.ifError(result.error);
assert.equal(result.status, 0, result.stderr);
const [pack] = JSON.parse(result.stdout);
const files = new Set(pack.files.map(({ path }) => path));
const privatePath =
  /(^|\/)(\.env(?:\..*)?|.*\.env|\.npmrc(?:\..*)?|.*token|myluz\.config\.json|browser-profile|\.myluz-assistant|node_modules)(\/|$)/i;
assert.deepEqual(
  [...files].filter((file) => privatePath.test(file)),
  [],
  "Private files must never be packed"
);
const requireFile = (file) =>
  assert.ok(
    files.has(file.replace(/^\.\//, "")),
    `Missing package file: ${file}`
  );
const walk = (value) => {
  if (typeof value === "string") requireFile(value);
  else for (const child of Object.values(value)) walk(child);
};
walk(pkg.exports);
for (const key of ["main", "module", "types"]) requireFile(pkg[key]);
for (const file of Object.values(pkg.bin)) {
  requireFile(file);
  assert.ok(
    readFileSync(file, "utf8").startsWith("#!/usr/bin/env node"),
    "CLI must have a Node shebang"
  );
}
requireFile("myluz.config.example.json");
console.log(
  `Package layout verified: ${files.size} files; all exports, types and CLI targets present; private files excluded.`
);
