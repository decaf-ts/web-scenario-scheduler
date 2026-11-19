import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadAppointmentConfig } from "../../../../src/scenarios/luz/config";

describe("loadAppointmentConfig", () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "myluz-config-test-"));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("loads every appointment filter and date/time bound from JSON", async () => {
    const file = join(directory, "myluz.json");
    const selectors = Object.fromEntries([
      "username", "password", "submitLogin", "confirmationScreen", "authenticated", "search", "backToSearch", "examSearch",
      "doctor", "exam", "hospital", "specialty", "consultation", "subSpecialty", "insurance",
      "fromDate", "toDate", "fromTime", "toTime", "submitSearch", "searchResults",
      "resultCard", "resultAvailable", "resultDescription", "selectedDate", "bookButton", "bookingConfirmation", "loggedOut", "blocked",
    ].map((key) => [key, `[data-selector="${key}"]`]));
    await writeFile(file, JSON.stringify({
      url: "https://myluz.hospitaldaluz.pt/MYLUZ/",
      intervalMs: 300_000,
      keepAlive: {
        enabled: true,
        intervalMs: 300_000,
        pages: [
          { name: "Invoices", selector: "text=Invoices" },
          { name: "Account", selector: "text=Account" },
        ],
      },
      selectors,
      search: {
        hospital: "Hospital da Luz Lisboa",
        specialty: "Ortopedia",
        consultation: "Ombro e Cotovelo",
        doctor: "Eduardo Carpinteiro",
        insurance: "Multicare",
        fromDate: "2026-12-01",
        toDate: "2026-12-31",
        fromTime: "09:00",
        toTime: "13:00",
      },
    }));

    const config = await loadAppointmentConfig(file);
    expect(config.notificationTimeoutMs).toBe(60_000);
    expect(config.browserVisibility).toBe("when-needed");
    expect(config.search).toEqual({
      hospital: "Hospital da Luz Lisboa",
      specialty: "Ortopedia",
      consultation: "Ombro e Cotovelo",
      doctor: "Eduardo Carpinteiro",
      insurance: "Multicare",
      fromDate: "2026-12-01",
      toDate: "2026-12-31",
      fromTime: "09:00",
      toTime: "13:00",
    });
    expect(config.keepAlive).toEqual({
      enabled: true,
      intervalMs: 300_000,
      pages: [
        { name: "Invoices", selector: "text=Invoices" },
        { name: "Account", selector: "text=Account" },
      ],
    });
  });

  it("requires explicit destinations and a one-minute floor for session continuity visits", async () => {
    const file = join(directory, "myluz-keepalive.json");
    const selectors = Object.fromEntries([
      "username", "password", "submitLogin", "confirmationScreen", "authenticated", "search", "backToSearch", "examSearch",
      "doctor", "exam", "hospital", "specialty", "consultation", "subSpecialty", "insurance",
      "fromDate", "toDate", "fromTime", "toTime", "submitSearch", "searchResults",
      "resultCard", "resultAvailable", "resultDescription", "selectedDate", "bookButton", "bookingConfirmation", "loggedOut", "blocked",
    ].map((key) => [key, `[data-selector="${key}"]`]));
    const base = { selectors, intervalMs: 900_000 };

    await writeFile(file, JSON.stringify({ ...base, keepAlive: { enabled: true, pages: [] } }));
    await expect(loadAppointmentConfig(file)).rejects.toThrow("keepAlive.pages must contain at least one");

    await writeFile(file, JSON.stringify({
      ...base,
      keepAlive: { enabled: true, intervalMs: 30_000, pages: [{ name: "Account", selector: "text=Account" }] },
    }));
    await expect(loadAppointmentConfig(file)).rejects.toThrow("keepAlive.intervalMs must be at least 60000 (1 minute)");

    await writeFile(file, JSON.stringify({
      ...base,
      keepAlive: { enabled: true, intervalMs: 60_000, pages: [{ name: "Account", selector: "text=Account" }] },
    }));
    await expect(loadAppointmentConfig(file)).resolves.toMatchObject({ keepAlive: { intervalMs: 60_000 } });
  });
});
