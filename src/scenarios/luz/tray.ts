import {
  NotificationCenter,
  TrayIcon,
  TRAY_ICON_BASE64,
} from "@decaf-ts/for-os";

export const DEFAULT_LUZ_NOTIFICATION_TIMEOUT_MS = 60_000;

export type AppointmentTrayAction = "open" | "search" | "accept" | "quit";
export type AppointmentTray = {
  readonly available: boolean;
  setStatus(status: string): void;
  setOpenText(text: string): void;
  setAcceptEnabled(enabled: boolean, title?: string): void;
  notify(title: string, message: string): void;
  notifyAppointment(title: string, message: string): void;
  close(): void;
};

/** Application menu and actions; for-os owns native polling and resource cleanup. */
export async function createAppointmentTray(
  onAction: (action: AppointmentTrayAction) => void,
  options: { notificationTimeoutMs?: number } = {}
): Promise<AppointmentTray> {
  const timeoutMs =
    options.notificationTimeoutMs ?? DEFAULT_LUZ_NOTIFICATION_TIMEOUT_MS;
  let notifications: NotificationCenter | undefined;
  let tray: TrayIcon | undefined;
  let closed = false;
  const action = (id: AppointmentTrayAction) => () => {
    if (!closed) onAction(id);
  };
  try {
    notifications = new NotificationCenter();
    notifications.registerAction("open", action("open"));
    notifications.registerAction("see", action("open"));
    notifications.registerAction("accept", action("accept"));
    tray = TrayIcon.create({
      icon: { base64: TRAY_ICON_BASE64.idle },
      tooltip: "MyLuz appointment watcher",
      menu: [
        { id: "open", label: "Open MyLuz", onClick: action("open") },
        { id: "search", label: "Search now", onClick: action("search") },
        {
          id: "accept",
          label: "Accept appointment",
          enabled: false,
          onClick: action("accept"),
        },
        { id: "quit", label: "Quit", onClick: action("quit") },
      ],
    });
  } catch (error) {
    console.warn(
      `MyLuz tray unavailable: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  const send = (title: string, body: string, appointment: boolean) => {
    if (closed) return;
    try {
      if (!notifications)
        throw new Error("Native notification bridge unavailable");
      if (appointment)
        notifications.notifyAppointment({ title, body, timeoutMs });
      else
        notifications.notify({
          title,
          body,
          timeoutMs,
          buttons: [{ id: "open", label: "Open MyLuz" }],
        });
    } catch (error) {
      console.warn(
        `OS notification unavailable: ${title}: ${body} (${error instanceof Error ? error.message : String(error)})`
      );
    }
  };
  return {
    get available() {
      return !closed && !!tray?.active;
    },
    setStatus: (status) => tray?.setTooltip(status),
    setOpenText: (label) => tray?.updateMenuItem("open", { label }),
    setAcceptEnabled: (enabled, label) =>
      tray?.updateMenuItem("accept", { enabled, ...(label ? { label } : {}) }),
    notify: (title, message) => send(title, message, false),
    notifyAppointment: (title, message) => send(title, message, true),
    close() {
      if (closed) return;
      closed = true;
      try {
        tray?.close();
      } finally {
        notifications?.close();
      }
    },
  };
}
