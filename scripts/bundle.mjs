import { chmodSync, mkdirSync } from "node:fs";
import { isAbsolute } from "node:path";
import process from "node:process";
import { rollup } from "rollup";
import terser from "@rollup/plugin-terser";

// Bundle the compiled, version-stamped library for Node. Keep runtime packages
// and native addons external, including package subpaths and node: builtins.
mkdirSync("dist", { recursive: true });
const bundle = await rollup({
  input: "lib/esm/index.js",
  external: (id) => !id.startsWith(".") && !isAbsolute(id),
  plugins: process.argv.includes("--dev") ? [] : [terser()],
});
try {
  for (const [format, extension] of [["es", "js"], ["cjs", "cjs"]]) {
    await bundle.write({
      file: `dist/scheduler.${extension}`,
      format,
      exports: "named",
      sourcemap: true,
    });
  }
} finally {
  await bundle.close();
}
chmodSync("lib/cjs/bin/cli.cjs", 0o755);
