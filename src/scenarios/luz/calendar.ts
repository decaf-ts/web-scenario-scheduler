import { parseIsoDate } from "./date-window";

type CalendarElement = {
  dataset: Record<string, string | undefined>;
};

export type CalendarPage = { locator(selector: string): any };
export type CalendarWindow = {
  fromDate?: string;
  toDate?: string;
  before?: string;
};

export function calendarDate(
  year: string,
  zeroBasedMonth: string,
  day: string
): string | undefined {
  if (
    !/^\d{4}$/.test(year) ||
    !/^\d{1,2}$/.test(zeroBasedMonth) ||
    !/^\d{1,2}$/.test(day)
  )
    return undefined;
  const date = `${year}-${String(Number(zeroBasedMonth) + 1).padStart(2, "0")}-${day.padStart(2, "0")}`;
  return parseIsoDate(date) ? date : undefined;
}

/** Read the selected day from Pikaday attributes, without parsing dropdown option text. */
export async function selectedPortalDate(
  page: CalendarPage
): Promise<string | undefined> {
  const selected = page.locator(".pika-table td.is-selected button.pika-day");
  if ((await selected.count()) !== 1) return undefined;
  const parts = await selected.evaluate((e: CalendarElement) => [
    e.dataset.pikaYear,
    e.dataset.pikaMonth,
    e.dataset.pikaDay,
  ]);
  return calendarDate(parts[0] ?? "", parts[1] ?? "", parts[2] ?? "");
}

/** Check the provider's first available date without moving its calendar or selecting another day. */
export function isDateInWindow(date: string, window: CalendarWindow): boolean {
  for (const value of [date, window.fromDate, window.toDate, window.before]) {
    if (value && !parseIsoDate(value))
      throw new Error(`Invalid calendar date: ${value}`);
  }
  return (
    (!window.fromDate || date >= window.fromDate) &&
    (!window.toDate || date <= window.toDate) &&
    (!window.before || date < window.before)
  );
}

export async function firstAvailablePortalDate(
  page: CalendarPage,
  window: CalendarWindow
): Promise<string | undefined> {
  const date = await selectedPortalDate(page);
  if (!date)
    throw new Error(
      "Could not read the portal's initially selected available date."
    );
  return isDateInWindow(date, window) ? date : undefined;
}
