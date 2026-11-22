import { afterEach, describe, expect, it, vi } from "vitest";
import { verifyBotApplication } from "./api";

vi.mock("@/lib/logger", () => ({
	createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

describe("verifyBotApplication", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("returns ok with application metadata on 200", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(
				new Response(
					JSON.stringify({
						id: "123456789012345678",
						name: "Z8 Bot",
						verify_key: "a".repeat(64),
					}),
					{ status: 200, headers: { "Content-Type": "application/json" } },
				),
			),
		);

		const result = await verifyBotApplication("token-123");

		expect(result).toEqual({
			kind: "ok",
			application: {
				id: "123456789012345678",
				name: "Z8 Bot",
				verifyKey: "a".repeat(64),
			},
		});
	});

	it.each([401, 403])("returns unauthorized on HTTP %i", async (status) => {
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("Unauthorized", { status })));

		const result = await verifyBotApplication("bad-token");

		expect(result).toEqual({ kind: "unauthorized", status });
	});

	it.each([429, 500, 502, 503])("returns error on HTTP %i", async (status) => {
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("Upstream error", { status })));

		const result = await verifyBotApplication("token-123");

		expect(result).toEqual({ kind: "error", status });
	});
});
