/** Normalizes whitespace and diacritics while preserving whole-label matching. */
export function normalizeOptionLabel(value: string): string {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/\s+/g, " ").trim().toLocaleLowerCase();
}

/** Returns every index whose option label exactly matches the requested value. */
export function exactOptionIndexes(options: string[], requested: string): number[] {
  const target = normalizeOptionLabel(requested);
  return options.flatMap((option, index) => normalizeOptionLabel(option) === target ? [index] : []);
}

/** The portal has not finished refreshing a dependent dropdown yet. */
export class OptionsNotReadyError extends Error {
  constructor(fieldName: string) {
    super(`The ${fieldName} options are still loading; the watcher will retry automatically.`);
    this.name = "OptionsNotReadyError";
  }
}

/** Wait for an asynchronously refreshed select to expose a unique exact option. */
export async function waitForExactOption(optionsReader: () => Promise<string[]>, requested: string, fieldName: string, config: {
  timeoutMs?: number;
  intervalMs?: number;
  wait?: (milliseconds: number) => Promise<void>;
} = {}): Promise<number> {
  const timeoutMs = config.timeoutMs ?? 15_000;
  const intervalMs = config.intervalMs ?? 250;
  const wait = config.wait ?? ((milliseconds) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const deadline = Date.now() + timeoutMs;
  let lastOptions: string[] = [];
  while (Date.now() < deadline) {
    try {
      lastOptions = await optionsReader();
    } catch {
      lastOptions = [];
    }
    const matches = exactOptionIndexes(lastOptions, requested);
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) {
      throw new Error(`The ${fieldName} value "${requested}" matches multiple visible options.`);
    }
    await wait(intervalMs);
  }
  if (!lastOptions.length) throw new OptionsNotReadyError(fieldName);
  throw new Error(`The ${fieldName} value "${requested}" does not match an existing visible option. Visible options: ${lastOptions.slice(0, 30).join(" | ")}`);
}
