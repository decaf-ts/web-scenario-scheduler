import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser } from "playwright";
import {
  firstAvailablePortalDate,
  selectedPortalDate,
} from "../../src/scenarios/luz/calendar";
import { createLuzSession } from "../../src/scenarios/luz/session";
import * as trayModule from "../../src/scenarios/luz/tray";
import {
  applyLuzAction,
  preventAutomaticWindowFocus,
} from "../../src/scenarios/luz/browser-actions";
import { BrowserVisibilityController } from "../../src/scenarios/luz/browser-visibility";
import type { StoryboardPage } from "@decaf-ts/for-testing/ui";
import { OptionsNotReadyError } from "../../src/scenarios/luz/options";

jest.setTimeout(45_000);
let browser: Browser;
let calendar: string;
const fixtureBrowserEnvironment = Object.fromEntries(
  Object.entries(process.env).filter(([name, value]) => value !== undefined &&
    !/^(MYLUZ_|SCHEDULER_FIXTURE_|NPM_TOKEN$|DISPLAY$|WAYLAND_DISPLAY$)/.test(name))
);
beforeAll(async () => {
  calendar = await readFile(
    join(__dirname, "../fixtures/luz-calendar.html"),
    "utf8"
  );
  browser = await chromium.launch({ headless: true, env: fixtureBrowserEnvironment });
});
afterAll(async () => {
  await browser?.close();
});
afterEach(() => jest.restoreAllMocks());

it("submits only fixture credentials, waits for simulated MFA, and resumes after fixture verification", async () => {
  await withAdapter(
    async ({ session, native, windowStates }) => {
      expect(await session.authenticated()).toBe(false);
      await session.login();
      expect(session.page.url()).toContain("Login2FA");
      await session.signInTick();
      expect(native.notify).toHaveBeenCalledWith(
        "MyLuz confirmation needed",
        expect.any(String)
      );
      expect(windowStates.at(-1)).toBe("normal");
      await session.page.goto(
        "https://luz.integration.test/MYLUZ/MarcacaoPasso1.aspx"
      );
      expect(await session.authenticated()).toBe(true);
      await session.prepareSearch();
      expect(windowStates.at(-1)).toBe("minimized");
    },
    (config) => {
      config.url = "https://luz.integration.test/login";
    }
  );
});

it("requires human verification only in the fixture and never submits login through a challenge", async () => {
  await withAdapter(
    async ({ session, native, windowStates }) => {
      expect(await session.authenticated()).toBe(false);
      await session.login();
      await session.signInTick();
      expect(native.notify).toHaveBeenCalledWith(
        "MyLuz verification required",
        expect.any(String)
      );
      expect(windowStates.at(-1)).toBe("normal");
      expect(session.page.url()).toContain("/captcha");
      await session.page.goto(
        "https://luz.integration.test/MYLUZ/MarcacaoPasso1.aspx"
      );
      expect(await session.authenticated()).toBe(true);
    },
    (config) => {
      config.url = "https://luz.integration.test/captcha";
    }
  );
});

it("rotates safe account pages, dismisses stale overlays, returns to search, and honors tray Search and Quit", async () => {
  await withAdapter(async ({ session, onAction, native }) => {
    await session.page.evaluate(() => {
      const document = (globalThis as any).document;
      const mask = document.createElement("div");
      mask.id = "select2-drop-mask";
      mask.textContent = "Overlay fixture";
      document.body.append(mask);
      document.addEventListener("keydown", (event: any) => {
        if (event.key === "Escape") mask.remove();
      });
    });
    session.beginWait();
    expect(session.waiting()).toBe(true);
    expect(session.keepAliveDue()).toBe(true);
    await session.visitKeepAlive();
    expect(session.keepAliveDue()).toBe(false);
    expect(native.setStatus).toHaveBeenCalledWith(
      expect.stringContaining("Session continuity")
    );
    await session.returnToSearch();
    expect(session.page.url()).toContain("MarcacaoPasso1");
    onAction("search");
    session.pollWait();
    expect(session.waiting()).toBe(false);
    session.beginCycle();
    expect(session.searchRequested()).toBe(false);
    onAction("quit");
    expect(session.running()).toBe(false);
    await session.waitTick();
  });
});

it("pauses on unknown pages, handles session expiry, and backs off transient filter failures", async () => {
  await withAdapter(async ({ session, onAction, native }) => {
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    await session.page.goto("https://luz.integration.test/unknown");
    expect(await session.recover(new Error("fixture failure"))).toBe("paused");
    onAction("search");
    await session.pollPause();
    expect(session.searchRequested()).toBe(true);
    await session.page.goto("https://luz.integration.test/logged-out");
    await expect(session.search()).rejects.toThrow(/requires sign-in/);
    expect(await session.recover(new Error("session ended"))).toBe("sign-in");
    await session.page.goto(
      "https://luz.integration.test/MYLUZ/MarcacaoPasso1.aspx"
    );
    const timers = jest.requireActual("node:timers/promises");
    const original = timers.setTimeout;
    jest
      .spyOn(timers, "setTimeout")
      .mockImplementation((...args: any[]) =>
        args[0] >= 1000 ? Promise.resolve() : original(...args)
      );
    expect(await session.recover(new OptionsNotReadyError("doctor"))).toBe(
      "retry"
    );
    expect(
      await session.recover(new Error("navigation destroyed context"))
    ).toBe("retry");
    const exitCode = process.exitCode;
    try {
      session.reportFatal(new Error("fixture fatal"));
      expect(process.exitCode).toBe(1);
      expect(native.notify).toHaveBeenCalledWith(
        "MyLuz watcher paused",
        expect.any(String)
      );
    } finally {
      process.exitCode = exitCode;
    }
  });
});

it("stops on a fixture rate-limit response instead of retrying the portal", async () => {
  await expect(
    withAdapter(
      async () => {
        throw new Error("Blocked fixture must not open a session");
      },
      (config) => {
        config.url = "https://luz.integration.test/blocked";
      }
    )
  ).rejects.toThrow(/denied|rate-limited/);
});

it("reloads a repaired fixture selector without waiting for an operator in CI", async () => {
  await withAdapter(
    async ({ session, native, configFile }) => {
      const preparing = session.prepareSearch();
      for (
        let i = 0;
        i < 100 &&
        !native.setStatus.mock.calls.some(([value]) =>
          value.includes("update selectors")
        );
        i++
      )
        await new Promise((resolve) => setTimeout(resolve, 20));
      expect(
        native.setStatus.mock.calls.some(([value]) =>
          value.includes("update selectors")
        )
      ).toBe(true);
      await new Promise((resolve) => setTimeout(resolve, 100));
      const config = JSON.parse(await readFile(configFile, "utf8"));
      config.selectors.insurance = "#insurance";
      await writeFile(configFile, JSON.stringify(config));
      await preparing;
      expect(await session.authenticated()).toBe(true);
      expect(native.notify).toHaveBeenCalledWith(
        "MyLuz signed in",
        expect.any(String)
      );
    },
    (config) => {
      config.selectors.insurance = "REPLACE_WITH_INSURANCE";
    }
  );
});

it.each([
  [
    "invalid cutoff",
    () => {},
    { before: "invalid" },
    /valid YYYY-MM-DD/,
  ],
  [
    "missing exam route",
    (config: any) => {
      config.bookingKind = "exam";
    },
    {},
    /examSearch/,
  ],
  [
    "missing exam value",
    (config: any) => {
      config.bookingKind = "exam";
      config.selectors.examSearch = "#open-search";
    },
    {},
    /search.exam/,
  ],
  [
    "unverified recursive booking",
    () => {},
    { recursive: true },
    /bookingConfirmation/,
  ],
  [
    "missing selected date",
    (config: any) => {
      config.selectors.selectedDate = "REPLACE_WITH_DATE";
    },
    { before: "2027-02-01" },
    /selectedDate/,
  ],
  [
    "missing credentials",
    (config: any) => {
      config.usernameEnv = "SCHEDULER_MISSING_FIXTURE_USERNAME";
    },
    {},
    /Set both/,
  ],
])(
  "rejects %s before launching a browser",
  async (_name, configure, run, expected) => {
    await expect(
      withAdapter(
        async () => {
          throw Error("Must reject before opening");
        },
        configure as any,
        { run: run as any }
      )
    ).rejects.toThrow(expected as RegExp);
  }
);

it("requires the tray before opening the browser", async () => {
  await expect(
    withAdapter(
      async () => {},
      () => {},
      { nativeAvailable: false }
    )
  ).rejects.toThrow(/system tray is required/);
});

it("handles exam controls and configured date/time inputs using only fixture values", async () => {
  await withAdapter(
    async ({ session }) => {
      await session.prepareSearch();
      expect(await session.search()).toBe(false);
      expect(
        await session.page.evaluate(
          "JSON.parse(sessionStorage.getItem('filters')).includes('Radiografia')"
        )
      ).toBe(true);
    },
    (config) => {
      config.bookingKind = "exam";
      config.search.exam = "Radiografia";
      config.selectors.examSearch = "#open-search";
      config.selectors.exam = "#exam";
      config.selectors.fromDate = "#fromDate";
      config.selectors.toDate = "#toDate";
      config.selectors.fromTime = "#fromTime";
      config.selectors.toTime = "#toTime";
      config.search.fromTime = "07:00";
      config.search.toTime = "10:00";
    },
    {
      controls:
        '<select id="exam"><option>Choose</option><option>Radiografia</option></select><input id="fromDate"><input id="toDate"><input id="fromTime"><input id="toTime">',
    }
  );
});

it("verifies a non-calendar result date, slot time and approval before a booking can be submitted", async () => {
  await withAdapter(
    async ({ session, onAction }) => {
      await session.page.goto(
        "https://luz.integration.test/MYLUZ/MarcacaoPasso2.aspx"
      );
      expect(await session.search()).toBe(false);
      await session.page.locator(".description").evaluate((element: any) => {
        element.textContent = "Fixture 09:30";
      });
      expect(await session.search()).toBe(true);
      expect(session.hasCandidate()).toBe(true);
      onAction("accept");
      await session.pollApproval();
      expect(session.accepted()).toBe(true);
      await expect(session.book()).rejects.toThrow(
        /Configure selectors.bookButton/
      );
      session.discardCandidate();
      expect(session.hasCandidate()).toBe(false);
      await expect(session.book()).rejects.toThrow(/No appointment candidate/);
      await session.page.locator(".description").evaluate((element: any) => {
        element.textContent = "Fixture without time";
      });
      await expect(session.search()).rejects.toThrow(/slot time/);
    },
    (config) => {
      Object.assign(config.search, {
        fromDate: "2027-02-01",
        toDate: "2027-02-28",
        fromTime: "09:00",
        toTime: "10:00",
      });
      Object.assign(config.selectors, {
        selectedDate: "#selected-date",
        resultCard: ".slot",
        resultAvailable: ".available",
        resultDescription: ".description",
      });
    },
    {
      results:
        '<title>Marcação Passo 2</title><div id="authenticated">Fixture</div><div id="selected-date">2027-02-23</div><div id="schedule"><div class="slot"><span class="available">Available</span><span class="description">Fixture 08:30</span></div></div>',
    }
  );
});

it("blocks page scripts from raising the window across navigation while preserving form focus", async () => {
  const page = await browser.newPage();
  try {
    await page.context().addInitScript({
      content: `window.focusRequests=0; window.focus=()=>window.focusRequests++;
        (${preventAutomaticWindowFocus.toString()})();`,
    });
    await page.goto(
      "data:text/html,<input id=code><script>window.focus()</script>"
    );
    expect(await page.evaluate("window.focusRequests")).toBe(0);
    await page.locator("#code").fill("fixture");
    expect(await page.locator("#code").inputValue()).toBe("fixture");
  } finally {
    await page.close();
  }
});

it("keeps automated clicks from taking focus even after Open, while preserving human browser interaction", async () => {
  const page = await browser.newPage();
  try {
    await page.setContent(`<button>Other</button><button>Choose</button><button disabled>Choose</button>
      <script>window.events=[];
      document.addEventListener('mousedown',e=>{if(e.isTrusted)events.push('pointer')});
      document.addEventListener('click',e=>events.push(e.isTrusted?'native':'background'));
      setTimeout(()=>document.querySelector('button:disabled').disabled=false,200);</script>`);
    const window = { show: jest.fn(), hide: jest.fn() };
    const visibility = new BrowserVisibilityController("when-needed", window);
    await applyLuzAction(
      page as unknown as StoryboardPage,
      {
        type: "click",
        selector: "button",
        text: "Choose",
        nth: 1,
      },
      visibility
    );
    expect(await page.evaluate("window.events")).toEqual(["background"]);
    expect(window.show).not.toHaveBeenCalled();
    await visibility.open();
    await applyLuzAction(
      page as unknown as StoryboardPage,
      {
        type: "click",
        selector: "button",
        nth: 0,
      },
      visibility
    );
    expect(await page.evaluate("window.events")).toEqual([
      "background",
      "background",
    ]);
    await visibility.requireAttention("confirmation");
    await page.locator("button").first().click();
    expect(await page.evaluate("window.events")).toEqual([
      "background",
      "background",
      "pointer",
      "native",
    ]);
    await visibility.clearAttention();
    await page
      .locator("button")
      .first()
      .evaluate((button: any) => (button.disabled = true));
    await expect(
      applyLuzAction(
        page as unknown as StoryboardPage,
        {
          type: "click",
          selector: "button",
          nth: 0,
          timeout: 100,
        },
        visibility
      )
    ).rejects.toThrow(/did not become enabled|Timeout/);
    expect(await page.evaluate("window.events.length")).toBe(4);
  } finally {
    await page.close();
  }
});

it("reads the initial available date without selecting other marked days, and excludes the cutoff", async () => {
  const page = await browser.newPage();
  try {
    await page.setContent(calendar);
    expect(await selectedPortalDate(page)).toBe("2027-02-23");
    await page.evaluate("window.events=['2027-02-10','2027-02-23'];render()");
    expect(
      await firstAvailablePortalDate(page, {
        fromDate: "2027-02-01",
        toDate: "2027-02-28",
      })
    ).toBe("2027-02-23");
    expect(await selectedPortalDate(page)).toBe("2027-02-23");
    expect(
      await firstAvailablePortalDate(page, {
        fromDate: "2027-02-01",
        before: "2027-02-23",
      })
    ).toBeUndefined();
  } finally {
    await page.close();
  }
});

it("rejects an out-of-range first date without forcing the calendar back", async () => {
  const page = await browser.newPage();
  try {
    await page.setContent(calendar);
    expect(
      await firstAvailablePortalDate(page, {
        fromDate: "2026-12-01",
        toDate: "2026-12-31",
      })
    ).toBeUndefined();
    expect(await page.locator(".pika-title").innerText()).toBe("2027-02");
    expect(await page.evaluate("window.selected")).toBe("2027-02-23");
  } finally {
    await page.close();
  }
});

async function withAdapter(
  body: (input: {
    session: Awaited<ReturnType<typeof createLuzSession>>;
    native: ReturnType<typeof nativeTray>;
    windowStates: string[];
    focusStates: boolean[];
    configFile: string;
    onAction: (action: trayModule.AppointmentTrayAction) => void;
  }) => Promise<void>,
  configure: (config: any) => void = () => undefined,
  fixture: {
    controls?: string;
    results?: string;
    run?: Parameters<typeof createLuzSession>[2];
    nativeAvailable?: boolean;
  } = {}
) {
  const temporary = await mkdtemp(join(tmpdir(), "luz-browser-integration-"));
  const native = nativeTray();
  native.available = fixture.nativeAvailable ?? true;
  let onAction!: (action: trayModule.AppointmentTrayAction) => void;
  jest
    .spyOn(trayModule, "createAppointmentTray")
    .mockImplementation(async (callback) => {
      onAction = callback;
      return native;
    });
  jest.spyOn(console, "log").mockImplementation(() => undefined);
  const launch = chromium.launchPersistentContext.bind(chromium);
  const windowStates: string[] = [];
  const focusStates: boolean[] = [];
  const unexpectedOrigins: string[] = [];
  jest
    .spyOn(chromium, "launchPersistentContext")
    .mockImplementation(async (profile, options) => {
      const context = await launch(profile, {
        ...options,
        headless: true,
        args: [],
        executablePath: undefined,
        serviceWorkers: "block",
        env: fixtureBrowserEnvironment,
      });
      const newCDPSession = context.newCDPSession.bind(context);
      jest.spyOn(context, "newCDPSession").mockImplementation(async (page) => {
        const protocol = await newCDPSession(page);
        return {
          send: async (method: string, params: any) => {
            if (method === "Runtime.evaluate")
              return protocol.send(method, params);
            if (method === "Browser.setWindowBounds")
              windowStates.push(params.bounds.windowState);
            if (method === "Emulation.setFocusEmulationEnabled")
              focusStates.push(params.enabled);
            return method === "Browser.getWindowBounds"
              ? { bounds: { windowState: windowStates.at(-1) ?? "normal" } }
              : { windowId: 1 };
          },
        } as never;
      });
      await context.route("**/*", async (route) => {
        const url = route.request().url();
        if (new URL(url).origin !== "https://luz.integration.test") {
          unexpectedOrigins.push(new URL(url).origin);
          await route.abort();
          return;
        }
        const navigation =
          '<a id="open-search" href="/MYLUZ/MarcacaoPasso1.aspx">Marcar</a><a href="/MYLUZ/HomePage.aspx">Início</a><a href="/MYLUZ/Servico_List.aspx">Especialidades</a><a href="/MYLUZ/GestaoConta.aspx">Gestão de conta</a>';
        if (url.includes("MarcacaoPasso2"))
          expect(focusStates.at(-1) ?? false).toBe(false);
        const html = `<!doctype html><title>Marcação Passo 1</title><div id="authenticated">Signed in fixture</div>
        <select id="hospital"><option value="">Choose</option><option>Hospital da Luz Lisboa</option></select>
        <select id="specialty"><option value="">Choose</option><option>Ortopedia</option></select>
        <select id="consultation"><option value="">Choose</option><option>Consulta de Ortopedia - Ombro e Cotovelo</option></select>
        <select id="doctor"><option value="">Choose</option><option>Eduardo Carpinteiro</option></select>
        <select id="insurance"><option value="">Choose</option><option>Multicare</option></select>
        ${fixture.controls ?? ""}${navigation}
        <input type="submit" value="Continuar" onclick="sessionStorage.setItem('filters',JSON.stringify(Array.from(document.querySelectorAll('select')).map(e=>e.options[e.selectedIndex].text)));sessionStorage.setItem('widgetCalls',JSON.stringify(window.widgetCalls||[]));sessionStorage.setItem('focusCalls',String(window.focusCalls||0));location.href='/MYLUZ/MarcacaoPasso2.aspx'">`;
        const mfa =
          "<!doctype html><title>Login</title>" +
          '<input type="number">'.repeat(6);
        const pathname = new URL(url).pathname;
        if (pathname === "/blocked") {
          await route.fulfill({ status: 429, body: "Access denied fixture" });
          return;
        }
        await route.fulfill({
          contentType: "text/html",
          body: url.includes("Login2FA")
            ? mfa
            : pathname === "/login"
              ? '<input id="username"><input id="password" type="password"><button id="login" onclick="location.href=\'/MYLUZ/Login2FA.aspx\'">Login</button>'
              : pathname === "/captcha"
                ? '<title>Verify you are human</title><div class="g-recaptcha">Human verification fixture</div>'
                : pathname === "/logged-out"
                  ? '<div id="logged-out">Session ended fixture</div>'
                  : pathname === "/unknown"
                    ? "<title>Unknown fixture</title><p>Unknown</p>"
                    : /account|HomePage|Servico_List|GestaoConta/.test(url)
                      ? '<div id="authenticated">Account fixture</div>' +
                        navigation
                      : url.includes("MarcacaoPasso2")
                        ? (fixture.results ?? calendar) + navigation
                        : html,
        });
      });
      return context;
    });
  let session: Awaited<ReturnType<typeof createLuzSession>> | undefined;
  try {
    const config = JSON.parse(
      await readFile(join(__dirname, "../../myluz.config.example.json"), "utf8")
    );
    config.url = "https://luz.integration.test/MYLUZ/MarcacaoPasso1.aspx";
    config.profileDir = join(temporary, "profile");
    config.usernameEnv = "SCHEDULER_FIXTURE_USERNAME";
    config.passwordEnv = "SCHEDULER_FIXTURE_PASSWORD";
    Object.assign(config.selectors, {
      authenticated: "#authenticated",
      hospital: "#hospital",
      specialty: "#specialty",
      consultation: "#consultation",
      doctor: "#doctor",
      insurance: "#insurance",
      searchResults: "#schedule",
      loggedOut: "#logged-out",
      username: "#username",
      password: "#password",
      submitLogin: "#login",
      search: "#open-search",
    });
    configure(config);
    expect(new URL(config.url).origin).toBe("https://luz.integration.test");
    await writeFile(join(temporary, "config.json"), JSON.stringify(config));
    await writeFile(
      join(temporary, "credentials.env"),
      "SCHEDULER_FIXTURE_USERNAME=fixture\nSCHEDULER_FIXTURE_PASSWORD=fixture\n",
      { mode: 0o600 }
    );
    session = await createLuzSession(
      join(temporary, "config.json"),
      join(temporary, "credentials.env"),
      fixture.run
    );
    await body({
      session,
      native,
      windowStates,
      focusStates,
      onAction,
      configFile: join(temporary, "config.json"),
    });
    expect(unexpectedOrigins).toEqual([]);
  } finally {
    await session?.close();
    await rm(temporary, { recursive: true, force: true });
  }
}

function nativeTray() {
  return {
    available: true,
    setStatus: jest.fn(),
    setOpenText: jest.fn(),
    setAcceptEnabled: jest.fn(),
    notify: jest.fn(),
    notifyAppointment: jest.fn(),
    close: jest.fn(),
  };
}

it("returns from an account page through its existing search link without reloading login", async () => {
  await withAdapter(
    async ({ session, windowStates }) => {
      await session.page.goto("https://luz.integration.test/account");
      const goto = jest.spyOn(session.page, "goto");
      await session.returnToSearch();
      expect(goto).not.toHaveBeenCalled();
      expect(windowStates.every((state) => state === "minimized")).toBe(true);
      expect(await session.authenticated()).toBe(true);
    },
    (config) => {
      config.selectors.search = "#open-search";
    }
  );
});

it("stops the watcher when its browser is closed", async () => {
  await withAdapter(async ({ session }) => {
    expect(session.running()).toBe(true);
    await (session.page.context() as any).close();
    expect(session.running()).toBe(false);
  });
});

it("runs all query selections, then rejects the initial out-of-range date without calendar navigation", async () => {
  await withAdapter(async ({ session, native, focusStates }) => {
    await session.page.route("**/filter-refresh", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1200));
      await route.fulfill({ contentType: "text/plain", body: "refreshed" });
    });
    await session.page.evaluate(() => {
      const document = (globalThis as any).document;
      for (const select of document.querySelectorAll("select")) {
        select.classList.add("select-hide");
        select.style.display = "none";
        const container = document.createElement("div");
        container.id = `s2id_${select.id}`;
        container.innerHTML = '<span class="select2-chosen">Choose</span>';
        select.after(container);
      }
      const view = globalThis as any;
      view.widgetCalls = [];
      view.focusCalls = 0;
      view.HTMLElement.prototype.focus = () => {
        view.focusCalls++;
      };
      view.jQuery = (element: any) => ({
        0: element,
        data: () => ({
          optionToData: (option: any) => ({
            id: option[0].value,
            text: option[0].textContent,
          }),
          onSelect: (choice: any, options: any) => {
            const previous = element.value;
            view.widgetCalls.push({
              field: element.id,
              noFocus: options.noFocus,
            });
            element.value = choice.id;
            document.querySelector(
              `#s2id_${element.id} .select2-chosen`
            ).textContent = choice.text;
            if (!options.noFocus) element.focus();
            if (previous !== choice.id)
              element.dispatchEvent(
                new view.Event("change", { bubbles: true })
              );
          },
        }),
        select2: () => {
          throw new Error("Use the selection handler with noFocus");
        },
      });
      view.jQuery.fn = { select2: () => undefined };
      document.querySelector("#hospital").addEventListener("change", () => {
        const button = document.querySelector('input[type="submit"]');
        button.disabled = true;
        void (globalThis as any).fetch("/filter-refresh").then(() => {
          for (const select of document.querySelectorAll(
            "select:not(#hospital)"
          ))
            select.selectedIndex = 0;
          button.disabled = false;
        });
      });
    });
    await session.prepareSearch();
    session.beginCycle();
    expect(await session.search()).toBe(false);
    expect(
      await session.page.evaluate(
        "JSON.parse(sessionStorage.getItem('filters'))"
      )
    ).toEqual([
      "Hospital da Luz Lisboa",
      "Ortopedia",
      "Consulta de Ortopedia - Ombro e Cotovelo",
      "Eduardo Carpinteiro",
      "Multicare",
    ]);
    expect(await session.page.locator(".pika-title").innerText()).toBe(
      "2027-02"
    );
    expect(native.setAcceptEnabled).toHaveBeenLastCalledWith(false);
    expect(native.notifyAppointment).not.toHaveBeenCalled();
    expect(focusStates).toEqual([]);
    expect(
      await session.page.evaluate(
        "JSON.parse(sessionStorage.getItem('widgetCalls'))"
      )
    ).toEqual(
      ["hospital", "specialty", "consultation", "doctor", "insurance"].map(
        (field) => ({ field, noFocus: true })
      )
    );
    expect(
      await session.page.evaluate(
        "Number(sessionStorage.getItem('focusCalls'))"
      )
    ).toBe(0);
  });
});

it("rejects duplicate dropdown labels before changing the form", async () => {
  await withAdapter(async ({ session, focusStates }) => {
    await session.page.evaluate(() => {
      const document = (globalThis as any).document;
      const option = document.querySelector("#hospital option:last-child");
      option.parentElement.append(option.cloneNode(true));
    });
    await expect(session.search()).rejects.toThrow(/matches multiple/);
    expect(focusStates).toEqual([]);
    expect(await session.page.locator("#hospital").inputValue()).toBe("");
  });
});

it("books an initial in-range date and only allows strictly earlier dates after confirmation", async () => {
  await withAdapter(
    async ({ session }) => {
      await session.prepareSearch();
      session.beginCycle();
      expect(await session.search()).toBe(true);
      await session.page.evaluate(`window.bookedDates=[];
      const button=document.createElement('button'); button.className='fixture-book';button.textContent='Book fixture';
      button.onclick=()=>{window.bookedDates.push(window.selected);const marker=document.createElement('div');marker.id='book-confirmed';marker.textContent='Confirmed fixture';document.body.append(marker);};
      document.querySelector('.card-right').append(button);`);
      await session.book();
      expect(await session.confirmed()).toBe(true);
      session.tightenCutoff();
      session.beginCycle();
      expect(await session.search()).toBe(false);
      await session.page.evaluate(
        "window.selected='2027-02-24';window.events=['2027-02-24'];render()"
      );
      session.beginCycle();
      expect(await session.search()).toBe(false);
      await session.page.evaluate(
        "document.querySelector('#book-confirmed').remove();window.selected='2027-02-10';window.events=['2027-02-10'];render()"
      );
      session.beginCycle();
      expect(await session.search()).toBe(true);
      await session.book();
      expect(await session.confirmed()).toBe(true);
      session.tightenCutoff();
      expect(await session.page.evaluate("window.bookedDates")).toEqual([
        "2027-02-23",
        "2027-02-10",
      ]);
    },
    (config) => {
      config.search.fromDate = "2027-02-01";
      config.search.toDate = "2027-02-28";
      config.selectors.bookButton = ".fixture-book";
      config.selectors.bookingConfirmation = "#book-confirmed";
    }
  );
});

it.each(["when-needed", "always", "manual"])(
  "applies %s visibility to actual MFA transitions and notification Open",
  async (mode) => {
    await withAdapter(
      async ({ session, windowStates, focusStates, onAction }) => {
        expect(windowStates.length).toBeGreaterThan(0);
        expect(
          windowStates.every(
            (state) => state === (mode === "always" ? "normal" : "minimized")
          )
        ).toBe(true);
        const initialCount = windowStates.length;
        expect(focusStates).toEqual([]);
        await session.page.goto(
          "https://luz.integration.test/MYLUZ/Login2FA.aspx"
        );
        await session.signInTick();
        await session.signInTick();
        if (mode === "when-needed")
          expect(windowStates.slice(initialCount)).toEqual(["normal"]);
        else expect(windowStates).toHaveLength(initialCount);
        await session.page.goto(
          "https://luz.integration.test/MYLUZ/MarcacaoPasso1.aspx"
        );
        expect(await session.authenticated()).toBe(true);
        if (mode === "when-needed")
          expect(windowStates.slice(initialCount)).toEqual([
            "normal",
            "minimized",
          ]);
        else expect(windowStates).toHaveLength(initialCount);
        onAction("open");
        await new Promise((resolve) => setTimeout(resolve, 25));
        expect(windowStates.at(-1)).toBe("normal");
        expect(focusStates).toEqual([]);
        const count = windowStates.length;
        await session.authenticated();
        expect(windowStates).toHaveLength(count);
      },
      (config) => {
        config.browserVisibility = mode;
      }
    );
  }
);
