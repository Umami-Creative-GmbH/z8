import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
	env: {
		APP_URL: "https://ui.z8-time.app",
		PLATFORM_DOMAIN: "ui.z8-time.app",
		BETTER_AUTH_URL: undefined as string | undefined,
		NEXT_PUBLIC_APP_URL: undefined as string | undefined,
	},
}));

vi.mock("@/env", () => ({ env: mockState.env }));

const { getAuthAllowedHosts, getOrganizationPlatformOrigins, getStaticTrustedOrigins } =
	await import("./auth-domain-config");

describe("auth domain config", () => {
	beforeEach(() => {
		mockState.env.APP_URL = "https://ui.z8-time.app";
		mockState.env.PLATFORM_DOMAIN = "ui.z8-time.app";
		mockState.env.BETTER_AUTH_URL = undefined;
		mockState.env.NEXT_PUBLIC_APP_URL = undefined;
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

	it("allows all explicit operator origins with their configured ports and no extra wildcards", () => {
		mockState.env.APP_URL = "https://APP.example.net:8443/sign-in?from=setup";
		mockState.env.BETTER_AUTH_URL = "https://auth.example.net:9443/api/auth";
		mockState.env.NEXT_PUBLIC_APP_URL = "http://public.example.net:8080/";
		const hosts = getAuthAllowedHosts();
		const origins = getStaticTrustedOrigins();
		expect(hosts).toEqual(expect.arrayContaining([
			"app.example.net:8443", "auth.example.net:9443", "public.example.net:8080",
		]));
		expect(origins).toEqual(expect.arrayContaining([
			"https://app.example.net:8443", "https://auth.example.net:9443", "http://public.example.net:8080",
		]));
		expect(hosts.filter((host) => host.includes("*"))).toEqual(["*.ui.z8-time.app"]);
		expect(origins.filter((origin) => origin.includes("*"))).toEqual(["https://*.ui.z8-time.app"]);
		expect(hosts).not.toContain("app.example.net");
		expect(origins).not.toContain("https://app.example.net");
	});

	it.each(["ftp://bad.example.net", "https://user:password@bad.example.net", "https://*.bad.example.net", "not-a-url"])(
		"does not add unsafe configured URL %s to allowed hosts or trusted origins",
		(url) => {
			mockState.env.APP_URL = url;
			mockState.env.BETTER_AUTH_URL = url;
			mockState.env.NEXT_PUBLIC_APP_URL = url;
			expect(getAuthAllowedHosts().some((host) => host.includes("bad.example.net") || host === url)).toBe(false);
			expect(getStaticTrustedOrigins().some((origin) => origin.includes("bad.example.net") || origin === url)).toBe(false);
		},
	);
});
