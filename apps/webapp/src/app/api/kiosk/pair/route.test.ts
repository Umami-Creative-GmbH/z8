import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	checkRateLimit: vi.fn(),
	pairKiosk: vi.fn(),
}));

vi.mock("@/db", () => ({
	db: { transaction: (run: (tx: unknown) => unknown) => run({}) },
}));

vi.mock("@/lib/rate-limit", () => ({
	checkRateLimit: mocks.checkRateLimit,
	getClientIp: () => "203.0.113.7",
	createRateLimitResponse: (result: { retryAfter: number }) =>
		Response.json(
			{ error: "Too Many Requests" },
			{ status: 429, headers: { "Retry-After": String(result.retryAfter) } },
		),
}));

vi.mock("@/lib/time-tracking/kiosk/kiosk-store", () => ({
	pairKiosk: mocks.pairKiosk,
	readKioskDeviceInfo: vi.fn(),
}));

const { POST } = await import("./route");

function pair(code: unknown) {
	return POST(
		new Request("http://localhost/api/kiosk/pair", {
			method: "POST",
			body: JSON.stringify({ code }),
		}),
	);
}

describe("POST /api/kiosk/pair", () => {
	beforeEach(() => {
		mocks.checkRateLimit.mockReset();
		mocks.pairKiosk.mockReset();
	});

	it("limits code attempts per client IP without trying the code", async () => {
		mocks.checkRateLimit.mockResolvedValue({
			allowed: false,
			remaining: 0,
			resetAt: 0,
			retryAfter: 120,
		});

		const response = await pair("ABCDE-FGHJK");

		expect(response.status).toBe(429);
		expect(mocks.checkRateLimit).toHaveBeenCalledWith("203.0.113.7", "kioskPairing");
		expect(mocks.pairKiosk).not.toHaveBeenCalled();
	});

	it("counts malformed attempts against the limit too", async () => {
		mocks.checkRateLimit.mockResolvedValue({
			allowed: true,
			remaining: 9,
			resetAt: 0,
			retryAfter: 0,
		});

		const response = await pair("nope");

		expect(response.status).toBe(400);
		expect(mocks.checkRateLimit).toHaveBeenCalledTimes(1);
		expect(mocks.pairKiosk).not.toHaveBeenCalled();
	});
});
