import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
	checkRateLimit: vi.fn(),
	getDomainConfig: vi.fn(),
	verifyTurnstileToken: vi.fn(),
	env: {
		MAIN_DOMAIN: "app.z8.test",
	},
}));

vi.mock("@/env", () => ({ env: mockState.env }));

vi.mock("@/lib/domain", () => ({
	getDomainConfig: mockState.getDomainConfig,
}));

vi.mock("@/lib/rate-limit", () => ({
	checkRateLimit: mockState.checkRateLimit,
	createRateLimitResponse: vi.fn(),
	getClientIp: vi.fn(() => "127.0.0.1"),
}));

vi.mock("@/lib/turnstile", () => ({
	verifyTurnstileToken: mockState.verifyTurnstileToken,
}));

const { POST } = await import("./route");

describe("POST /api/auth/verify-turnstile", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockState.env.MAIN_DOMAIN = "app.z8.test";
		mockState.checkRateLimit.mockResolvedValue({ allowed: true });
		mockState.verifyTurnstileToken.mockResolvedValue({ success: true });
	});

	it("derives enterprise Turnstile context from the trusted Host header", async () => {
		mockState.getDomainConfig.mockResolvedValue({ organizationId: "org_123" });

		const response = await POST(
			new Request("https://login.acme.test/api/auth/verify-turnstile", {
				method: "POST",
				headers: { host: "login.acme.test" },
				body: JSON.stringify({ token: "token_123" }),
			}),
		);

		expect(response.status).toBe(200);
		expect(mockState.getDomainConfig).toHaveBeenCalledWith("login.acme.test");
		expect(mockState.verifyTurnstileToken).toHaveBeenCalledWith("token_123", "org_123", true);
	});

	it("ignores spoofed x-z8-domain headers on the main domain", async () => {
		await POST(
			new Request("https://app.z8.test/api/auth/verify-turnstile", {
				method: "POST",
				headers: { host: "app.z8.test", "x-z8-domain": "login.acme.test" },
				body: JSON.stringify({ token: "token_123" }),
			}),
		);

		expect(mockState.getDomainConfig).not.toHaveBeenCalled();
		expect(mockState.verifyTurnstileToken).toHaveBeenCalledWith("token_123", undefined, false);
	});
});
