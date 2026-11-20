import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerCustomDomain } from "./domain-service";

const { env, findFirst, values } = vi.hoisted(() => ({
	env: { PLATFORM_DOMAIN: "Tenants.Example.Net.:443", MAIN_DOMAIN: "ui.example.org" },
	findFirst: vi.fn(),
	values: vi.fn(),
}));

vi.mock("@/lib/social-oauth", () => ({ getConfiguredProviders: vi.fn() }));
vi.mock("@/env", () => ({ env }));
vi.mock("@/db", () => ({
	db: {
		query: { organizationDomain: { findFirst } },
		insert: () => ({ values }),
	},
}));

describe("custom domain registration", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		findFirst.mockResolvedValue(undefined);
		values.mockReturnValue({ returning: async () => [{ id: "domain-id" }] });
	});

	it.each([
		"TENANTS.example.net.:443",
		"one.two.tenants.example.net",
		"ui.example.org",
		"login.ui.example.org.",
	])(
		"reserves the configured platform and main domains and their descendants (%s)",
		async (host) => {
			await expect(registerCustomDomain("org", host)).rejects.toThrow("reserved");
			expect(findFirst).not.toHaveBeenCalled();
			expect(values).not.toHaveBeenCalled();
		},
	);

	it("allows a customer hostname that shares only part of a DNS label", async () => {
		await registerCustomDomain("org", "MyTenants.example.net.:443");
		expect(values).toHaveBeenCalledWith(
			expect.objectContaining({
				organizationId: "org",
				domain: "mytenants.example.net",
				domainVerified: false,
			}),
		);
	});
});
