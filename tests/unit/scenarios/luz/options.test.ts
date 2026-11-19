import { exactOptionIndexes, OptionsNotReadyError, waitForExactOption } from "../../../../src/scenarios/luz/options";

describe("exactOptionIndexes", () => {
  it("matches complete labels after normalizing whitespace and accents", () => {
    expect(exactOptionIndexes(["  Hospital da Luz   Lisboa ", "Hospital da Luz Oeiras"], "Hospital da Luz Lisboa")).toEqual([0]);
    expect(exactOptionIndexes(["Ortopédia"], "Ortopedia")).toEqual([0]);
  });

  it("does not treat a partial label as a match", () => {
    expect(exactOptionIndexes(["Ombro e Cotovelo", "Ortopedia"], "Ombro")).toEqual([]);
  });

  it("returns duplicates so callers can reject ambiguous choices", () => {
    expect(exactOptionIndexes(["Multicare", "Multicare", "ADSE"], "Multicare")).toEqual([0, 1]);
  });

  it("waits for a dependent select to populate before choosing an exact option", async () => {
    const optionSets = [[], [], ["Ortopedia"]];
    const selectedIndex = await waitForExactOption(
      async () => optionSets.shift() ?? ["Ortopedia"],
      "Ortopedia",
      "specialty",
      { wait: async () => undefined, timeoutMs: 1000 },
    );

    expect(selectedIndex).toBe(0);
  });

  it("marks a still-empty select as transient so the watcher can retry automatically", async () => {
    await expect(waitForExactOption(
      async () => [],
      "Ortopedia",
      "specialty",
      { wait: async () => new Promise((resolve) => setTimeout(resolve, 1)), timeoutMs: 5 },
    )).rejects.toBeInstanceOf(OptionsNotReadyError);
  });

  it("keeps a populated but unmatched option as a configuration error", async () => {
    await expect(waitForExactOption(
      async () => ["Cardiologia"],
      "Ortopedia",
      "specialty",
      { wait: async () => new Promise((resolve) => setTimeout(resolve, 1)), timeoutMs: 5 },
    )).rejects.toThrow("does not match an existing visible option");
  });
});
