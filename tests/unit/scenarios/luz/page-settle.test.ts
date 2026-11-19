import { waitForSettledPageState } from "../../../../src/scenarios/luz/page-settle";

describe("waitForSettledPageState", () => {
  it("retries a destroyed context and returns only after the new state is stable", async () => {
    const states: Array<string | Error> = [
      new Error("Execution context was destroyed"),
      "results",
      "results",
      "results",
    ];
    const state = await waitForSettledPageState({
      readState: async () => {
        const next = states.shift() ?? "unknown";
        if (next instanceof Error) throw next;
        return next;
      },
      pause: async () => undefined,
      sampleIntervalMs: 0,
    });

    expect(state).toBe("results");
  });

  it("does not accept unknown while a route is still transitioning", async () => {
    const states = ["unknown", "appointment-form", "appointment-form", "appointment-form"];
    const state = await waitForSettledPageState({
      readState: async () => states.shift() ?? "appointment-form",
      isTransient: (value) => value === "unknown",
      pause: async () => undefined,
      sampleIntervalMs: 0,
    });

    expect(state).toBe("appointment-form");
  });
});
