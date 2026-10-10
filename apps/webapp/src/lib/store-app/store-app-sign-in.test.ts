import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { challengeForVerifier, createPkceVerifier } from "./pkce";
import { type AuthSessionOutcome, signInFromStoreApp } from "./store-app-sign-in";

const AUTHORIZE_URL =
	"https://time.acme.example/api/auth/app-login?app=mobile&redirect=z8mobile%3A%2F%2Fauth%2Fcallback&challenge=x";

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

function harness({
	outcome = { status: "completed", callbackUrl: "z8mobile://auth/callback?code=ONE-TIME-CODE" },
	startResponse = json({ authorizeUrl: AUTHORIZE_URL }),
	exchangeResponse = json({ ok: true }),
}: {
	outcome?: AuthSessionOutcome;
	startResponse?: Response;
	exchangeResponse?: Response;
} = {}) {
	const fetch = vi.fn(async (input: RequestInfo | URL) =>
		String(input) === "/api/auth/app-sign-in" ? startResponse : exchangeResponse,
	);
	const openAuthSession = vi.fn(async () => outcome);
	return {
		fetch,
		openAuthSession,
		run: () =>
			signInFromStoreApp("ada@acme.example", {
				fetch: fetch as unknown as typeof globalThis.fetch,
				openAuthSession,
			}),
		body: (index: number) => JSON.parse(String(fetch.mock.calls[index]?.[1]?.body)),
	};
}

describe("PKCE for the store app", () => {
	it("derives the S256 challenge of RFC 7636 appendix B", async () => {
		await expect(challengeForVerifier("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).resolves.toBe(
			"E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
		);
	});

	it("creates a fresh 43-character verifier each time", () => {
		const first = createPkceVerifier();
		expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
		expect(createPkceVerifier()).not.toBe(first);
	});
});

describe("store app sign-in", () => {
	it("signs in through the system browser and exchanges the code with its verifier", async () => {
		const test = harness();

		await expect(test.run()).resolves.toEqual({ status: "signed-in" });

		const start = test.body(0);
		expect(start.email).toBe("ada@acme.example");
		expect(test.openAuthSession).toHaveBeenCalledWith(AUTHORIZE_URL, "z8mobile");
		const [exchangeUrl, exchangeInit] = test.fetch.mock.calls[1] ?? [];
		expect(exchangeUrl).toBe("/api/auth/app-exchange");
		expect(exchangeInit?.method).toBe("POST");
		expect(new Headers(exchangeInit?.headers).get("x-z8-app-type")).toBe("mobile");
		const exchange = test.body(1);
		expect(exchange.code).toBe("ONE-TIME-CODE");
		// The server only ever saw the challenge; the verifier stays until the exchange.
		expect(createHash("sha256").update(exchange.verifier).digest("base64url")).toBe(
			start.challenge,
		);
		expect(JSON.stringify(start)).not.toContain(exchange.verifier);
	});

	it("reports a cancelled browser sign-in without exchanging anything", async () => {
		const test = harness({ outcome: { status: "cancelled" } });

		await expect(test.run()).resolves.toEqual({ status: "cancelled" });
		expect(test.fetch).toHaveBeenCalledTimes(1);
	});

	it.each([
		["another app's scheme", "z8://auth/callback?code=ONE-TIME-CODE"],
		["another path", "z8mobile://evil/callback?code=ONE-TIME-CODE"],
		["no code", "z8mobile://auth/callback"],
	])("refuses a callback with %s", async (_case, callbackUrl) => {
		const test = harness({ outcome: { status: "completed", callbackUrl } });

		await expect(test.run()).resolves.toEqual({ status: "failed", reason: "callback" });
		expect(test.fetch).toHaveBeenCalledTimes(1);
	});

	it("reports a refused exchange, such as a replayed or expired code", async () => {
		const test = harness({
			exchangeResponse: json({ error: "Invalid or expired code" }, 401),
		});

		await expect(test.run()).resolves.toEqual({ status: "failed", reason: "exchange" });
	});

	it("reports a rate-limited start without opening the browser", async () => {
		const test = harness({ startResponse: json({ error: "Too many requests" }, 429) });

		await expect(test.run()).resolves.toEqual({ status: "failed", reason: "rate-limited" });
		expect(test.openAuthSession).not.toHaveBeenCalled();
	});

	it("reports a browser that could not open", async () => {
		const test = harness({ outcome: { status: "failed" } });

		await expect(test.run()).resolves.toEqual({ status: "failed", reason: "browser" });
	});

	it("reports an unreachable server", async () => {
		const test = harness();
		test.fetch.mockRejectedValueOnce(new TypeError("Failed to fetch"));

		await expect(test.run()).resolves.toEqual({ status: "failed", reason: "unavailable" });
	});
});
