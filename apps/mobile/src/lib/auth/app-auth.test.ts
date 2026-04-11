import {
  buildAppLoginUrl,
  extractAppCallbackResult,
  extractSessionTokenFromCallback,
  MOBILE_APP_TYPE_HEADER,
} from "./app-auth";

describe("app auth utilities", () => {
  it("builds the mobile app login URL", () => {
    expect(
      buildAppLoginUrl("https://ui.z8-time.app", "z8mobile://auth/callback"),
    ).toBe(
      "https://ui.z8-time.app/api/auth/app-login?app=mobile&redirect=z8mobile%3A%2F%2Fauth%2Fcallback",
    );
  });

  it("extracts the session token from a callback URL", () => {
    expect(
      extractSessionTokenFromCallback("z8mobile://auth/callback?token=abc123"),
    ).toBe("abc123");
  });

  it("extracts callback errors so sign-in can surface them", () => {
    expect(
      extractAppCallbackResult(
        "z8mobile://auth/callback?error=access_denied",
      ),
    ).toEqual({
      error: "access_denied",
      token: null,
    });
  });

  it("returns null when the callback URL has no token", () => {
    expect(
      extractSessionTokenFromCallback(
        "z8mobile://auth/callback?error=access_denied",
      ),
    ).toBeNull();
  });

  it("exports the mobile app type header", () => {
    expect(MOBILE_APP_TYPE_HEADER).toEqual({
      "X-Z8-App-Type": "mobile",
    });
  });
});
