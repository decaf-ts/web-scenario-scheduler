import { Command } from "commander";
import { myluzCommand } from "../scenarios/luz/command";
import { runScenario } from "./scenario";

/** CLI module discovered by the Decaf CLI as `decaf scheduler`. */
const scheduler = new Command("scheduler")
  .description("Run Storyboard scenario definitions")
  .enablePositionalOptions();
scheduler.command("run <scenario> [args...]", { isDefault: true })
  .description("Import a .js/.mjs/.cjs Storyboard definition and execute its flow")
  .allowUnknownOption()
  .passThroughOptions()
  .action(async (file: string, args: string[]) => {
    await runScenario(file, args[0] === "--" ? args.slice(1) : args);
  });
scheduler.addCommand(myluzCommand());
export default scheduler;
