import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
	checkRateLimit: vi.fn(),
	getDomainConfig: vi.fn(),
	getPlatformOrganizationLabel: vi.fn(),
	resolvePlatformOrganization: vi.fn(),
	verifyTurnstileToken: vi.fn(),
	env: {
		MAIN_DOMAIN: "app.z8.test",
		PLATFORM_DOMAIN: "ui.z8-time.app",
	},
}));

vi.mock("@/env", () => ({ env: mockState.env }));

vi.mock("@/lib/domain", () => ({
	getDomainConfig: mockState.getDomainConfig,
	getPlatformOrganizationLabel: mockState.getPlatformOrganizationLabel,
	resolvePlatformOrganization: mockState.resolvePlatformOrganization,
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
		mockState.env.PLATFORM_DOMAIN = "ui.z8-time.app";
		mockState.checkRateLimit.mockResolvedValue({ allowed: true });
		mockState.getPlatformOrganizationLabel.mockReturnValue(null);
		mockState.resolvePlatformOrganization.mockResolvedValue(null);
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

	it("derives platform organization Turnstile context from platform subdomains", async () => {
		mockState.getPlatformOrganizationLabel.mockReturnValue("acme");
		mockState.resolvePlatformOrganization.mockResolvedValue({ id: "org_123" });

		const response = await POST(
			new Request("https://acme.ui.z8-time.app/api/auth/verify-turnstile", {
				method: "POST",
				headers: { host: "acme.ui.z8-time.app" },
				body: JSON.stringify({ token: "token_123" }),
			}),
		);

		expect(response.status).toBe(200);
		expect(mockState.getPlatformOrganizationLabel).toHaveBeenCalledWith("acme.ui.z8-time.app");
		expect(mockState.resolvePlatformOrganization).toHaveBeenCalledWith("acme");
		expect(mockState.getDomainConfig).not.toHaveBeenCalled();
		expect(mockState.verifyTurnstileToken).toHaveBeenCalledWith("token_123", "org_123", false);
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
