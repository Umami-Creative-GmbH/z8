import { QueryClient } from "@tanstack/react-query";

import { MOBILE_SESSION_QUERY_KEY, createMobileSessionController } from "./use-mobile-session";

const { exchangeAppCallbackCode, setStoredSessionToken, extractAppCallbackResult } = vi.hoisted(() => ({
	exchangeAppCallbackCode: vi.fn(),
	setStoredSessionToken: vi.fn(),
	extractAppCallbackResult: vi.fn(),
}));

vi.mock("@/src/lib/auth/session-store", () => ({
  getStoredSessionToken: vi.fn().mockResolvedValue(null),
  setStoredSessionToken,
  clearStoredSessionToken: vi.fn(),
}));

vi.mock("@/src/lib/auth/app-auth", async () => {
  const actual = await vi.importActual("@/src/lib/auth/app-auth");

	return {
		...actual,
		exchangeAppCallbackCode,
		extractAppCallbackResult,
	};
});

describe("useMobileSessionController", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

	it("stores the callback token and invalidates the mobile session query", async () => {
		extractAppCallbackResult.mockReturnValue({
			code: null,
			error: null,
			token: "token-from-callback",
		});

    const queryClient = new QueryClient();
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");

    const controller = createMobileSessionController(queryClient);

    await expect(
      controller.handleCallbackUrl(
        "z8mobile://auth/callback?token=token-from-callback",
      ),
    ).resolves.toEqual({
      error: null,
      status: "signed-in",
    });

		expect(extractAppCallbackResult).toHaveBeenCalledWith(
			"z8mobile://auth/callback?token=token-from-callback",
		);
		expect(exchangeAppCallbackCode).not.toHaveBeenCalled();
		expect(setStoredSessionToken).toHaveBeenCalledWith("token-from-callback");

    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: MOBILE_SESSION_QUERY_KEY,
    });
  });

	it("exchanges the callback code before storing the session token", async () => {
		extractAppCallbackResult.mockReturnValue({
			code: "ONE-TIME-CODE",
			error: null,
			token: null,
		});
		exchangeAppCallbackCode.mockResolvedValue("session-token");

		const queryClient = new QueryClient();
		const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
		const controller = createMobileSessionController(queryClient);

		await expect(
			controller.handleCallbackUrl("z8mobile://auth/callback?code=ONE-TIME-CODE"),
		).resolves.toEqual({
			error: null,
			status: "signed-in",
		});

		expect(exchangeAppCallbackCode).toHaveBeenCalledWith("ONE-TIME-CODE", "mobile");
		expect(setStoredSessionToken).toHaveBeenCalledWith("session-token");
		expect(invalidateQueries).toHaveBeenCalledWith({
			queryKey: MOBILE_SESSION_QUERY_KEY,
		});
	});

	it("returns a recoverable auth error when code exchange fails", async () => {
		extractAppCallbackResult.mockReturnValue({
			code: "ONE-TIME-CODE",
			error: null,
			token: null,
		});
		exchangeAppCallbackCode.mockRejectedValue(new Error("exchange failed"));

		const queryClient = new QueryClient();
		const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
		const controller = createMobileSessionController(queryClient);

		await expect(
			controller.handleCallbackUrl("z8mobile://auth/callback?code=ONE-TIME-CODE"),
		).resolves.toEqual({
			error: "code_exchange_failed",
			status: "error",
		});

		expect(exchangeAppCallbackCode).toHaveBeenCalledWith("ONE-TIME-CODE", "mobile");
		expect(setStoredSessionToken).not.toHaveBeenCalled();
		expect(invalidateQueries).not.toHaveBeenCalled();
	});

	it("returns a sign-in error state when the callback includes an auth error", async () => {
		extractAppCallbackResult.mockReturnValue({
			code: null,
			error: "access_denied",
			token: null,
		});

    const queryClient = new QueryClient();
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
    const controller = createMobileSessionController(queryClient);

    await expect(
      controller.handleCallbackUrl("z8mobile://auth/callback?error=access_denied"),
    ).resolves.toEqual({
      error: "access_denied",
      status: "error",
    });

		expect(setStoredSessionToken).not.toHaveBeenCalled();
		expect(exchangeAppCallbackCode).not.toHaveBeenCalled();
		expect(invalidateQueries).not.toHaveBeenCalled();
	});
});
