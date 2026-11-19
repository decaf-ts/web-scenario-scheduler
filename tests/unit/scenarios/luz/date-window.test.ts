import { isBeforeDate, parseIsoDate, parsePortalCalendarDate } from "../../../../src/scenarios/luz/date-window";

describe("appointment date window", () => {
  test("accepts only valid ISO calendar dates", () => {
    expect(parseIsoDate("2026-12-01")?.toISOString()).toBe("2026-12-01T00:00:00.000Z");
    expect(parseIsoDate("2026-02-30")).toBeUndefined();
    expect(parseIsoDate("01/12/2026")).toBeUndefined();
  });

  test("treats the --before cutoff as exclusive", () => {
    expect(isBeforeDate("2026-12-30", "2026-12-31")).toBe(true);
    expect(isBeforeDate("2026-12-31", "2026-12-31")).toBe(false);
    expect(isBeforeDate("2027-02-22", "2026-12-31")).toBe(false);
    expect(isBeforeDate("2026-12-01")).toBe(true);
  });

  test("resolves a selected day against the Portuguese calendar heading", () => {
    expect(parsePortalCalendarDate("22", "FEVEREIRO 2027")).toBe("2027-02-22");
    expect(parsePortalCalendarDate("22/02/2027", "FEVEREIRO 2027")).toBe("2027-02-22");
    expect(parsePortalCalendarDate("22", "Unexpected calendar")).toBeUndefined();
  });
});
