import {
  StoryboardRunner,
  type StoryboardPage,
} from "@decaf-ts/for-testing/ui";
import {
  createLuzStoryboard,
  type LuzSession,
} from "../../../../src/scenarios/luz/scenario";

function fakeSession() {
  let running = true;
  let candidate = false;
  let requested = false;
  let authenticated = true;
  let recursive = false;
  let accepted = false;
  let waiting = true;
  let keepAliveDue = true;
  const calls: string[] = [];
  const session: LuzSession = {
    page: {} as StoryboardPage,
    running: () => running,
    authenticated: async () => authenticated,
    async login() {
      calls.push("submit-login");
    },
    async signInTick() {
      calls.push("login");
    },
    async prepareSearch() {
      calls.push("prepare");
    },
    beginCycle() {
      calls.push("begin");
    },
    async search() {
      calls.push("search");
      candidate = true;
      return true;
    },
    async pollApproval() {
      calls.push("approve");
      accepted = true;
    },
    accepted: () => accepted,
    hasCandidate: () => candidate,
    searchRequested: () => requested,
    discardCandidate() {
      calls.push("discard");
      candidate = false;
    },
    async book() {
      calls.push("book");
      candidate = false;
    },
    recursive: () => recursive,
    async confirmed() {
      calls.push("confirm");
      return true;
    },
    confirmationPending: () => false,
    tightenCutoff() {
      calls.push("earlier");
    },
    async returnToSearch() {
      calls.push("return");
      running = false;
    },
    beginWait() {
      calls.push("begin-wait");
    },
    pollWait() {
      calls.push("poll-wait");
    },
    waiting: () => waiting,
    keepAliveDue: () => keepAliveDue,
    async visitKeepAlive() {
      calls.push("keep-alive");
      keepAliveDue = false;
      waiting = false;
    },
    async waitTick() {
      calls.push("wait");
    },
    async recover() {
      calls.push("recover");
      return "retry";
    },
    async pollPause() {
      calls.push("paused");
    },
    reportFatal() {
      calls.push("fatal");
      running = false;
    },
    async close() {
      calls.push("close");
    },
  };
  return {
    session,
    calls,
    stop: () => {
      running = false;
    },
    requestSearch: () => {
      requested = true;
    },
    signIn: () => {
      authenticated = true;
    },
    logOut: () => {
      authenticated = false;
    },
    recursive: () => {
      recursive = true;
    },
    rejectApproval: () => {
      accepted = false;
    },
  };
}

async function run(fake: ReturnType<typeof fakeSession>) {
  const factory = jest.fn(async () => fake.session);
  const states: string[] = [];
  await StoryboardRunner.runScenario(createLuzStoryboard(factory), {
    args: ["--config", "example.json", "--env-file", "credentials.env"],
    onState: (name) => states.push(name),
  });
  expect(factory).toHaveBeenCalledWith(
    "example.json",
    "credentials.env",
    expect.objectContaining({ config: "example.json" }),
    undefined
  );
  return states;
}

describe("Luz Storyboard definition", () => {
  it("waits for sign-in, searches, books on approval, visits keep-alive pages and returns to search", async () => {
    const fake = fakeSession();
    fake.logOut();
    fake.session.signInTick = async () => {
      fake.calls.push("login");
      if (fake.calls.filter((c) => c === "login").length === 2) fake.signIn();
    };
    const states = await run(fake);
    expect(states).toContain("sign-in-wait");
    expect(
      fake.calls.filter((c) =>
        ["login", "search", "book", "keep-alive", "return", "close"].includes(c)
      )
    ).toEqual([
      "login",
      "login",
      "search",
      "book",
      "keep-alive",
      "return",
      "close",
    ]);
  });

  it("keeps waiting while approval is absent, and never books when Search now is requested", async () => {
    const fake = fakeSession();
    let polls = 0;
    fake.session.pollApproval = async () => {
      if (++polls === 2) fake.requestSearch();
    };
    const states = await run(fake);
    expect(states).toContain("approval-wait");
    expect(fake.calls).toContain("discard");
    expect(fake.calls).not.toContain("book");
    expect(fake.calls).not.toContain("earlier");
  });

  it("advances the date only after booking confirmation, then starts another search", async () => {
    const fake = fakeSession();
    fake.recursive();
    let confirmations = 0;
    let searches = 0;
    fake.session.confirmed = async () => {
      fake.calls.push("confirm");
      return ++confirmations === 2;
    };
    fake.session.confirmationPending = () => true;
    fake.session.returnToSearch = async () => {
      fake.calls.push("return");
    };
    fake.session.search = async () => {
      fake.calls.push("search");
      if (++searches === 2) fake.stop();
      return true;
    };
    const states = await run(fake);
    expect(states).toContain("confirmation-wait");
    expect(
      fake.calls.filter((c) =>
        ["search", "book", "confirm", "earlier", "return", "close"].includes(c)
      )
    ).toEqual([
      "search",
      "book",
      "confirm",
      "confirm",
      "earlier",
      "return",
      "search",
      "close",
    ]);
  });

  it("does not tighten the cutoff or book again when confirmation times out", async () => {
    const fake = fakeSession();
    fake.recursive();
    fake.session.confirmed = async () => false;
    await run(fake);
    expect(fake.calls).toContain("fatal");
    expect(fake.calls).not.toContain("earlier");
    expect(fake.calls.filter((c) => c === "book")).toHaveLength(1);
    expect(fake.calls.at(-1)).toBe("close");
  });

  it("returns to sign-in after session expiry without reopening the browser", async () => {
    const fake = fakeSession();
    let searches = 0;
    fake.session.search = async () => {
      fake.calls.push("search");
      if (++searches === 1) {
        fake.logOut();
        throw new Error("expired");
      }
      fake.stop();
      return false;
    };
    fake.session.recover = async () => "sign-in";
    fake.session.signInTick = async () => {
      fake.calls.push("login");
      fake.signIn();
    };
    const states = await run(fake);
    expect(states.filter((name) => name === "open")).toHaveLength(1);
    expect(states.filter((name) => name === "sign-in")).toHaveLength(2);
    expect(fake.calls.at(-1)).toBe("close");
  });

  it("recovers transient searches and keeps paused searches waiting for the operator", async () => {
    const fake = fakeSession();
    let searches = 0;
    fake.session.search = async () => {
      fake.calls.push("search");
      if (++searches < 3) throw new Error("transient");
      fake.stop();
      return false;
    };
    let recoveries = 0;
    fake.session.recover = async () =>
      ++recoveries === 1 ? "retry" : "paused";
    fake.session.pollPause = async () => fake.requestSearch();
    fake.session.returnToSearch = async () => {
      fake.calls.push("return");
    };
    const states = await run(fake);
    expect(states).toContain("paused");
    expect(searches).toBe(3);
  });

  it("cleans up the session when externally cancelled", async () => {
    const fake = fakeSession();
    const controller = new AbortController();
    fake.session.search = async () => {
      controller.abort(new Error("cancel"));
      return false;
    };
    await expect(
      StoryboardRunner.runScenario(
        createLuzStoryboard(async () => fake.session),
        { signal: controller.signal }
      )
    ).rejects.toThrow("cancel");
    expect(fake.calls.at(-1)).toBe("close");
  });
  it("does not book when Quit arrives immediately before the booking state", async () => {
    const fake = fakeSession();
    await StoryboardRunner.runScenario(createLuzStoryboard(async () => fake.session), {
      onState: name => { if (name === "book") fake.stop(); },
    });
    expect(fake.calls).not.toContain("book");
    expect(fake.calls.at(-1)).toBe("close");
  });

  it("stops automated searches after a blocked-site recovery fails", async () => {
    const fake = fakeSession();
    fake.session.search = async () => { fake.calls.push("search"); throw new Error("HTTP 429"); };
    fake.session.recover = async () => { throw new Error("blocked"); };
    await run(fake);
    expect(fake.calls.filter(call => call === "search")).toHaveLength(1);
    expect(fake.calls).not.toContain("book");
    expect(fake.calls).toContain("fatal");
  });

  it("rechecks after an empty search and keep-alive navigation on the same session", async () => {
    const fake = fakeSession(); let searches = 0;
    fake.session.search = async () => { fake.calls.push("search"); if (++searches === 2) fake.stop(); return false; };
    fake.session.returnToSearch = async () => { fake.calls.push("return"); };
    await run(fake);
    expect(fake.calls.filter(call => ["search", "keep-alive", "return", "close"].includes(call))).toEqual([
      "search", "keep-alive", "return", "search", "close",
    ]);
  });

  it("also tracks confirmation and the earlier-date cutoff after a manually approved booking", async () => {
    const fake = fakeSession();
    const states = await run(fake);
    expect(states).toContain("confirmation");
    expect(states).toContain("earlier-date");
    expect(fake.calls.indexOf("confirm")).toBeLessThan(fake.calls.indexOf("earlier"));
    expect(fake.calls.indexOf("earlier")).toBeLessThan(fake.calls.indexOf("begin-wait"));
  });

});
