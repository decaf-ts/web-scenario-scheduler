import { BrowserVisibilityController } from "../../../../src/scenarios/luz/browser-visibility";

it("starts minimized, shows once for MFA, and minimizes when verification finishes", async () => {
  const window = {
    show: jest.fn(async () => undefined),
    hide: jest.fn(async () => undefined),
  };
  const visibility = new BrowserVisibilityController("when-needed", window);
  await visibility.initialize();
  expect(window.hide).toHaveBeenCalledTimes(1);
  await visibility.requireAttention("confirmation");
  await visibility.requireAttention("confirmation");
  expect(window.show).toHaveBeenCalledTimes(1);
  await visibility.clearAttention();
  expect(window.hide).toHaveBeenCalledTimes(2);
  await visibility.clearAttention();
  expect(window.hide).toHaveBeenCalledTimes(2);
});

it("lets notification Open stay visible during ordinary work until a challenge lifecycle finishes", async () => {
  const window = {
    show: jest.fn(async () => undefined),
    hide: jest.fn(async () => undefined),
  };
  const visibility = new BrowserVisibilityController("when-needed", window);
  await visibility.initialize();
  await visibility.open();
  await visibility.clearAttention();
  expect(window.show).toHaveBeenCalledTimes(1);
  expect(window.hide).toHaveBeenCalledTimes(1);
  await visibility.requireAttention("human-verification");
  await visibility.clearAttention();
  expect(window.hide).toHaveBeenCalledTimes(2);
});

it("keeps always mode visible and manual mode hidden until explicit Open", async () => {
  const alwaysWindow = {
    show: jest.fn(async () => undefined),
    hide: jest.fn(async () => undefined),
  };
  const always = new BrowserVisibilityController("always", alwaysWindow);
  await always.initialize();
  await always.requireAttention("confirmation");
  await always.clearAttention();
  expect(alwaysWindow.show).toHaveBeenCalledTimes(1);
  expect(alwaysWindow.hide).not.toHaveBeenCalled();
  const manualWindow = {
    show: jest.fn(async () => undefined),
    hide: jest.fn(async () => undefined),
  };
  const manual = new BrowserVisibilityController("manual", manualWindow);
  await manual.initialize();
  await manual.requireAttention("human-verification");
  await manual.clearAttention();
  expect(manualWindow.show).not.toHaveBeenCalled();
  expect(manualWindow.hide).toHaveBeenCalledTimes(1);
  await manual.open();
  expect(manualWindow.show).toHaveBeenCalledTimes(1);
});

it("returns ordinary browser work to the background and preserves explicit Open", async () => {
  const window = {
    show: jest.fn(async () => undefined),
    hide: jest.fn(async () => undefined),
  };
  const visibility = new BrowserVisibilityController("when-needed", window);
  const task = visibility.background(async () => "done");
  expect(await task()).toBe("done");
  expect(window.hide).toHaveBeenCalledTimes(2);
  await visibility.requireAttention("confirmation");
  await task();
  expect(window.hide).toHaveBeenCalledTimes(2);
  await visibility.clearAttention();
  await visibility.open();
  const hides = window.hide.mock.calls.length;
  await task();
  expect(window.hide).toHaveBeenCalledTimes(hides);
});

it("enforces background before and after each action and respects a manual minimize after Open", async () => {
  const events: string[] = [];
  let minimized = false;
  const visibility = new BrowserVisibilityController("when-needed", {
    show: async () => {
      minimized = false;
      events.push("show");
    },
    hide: async () => {
      minimized = true;
      events.push("hide");
    },
    isMinimized: async () => minimized,
  });
  const step = visibility.background(async () => {
    events.push("input");
  });
  await step();
  expect(events).toEqual(["hide", "input"]);
  await visibility.open();
  events.length = 0;
  await step();
  expect(events).toEqual(["input"]);
  minimized = true;
  events.length = 0;
  await step();
  expect(events).toEqual(["input"]);
  expect(visibility.shouldStayInBackground).toBe(true);
});
