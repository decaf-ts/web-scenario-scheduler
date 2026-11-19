/** Wait until the rendered page state stops changing during a portal navigation. */
export async function waitForSettledPageState<State extends string>(options: {
  readState: () => Promise<State>;
  waitForDomContentLoaded?: () => Promise<unknown>;
  isTransient?: (state: State) => boolean;
  pause?: (milliseconds: number) => Promise<void>;
  timeoutMs?: number;
  stableSamples?: number;
  sampleIntervalMs?: number;
}): Promise<State> {
  const pause = options.pause ?? ((milliseconds) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const timeoutMs = options.timeoutMs ?? 15_000;
  const stableSamples = options.stableSamples ?? 3;
  const sampleIntervalMs = options.sampleIntervalMs ?? 250;
  await options.waitForDomContentLoaded?.().catch(() => undefined);

  const deadline = Date.now() + timeoutMs;
  let previous: State | undefined;
  let stableCount = 0;
  let last: State | undefined;
  while (Date.now() < deadline) {
    try {
      last = await options.readState();
    } catch {
      // Navigation can destroy the current execution context; retry on the new document.
      previous = undefined;
      stableCount = 0;
      await pause(sampleIntervalMs);
      continue;
    }
    if (!options.isTransient?.(last) && last === previous) stableCount++;
    else stableCount = 1;
    if (!options.isTransient?.(last) && stableCount >= stableSamples) return last;
    previous = last;
    await pause(sampleIntervalMs);
  }
  throw new Error(`The MyLuz page did not settle within ${timeoutMs}ms${last ? ` (last state: ${last})` : ""}.`);
}
