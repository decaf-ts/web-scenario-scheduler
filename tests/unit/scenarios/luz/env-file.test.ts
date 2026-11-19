import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readAppointmentEnvFile } from "../../../../src/scenarios/luz/env-file";

describe("readAppointmentEnvFile", () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "myluz-env-test-"));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("reads comments, export syntax, and quoted dotenv values", async () => {
    const file = join(directory, "credentials.env");
    await writeFile(file, [
      "# ignored comment",
      "export MYLUZ_USERNAME = patient@example.test",
      'MYLUZ_PASSWORD="value with spaces # preserved" # trailing comment',
      "ANOTHER_PASSWORD='single quoted value'",
      "",
    ].join("\n"));

    await expect(readAppointmentEnvFile(file)).resolves.toEqual({
      MYLUZ_USERNAME: "patient@example.test",
      MYLUZ_PASSWORD: "value with spaces # preserved",
      ANOTHER_PASSWORD: "single quoted value",
    });
  });

  it("rejects malformed assignments without including values in errors", async () => {
    const file = join(directory, "invalid.env");
    await writeFile(file, "MYLUZ_PASSWORD='private credential\n");

    await expect(readAppointmentEnvFile(file)).rejects.toThrow(/line 1/);
    await expect(readAppointmentEnvFile(file)).rejects.not.toThrow(/private credential/);
  });
});
