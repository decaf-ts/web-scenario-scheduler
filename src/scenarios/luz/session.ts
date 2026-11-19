import {
  firstAvailablePortalDate,
  isDateInWindow,
  selectedPortalDate,
} from "./calendar";
import {
  BrowserVisibilityController,
  type BrowserVisibility,
} from "./browser-visibility";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  type StoryboardAction,
  type StoryboardPage,
} from "@decaf-ts/for-testing/ui";
import { applyLuzAction, preventAutomaticWindowFocus } from "./browser-actions";
import { loadAppointmentConfig } from "./config";
import {
  isBeforeDate,
  parseIsoDate,
  parsePortalCalendarDate,
} from "./date-window";
import { readAppointmentEnvFile } from "./env-file";
import {
  exactOptionIndexes,
  OptionsNotReadyError,
  waitForExactOption,
} from "./options";
import { waitForSettledPageState } from "./page-settle";
import {
  classifyMyLuzPage,
  isLuzMfaRoute,
  hasHumanVerificationPrompt,
  type MyLuzPageState,
} from "./page-state";
import { createAppointmentTray, type AppointmentTrayAction } from "./tray";

type BrowserPage = {
  goto(
    url: string,
    options?: {
      waitUntil?: "load" | "domcontentloaded" | "networkidle" | "commit";
    }
  ): Promise<unknown>;
  url(): string;
  bringToFront(): Promise<void>;
  locator(selector: string): any;
  waitForLoadState?(
    state: "domcontentloaded" | "networkidle",
    options?: { timeout?: number }
  ): Promise<unknown>;
  on?(event: string, listener: (event: any) => void): void;
};

async function visible(page: BrowserPage, selector: string): Promise<boolean> {
  try {
    const locator = page.locator(selector);
    return (await locator.count()) > 0 && (await locator.first().isVisible());
  } catch {
    return false;
  }
}

function isConfiguredSelector(selector: string): boolean {
  return Boolean(selector.trim()) && !selector.startsWith("REPLACE_WITH_");
}

async function confirmationVisible(
  page: BrowserPage,
  selector: string
): Promise<boolean> {
  if (isLuzMfaRoute(page.url())) return true;
  if (isConfiguredSelector(selector) && (await visible(page, selector)))
    return true;
  const genericCodeFields = [
    'input[autocomplete="one-time-code"]',
    'input[id*="otp" i]',
    'input[name*="otp" i]',
    'input[id*="code" i]',
    'input[name*="code" i]',
    'input[placeholder*="código" i]',
    'input[placeholder*="code" i]',
  ].join(",");
  if (await visible(page, genericCodeFields)) return true;
  const bodyText = await page
    .locator("body")
    .innerText()
    .catch(() => "");
  return /(?:c[oó]digo|code).{0,60}(?:sms|confirma|verifica|seguran)|(?:sms|confirma|verifica|seguran).{0,60}(?:c[oó]digo|code)/i.test(
    bodyText
  );
}

async function selectedCalendarDate(
  page: BrowserPage,
  selector: string
): Promise<string | undefined> {
  if (await page.locator(".pika-table").count())
    return selectedPortalDate(page);
  const bodyText = await page
    .locator("body")
    .innerText()
    .catch(() => "");
  if (isConfiguredSelector(selector) && (await visible(page, selector))) {
    const label = await page
      .locator(selector)
      .first()
      .innerText()
      .catch(() => "");
    const parsed = parsePortalCalendarDate(label, bodyText);
    if (parsed) return parsed;
  }
  const selectedLabels = await page
    .locator(
      '[aria-current="date"],[aria-selected="true"],[aria-pressed="true"],[data-selected="true"],.ui-datepicker-current-day,.selected-date'
    )
    .evaluateAll(
      (
        elements: Array<{ innerText?: string; textContent?: string | null }>
      ) => [
        ...new Set(
          elements
            .map((element) =>
              (element.innerText ?? element.textContent ?? "").trim()
            )
            .filter((label) => /^\d{1,2}$/.test(label))
        ),
      ]
    )
    .catch(() => [] as string[]);
  if (selectedLabels.length !== 1) return undefined;
  return parsePortalCalendarDate(selectedLabels[0], bodyText);
}

export interface LuzSession {
  page: StoryboardPage;
  running(): boolean;
  authenticated(): Promise<boolean>;
  login(): Promise<void>;
  signInTick(): Promise<void>;
  prepareSearch(): Promise<void>;
  beginCycle(): void;
  search(): Promise<boolean>;
  pollApproval(): Promise<void>;
  accepted(): boolean;
  hasCandidate(): boolean;
  searchRequested(): boolean;
  discardCandidate(): void;
  book(): Promise<void>;
  recursive(): boolean;
  confirmed(): Promise<boolean>;
  confirmationPending(): boolean;
  tightenCutoff(): void;
  returnToSearch(): Promise<void>;
  beginWait(): void;
  pollWait(): void;
  waiting(): boolean;
  keepAliveDue(): boolean;
  visitKeepAlive(): Promise<void>;
  waitTick(): Promise<void>;
  recover(error: unknown): Promise<"retry" | "sign-in" | "paused">;
  pollPause(): Promise<void>;
  reportFatal(error: unknown): void;
  close(): Promise<void>;
}

export type MyLuzRunOptions = {
  before?: string;
  recursive?: boolean;
  browserVisibility?: BrowserVisibility;
  kind?: "appointment" | "exam";
};

/** Logs visible control labels and selectors without reading their entered values. */
async function visibleControlMetadata(
  page: BrowserPage
): Promise<Array<Record<string, string | undefined>>> {
  return page
    .locator("input,select,textarea,button,a,[role=button]")
    .evaluateAll(
      (
        elements: Array<{
          tagName: string;
          id: string;
          getAttribute(name: string): string | null;
          innerText?: string;
          labels?: Array<{ innerText: string }>;
          getBoundingClientRect(): { width: number; height: number };
        }>
      ) =>
        elements
          .filter((element) => {
            const bounds = element.getBoundingClientRect();
            return bounds.width > 0 && bounds.height > 0;
          })
          .map((element) => ({
            tag: element.tagName.toLowerCase(),
            type: element.getAttribute("type") ?? undefined,
            id: element.id || undefined,
            name: element.getAttribute("name") ?? undefined,
            placeholder: element.getAttribute("placeholder") ?? undefined,
            ariaLabel: element.getAttribute("aria-label") ?? undefined,
            label:
              Array.from(element.labels ?? [])
                .map((label) => label.innerText.trim())
                .filter(Boolean)
                .join(" ") || undefined,
            text: !["INPUT", "SELECT", "TEXTAREA"].includes(element.tagName)
              ? (element.innerText ?? "")
                  .replace(/\s+/g, " ")
                  .trim()
                  .slice(0, 80)
              : undefined,
          }))
          .filter(
            (element) =>
              element.tag !== "a" ||
              /agenda|consulta|marcar|hor[aá]rio|appointment|book/i.test(
                element.text ?? ""
              )
          )
    );
}

async function recordLoginAttempt(profileDir: string): Promise<void> {
  const file = join(profileDir, "login-attempts.json");
  const cutoff = Date.now() - 15 * 60_000;
  let attempts: number[] = [];
  try {
    const parsed = JSON.parse(await readFile(file, "utf8")) as unknown;
    if (Array.isArray(parsed))
      attempts = parsed.filter(
        (value): value is number => typeof value === "number" && value > cutoff
      );
  } catch {
    // A missing or unreadable history starts conservatively with no known attempts.
  }
  if (attempts.length >= 3) {
    const retryAt = new Date(
      Math.min(...attempts) + 15 * 60_000
    ).toLocaleTimeString();
    throw new Error(
      `Stopped before another MyLuz login submission: this profile has used 3 login attempts in 15 minutes. Try again after ${retryAt}.`
    );
  }
  attempts.push(Date.now());
  await writeFile(file, JSON.stringify(attempts), {
    encoding: "utf8",
    mode: 0o600,
  });
}

export async function createLuzSession(
  configFile: string,
  envFile: string,
  options: MyLuzRunOptions = {},
  signal?: AbortSignal
): Promise<LuzSession> {
  const sleep = (ms: number) => delay(ms, undefined, { signal });
  let config = await loadAppointmentConfig(configFile);
  const bookingKind = options.kind ?? config.bookingKind;
  let beforeDate = options.before;
  if (beforeDate && !parseIsoDate(beforeDate))
    throw new Error("--before must be a valid YYYY-MM-DD date.");
  if (
    bookingKind === "exam" &&
    !isConfiguredSelector(config.selectors.examSearch)
  ) {
    throw new Error(
      "Exam mode requires selectors.examSearch to point to the portal's exam-booking route."
    );
  }
  if (bookingKind === "exam" && !config.search.exam) {
    throw new Error(
      "Exam mode requires search.exam to match an existing portal option."
    );
  }
  if (beforeDate && !isConfiguredSelector(config.selectors.selectedDate)) {
    throw new Error(
      "--before requires selectors.selectedDate so the calendar date can be verified; Pikaday bounds are applied on the availability page."
    );
  }
  if (
    options.recursive &&
    (!isConfiguredSelector(config.selectors.bookingConfirmation) ||
      !isConfiguredSelector(config.selectors.selectedDate))
  ) {
    throw new Error(
      "--recursive requires configured selectors.selectedDate and selectors.bookingConfirmation so dates and completed bookings can be verified."
    );
  }
  const environment = {
    ...(await readAppointmentEnvFile(envFile)),
    ...process.env,
  };
  const username = environment[config.usernameEnv];
  const password = environment[config.passwordEnv];
  if (!username || !password)
    throw new Error(
      `Set both ${config.usernameEnv} and ${config.passwordEnv} in the environment before starting.`
    );

  let page: BrowserPage | undefined;
  const filterRequests = new Set<unknown>();
  let filterActivityAt = Date.now();
  let setBrowserWindowState:
    ((state: "normal" | "minimized") => Promise<void>) | undefined;
  let readBrowserWindowState: (() => Promise<string>) | undefined;
  let acceptRequested: boolean;
  let searchRequested: boolean;
  let quitRequested = false;
  let candidateIndex: number | undefined;
  let candidateDate: string | undefined;
  const actions: AppointmentTrayAction[] = [];
  const tray = await createAppointmentTray(
    (action) => {
      actions.push(action);
      if (action === "accept") acceptRequested = true;
      if (action === "search") searchRequested = true;
      if (action === "quit") quitRequested = true;
      if (action === "open") void visibility.open();
    },
    { notificationTimeoutMs: config.notificationTimeoutMs }
  );
  if (!tray.available) {
    tray.close();
    throw new Error(
      "The system tray is required for appointment approval. Build it with: npm run os:install"
    );
  }
  const preserveBrowserOnTermination = () => {
    tray.setStatus("Termination requested — browser kept open");
    tray.notify(
      "MyLuz browser kept open",
      "A shutdown request was received. The watcher is paused so you can preserve the current sign-in step; choose Quit in the tray when ready."
    );
  };
  process.on("SIGTERM", preserveBrowserOnTermination);
  let context: any;
  let siteBlocked = false;

  let selectors = config.selectors;
  const searchRouteSelector = () =>
    bookingKind === "exam" ? selectors.examSearch : selectors.search;
  const takeActions = () => actions.splice(0, actions.length);
  const visibility = new BrowserVisibilityController(
    options.browserVisibility ?? config.browserVisibility,
    {
      async show() {
        try {
          await setBrowserWindowState?.("normal");
        } catch (error) {
          console.warn(`Could not restore the MyLuz window: ${String(error)}`);
        }
        try {
          await page?.bringToFront();
        } catch (error) {
          console.warn(`Could not focus the MyLuz browser: ${String(error)}`);
        }
      },
      async isMinimized() {
        try {
          return (await readBrowserWindowState?.()) === "minimized";
        } catch {
          return false;
        }
      },
      async hide() {
        try {
          await setBrowserWindowState?.("minimized");
        } catch (error) {
          console.warn(`Could not minimize the MyLuz window: ${String(error)}`);
        }
      },
    }
  );
  // Apply policy around each input/action, including the individual selections inside a query.
  const runScenarioAction = async (
    browserPage: BrowserPage,
    action: StoryboardAction
  ): Promise<void> => {
    await applyLuzAction(
      browserPage as unknown as StoryboardPage,
      action,
      visibility
    );
  };
  const navigate = async (
    browserPage: BrowserPage,
    url: string
  ): Promise<void> => {
    await visibility.background(async () => {
      await browserPage.goto(url, { waitUntil: "domcontentloaded" });
    })();
  };
  const waitForPageToSettle = async () =>
    waitForSettledPageState({
      readState: () => identifyPage(),
      waitForDomContentLoaded: () =>
        page!.waitForLoadState?.("domcontentloaded", { timeout: 3_000 }) ??
        Promise.resolve(),
      isTransient: (state) => state === "unknown",
    });
  const loginFormVisible = async (): Promise<boolean> =>
    (await visible(page!, selectors.username)) &&
    (await visible(page!, selectors.password));
  const isAuthenticated = async (): Promise<boolean> =>
    !(await loginFormVisible()) &&
    !(await confirmationVisible(page!, selectors.confirmationScreen)) &&
    ((isConfiguredSelector(selectors.authenticated) &&
      (await visible(page!, selectors.authenticated))) ||
      (await visible(page!, selectors.hospital)) ||
      (await visible(page!, selectors.doctor)) ||
      (await visible(page!, selectors.exam)));
  let signInWaitingSince = Date.now();
  let signInNotified = false;
  const signInTick = async (): Promise<void> => {
    await verifyNotBlocked();
    takeActions();
    const state = await identifyPage().catch(() => "unknown" as MyLuzPageState);
    if (state === "blocked") stopForSiteBlock();
    if (state === "human-verification") {
      tray.setStatus(
        "Human verification required — complete it in the browser"
      );
      if (!signInNotified)
        tray.notify(
          "MyLuz verification required",
          "Complete the visible challenge manually in Chrome. The browser will stay open."
        );
      signInNotified = true;
    } else if (!signInNotified && state === "confirmation") {
      signInNotified = true;
      tray.notify(
        "MyLuz confirmation needed",
        "Enter the confirmation code and continue in the visible browser."
      );
    }
    if (!signInNotified && Date.now() - signInWaitingSince > 10_000) {
      signInNotified = true;
      tray.notify(
        "MyLuz sign-in",
        "Finish sign-in in the visible browser. The browser will stay open while waiting."
      );
    }
  };
  const stopForSiteBlock = (): never => {
    tray.setStatus("Site requested that automation stop");
    tray.notify(
      "MyLuz watcher stopped",
      "The site returned an access-denied or rate-limit response, or displayed its configured blocked screen. Review it in the browser; the watcher will not retry."
    );
    throw new Error(
      "MyLuz denied or rate-limited automated access; stopping without retry."
    );
  };
  const verifyNotBlocked = async () => {
    if (siteBlocked || (await visible(page!, selectors.blocked)))
      stopForSiteBlock();
  };
  const handleLogout = async (): Promise<void> => {
    candidateIndex = undefined;
    tray.setOpenText("Open MyLuz");
    tray.setAcceptEnabled(false);
    tray.setStatus("Logged out — sign in again in the browser");
    tray.notify(
      "MyLuz sign-in required",
      "The session ended. Sign in again in the visible browser, then choose Search now in the tray menu."
    );
    await visibility.requireAttention("login");
    signInWaitingSince = Date.now();
    signInNotified = false;
    throw new Error("MyLuz session requires sign-in.");
  };
  const verifySession = async () => {
    await verifyNotBlocked();
    if (
      (await visible(page!, selectors.loggedOut)) ||
      (await loginFormVisible())
    )
      await handleLogout();
  };
  const identifyPage = async (): Promise<MyLuzPageState> => {
    await verifyNotBlocked();
    const bodyText = await page!
      .locator("body")
      .innerText()
      .catch(() => "");
    const pageTitle = (await (page as any).title?.().catch(() => "")) ?? "";
    const cards = isConfiguredSelector(selectors.resultCard)
      ? page!.locator(selectors.resultCard)
      : undefined;
    const results = Boolean(cards && (await cards.count()) > 0);
    const appointmentForm = [
      selectors.hospital,
      selectors.specialty,
      selectors.consultation,
      selectors.doctor,
      selectors.exam,
    ].some((selector) => isConfiguredSelector(selector))
      ? await Promise.all(
          [
            selectors.hospital,
            selectors.specialty,
            selectors.consultation,
            selectors.doctor,
            selectors.exam,
          ]
            .filter(isConfiguredSelector)
            .map((selector) => visible(page!, selector))
        ).then((values) => values.some(Boolean))
      : false;
    const authenticated =
      isConfiguredSelector(selectors.authenticated) &&
      (await visible(page!, selectors.authenticated));
    const blocked =
      (await visible(page!, selectors.blocked)) ||
      /access denied|acesso negado|too many requests|muitas tentativas/i.test(
        bodyText
      );
    const challengeControls = [
      'iframe[src*="captcha" i]',
      'iframe[title*="captcha" i]',
      'iframe[src*="challenge" i]',
      'iframe[title*="challenge" i]',
      'iframe[src*="arkose" i]',
      '[id*="captcha" i]',
      '[class*="captcha" i]',
      "[data-sitekey]",
      '[id*="challenge" i]',
      '[class*="challenge" i]',
      ".h-captcha",
      ".g-recaptcha",
      '[aria-label*="verification" i]',
    ].join(",");
    const humanVerification =
      (await visible(page!, challengeControls)) ||
      hasHumanVerificationPrompt(bodyText);
    const state = classifyMyLuzPage({
      url: (page as any).url?.() ?? "",
      title: pageTitle,
      bodyText,
      loginForm: await loginFormVisible(),
      confirmation: await confirmationVisible(
        page!,
        selectors.confirmationScreen
      ),
      humanVerification,
      loggedOut: await visible(page!, selectors.loggedOut),
      blocked,
      appointmentForm,
      results,
      authenticated,
    });
    if (state === "confirmation" || state === "human-verification") {
      await visibility.requireAttention(state);
    } else if (["home", "appointment-form", "results"].includes(state)) {
      await visibility.clearAttention();
    }
    return state;
  };
  const open = async (): Promise<void> => {
    await mkdir(config.profileDir, { recursive: true });
    context = await chromium.launchPersistentContext(config.profileDir, {
      headless: false,
      viewport: { width: 1365, height: 900 },
      args:
        (options.browserVisibility ?? config.browserVisibility) === "always"
          ? []
          : ["--start-minimized"],
      ...(environment.MYLUZ_CHROMIUM_EXECUTABLE_PATH
        ? { executablePath: environment.MYLUZ_CHROMIUM_EXECUTABLE_PATH }
        : {}),
    });
    if ((options.browserVisibility ?? config.browserVisibility) !== "always")
      await context.addInitScript(preventAutomaticWindowFocus);
    // Persistent contexts may still have a live MyLuz tab. Reuse it so a
    // confirmation prompt or in-progress signed-in flow is never discarded.
    const existingPages = context.pages() as BrowserPage[];
    const browserPage = (existingPages.find((candidate: any) => {
      try {
        return (
          new URL(candidate.url()).hostname === new URL(config.url).hostname
        );
      } catch {
        return false;
      }
    }) ??
      existingPages[0] ??
      (await context.newPage())) as BrowserPage;
    page = browserPage;
    browserPage.on?.("close", () => {
      quitRequested = true;
    });
    if ((options.browserVisibility ?? config.browserVisibility) !== "always")
      await (browserPage as unknown as StoryboardPage).evaluate(
        preventAutomaticWindowFocus
      );
    try {
      const devtools = await context.newCDPSession(browserPage);
      const { windowId } = await devtools.send("Browser.getWindowForTarget");
      readBrowserWindowState = async () =>
        (await devtools.send("Browser.getWindowBounds", { windowId })).bounds
          .windowState;
      setBrowserWindowState = async (state) => {
        await devtools.send("Browser.setWindowBounds", {
          windowId,
          bounds: { windowState: state },
        });
      };
    } catch (error) {
      console.warn(
        `Could not minimize the background MyLuz browser: ${error instanceof Error ? error.message : String(error)}`
      );
    }
    await visibility.initialize();
    const portalOrigin = new URL(config.url).origin;
    browserPage.on?.("request", (request: any) => {
      if (
        ["document", "xhr", "fetch"].includes(request.resourceType()) &&
        new URL(request.url()).origin === portalOrigin
      ) {
        filterRequests.add(request);
        filterActivityAt = Date.now();
      }
    });
    const finishFilterRequest = (request: unknown) => {
      if (filterRequests.delete(request)) filterActivityAt = Date.now();
    };
    browserPage.on?.("requestfinished", finishFilterRequest);
    browserPage.on?.("requestfailed", finishFilterRequest);
    browserPage.on?.("response", (response) => {
      if (response.status() === 403 || response.status() === 429)
        siteBlocked = true;
    });
    const currentUrl = (browserPage as any).url?.() ?? "about:blank";
    if (
      currentUrl === "about:blank" ||
      (() => {
        try {
          return new URL(currentUrl).hostname !== new URL(config.url).hostname;
        } catch {
          return true;
        }
      })()
    ) {
      await navigate(browserPage, config.url);
    }
    const necessaryCookiesButton =
      'input[type="submit"][value="Aceitar estritamente necessários"]';
    if (await visible(browserPage, necessaryCookiesButton)) {
      await runScenarioAction(browserPage, {
        type: "click",
        selector: necessaryCookiesButton,
      });
    }
    const pageState = await identifyPage();
    console.log(
      `MyLuz page detected at startup: ${pageState} (${(browserPage as any).url?.() ?? "unknown URL"})`
    );
    if (pageState === "blocked") stopForSiteBlock();
  };

  const login = async (): Promise<void> => {
    signal?.throwIfAborted();
    if (quitRequested) return;
    const pageState = await identifyPage();
    if (
      pageState === "login" ||
      pageState === "confirmation" ||
      pageState === "human-verification" ||
      !(await isAuthenticated())
    ) {
      if (pageState !== "human-verification" && (await loginFormVisible())) {
        await recordLoginAttempt(config.profileDir);
        await runScenarioAction(page!, {
          type: "fill",
          selector: selectors.username,
          value: username,
        });
        await runScenarioAction(page!, {
          type: "fill",
          selector: selectors.password,
          value: password,
        });
        const credentialsReady =
          (await page!.locator(selectors.username).inputValue()) === username &&
          (await page!.locator(selectors.password).inputValue()) === password;
        if (!credentialsReady)
          throw new Error(
            "MyLuz login fields did not retain the configured credentials; login was not submitted."
          );
        await runScenarioAction(page!, {
          type: "click",
          selector: selectors.submitLogin,
        });
        const transitionDeadline = Date.now() + 20_000;
        let submittedState: MyLuzPageState = "login";
        while (Date.now() < transitionDeadline) {
          submittedState = await identifyPage();
          if (submittedState !== "login") break;
          await sleep(500);
        }
        console.log(
          `MyLuz login submission finished at page state: ${submittedState}`
        );
        if (submittedState === "human-verification") {
          tray.setStatus(
            "Human verification required — complete it in the browser"
          );
          tray.notify(
            "MyLuz verification required",
            "Complete the visible verification challenge manually in Chrome. The watcher will not bypass it and will keep this browser open."
          );
        } else if (submittedState === "login") {
          await visibility.requireAttention("login");
          tray.setStatus("Login form remains open — sign-in not confirmed");
          tray.notify(
            "MyLuz login not confirmed",
            "The login form is still visible after submission. Check for an on-page validation message or verification step; credentials will not be resubmitted automatically."
          );
        }
      }
      tray.setStatus("Complete MyLuz confirmation in the browser");
    }
  };

  const prepareSearch = async (): Promise<void> => {
    const pageState = await identifyPage();
    if (pageState === "blocked") stopForSiteBlock();
    tray.setStatus("Signed in — checking appointments");
    tray.notify(
      "MyLuz watcher ready",
      "Sign-in is complete. The configured search will run at its stated interval."
    );
    if (
      pageState !== "appointment-form" &&
      pageState !== "results" &&
      isConfiguredSelector(selectors.search) &&
      (await visible(page!, selectors.search))
    ) {
      await runScenarioAction(page!, {
        type: "click",
        selector: selectors.search,
      });
      await sleep(1200);
    }
    const requiredSearchSelectors = () => [
      ...(bookingKind === "appointment" && config.search.doctor
        ? ["doctor"]
        : []),
      ...(bookingKind === "exam" && config.search.exam ? ["exam"] : []),
      ...(config.search.hospital ? ["hospital"] : []),
      ...(bookingKind === "appointment" && config.search.specialty
        ? ["specialty"]
        : []),
      ...(bookingKind === "appointment" && config.search.consultation
        ? ["consultation"]
        : []),
      ...(bookingKind === "appointment" && config.search.subSpecialty
        ? ["subSpecialty"]
        : []),
      ...(config.search.insurance ? ["insurance"] : []),

      "submitSearch",
    ];
    const findUnconfiguredSelectors = () =>
      requiredSearchSelectors().filter(
        (key) =>
          !isConfiguredSelector((selectors as Record<string, string>)[key])
      );
    let unconfigured = findUnconfiguredSelectors();
    if (unconfigured.length) {
      const controls = await visibleControlMetadata(page!);
      console.log(
        `MyLuz appointment selectors need configuration (${unconfigured.join(", ")}). Visible control metadata (field values omitted):\n${JSON.stringify(controls, null, 2)}`
      );
      tray.notify(
        "MyLuz signed in",
        "The browser session is ready, but the appointment-page selectors need configuration. Check the CLI output; your session profile is retained."
      );
      tray.setStatus(
        "Signed in — update selectors in config; browser session stays open"
      );
      let configMtime = (await stat(configFile)).mtimeMs;
      while (!quitRequested && unconfigured.length) {
        await verifySession();
        await sleep(1000);
        try {
          const nextMtime = (await stat(configFile)).mtimeMs;
          if (nextMtime === configMtime) continue;
          configMtime = nextMtime;
          const next = await loadAppointmentConfig(configFile);
          config = {
            ...config,
            intervalMs: next.intervalMs,
            keepAlive: next.keepAlive,
            search: next.search,
          };
          selectors = next.selectors;
          unconfigured = findUnconfiguredSelectors();
        } catch {
          // The operator may be midway through saving the JSON config.
        }
      }
      if (quitRequested) return;
      if (
        isConfiguredSelector(selectors.search) &&
        !(await visible(page!, selectors.doctor)) &&
        (await visible(page!, selectors.search))
      ) {
        await runScenarioAction(page!, {
          type: "click",
          selector: selectors.search,
        });
        await sleep(1200);
      }
    }
  };

  const fillIfConfigured = async (
    selector: string,
    value: string | undefined
  ) => {
    if (
      value === undefined ||
      !isConfiguredSelector(selector) ||
      !(await visible(page!, selector))
    )
      return;
    const field = page!.locator(selector);
    const tagName = await field.evaluate((element: { tagName: string }) =>
      element.tagName.toLowerCase()
    );
    if (tagName === "select")
      await runScenarioAction(page!, {
        type: "select",
        selector,
        label: value,
      });
    else await runScenarioAction(page!, { type: "fill", selector, value });
  };
  const dismissSelect2Overlay = async (): Promise<void> => {
    if (!(await visible(page!, "#select2-drop-mask"))) return;
    await runScenarioAction(page!, {
      type: "press",
      selector: "body",
      key: "Escape",
    }).catch(() => undefined);
    for (
      let attempt = 0;
      attempt < 30 && (await visible(page!, "#select2-drop-mask"));
      attempt++
    )
      await sleep(100);
  };
  const selectExactOption = async (
    selector: string,
    value: string | undefined,
    fieldName: string
  ) => {
    if (value === undefined || !isConfiguredSelector(selector)) return;
    const waitForFilterRefresh = async () => {
      const startedAt = Date.now();
      while (Date.now() - startedAt < 10_000) {
        if (
          !filterRequests.size &&
          Date.now() - Math.max(startedAt, filterActivityAt) >= 500
        )
          return;
        await sleep(50);
      }
      throw new OptionsNotReadyError(fieldName);
    };
    // A previous document's networkidle state does not describe later postbacks.
    // Let the previous filter's requests finish before selecting its dependent.
    await waitForFilterRefresh();
    await dismissSelect2Overlay();
    const field = page!.locator(selector);
    if (!(await field.count())) throw new OptionsNotReadyError(fieldName);
    const tagName = await field.evaluate((element: { tagName: string }) =>
      element.tagName.toLowerCase()
    );
    if (tagName !== "select" && !(await visible(page!, selector)))
      throw new OptionsNotReadyError(fieldName);
    let select2Container: any;
    if (tagName === "select") {
      const readOptions = () =>
        field
          .locator("option")
          .evaluateAll((elements: Array<{ textContent: string | null }>) =>
            elements
              .map((element) =>
                (element.textContent ?? "").replace(/\s+/g, " ").trim()
              )
              .filter(Boolean)
          );
      const exactIndex = await waitForExactOption(
        readOptions,
        value,
        fieldName
      );
      const nativeClass =
        (await field.getAttribute("class").catch(() => "")) ?? "";
      if (
        !/\bselect-hide\b/.test(nativeClass) ||
        visibility.mode !== "always"
      ) {
        const options = await readOptions();
        await runScenarioAction(page!, {
          type: "select",
          selector,
          label: options[exactIndex],
        });
        await waitForFilterRefresh();
        const selectedLabels: string[] = await field
          .locator("option:checked")
          .evaluateAll((elements: Array<{ textContent: string | null }>) =>
            elements.map((element) => element.textContent ?? "")
          );
        if (
          selectedLabels.length !== 1 ||
          exactOptionIndexes(selectedLabels, value).length !== 1
        )
          throw new Error(
            `The ${fieldName} control did not retain the requested option after refreshing.`
          );
        const id = await field.getAttribute("id");
        if (id && /\bselect-hide\b/.test(nativeClass)) {
          const chosen = page!.locator(`#s2id_${id} .select2-chosen`);
          if (
            (await chosen.count()) &&
            exactOptionIndexes([await chosen.innerText()], value).length !== 1
          )
            throw new Error(
              `The ${fieldName} widget did not retain the requested option after refreshing.`
            );
        }
        return;
      }
      const nativeId = await field.getAttribute("id");
      if (!nativeId)
        throw new Error(
          `The hidden Select2 control for ${fieldName} has no stable native id.`
        );
      const containerSelector = `#s2id_${nativeId}`;
      select2Container = page!.locator(containerSelector);
      const choice = select2Container.locator("a.select2-choice").first();
      if ((await choice.count()) === 0 || !(await choice.isVisible())) {
        throw new Error(
          `The visible Select2 control for ${fieldName} could not be found from native selector "${selector}".`
        );
      }
      await runScenarioAction(page!, {
        type: "click",
        selector: `${containerSelector} >> a.select2-choice`,
      });
      const searchInput = page!
        .locator(".select2-drop-active input.select2-input")
        .last();
      if ((await searchInput.count()) > 0 && (await searchInput.isVisible())) {
        await runScenarioAction(page!, {
          type: "fill",
          selector: ".select2-drop-active input.select2-input >> nth=-1",
          value,
        });
      }
    } else {
      const fieldClass =
        (await field.getAttribute("class").catch(() => "")) ?? "";
      if (/\bselect2-focusser\b/.test(fieldClass)) {
        select2Container = field.locator(
          "xpath=ancestor::*[contains(concat(' ', normalize-space(@class), ' '), ' select2-container ')][1]"
        );
        const choice = select2Container.locator("a.select2-choice").first();
        if ((await choice.count()) === 0 || !(await choice.isVisible())) {
          throw new Error(
            `The visible Select2 control for ${fieldName} could not be found from selector "${selector}".`
          );
        }
        await runScenarioAction(page!, {
          type: "click",
          selector: `${selector} >> xpath=ancestor::*[contains(concat(' ', normalize-space(@class), ' '), ' select2-container ')][1] >> a.select2-choice`,
        });
        const searchInput = page!
          .locator(".select2-drop-active input.select2-input")
          .last();
        if (
          (await searchInput.count()) > 0 &&
          (await searchInput.isVisible())
        ) {
          await runScenarioAction(page!, {
            type: "fill",
            selector: ".select2-drop-active input.select2-input >> nth=-1",
            value,
          });
        } else {
          await runScenarioAction(page!, { type: "fill", selector, value });
        }
      } else {
        await runScenarioAction(page!, { type: "click", selector });
        await runScenarioAction(page!, { type: "fill", selector, value });
      }
    }
    const optionSelectorCandidates = [
      ".select2-drop-active .select2-result-selectable",
      ".select2-drop-active .select2-results__option",
      '.select2-drop-active [role="option"]',
      '.select2-drop-active [data-selectable="true"]',
      ".select2-drop-active .autocomplete-suggestion",
      ".select2-result-selectable",
      ".select2-results__option",
      '[role="option"]',
      '[data-selectable="true"]',
      ".autocomplete-suggestion",
    ];
    let optionsSelector = optionSelectorCandidates[0];
    let options = page!.locator(optionsSelector);
    for (const candidate of optionSelectorCandidates) {
      const candidateOptions = page!.locator(candidate);
      if ((await candidateOptions.count()) > 0) {
        optionsSelector = candidate;
        options = candidateOptions;
        break;
      }
    }
    let visibleOptions: Array<{ index: number; text: string }> = [];
    let previousOptionSet = "";
    let stableForMs = 0;
    for (let attempt = 0; attempt < 100; attempt++) {
      visibleOptions = await options.evaluateAll(
        (
          elements: Array<{
            textContent: string | null;
            getBoundingClientRect(): { width: number; height: number };
            ownerDocument: {
              defaultView?: {
                getComputedStyle(element: unknown): {
                  display: string;
                  visibility: string;
                  opacity: string;
                };
              };
            };
          }>
        ) =>
          elements.flatMap((element, index) => {
            const bounds = element.getBoundingClientRect();
            const style =
              element.ownerDocument.defaultView?.getComputedStyle(element);
            const text = (element.textContent ?? "")
              .replace(/\s+/g, " ")
              .trim();
            return bounds.width > 0 &&
              bounds.height > 0 &&
              style?.display !== "none" &&
              style?.visibility === "visible" &&
              Number(style.opacity) > 0 &&
              text
              ? [{ index, text }]
              : [];
          })
      );
      const currentOptionSet = JSON.stringify(
        visibleOptions.map((option) => option.text)
      );
      stableForMs =
        currentOptionSet === previousOptionSet ? stableForMs + 100 : 0;
      previousOptionSet = currentOptionSet;
      if (
        stableForMs >= 1200 &&
        visibleOptions.some(
          (option) => exactOptionIndexes([option.text], value).length > 0
        )
      )
        break;
      await sleep(100);
    }
    const exact = visibleOptions.filter(
      (option) => exactOptionIndexes([option.text], value).length > 0
    );
    if (!visibleOptions.length) throw new OptionsNotReadyError(fieldName);
    if (exact.length !== 1) {
      const reason =
        exact.length > 1
          ? "matches multiple visible options"
          : "does not match an existing visible option";
      throw new Error(
        `The ${fieldName} value "${value}" ${reason}. Visible options: ${visibleOptions
          .map((option) => option.text)
          .slice(0, 30)
          .join(" | ")}`
      );
    }
    await runScenarioAction(page!, {
      type: "click",
      selector: optionsSelector,
      // Re-resolve by label: Select2 can replace/reorder results after filtering.
      text: new RegExp(
        `^\\s*${exact[0].text
          .split(/\s+/)
          .map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
          .join("\\s+")}\\s*$`,
        "i"
      ),
    });
    await waitForFilterRefresh();
    if (select2Container) {
      const chosen = select2Container.locator(".select2-chosen").first();
      let selectedLabel = "";
      let selectedSince: number | undefined;
      for (let attempt = 0; attempt < 50; attempt++) {
        selectedLabel = await chosen.innerText().catch(() => "");
        if (exactOptionIndexes([selectedLabel], value).length === 1) {
          selectedSince ??= Date.now();
          if (Date.now() - selectedSince >= 1200) break;
        } else selectedSince = undefined;
        await sleep(100);
      }
      if (
        selectedSince === undefined ||
        Date.now() - selectedSince < 1200 ||
        exactOptionIndexes([selectedLabel], value).length !== 1
      ) {
        throw new Error(
          `The ${fieldName} control did not settle on the exact option "${value}" after selection.`
        );
      }
    }
    // The portal repopulates dependent filters asynchronously after each selection.
    await sleep(100);
  };
  const searchOnce = async (): Promise<boolean> => {
    await verifySession();
    const inspectResults = async (): Promise<boolean> => {
      if (await page!.locator(".pika-table").count()) {
        const selected = await firstAvailablePortalDate(page!, {
          fromDate: config.search.fromDate,
          toDate: config.search.toDate,
          before: beforeDate,
        });
        if (!selected) {
          candidateIndex = undefined;
          candidateDate = undefined;
          tray.setAcceptEnabled(false);
          tray.setStatus(
            "First available date is outside the requested interval — waiting for next check"
          );
          console.log(
            "MyLuz query completed: the portal's first available date is outside the requested interval; calendar unchanged."
          );
          return false;
        }
      }
      for (const key of [
        "resultCard",
        "resultAvailable",
        "resultDescription",
      ] as const) {
        if (!isConfiguredSelector(selectors[key]))
          throw new Error(
            `Configure selectors.${key} for the availability screen.`
          );
      }
      const date = await selectedCalendarDate(page!, selectors.selectedDate);
      if (!date) {
        throw new Error(
          "Could not verify the portal's first available date; configure selectors.selectedDate."
        );
      }
      if (
        date &&
        ((beforeDate && !isBeforeDate(date, beforeDate)) ||
          (config.search.fromDate && date < config.search.fromDate) ||
          (config.search.toDate && date > config.search.toDate))
      ) {
        candidateIndex = undefined;
        candidateDate = undefined;
        tray.setAcceptEnabled(false);
        tray.setStatus(
          `Calendar date ${date} is outside the configured search window`
        );
        return false;
      }
      const cards = page!.locator(selectors.resultCard);
      const count = await cards.count();
      for (let index = 0; index < count; index++) {
        const card = cards.nth(index);
        const available = card.locator(selectors.resultAvailable);
        if (
          (await available.count()) === 0 ||
          !(await available.first().isVisible())
        )
          continue;
        if (config.search.fromTime || config.search.toTime) {
          const text = await card.innerText();
          const time = text.match(/\b(?:[01]\d|2[0-3]):[0-5]\d\b/)?.[0];
          if (!time)
            throw new Error(
              "Could not verify the slot time against the configured time window."
            );
          if (
            (config.search.fromTime && time < config.search.fromTime) ||
            (config.search.toTime && time > config.search.toTime)
          )
            continue;
        }
        candidateIndex = index;
        candidateDate = date;
        const detail = await card
          .locator(selectors.resultDescription)
          .innerText()
          .catch(() => "An appointment is available.");
        tray.setOpenText("See appointment");
        tray.setAcceptEnabled(true, `Accept ${bookingKind}`);
        tray.setStatus(
          `${bookingKind === "exam" ? "Exam" : "Appointment"} available — accept in the tray menu`
        );
        tray.notifyAppointment(
          `MyLuz ${bookingKind} available`,
          `${date ? `${date}: ` : ""}${detail.slice(0, 220)}. Choose See to review it or Accept to submit the booking.`
        );
        return true;
      }
      candidateIndex = undefined;
      tray.setOpenText("Open MyLuz");
      tray.setAcceptEnabled(false);
      tray.setStatus("No appointment found — waiting for next check");
      return false;
    };
    const currentState = await identifyPage();
    if (currentState === "blocked") stopForSiteBlock();
    if (currentState === "human-verification") {
      tray.setStatus(
        "Human verification required — complete it in the browser"
      );
      tray.notify(
        "MyLuz verification required",
        "Complete the visible verification challenge manually in Chrome. The watcher will not bypass it and will keep this browser open."
      );
      throw new Error("MyLuz session requires human verification.");
    }
    if (currentState === "results") return inspectResults();
    if (
      isConfiguredSelector(searchRouteSelector()) &&
      currentState !== "appointment-form" &&
      (await visible(page!, searchRouteSelector()))
    ) {
      await runScenarioAction(page!, {
        type: "click",
        selector: searchRouteSelector(),
      });
    }
    await selectExactOption(
      selectors.hospital,
      config.search.hospital,
      "hospital"
    );
    if (bookingKind === "appointment") {
      await selectExactOption(
        selectors.specialty,
        config.search.specialty,
        "specialty"
      );
      await selectExactOption(
        selectors.consultation,
        config.search.consultation,
        "consultation"
      );
      await selectExactOption(
        selectors.subSpecialty,
        config.search.subSpecialty,
        "sub-specialty"
      );
      await selectExactOption(selectors.doctor, config.search.doctor, "doctor");
    } else {
      await selectExactOption(selectors.exam, config.search.exam, "exam");
    }
    await selectExactOption(
      selectors.insurance,
      config.search.insurance,
      "insurance"
    );
    await fillIfConfigured(selectors.fromDate, config.search.fromDate);
    const requestedToDate =
      beforeDate && (!config.search.toDate || beforeDate < config.search.toDate)
        ? beforeDate
        : config.search.toDate;
    await fillIfConfigured(selectors.toDate, requestedToDate);
    await fillIfConfigured(selectors.fromTime, config.search.fromTime);
    await fillIfConfigured(selectors.toTime, config.search.toTime);
    await runScenarioAction(page!, {
      type: "click",
      selector: selectors.submitSearch,
    });
    await waitForPageToSettle();
    const postSubmitControls = await visibleControlMetadata(page!);
    console.log(
      `MyLuz visible controls after continuing the appointment form (values omitted):\n${JSON.stringify(postSubmitControls, null, 2)}`
    );
    await runScenarioAction(page!, {
      type: "waitForSelector",
      selector: selectors.searchResults,
      state: "visible",
      timeout: 30_000,
    });
    await verifySession();
    return inspectResults();
  };
  let keepAlivePageIndex = 0;
  const visitKeepAlivePage = async (): Promise<void> => {
    const pages = config.keepAlive.pages;
    if (!config.keepAlive.enabled || pages.length === 0) return;
    await verifySession();
    // Configured selectors are useful on the booking page, but portal navigation
    // changes between account pages. Discover the same read-only destinations
    // from the currently rendered page on every visit so the rotation can keep
    // moving instead of silently getting stuck on an obsolete selector.
    const safeDestination =
      /in[ií]cio|minha sa[uú]de|hist[oó]rico|faturas|pagamentos|profissionais|unidades|especialidades|guia de sa[uú]de|gest[aã]o de conta/i;
    const unsafeRoute =
      /logout|logoff|sair|marcar|agendar|booking|appointment|reserv|cancel|confirm|submit|delete|remover/i;
    await dismissSelect2Overlay();
    const currentUrl = new URL(page!.url());
    const candidates: Array<{
      index: number;
      href: string;
      label: string;
      visible: boolean;
    }> = await page!.locator("a[href]").evaluateAll(
      (
        elements: Array<{
          href: string;
          innerText?: string;
          textContent?: string | null;
          getClientRects(): { length: number };
        }>
      ) =>
        elements.map((element, index) => ({
          index,
          href: element.href,
          label: (element.innerText ?? element.textContent ?? "")
            .replace(/\s+/g, " ")
            .trim(),
          visible: element.getClientRects().length > 0,
        }))
    );
    const configuredIndexes = new Map<number, string>();
    for (const configured of pages) {
      if (!(await visible(page!, configured.selector))) continue;
      const index = await page!
        .locator(configured.selector)
        .first()
        .evaluate(
          (element: {
            closest(
              selector: string
            ): { getAttribute(name: string): string | null } | null;
            ownerDocument: {
              querySelectorAll(selector: string): ArrayLike<unknown>;
            };
          }) => {
            const anchor = element.closest("a[href]");
            if (!anchor) return -1;
            return Array.from(
              element.ownerDocument.querySelectorAll("a[href]")
            ).indexOf(anchor);
          }
        );
      if (index >= 0) configuredIndexes.set(index, configured.name);
    }
    const destinations = candidates.filter((candidate) => {
      const explicitlyConfigured = configuredIndexes.has(candidate.index);
      if (
        !candidate.visible ||
        !candidate.label ||
        (!explicitlyConfigured && !safeDestination.test(candidate.label)) ||
        unsafeRoute.test(candidate.href)
      )
        return false;
      try {
        const target = new URL(candidate.href);
        return (
          target.origin === currentUrl.origin &&
          target.pathname.startsWith("/MYLUZ/") &&
          (target.pathname !== currentUrl.pathname ||
            target.search !== currentUrl.search)
        );
      } catch {
        return false;
      }
    });
    if (destinations.length === 0) {
      tray.setStatus(
        "Session open — no other read-only page link is available here"
      );
      console.warn(
        "No different configured read-only MyLuz destination is visible; staying on the current page until the next keep-alive tick."
      );
      return;
    }
    const destination = destinations[keepAlivePageIndex % destinations.length];
    keepAlivePageIndex = (keepAlivePageIndex + 1) % destinations.length;
    const configuredName = configuredIndexes.get(destination.index);
    const destinationName = configuredName ?? destination.label;
    tray.setStatus(`Session continuity: opening ${destinationName}`);
    await runScenarioAction(page!, {
      type: "click",
      selector: `a[href] >> nth=${destination.index}`,
    });
    await waitForPageToSettle();
    await verifySession();
    const state = await identifyPage();
    if (state === "blocked") stopForSiteBlock();
    if (state === "human-verification") {
      tray.notify(
        "MyLuz verification required",
        "Complete the visible challenge manually. The browser will stay open."
      );
      throw new Error("MyLuz session requires human verification.");
    }
    console.log(
      `Session-continuity view: ${destinationName} (${state}); continuing the scheduled wait before the next search.`
    );
  };
  const returnToAppointmentFlow = async (): Promise<void> => {
    let state = await identifyPage().catch(() => "unknown" as MyLuzPageState);
    if (state === "appointment-form") {
      await dismissSelect2Overlay();
      return;
    }
    if (
      state === "results" &&
      isConfiguredSelector(selectors.backToSearch) &&
      (await visible(page!, selectors.backToSearch))
    ) {
      await runScenarioAction(page!, {
        type: "click",
        selector: selectors.backToSearch,
      });
      await waitForPageToSettle();
    } else {
      if (!(await visible(page!, searchRouteSelector()))) {
        await navigate(page!, config.url);
        await waitForPageToSettle();
      }
      if (
        isConfiguredSelector(searchRouteSelector()) &&
        (await visible(page!, searchRouteSelector()))
      ) {
        await runScenarioAction(page!, {
          type: "click",
          selector: searchRouteSelector(),
        });
        await waitForPageToSettle();
      }
    }
    const deadline = Date.now() + 30_000;
    while (!quitRequested && Date.now() < deadline) {
      await verifySession();
      state = await identifyPage().catch(() => "unknown" as MyLuzPageState);
      if (state === "appointment-form") {
        console.log(
          "Returned to the appointment search form for the scheduled recheck."
        );
        return;
      }
      if (state === "human-verification") {
        tray.notify(
          "MyLuz verification required",
          "Complete the visible challenge manually in the browser; the watcher will wait without retrying login."
        );
      }
      await sleep(500);
    }
    if (!quitRequested)
      throw new Error(
        `Could not return to the appointment search form from page state "${state}".`
      );
  };

  let transientRetryDelayMs = 10_000;
  let bookedDate: string | undefined;
  let confirmationDeadline = 0;
  let wakeAt = 0;
  let nextKeepAliveAt = 0;
  const onAbort = () => {
    quitRequested = true;
  };
  signal?.addEventListener("abort", onAbort, { once: true });
  const close = async () => {
    signal?.removeEventListener("abort", onAbort);
    process.off("SIGTERM", preserveBrowserOnTermination);
    try {
      tray.close();
    } finally {
      if (context) await context.close();
    }
  };
  try {
    signal?.throwIfAborted();
    await open();
  } catch (error) {
    await close();
    throw error;
  }
  const session: LuzSession = {
    page: page as unknown as StoryboardPage,
    running: () => !quitRequested,
    authenticated: async () =>
      (await identifyPage()) !== "human-verification" &&
      (await isAuthenticated()),
    login,
    signInTick,
    prepareSearch,
    beginCycle() {
      takeActions();
      searchRequested = false;
      acceptRequested = false;
    },
    async search() {
      if (quitRequested) return false;
      const found = await searchOnce();
      transientRetryDelayMs = 10_000;
      if (found && options.recursive) acceptRequested = true;
      return found;
    },
    async pollApproval() {
      await verifySession();
      const received = takeActions();
      if (received.includes("search")) searchRequested = true;
      if (received.includes("accept")) acceptRequested = true;
    },
    accepted: () => acceptRequested,
    hasCandidate: () => candidateIndex !== undefined,
    searchRequested: () => searchRequested,
    discardCandidate() {
      tray.setAcceptEnabled(false);
      tray.setOpenText("Open MyLuz");
      candidateIndex = undefined;
    },
    async book() {
      await verifySession();
      signal?.throwIfAborted();
      if (quitRequested) return;
      if (candidateIndex === undefined)
        throw new Error("No appointment candidate is selected.");
      if (!isConfiguredSelector(selectors.bookButton))
        throw new Error(
          "Configure selectors.bookButton for the verified final booking action before approving a booking."
        );
      const currentDate = await selectedCalendarDate(
        page!,
        selectors.selectedDate
      );
      if (
        !candidateDate ||
        currentDate !== candidateDate ||
        !isDateInWindow(candidateDate, {
          fromDate: config.search.fromDate,
          toDate: config.search.toDate,
          before: beforeDate,
        })
      ) {
        throw new Error(
          "The available date changed or no longer improves the confirmed booking; booking was not submitted."
        );
      }
      if (!isConfiguredSelector(selectors.bookingConfirmation))
        throw new Error(
          "Configure selectors.bookingConfirmation so a confirmed booking can set the next date cutoff."
        );
      bookedDate = candidateDate;
      await runScenarioAction(page!, {
        type: "click",
        selector: `${selectors.resultCard} >> nth=${candidateIndex} >> ${selectors.bookButton}`,
      });
      tray.setAcceptEnabled(false);
      tray.setOpenText("Open MyLuz");
      candidateIndex = undefined;
      confirmationDeadline = Date.now() + 60_000;
      if (!options.recursive) {
        tray.setStatus("Booking action submitted — check the browser");
        tray.notify(
          `MyLuz ${bookingKind} booking action submitted`,
          "Verify the booking confirmation in the browser."
        );
      }
    },
    recursive: () => Boolean(options.recursive),
    async confirmed() {
      await verifySession();
      const state = await identifyPage();
      if (state === "confirmation" || state === "human-verification")
        confirmationDeadline = Date.now() + 60_000;
      return (
        isConfiguredSelector(selectors.bookingConfirmation) &&
        (await visible(page!, selectors.bookingConfirmation))
      );
    },
    confirmationPending: () => Date.now() < confirmationDeadline,
    tightenCutoff() {
      if (!bookedDate || !isBeforeDate(bookedDate, beforeDate)) {
        throw new Error(
          "The confirmed booking has no verified earlier date; recursive cutoff was not advanced."
        );
      }
      beforeDate = bookedDate;
      tray.setStatus(
        `Booked ${bookedDate}; searching for an earlier ${bookingKind}`
      );
      tray.notify(
        `MyLuz ${bookingKind} booked`,
        `The portal confirmed ${bookedDate}. Searching earlier; existing bookings are left unchanged.`
      );
    },
    returnToSearch: returnToAppointmentFlow,
    beginWait() {
      wakeAt = Date.now() + config.intervalMs;
      nextKeepAliveAt = Date.now();
    },
    pollWait() {
      if (takeActions().includes("search")) searchRequested = true;
    },
    waiting: () => !searchRequested && Date.now() < wakeAt,
    keepAliveDue: () =>
      config.keepAlive.enabled &&
      config.keepAlive.pages.length > 0 &&
      Date.now() >= nextKeepAliveAt,
    async visitKeepAlive() {
      await visitKeepAlivePage();
      nextKeepAliveAt = Date.now() + config.keepAlive.intervalMs;
    },
    waitTick: () => sleep(500),
    async recover(failure) {
      const message =
        failure instanceof Error ? failure.message : String(failure);
      const recoveredState = await identifyPage().catch(
        () => "unknown" as MyLuzPageState
      );
      console.error(
        `MyLuz cycle paused at page state "${recoveredState}": ${message}`
      );
      if (siteBlocked || recoveredState === "blocked") stopForSiteBlock();
      if (
        failure instanceof OptionsNotReadyError ||
        /select2-drop-mask.*intercepts pointer events/i.test(message)
      ) {
        const retryDelay = transientRetryDelayMs;
        transientRetryDelayMs = Math.min(300_000, transientRetryDelayMs * 2);
        tray.setStatus(
          `A filter is refreshing — retrying in ${Math.round(retryDelay / 1000)}s`
        );
        await sleep(retryDelay);
        await returnToAppointmentFlow();
        return "retry";
      }
      if (/execution context was destroyed|navigation/i.test(message)) {
        await sleep(1500);
        const settled = await identifyPage().catch(
          () => "unknown" as MyLuzPageState
        );
        if (["appointment-form", "results", "home"].includes(settled))
          return "retry";
      }
      if (
        ["login", "confirmation", "human-verification"].includes(recoveredState)
      ) {
        candidateIndex = undefined;
        candidateDate = undefined;
        tray.setAcceptEnabled(false);
        tray.setOpenText("Open MyLuz");
        await visibility.requireAttention(
          recoveredState === "confirmation" ||
            recoveredState === "human-verification"
            ? recoveredState
            : "login"
        );
        return "sign-in";
      }
      tray.setStatus(`Paused on ${recoveredState} — use tray Search to retry`);
      tray.notify(
        "MyLuz search paused",
        `Review the browser, then choose Search now to retry. ${message.slice(0, 180)}`
      );
      return "paused";
    },
    async pollPause() {
      await verifySession();
      if (takeActions().includes("search")) searchRequested = true;
    },
    reportFatal(error) {
      console.error(
        `MyLuz watcher paused after an error: ${error instanceof Error ? error.message : String(error)}`
      );
      tray.setStatus("Paused after an error — browser remains open");
      tray.notify(
        "MyLuz watcher paused",
        "Review the CLI output and choose Quit from the tray when ready."
      );
      process.exitCode = 1;
    },
    close,
  };
  return {
    ...session,
    prepareSearch: visibility.background(session.prepareSearch),
    search: visibility.background(session.search),
    book: visibility.background(session.book),
    confirmed: visibility.background(session.confirmed),
    returnToSearch: visibility.background(session.returnToSearch),
    visitKeepAlive: visibility.background(session.visitKeepAlive),
    waitTick: visibility.background(session.waitTick),
  };
}
