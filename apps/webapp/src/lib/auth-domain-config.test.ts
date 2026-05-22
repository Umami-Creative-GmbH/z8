import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
	env: {
		APP_URL: "https://ui.z8-time.app",
		PLATFORM_DOMAIN: "ui.z8-time.app",
	},
}));

vi.mock("@/env", () => ({ env: mockState.env }));

const { getAuthAllowedHosts, getStaticTrustedOrigins } = await import("./auth-domain-config");

describe("auth domain config", () => {
	beforeEach(() => {
		mockState.env.APP_URL = "https://ui.z8-time.app";
		mockState.env.PLATFORM_DOMAIN = "ui.z8-time.app";
	});

	it("allows the platform wildcard host for Better Auth baseURL resolution", () => {
		expect(getAuthAllowedHosts()).toContain("*.ui.z8-time.app");
		expect(getAuthAllowedHosts()).toContain("ui.z8-time.app");
		expect(getAuthAllowedHosts()).toContain("localhost:3000");
	});

	it("trusts the platform wildcard origin for CSRF and redirects", () => {
		expect(getStaticTrustedOrigins()).toContain("https://*.ui.z8-time.app");
		expect(getStaticTrustedOrigins()).toContain("https://ui.z8-time.app");
	});
});
