import type { BrowserVisibility } from "./browser-visibility";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";

export type AppointmentConfig = {
  bookingKind: "appointment" | "exam";
  url: string;
  usernameEnv: string;
  passwordEnv: string;
  profileDir: string;
  intervalMs: number;
  notificationTimeoutMs: number;
  browserVisibility: BrowserVisibility;
  keepAlive: {
    enabled: boolean;
    intervalMs: number;
    pages: Array<{ name: string; selector: string }>;
  };
  selectors: {
    username: string;
    password: string;
    submitLogin: string;
    confirmationScreen: string;
    authenticated: string;
    search: string;
    backToSearch: string;
    examSearch: string;
    doctor: string;
    exam: string;
    hospital: string;
    specialty: string;
    consultation: string;
    subSpecialty: string;
    insurance: string;
    fromDate: string;
    toDate: string;
    fromTime: string;
    toTime: string;
    submitSearch: string;
    searchResults: string;
    resultCard: string;
    resultAvailable: string;
    resultDescription: string;
    selectedDate: string;
    bookButton: string;
    bookingConfirmation: string;
    loggedOut: string;
    blocked: string;
  };
  search: {
    doctor?: string;
    exam?: string;
    hospital?: string;
    specialty?: string;
    consultation?: string;
    subSpecialty?: string;
    insurance?: string;
    fromDate?: string;
    toDate?: string;
    fromTime?: string;
    toTime?: string;
  };
};

const minimumIntervalMs = 5 * 60_000;
const minimumKeepAliveIntervalMs = 60_000;
const selectorKeys = [
  "username",
  "password",
  "submitLogin",
  "confirmationScreen",
  "authenticated",
  "search",
  "backToSearch",
  "examSearch",
  "doctor",
  "exam",
  "hospital",
  "specialty",
  "consultation",
  "subSpecialty",
  "insurance",
  "fromDate",
  "toDate",
  "fromTime",
  "toTime",
  "submitSearch",
  "searchResults",
  "resultCard",
  "resultAvailable",
  "resultDescription",
  "selectedDate",
  "bookButton",
  "bookingConfirmation",
  "loggedOut",
  "blocked",
] as const;

function requireString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim())
    throw new Error(`Config field "${name}" must be a non-empty string.`);
  return value.trim();
}

/** Loads user configuration; credentials are read only from environment variables. */
export async function loadAppointmentConfig(
  file: string
): Promise<AppointmentConfig> {
  const absolute = resolve(file);
  const raw = JSON.parse(await readFile(absolute, "utf8")) as Record<
    string,
    unknown
  >;
  const bookingKind = String(raw.bookingKind ?? "appointment");
  if (bookingKind !== "appointment" && bookingKind !== "exam") {
    throw new Error('bookingKind must be either "appointment" or "exam".');
  }
  const rawSelectors = raw.selectors as Record<string, unknown> | undefined;
  const missing = selectorKeys.filter(
    (key) =>
      typeof rawSelectors?.[key] !== "string" ||
      !String(rawSelectors[key]).trim()
  );
  if (missing.length)
    throw new Error(`Config selectors are missing: ${missing.join(", ")}.`);

  const intervalMs = Number(raw.intervalMs ?? minimumIntervalMs);
  if (!Number.isFinite(intervalMs) || intervalMs < minimumIntervalMs) {
    throw new Error(
      `intervalMs must be at least ${minimumIntervalMs} (5 minutes) to respect the site's request limits.`
    );
  }
  const notificationTimeoutMs = Number(raw.notificationTimeoutMs ?? 60_000);
  if (!Number.isFinite(notificationTimeoutMs) || notificationTimeoutMs < 0) {
    throw new Error("notificationTimeoutMs must be a finite number >= 0.");
  }
  const browserVisibility = raw.browserVisibility ?? "when-needed";
  if (
    typeof browserVisibility !== "string" ||
    !["when-needed", "always", "manual"].includes(browserVisibility)
  ) {
    throw new Error(
      "browserVisibility must be when-needed, always, or manual."
    );
  }
  const rawKeepAlive = (raw.keepAlive ?? {}) as Record<string, unknown>;
  const keepAliveIntervalMs = Number(
    rawKeepAlive.intervalMs ?? minimumKeepAliveIntervalMs
  );
  if (
    !Number.isFinite(keepAliveIntervalMs) ||
    keepAliveIntervalMs < minimumKeepAliveIntervalMs
  ) {
    throw new Error(
      `keepAlive.intervalMs must be at least ${minimumKeepAliveIntervalMs} (1 minute).`
    );
  }
  const keepAlivePages = Array.isArray(rawKeepAlive.pages)
    ? rawKeepAlive.pages.map((page, index) => {
        const item = page as Record<string, unknown>;
        return {
          name: requireString(item?.name, `keepAlive.pages[${index}].name`),
          selector: requireString(
            item?.selector,
            `keepAlive.pages[${index}].selector`
          ),
        };
      })
    : [];
  if (rawKeepAlive.enabled === true && keepAlivePages.length === 0) {
    throw new Error(
      "keepAlive.pages must contain at least one configured read-only page when keepAlive.enabled is true."
    );
  }
  const url = new URL(
    String(raw.url ?? "https://myluz.hospitaldaluz.pt/MYLUZ/")
  );
  if (url.protocol !== "https:")
    throw new Error("The MyLuz URL must use HTTPS.");
  const profile = String(
    raw.profileDir ?? "~/.myluz-assistant/browser-profile"
  );
  const profileDir = profile.startsWith("~/")
    ? resolve(homedir(), profile.slice(2))
    : resolve(dirname(absolute), profile);
  const search = (raw.search ?? {}) as Record<string, unknown>;
  const normalizedSearch: AppointmentConfig["search"] = {};
  for (const key of [
    "doctor",
    "exam",
    "hospital",
    "specialty",
    "consultation",
    "subSpecialty",
    "insurance",
    "fromDate",
    "toDate",
    "fromTime",
    "toTime",
  ] as const) {
    if (search[key] !== undefined && search[key] !== "")
      normalizedSearch[key] = String(search[key]);
  }

  for (const key of ["fromTime", "toTime"] as const) {
    const value = normalizedSearch[key];
    if (value && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value))
      throw new Error(`search.${key} must use HH:MM.`);
  }
  if (
    normalizedSearch.fromTime &&
    normalizedSearch.toTime &&
    normalizedSearch.fromTime > normalizedSearch.toTime
  ) {
    throw new Error("search.fromTime must not be later than search.toTime.");
  }

  return {
    bookingKind,
    url: url.toString(),
    usernameEnv: requireString(
      raw.usernameEnv ?? "MYLUZ_USERNAME",
      "usernameEnv"
    ),
    passwordEnv: requireString(
      raw.passwordEnv ?? "MYLUZ_PASSWORD",
      "passwordEnv"
    ),
    profileDir,
    intervalMs,
    notificationTimeoutMs,
    browserVisibility: browserVisibility as BrowserVisibility,
    keepAlive: {
      enabled: rawKeepAlive.enabled === true,
      intervalMs: keepAliveIntervalMs,
      pages: keepAlivePages,
    },
    selectors: Object.fromEntries(
      selectorKeys.map((key) => [key, String(rawSelectors![key]).trim()])
    ) as AppointmentConfig["selectors"],
    search: normalizedSearch,
  };
}
