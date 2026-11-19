import type { BrowserVisibility } from "./browser-visibility";
import { Command, Option } from "commander";

/** Interactive MyLuz appointment/exam watcher command. */
function optionsCommand(): Command {
  return new Command("myluz")
    .description(
      "Run a visible, user-assisted MyLuz appointment search scenario"
    )
    .option(
      "-c, --config <file>",
      "JSON workflow configuration",
      "myluz.config.json"
    )
    .option(
      "-e, --env-file <file>",
      "dotenv file containing login credentials",
      ".env.secret"
    )
    .option(
      "--before <date>",
      "only consider dates strictly earlier than YYYY-MM-DD"
    )
    .option(
      "--recursive",
      "automatically book the first date in the interval, then only confirmed earlier dates"
    )
    .addOption(
      new Option("--kind <kind>", "booking kind: appointment or exam").choices([
        "appointment",
        "exam",
      ])
    )
    .addOption(
      new Option(
        "--browser-visibility <mode>",
        "browser visibility (overrides config)"
      ).choices(["when-needed", "always", "manual"])
    )
    .addHelpText(
      "after",
      `
Credentials are read from the environment variables named by the config
(defaults: MYLUZ_USERNAME and MYLUZ_PASSWORD). Values are loaded from
--env-file (default: .env.secret); shell variables take precedence. The browser uses a persistent profile for the site's normal session behavior. MFA must be
completed manually. An available appointment is booked only after choosing
"Accept appointment" from the tray menu, unless --recursive is set. --before
uses an exclusive YYYY-MM-DD cutoff. --recursive requires a verified
calendar date and booking confirmation selector; an initial --before is optional. It books the initial date
only within the configured interval, then uses each confirmed date as the next
exclusive cutoff. Previously booked visits are not cancelled automatically.
Use --kind exam with configured exam selectors to run the same flow for exams.

Polling is at least 5 minutes. If the site returns HTTP 403/429 or shows the
configured blocked selector, the watcher stops and asks you to review it.
This command does not hide automation, bypass bot checks, or simulate random
site activity. Configure selectors for the current MyLuz page in JSON.

Browser visibility defaults to when-needed: show for CAPTCHA/MFA/manual sign-in,
then minimize after authentication. Notification and tray Open always restore it.
Use always to keep the window visible, or manual to show only on explicit Open.

Install runtime pieces if needed:
  npm run browser:install
  npm run os:install
`
    );
}

export type LuzOptions = {
  config: string;
  envFile: string;
  before?: string;
  recursive?: boolean;
  browserVisibility?: BrowserVisibility;
  kind?: "appointment" | "exam";
};

/** Parse scenario-owned options without executing the scenario. */
export function parseLuzOptions(args: string[]): LuzOptions {
  return optionsCommand().parse(args, { from: "user" }).opts<LuzOptions>();
}

/** Compatible named shortcut; both entry paths execute the same Storyboard definition. */
export function myluzCommand(): Command {
  return optionsCommand().action(async (options: LuzOptions) => {
    const { runMyLuzScenario } = await import("./scenario");
    await runMyLuzScenario(options.config, options.envFile, options);
  });
}
