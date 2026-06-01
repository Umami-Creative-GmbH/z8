import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
	env: {
		APP_URL: "https://ui.z8-time.app",
		PLATFORM_DOMAIN: "ui.z8-time.app",
	},
}));

vi.mock("@/env", () => ({ env: mockState.env }));

const {
	getAuthAllowedHosts,
	getOrganizationPlatformOrigins,
	getStaticTrustedOrigins,
} = await import("./auth-domain-config");

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

	it("builds exact trusted origins for an organization's generated platform URLs", () => {
		expect(getOrganizationPlatformOrigins({ id: "Org_ID-123", slug: "acme" })).toEqual([
			"https://acme.ui.z8-time.app",
			"https://orgid-4f72675f49442d313233.ui.z8-time.app",
		]);
	});
});
