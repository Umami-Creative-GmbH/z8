import { beforeEach, describe, expect, it, vi } from "vitest";

const mockEnv = vi.hoisted(() => ({
	env: {
		MAIN_DOMAIN: "app.z8.test",
	},
}));

vi.mock("@/env", () => mockEnv);

const { getCustomDomainFromHeaders } = await import("./request-domain");

describe("getCustomDomainFromHeaders", () => {
	beforeEach(() => {
		mockEnv.env.MAIN_DOMAIN = "app.z8.test";
	});

	it("returns null for the configured main domain", () => {
		expect(getCustomDomainFromHeaders(new Headers({ host: "app.z8.test" }))).toBeNull();
	});

	it("returns null for localhost and localhost subdomains", () => {
		expect(getCustomDomainFromHeaders(new Headers({ host: "localhost:3000" }))).toBeNull();
		expect(getCustomDomainFromHeaders(new Headers({ host: "tenant.localhost:3000" }))).toBeNull();
	});

	it("returns normalized custom domains from the trusted host header", () => {
		expect(getCustomDomainFromHeaders(new Headers({ host: "Login.Acme.Test:443" }))).toBe(
			"login.acme.test",
		);
	});

	it("ignores client-supplied x-z8-domain headers", () => {
		expect(
			getCustomDomainFromHeaders(
				new Headers({ host: "app.z8.test", "x-z8-domain": "login.acme.test" }),
			),
		).toBeNull();
	});

	it("defaults the main domain to localhost:3000", () => {
		mockEnv.env.MAIN_DOMAIN = undefined;

		expect(getCustomDomainFromHeaders(new Headers({ host: "localhost:3000" }))).toBeNull();
	});
});
