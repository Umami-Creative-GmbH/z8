import { QueryClient } from "@tanstack/react-query";

import {
  MOBILE_SESSION_QUERY_KEY,
  createMobileSessionController,
} from "./use-mobile-session";

const { setStoredSessionToken, extractAppCallbackResult } = vi.hoisted(() => ({
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
    extractAppCallbackResult,
  };
});

describe("useMobileSessionController", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("stores the callback token and invalidates the mobile session query", async () => {
    extractAppCallbackResult.mockReturnValue({
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
    expect(setStoredSessionToken).toHaveBeenCalledWith("token-from-callback");

    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: MOBILE_SESSION_QUERY_KEY,
    });
  });

  it("returns a sign-in error state when the callback includes an auth error", async () => {
    extractAppCallbackResult.mockReturnValue({
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
    expect(invalidateQueries).not.toHaveBeenCalled();
  });
});
