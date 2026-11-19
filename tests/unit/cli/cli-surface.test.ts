import { scheduler, myluzCommand } from "../../../src/cli/index";
import * as api from "../../../src/index";

it("exposes a generic file runner and the compatible MyLuz command", () => {
  expect(scheduler.name()).toBe("scheduler");
  expect(scheduler.commands.map((command) => command.name())).toEqual([
    "run",
    "myluz",
  ]);
  expect(myluzCommand().name()).toBe("myluz");
  for (const member of [
    "runScenario",
    "loadScenario",
    "createLuzStoryboard",
    "createLuzSession",
    "loadAppointmentConfig",
    "createAppointmentTray",
  ] as const)
    expect(typeof api[member]).toBe("function");
});
