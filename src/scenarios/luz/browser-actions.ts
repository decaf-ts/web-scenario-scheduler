import { setTimeout as delay } from "node:timers/promises";
import {
  applyStoryboardAction,
  type StoryboardAction,
  type StoryboardPage,
} from "@decaf-ts/for-testing/ui";
import type { BrowserVisibilityController } from "./browser-visibility";

/** Desktop activation belongs to attention steps and explicit Open requests. */
export function preventAutomaticWindowFocus(): void {
  const view = globalThis as any;
  if (view === view.top) view.focus = () => undefined;
}

/** Chromium restores minimized windows for pointer clicks, including trial clicks. */
export async function clickInBackground(
  locator: any,
  options: { timeout?: number } = {}
): Promise<void> {
  const timeout = options.timeout ?? 15_000;
  const deadline = timeout === 0 ? Infinity : Date.now() + timeout;
  const remaining = () =>
    deadline === Infinity ? 0 : Math.max(1, deadline - Date.now());
  do {
    await locator.waitFor({ state: "visible", timeout: remaining() });
    if (await locator.isEnabled()) {
      const clicked = await locator.evaluate(
        (element: any) => {
          if (
            !element.isConnected ||
            !element.getClientRects().length ||
            element.closest(':disabled,[aria-disabled="true"],[inert]')
          )
            return false;
          if (typeof element.click !== "function")
            throw new Error("The background click target cannot be activated.");
          element.click();
          return true;
        },
        undefined,
        { timeout: remaining() }
      );
      if (clicked) return;
    }
    await delay(Math.min(100, remaining() || 100));
  } while (Date.now() < deadline);
  throw new Error(
    `Background click target did not become enabled within ${timeout}ms.`
  );
}

async function selectInBackground(
  locator: any,
  requested: unknown
): Promise<void> {
  if (!(await locator.isEnabled()))
    throw new Error("The background dropdown is disabled.");
  await locator.evaluate((element: any, requested: any) => {
    const normalize = (text: string) => text.replace(/\s+/g, " ").trim();
    const option = Array.from(element.options).find((item: any) =>
      typeof requested === "string"
        ? item.value === requested
        : normalize(item.label) === normalize(requested.label)
    ) as any;
    if (!option || option.disabled || option.parentElement?.disabled)
      throw new Error("The background dropdown option is unavailable.");
    const jquery = (globalThis as any).jQuery;
    const widget = jquery?.fn?.select2 && jquery(element).data("select2");
    if (widget) {
      // Preserve the widget's selection/change events, skipping its final
      // focusser.focus() call that otherwise activates the browser window.
      if (
        typeof widget.onSelect === "function" &&
        typeof widget.optionToData === "function"
      )
        widget.onSelect(widget.optionToData(jquery(option)), { noFocus: true });
      else jquery(element).select2("val", option.value, true);
    } else {
      element.value = option.value;
      option.selected = true;
      for (const type of ["input", "change"])
        element.dispatchEvent(
          new (globalThis as any).Event(type, { bubbles: true })
        );
    }
  }, requested);
}

/** Retain Storyboard targeting while keeping ordinary work from taking focus. */
export async function applyLuzAction(
  page: StoryboardPage,
  action: StoryboardAction,
  visibility: BrowserVisibilityController
): Promise<void> {
  await visibility.background(async () => {
    if (
      !["click", "select"].includes(action.type) ||
      visibility.mode === "always"
    ) {
      await applyStoryboardAction(page, action);
      return;
    }
    const target = (locator: any): any => ({
      first: () => target(locator.first()),
      nth: (index: number) => target(locator.nth(index)),
      filter: (options: unknown) => target(locator.filter(options)),
      click: (options: { timeout?: number }) =>
        clickInBackground(locator, options),
      selectOption: (value: unknown) => selectInBackground(locator, value),
    });
    await applyStoryboardAction(
      {
        locator: (selector: string) => target(page.locator(selector)),
      } as StoryboardPage,
      action
    );
  })();
}
