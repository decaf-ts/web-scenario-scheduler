/** Parse a calendar date expressed as ISO-8601 YYYY-MM-DD without local TZ drift. */
export function parseIsoDate(value: string): Date | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? parsed : undefined;
}

/** The cutoff is exclusive: only dates strictly before it match. */
export function isBeforeDate(candidate: string, cutoff?: string): boolean {
  const candidateDate = parseIsoDate(candidate);
  if (!candidateDate) return false;
  if (!cutoff) return true;
  const cutoffDate = parseIsoDate(cutoff);
  return Boolean(cutoffDate && candidateDate.getTime() < cutoffDate.getTime());
}

const months: Record<string, number> = {
  janeiro: 1, jan: 1,
  fevereiro: 2, fev: 2,
  março: 3, marco: 3, mar: 3,
  abril: 4, abr: 4,
  maio: 5, mai: 5,
  junho: 6, jun: 6,
  julho: 7, jul: 7,
  agosto: 8, ago: 8,
  setembro: 9, set: 9,
  outubro: 10, out: 10,
  novembro: 11, nov: 11,
  dezembro: 12, dez: 12,
};

/** Resolve a selected calendar day using its label and the visible month/year heading. */
export function parsePortalCalendarDate(selectedText: string, calendarText: string): string | undefined {
  const normalized = selectedText.trim();
  const iso = normalized.match(/\b(\d{4}-\d{2}-\d{2})\b/)?.[1];
  if (iso && parseIsoDate(iso)) return iso;
  const fullDate = normalized.match(/\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})\b/);
  if (fullDate) {
    const [, day, month, year] = fullDate;
    const date = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
    return parseIsoDate(date) ? date : undefined;
  }
  const dayMatch = normalized.match(/^\D*(\d{1,2})\D*$/);
  if (!dayMatch) return undefined;
  const heading = calendarText.toLocaleLowerCase("pt-PT").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const monthYear = heading.match(/\b(janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro|jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)\s+(\d{4})\b/);
  if (!monthYear) return undefined;
  const month = months[monthYear[1]];
  const day = Number(dayMatch[1]);
  const year = Number(monthYear[2]);
  const date = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return parseIsoDate(date) ? date : undefined;
}
