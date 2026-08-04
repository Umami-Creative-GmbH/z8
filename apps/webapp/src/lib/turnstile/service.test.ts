import { afterEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.hoisted(() => vi.fn());

vi.mock("@/env", () => ({
	env: {
		TURNSTILE_SECRET_KEY: "turnstile-secret",
		TURNSTILE_TIMEOUT_MS: "1234",
	},
}));

vi.mock("@/lib/vault", () => ({ getOrgSecret: vi.fn() }));

describe("verifyTurnstileToken", () => {
	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it("aborts verification after the configured timeout", async () => {
		vi.useFakeTimers();
		fetchMock.mockImplementation((_url: string, init: RequestInit) => {
			return new Promise((_resolve, reject) => {
				init.signal?.addEventListener(
					"abort",
					() => reject(new DOMException("Aborted", "AbortError")),
					{ once: true },
				);
			});
		});
		vi.stubGlobal("fetch", fetchMock);
		const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
		const { verifyTurnstileToken } = await import("./service");

		const resultPromise = verifyTurnstileToken("token");
		expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 1234);

		await vi.advanceTimersByTimeAsync(1234);

		await expect(resultPromise).resolves.toEqual({
			success: false,
			error: "Turnstile verification timed out",
		});
		expect(vi.getTimerCount()).toBe(0);
	});
});
