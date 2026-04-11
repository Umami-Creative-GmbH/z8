const { getWebappUrl } = vi.hoisted(() => ({
  getWebappUrl: vi.fn(() => "https://ui.z8-time.app"),
}));

vi.mock("@/src/lib/config", () => ({
  getWebappUrl,
}));

import {
  buildAppLoginUrl,
  exchangeAppCallbackCode,
  extractAppCallbackResult,
  extractSessionTokenFromCallback,
  MOBILE_APP_TYPE_HEADER,
} from "./app-auth";

describe("app auth utilities", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

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

  it("exchanges a callback code for a session token", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ token: "session-token" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      exchangeAppCallbackCode("one-time-code", "mobile"),
    ).resolves.toBe("session-token");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://ui.z8-time.app/api/auth/app-exchange",
      expect.objectContaining({
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Z8-App-Type": "mobile",
        },
        body: JSON.stringify({ code: "one-time-code" }),
      }),
    );
  });

  it("extracts a callback code so the app can exchange it for a session token", () => {
    expect(
      extractAppCallbackResult("z8mobile://auth/callback?code=one-time-code"),
    ).toEqual({
      code: "one-time-code",
      error: null,
      token: null,
    });
  });

  it("extracts callback errors so sign-in can surface them", () => {
    expect(
      extractAppCallbackResult(
        "z8mobile://auth/callback?error=access_denied",
      ),
    ).toEqual({
      code: null,
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
