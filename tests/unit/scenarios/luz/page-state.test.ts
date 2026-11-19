import {
  classifyMyLuzPage,
  hasHumanVerificationPrompt,
} from "../../../../src/scenarios/luz/page-state";

const base = {
  url: "https://myluz.hospitaldaluz.pt/MYLUZ/",
  title: "MyLuz",
  bodyText: "",
  loginForm: false,
  confirmation: false,
  humanVerification: false,
  loggedOut: false,
  blocked: false,
  appointmentForm: false,
  results: false,
  authenticated: false,
};

describe("classifyMyLuzPage", () => {
  it("recognizes the Portuguese icon-selection verification prompt", () => {
    expect(hasHumanVerificationPrompt("Clique no ícone que é diferente")).toBe(
      true
    );
  });

  test.each([
    ["login", { loginForm: true }],
    ["confirmation", { confirmation: true }],
    ["human-verification", { humanVerification: true }],
    ["blocked", { blocked: true }],
    ["appointment-form", { appointmentForm: true }],
    ["results", { results: true }],
    ["home", { authenticated: true }],
    ["home", { title: "Home - MyLuz" }],
    ["unknown", { title: "", bodyText: "Unexpected content" }],
  ] as const)("recognizes %s state", (expected, input) => {
    expect(classifyMyLuzPage({ ...base, ...input })).toBe(expected);
  });

  test("prioritizes a block page over login-looking controls", () => {
    expect(classifyMyLuzPage({ ...base, loginForm: true, blocked: true })).toBe(
      "blocked"
    );
  });

  test("recognizes challenge widgets before reporting a plain login form", () => {
    expect(
      classifyMyLuzPage({ ...base, loginForm: true, humanVerification: true })
    ).toBe("human-verification");
  });

  test("recognizes the portal booking routes even while controls are re-rendering", () => {
    expect(
      classifyMyLuzPage({ ...base, url: `${base.url}MarcacaoPasso1.aspx` })
    ).toBe("appointment-form");
    expect(
      classifyMyLuzPage({ ...base, url: `${base.url}MarcacaoPasso2.aspx` })
    ).toBe("results");
  });
});

it("recognizes the portal's split six-digit MFA route without OTP attributes", () => {
  expect(
    classifyMyLuzPage({
      url: "https://myluz.hospitaldaluz.pt/MYLUZ/Login2FA.aspx",
      title: "Login",
      bodyText: "",
      loginForm: false,
      confirmation: false,
      humanVerification: false,
      loggedOut: false,
      blocked: false,
      appointmentForm: false,
      results: false,
      authenticated: false,
    })
  ).toBe("confirmation");
});
