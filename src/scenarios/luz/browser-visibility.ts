export type BrowserVisibility = "when-needed" | "always" | "manual";
export type BrowserAttention = "confirmation" | "human-verification" | "login";

/** Own automatic visibility separately from explicit notification/tray Open requests. */
export class BrowserVisibilityController {
  private attention?: BrowserAttention;
  private openedByUser = false;
  constructor(
    readonly mode: BrowserVisibility,
    private readonly window: {
      show(): Promise<void>;
      hide(): Promise<void>;
      isMinimized?(): Promise<boolean>;
    }
  ) {}

  async initialize(): Promise<void> {
    if (this.mode === "always") await this.window.show();
    else await this.window.hide();
  }

  async requireAttention(reason: BrowserAttention): Promise<void> {
    if (this.attention === reason) return;
    this.attention = reason;
    if (this.mode === "when-needed") await this.window.show();
  }

  async clearAttention(): Promise<void> {
    if (!this.attention) return;
    this.attention = undefined;
    if (this.mode === "when-needed") {
      this.openedByUser = false;
      await this.window.hide();
    }
  }

  /** Explicit Open always works, and stays visible during ordinary background work. */
  async open(): Promise<void> {
    this.openedByUser = true;
    await this.window.show();
  }

  async maintainBackground(): Promise<void> {
    // Re-minimizing can dispatch resize/blur and close a live dropdown.
    if (this.shouldStayInBackground && !(await this.window.isMinimized?.()))
      await this.window.hide();
  }

  get shouldStayInBackground(): boolean {
    return (
      this.mode !== "always" &&
      !this.openedByUser &&
      (this.mode === "manual" || !this.attention)
    );
  }

  /** Apply the current visibility policy before and after each browser step. */
  background<T>(action: () => Promise<T>): () => Promise<T> {
    return async () => {
      if (this.openedByUser && (await this.window.isMinimized?.()))
        this.openedByUser = false;
      await this.maintainBackground();
      try {
        return await action();
      } finally {
        await this.maintainBackground();
      }
    };
  }
}
