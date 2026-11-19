#!/usr/bin/env node
import scheduler from "../cli/cli-module";

// Recognize the standalone shorthand before Commander scans scenario-owned options.
const args = process.argv.slice(2);
if (args[0] && !args[0].startsWith("-") &&
    !["help", ...scheduler.commands.map((command) => command.name())].includes(args[0])) {
  args.unshift("run");
}

void scheduler.parseAsync(args, { from: "user" }).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
