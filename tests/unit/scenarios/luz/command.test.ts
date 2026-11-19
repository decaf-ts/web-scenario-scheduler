import { myluzCommand } from "../../../../src/scenarios/luz/command";

describe("myluz CLI options", () => {
  it("parses an exclusive date cutoff, recursive booking, and exam mode", () => {
    const command = myluzCommand();
    command.parseOptions(["--before", "2026-12-31", "--recursive", "--kind", "exam"]);

    expect(command.opts()).toMatchObject({
      before: "2026-12-31",
      recursive: true,
      kind: "exam",
    });
  });
});

it("parses when-needed visibility and allows recursive booking from the configured interval", () => {
  const command = myluzCommand();
  command.parseOptions(["--recursive", "--browser-visibility", "when-needed"]);
  expect(command.opts()).toMatchObject({ recursive: true, browserVisibility: "when-needed" });
  expect(command.opts().before).toBeUndefined();
});
