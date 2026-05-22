import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
	domainConfig: vi.fn(),
	db: {
		query: {
			organization: {
				findFirst: vi.fn(),
			},
		},
	},
	env: {
		PLATFORM_DOMAIN: "ui.z8-time.app",
	},
}));

vi.mock("@/env", () => ({ env: mockState.env }));
vi.mock("@/db", () => ({ db: mockState.db }));
vi.mock("@/lib/domain/domain-service", () => ({
	getDomainConfigByOrganization: mockState.domainConfig,
}));
vi.mock("@/lib/logger", () => ({
	createLogger: () => ({ warn: vi.fn() }),
}));

const { getOrganizationBaseUrl } = await import("./app-url");

describe("getOrganizationBaseUrl", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockState.env.PLATFORM_DOMAIN = "ui.z8-time.app";
		delete process.env.BETTER_AUTH_URL;
		delete process.env.NEXT_PUBLIC_APP_URL;
	});

	it("returns verified custom domain before platform subdomain", async () => {
		mockState.domainConfig.mockResolvedValueOnce({
			domain: "login.acme.test",
			domainVerified: true,
		});

		await expect(getOrganizationBaseUrl("org_123")).resolves.toBe("https://login.acme.test");
		expect(mockState.db.query.organization.findFirst).not.toHaveBeenCalled();
	});

	it("returns canonical slug platform subdomain when no verified custom domain exists", async () => {
		mockState.domainConfig.mockResolvedValueOnce(null);
		mockState.db.query.organization.findFirst.mockResolvedValueOnce({ slug: "acme" });

		await expect(getOrganizationBaseUrl("org_123")).resolves.toBe("https://acme.ui.z8-time.app");
	});

	it("returns the default app URL when organization lookup fails", async () => {
		process.env.NEXT_PUBLIC_APP_URL = "https://ui.z8-time.app";
		mockState.domainConfig.mockResolvedValueOnce(null);
		mockState.db.query.organization.findFirst.mockResolvedValueOnce(null);

		await expect(getOrganizationBaseUrl("org_123")).resolves.toBe("https://ui.z8-time.app");
	});
});
