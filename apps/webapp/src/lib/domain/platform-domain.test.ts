import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
	env: {
		MAIN_DOMAIN: "ui.z8-time.app",
		PLATFORM_DOMAIN: "ui.z8-time.app",
	},
}));

vi.mock("@/env", () => ({ env: mockState.env }));

const { classifyDomainHost, getPlatformOrganizationLabel, normalizeDomainHost } = await import(
	"./platform-domain"
);

describe("platform domain host helpers", () => {
	beforeEach(() => {
		mockState.env.MAIN_DOMAIN = "ui.z8-time.app";
		mockState.env.PLATFORM_DOMAIN = "ui.z8-time.app";
	});

	it("normalizes hosts by lowercasing and removing ports", () => {
		expect(normalizeDomainHost("Acme.UI.Z8-Time.App:443")).toBe("acme.ui.z8-time.app");
		expect(normalizeDomainHost("https://Acme.UI.Z8-Time.App/login")).toBe("acme.ui.z8-time.app");
		expect(normalizeDomainHost("  ")).toBeNull();
	});

	it("classifies the main domain and localhost as main", () => {
		expect(classifyDomainHost("ui.z8-time.app")).toEqual({ type: "main", hostname: "ui.z8-time.app" });
		expect(classifyDomainHost("localhost:3000")).toEqual({ type: "main", hostname: "localhost" });
		expect(classifyDomainHost("tenant.localhost:3000")).toEqual({ type: "main", hostname: "tenant.localhost" });
	});

	it("classifies one-label platform organization subdomains", () => {
		expect(classifyDomainHost("acme.ui.z8-time.app")).toEqual({
			type: "platformOrganization",
			hostname: "acme.ui.z8-time.app",
			label: "acme",
			rootDomain: "ui.z8-time.app",
		});
		expect(getPlatformOrganizationLabel("org_123.ui.z8-time.app")).toBe("org_123");
	});

	it("does not classify multi-level platform hosts as organization subdomains", () => {
		expect(classifyDomainHost("deep.acme.ui.z8-time.app")).toEqual({
			type: "unknownPlatform",
			hostname: "deep.acme.ui.z8-time.app",
			rootDomain: "ui.z8-time.app",
		});
	});

	it("classifies unrelated hosts as custom domain candidates", () => {
		expect(classifyDomainHost("login.acme.test")).toEqual({
			type: "customDomain",
			hostname: "login.acme.test",
		});
	});
});
