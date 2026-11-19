import {
  StoryboardRunner,
  type StoryboardScenario,
  type StoryboardFlowContext,
} from "@decaf-ts/for-testing/ui";
import { parseLuzOptions } from "./command";
import type { LuzSession, MyLuzRunOptions } from "./session";

export type { LuzSession, MyLuzRunOptions } from "./session";
export type LuzSessionFactory = (
  config: string,
  env: string,
  options: MyLuzRunOptions,
  signal?: AbortSignal
) => Promise<LuzSession>;
export interface LuzState {
  session?: LuzSession;
  found: boolean;
  recovery?: "retry" | "sign-in" | "paused";
}

const task = (name: string) => ({ type: "task" as const, name });
const session = ({ state }: StoryboardFlowContext<LuzState>) => {
  if (!state.session) throw new Error("Luz session has not been opened.");
  return state.session;
};

/** Login, search, approval, confirmation, earlier-date and session-continuity loops. */
export function createLuzStoryboard(
  createSession?: LuzSessionFactory
): StoryboardScenario<LuzState> {
  return {
    id: "luz-appointments",
    section: "Luz",
    title: "Find and approve progressively earlier Luz appointments",
    route: "",
    flow: {
      initial: "open",
      stopWhen: "stopped",
      state: () => ({ found: false }),
      finalize: async ({ state }) => {
        await state.session?.close();
      },
      tasks: {
        async open(context) {
          const options = parseLuzOptions(context.args);
          const factory =
            createSession ?? (await import("./session")).createLuzSession;
          context.state.session = await factory(
            options.config,
            options.envFile,
            options,
            context.signal
          );
          context.page = context.state.session.page;
        },
        login: (context) => session(context).login(),
        signInTick: (context) => session(context).signInTick(),
        prepareSearch: (context) => session(context).prepareSearch(),
        beginCycle: (context) => session(context).beginCycle(),
        async search(context) {
          context.state.found = await session(context).search();
        },
        pollApproval: (context) => session(context).pollApproval(),
        discardCandidate: (context) => session(context).discardCandidate(),
        book: (context) => session(context).book(),
        tightenCutoff: (context) => session(context).tightenCutoff(),
        returnToSearch: (context) => session(context).returnToSearch(),
        beginWait: (context) => session(context).beginWait(),
        pollWait: (context) => session(context).pollWait(),
        visitKeepAlive: (context) => session(context).visitKeepAlive(),
        waitTick: (context) => session(context).waitTick(),
        async recover(context) {
          context.state.recovery = await session(context).recover(
            context.error
          );
        },
        pollPause: (context) => session(context).pollPause(),
        fatal: (context) => session(context).reportFatal(context.error),
        unconfirmed() {
          throw new Error(
            "Recursive booking did not reach the configured booking confirmation; cutoff was not advanced."
          );
        },
      },
      conditions: {
        stopped: ({ state }) =>
          Boolean(state.session && !state.session.running()),
        authenticated: (context) => session(context).authenticated(),
        found: ({ state }) => state.found,
        candidate: (context) => session(context).hasCandidate(),
        accepted: (context) => session(context).accepted(),
        searchRequested: (context) => session(context).searchRequested(),
        recursive: (context) => session(context).recursive(),
        confirmed: (context) => session(context).confirmed(),
        confirmationPending: (context) =>
          session(context).confirmationPending(),
        waiting: (context) => session(context).waiting(),
        keepAliveDue: (context) => session(context).keepAliveDue(),
        needsSignIn: ({ state }) => state.recovery === "sign-in",
        retry: ({ state }) => state.recovery === "retry",
      },
      states: {
        open: { actions: [task("open")], transitions: [{ to: "login" }] },
        login: {
          actions: [task("login")],
          onError: "fatal",
          transitions: [{ to: "sign-in" }],
        },
        "sign-in": {
          actions: [task("signInTick")],
          onError: "fatal",
          transitions: [
            { when: "stopped", to: null },
            { when: "authenticated", to: "prepare" },
            { to: "sign-in-wait" },
          ],
        },
        "sign-in-wait": {
          actions: [task("waitTick")],
          transitions: [{ to: "sign-in" }],
        },
        prepare: {
          actions: [task("prepareSearch")],
          onError: "recover",
          transitions: [{ when: "stopped", to: null }, { to: "search" }],
        },
        search: {
          actions: [task("beginCycle"), task("search")],
          onError: "recover",
          transitions: [
            { when: "stopped", to: null },
            { when: "found", to: "approval" },
            { to: "begin-wait" },
          ],
        },
        approval: {
          actions: [task("pollApproval")],
          onError: "recover",
          transitions: [
            { when: "stopped", to: null },
            { when: "searchRequested", to: "discard" },
            { when: "accepted", to: "book" },
            { when: "candidate", to: "approval-wait" },
            { to: "begin-wait" },
          ],
        },
        "approval-wait": {
          actions: [task("waitTick")],
          transitions: [{ to: "approval" }],
        },
        discard: {
          actions: [task("discardCandidate")],
          transitions: [{ to: "return-search" }],
        },
        book: {
          actions: [task("book")],
          onError: "fatal",
          transitions: [{ when: "stopped", to: null }, { to: "confirmation" }],
        },
        confirmation: {
          actions: [],
          onError: "fatal",
          transitions: [
            { when: "stopped", to: null },
            { when: "confirmed", to: "earlier-date" },
            { when: "confirmationPending", to: "confirmation-wait" },
            { to: "unconfirmed" },
          ],
        },
        "confirmation-wait": {
          actions: [task("waitTick")],
          transitions: [{ to: "confirmation" }],
        },
        unconfirmed: {
          actions: [task("unconfirmed")],
          onError: "fatal",
          transitions: [],
        },
        "earlier-date": {
          actions: [task("tightenCutoff")],
          onError: "fatal",
          transitions: [
            { when: "recursive", to: "return-search" },
            { to: "begin-wait" },
          ],
        },
        "begin-wait": {
          actions: [task("beginWait")],
          transitions: [{ to: "wait" }],
        },
        wait: {
          actions: [task("pollWait")],
          onError: "recover",
          transitions: [
            { when: "stopped", to: null },
            { when: "searchRequested", to: "return-search" },
            { when: "waiting", to: "keep-alive-check" },
            { to: "return-search" },
          ],
        },
        "keep-alive-check": {
          actions: [],
          transitions: [
            { when: "keepAliveDue", to: "keep-alive" },
            { to: "wait-tick" },
          ],
        },
        "keep-alive": {
          actions: [task("visitKeepAlive")],
          onError: "recover",
          transitions: [{ to: "wait" }],
        },
        "wait-tick": {
          actions: [task("waitTick")],
          transitions: [{ to: "wait" }],
        },
        "return-search": {
          actions: [task("returnToSearch")],
          onError: "recover",
          transitions: [{ when: "stopped", to: null }, { to: "search" }],
        },
        recover: {
          actions: [task("recover")],
          onError: "fatal",
          transitions: [
            { when: "stopped", to: null },
            { when: "needsSignIn", to: "sign-in" },
            { when: "retry", to: "search" },
            { to: "paused" },
          ],
        },
        paused: {
          actions: [task("pollPause")],
          onError: "recover",
          transitions: [
            { when: "stopped", to: null },
            { when: "searchRequested", to: "return-search" },
            { to: "paused-wait" },
          ],
        },
        "paused-wait": {
          actions: [task("waitTick")],
          transitions: [{ to: "paused" }],
        },
        fatal: {
          actions: [task("fatal")],
          transitions: [{ to: "fatal-wait" }],
        },
        "fatal-wait": {
          actions: [task("waitTick")],
          transitions: [{ when: "stopped", to: null }, { to: "fatal-wait" }],
        },
      },
    },
  };
}

const storyboard = createLuzStoryboard();
export default storyboard;

/** Backwards-compatible programmatic entry; execution belongs to the shared Storyboard runner. */
export async function runMyLuzScenario(
  config: string,
  env: string,
  options: MyLuzRunOptions = {}
): Promise<void> {
  const args = ["--config", config, "--env-file", env];
  if (options.before) args.push("--before", options.before);
  if (options.recursive) args.push("--recursive");
  if (options.kind) args.push("--kind", options.kind);
  if (options.browserVisibility)
    args.push("--browser-visibility", options.browserVisibility);
  await StoryboardRunner.runScenario(storyboard, { args });
}
