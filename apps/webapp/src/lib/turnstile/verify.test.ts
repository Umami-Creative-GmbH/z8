import { afterEach, describe, expect, it, vi } from "vitest";
import { verifyTurnstileWithServer } from "./verify";

const fallback = { success: false, error: "Verification failed." };
const token = "sensitive-turnstile-token";

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("verifyTurnstileWithServer", () => {
	it("preserves a structured server error from a non-2xx response", async () => {
		stubResponse({ success: false, error: "Challenge expired." }, 422);

		await expect(verifyTurnstileWithServer(token)).resolves.toEqual({
			success: false,
			error: "Challenge expired.",
		});
	});

	it("uses the safe fallback for a non-JSON non-2xx response", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(new Response("Bad gateway", { status: 502 })),
		);

		await expect(verifyTurnstileWithServer(token)).resolves.toEqual(fallback);
	});

	it("preserves a structured failure from a 2xx response", async () => {
		stubResponse({ success: false, error: "Invalid challenge." });

		await expect(verifyTurnstileWithServer(token)).resolves.toEqual({
			success: false,
			error: "Invalid challenge.",
		});
	});

	it("accepts a valid successful response and keeps the request contract", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValue(jsonResponse({ success: true }));
		vi.stubGlobal("fetch", fetchMock);

		await expect(verifyTurnstileWithServer(token)).resolves.toEqual({
			success: true,
		});
		expect(fetchMock).toHaveBeenCalledWith("/api/auth/verify-turnstile", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ token }),
		});
	});

	it.each([
		["malformed JSON", new Response("not JSON", { status: 200 })],
		["null", jsonResponse(null)],
		["a missing success field", jsonResponse({ error: "Invalid." })],
		["a string success field", jsonResponse({ success: "true" })],
		["a numeric success field", jsonResponse({ success: 1 })],
		["a non-string error field", jsonResponse({ success: false, error: 123 })],
	])("uses the safe fallback for %s in a 2xx response", async (_label, response) => {
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));

		await expect(verifyTurnstileWithServer(token)).resolves.toEqual(fallback);
	});

	it("rejects status-inconsistent success from a non-2xx response", async () => {
		stubResponse({ success: true }, 500);

		await expect(verifyTurnstileWithServer(token)).resolves.toEqual(fallback);
	});

	it.each([
		["fetch", () => Promise.reject(new Error(token))],
		[
			"response text",
			() =>
				Promise.resolve({
					ok: true,
					text: () => Promise.reject(new Error(token)),
				}),
		],
	])("uses the safe fallback when %s rejects", async (_label, fetchImplementation) => {
		vi.stubGlobal("fetch", vi.fn(fetchImplementation));

		const result = await verifyTurnstileWithServer(token);

		expect(result).toEqual(fallback);
		expect(JSON.stringify(result)).not.toContain(token);
	});

	it("does not return a structured server error that echoes the token", async () => {
		stubResponse({ success: false, error: `Invalid token: ${token}` }, 400);

		const result = await verifyTurnstileWithServer(token);

		expect(result).toEqual(fallback);
		expect(JSON.stringify(result)).not.toContain(token);
	});
});

function stubResponse(body: unknown, status = 200): void {
	vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(body, status)));
}

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}
