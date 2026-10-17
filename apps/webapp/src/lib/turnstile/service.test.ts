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
		vi.unstubAllEnvs();
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it.each([
		[
			"development",
			"z8.localhost",
			"1x0000000000000000000000000000000AA",
			true,
		],
		["production", "z8.localhost", "turnstile-secret", false],
		["development", "login.example.org", "turnstile-secret", false],
	] as const)(
		"verifies %s requests on %s with the matching secret and hostname policy",
		async (mode, hostname, secret, success) => {
			vi.stubEnv("NODE_ENV", mode);
			fetchMock.mockResolvedValue({
				ok: true,
				json: async () => ({ success: true, hostname: "dummy-key-pass" }),
			});
			vi.stubGlobal("fetch", fetchMock);
			const { verifyTurnstileToken } = await import("./service");
			await expect(
				verifyTurnstileToken(
					"XXXX.DUMMY.TOKEN.XXXX",
					undefined,
					false,
					hostname,
				),
			).resolves.toMatchObject({ success });
			expect(
				JSON.parse(fetchMock.mock.calls.at(-1)?.[1].body ?? "{}"),
			).toMatchObject({ secret });
		},
	);

	it("still rejects failed Cloudflare validation with development keys", async () => {
		vi.stubEnv("NODE_ENV", "development");
		fetchMock.mockResolvedValue({
			ok: true,
			json: async () => ({
				success: false,
				"error-codes": ["invalid-input-response"],
			}),
		});
		vi.stubGlobal("fetch", fetchMock);
		const { verifyTurnstileToken } = await import("./service");
		await expect(
			verifyTurnstileToken("invalid", undefined, false, "z8.localhost"),
		).resolves.toMatchObject({ success: false });
	});

	it("keeps enterprise secrets and hostname binding even on a local development host", async () => {
		vi.stubEnv("NODE_ENV", "development");
		const { getOrgSecret } = await import("@/lib/vault");
		vi.mocked(getOrgSecret).mockResolvedValue("enterprise-secret");
		fetchMock.mockResolvedValue({
			ok: true,
			json: async () => ({ success: true, hostname: "example.com" }),
		});
		vi.stubGlobal("fetch", fetchMock);
		const { verifyTurnstileToken } = await import("./service");
		await expect(
			verifyTurnstileToken("token", "org-1", true, "z8.localhost"),
		).resolves.toEqual({
			success: false,
			error: "Turnstile hostname mismatch",
		});
		expect(getOrgSecret).toHaveBeenCalledWith("org-1", "turnstile/secret_key");
		expect(
			JSON.parse(fetchMock.mock.calls.at(-1)?.[1].body ?? "{}"),
		).toMatchObject({ secret: "enterprise-secret" });
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
