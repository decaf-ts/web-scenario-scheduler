export type MyLuzPageState =
  | "login"
  | "confirmation"
  | "human-verification"
  | "blocked"
  | "appointment-form"
  | "results"
  | "home"
  | "unknown";

export function hasHumanVerificationPrompt(bodyText: string): boolean {
  return /captcha|verifica[cç][aã]o humana|confirme que.{0,40}rob[oô]|n[aã]o sou um rob[oô]|are you human|verify you are human|robot check|clique no.{0,30}ícone.{0,30}(?:diferente|distinto)|ícone que é diferente|complete.{0,30}desafio/i.test(
    bodyText
  );
}

export function isLuzMfaRoute(url: string): boolean {
  try {
    return /\/login2fa\.aspx$/i.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

/** Classify the rendered page from visible evidence before taking any action. */
export function classifyMyLuzPage(input: {
  url: string;
  title: string;
  bodyText: string;
  loginForm: boolean;
  confirmation: boolean;
  humanVerification: boolean;
  loggedOut: boolean;
  blocked: boolean;
  appointmentForm: boolean;
  results: boolean;
  authenticated: boolean;
}): MyLuzPageState {
  if (input.blocked) return "blocked";
  if (input.humanVerification) return "human-verification";
  if (input.confirmation || isLuzMfaRoute(input.url)) return "confirmation";
  if (input.loggedOut || input.loginForm) return "login";
  const route = (() => {
    try {
      return new URL(input.url).pathname.toLowerCase();
    } catch {
      return "";
    }
  })();
  if (/marcacaopasso2\.aspx$/.test(route)) return "results";
  if (/marcacaopasso1\.aspx$/.test(route)) return "appointment-form";
  if (input.results) return "results";
  if (input.appointmentForm) return "appointment-form";
  if (
    input.authenticated ||
    /\b(?:início|inicio|home|área pessoal|area pessoal|my luz)\b/i.test(
      `${input.title} ${input.bodyText}`
    )
  )
    return "home";
  return "unknown";
}
