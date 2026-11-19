import {
  NotificationCenter,
  TrayIcon,
  type TrayIconOptions,
} from "@decaf-ts/for-os";
import { createAppointmentTray } from "../../../../src/scenarios/luz/tray";

afterEach(() => jest.restoreAllMocks());

it("routes menu and popup actions and cleans up both shared resources", async () => {
  let options!: TrayIconOptions;
  const native = {
    active: true,
    updateMenuItem: jest.fn(),
    setTooltip: jest.fn(),
    close: jest.fn(),
  };
  jest.spyOn(TrayIcon, "create").mockImplementation((config) => {
    options = config;
    return native as unknown as TrayIcon;
  });
  const notify = jest
    .spyOn(NotificationCenter.prototype, "notify")
    .mockReturnValue({} as never);
  const appointment = jest
    .spyOn(NotificationCenter.prototype, "notifyAppointment")
    .mockReturnValue({} as never);
  const close = jest.spyOn(NotificationCenter.prototype, "close");
  const register = jest.spyOn(NotificationCenter.prototype, "registerAction");
  const action = jest.fn();
  const tray = await createAppointmentTray(action);
  expect(options.menu?.find((item) => item.id === "accept")?.enabled).toBe(
    false
  );
  for (const entry of options.menu ?? []) entry.onClick?.(entry.id);
  expect(action.mock.calls.map(([id]) => id)).toEqual([
    "open",
    "search",
    "accept",
    "quit",
  ]);
  action.mockClear();
  register.mock.calls.find(([id]) => id === "see")![1]("see");
  register.mock.calls.find(([id]) => id === "accept")![1]("accept");
  expect(action.mock.calls.map(([id]) => id)).toEqual(["open", "accept"]);
  tray.setAcceptEnabled(true, "Accept earlier appointment");
  expect(native.updateMenuItem).toHaveBeenCalledWith("accept", {
    enabled: true,
    label: "Accept earlier appointment",
  });
  tray.notify("Ready", "Open the browser");
  expect(notify).toHaveBeenCalledWith(
    expect.objectContaining({
      timeoutMs: 60_000,
      buttons: [{ id: "open", label: "Open MyLuz" }],
    })
  );
  tray.notifyAppointment("Appointment", "An earlier slot");
  expect(appointment).toHaveBeenCalledWith({
    title: "Appointment",
    body: "An earlier slot",
    timeoutMs: 60_000,
  });
  tray.close();
  tray.close();
  expect(native.close).toHaveBeenCalledTimes(1);
  expect(close).toHaveBeenCalledTimes(1);
  expect(tray.available).toBe(false);
  action.mockClear();
  options.menu![0].onClick?.("open");
  expect(action).not.toHaveBeenCalled();
});

it("reports unavailable when a desktop host cannot be created", async () => {
  jest.spyOn(TrayIcon, "create").mockImplementation(() => {
    throw new Error("no desktop");
  });
  jest.spyOn(console, "warn").mockImplementation(() => undefined);
  const tray = await createAppointmentTray(jest.fn());
  expect(tray.available).toBe(false);
  expect(() => tray.setAcceptEnabled(true)).not.toThrow();
  tray.close();
});

it("forwards a configured notification display duration", async () => {
  const native = {
    active: true,
    updateMenuItem: jest.fn(),
    setTooltip: jest.fn(),
    close: jest.fn(),
  };
  jest.spyOn(TrayIcon, "create").mockReturnValue(native as unknown as TrayIcon);
  const notify = jest
    .spyOn(NotificationCenter.prototype, "notify")
    .mockReturnValue({} as never);
  const tray = await createAppointmentTray(jest.fn(), {
    notificationTimeoutMs: 120_000,
  });
  try {
    tray.notify("Ready", "Review when ready");
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ timeoutMs: 120_000 })
    );
  } finally {
    tray.close();
  }
});
