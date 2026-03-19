import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
	requireUser: vi.fn(),
	canManageCurrentOrganizationSettings: vi.fn(),
	revalidatePath: vi.fn(),
	updateSocialOAuthConfig: vi.fn(),
	deleteSocialOAuthConfig: vi.fn(),
	updateTestStatus: vi.fn(),
}));

vi.mock("next/cache", () => ({
	revalidatePath: mockState.revalidatePath,
}));

vi.mock("next/headers", () => ({
	headers: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
	auth: {
		api: {},
	},
}));

vi.mock("@/lib/auth-helpers", () => ({
	requireUser: mockState.requireUser,
	canManageCurrentOrganizationSettings: mockState.canManageCurrentOrganizationSettings,
}));

vi.mock("@/lib/domain", () => ({
	deleteCustomDomain: vi.fn(),
	getOrganizationBranding: vi.fn(),
	listOrganizationDomains: vi.fn(),
	registerCustomDomain: vi.fn(),
	requestNewVerificationToken: vi.fn(),
	updateDomainAuthConfig: vi.fn(),
	updateOrganizationBranding: vi.fn(),
	verifyDomainOwnership: vi.fn(),
}));

vi.mock("@/lib/social-oauth", () => ({
	createSocialOAuthConfig: vi.fn(),
	deleteSocialOAuthConfig: mockState.deleteSocialOAuthConfig,
	getConfiguredProviders: vi.fn(),
	listOrgSocialOAuthConfigs: vi.fn(),
	updateSocialOAuthConfig: mockState.updateSocialOAuthConfig,
	updateTestStatus: mockState.updateTestStatus,
}));

vi.mock("@/lib/vault", () => ({
	deleteOrgSecret: vi.fn(),
	storeOrgSecret: vi.fn(),
}));

const {
	deleteSocialOAuthConfigAction,
	testSocialOAuthConfigAction,
	updateSocialOAuthConfigAction,
} = await import("./actions");

describe("enterprise social oauth actions org forwarding", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockState.requireUser.mockResolvedValue({
			session: {
				activeOrganizationId: "org-1",
			},
			employee: {
				role: "admin",
				organizationId: "org-1",
			},
		});
		mockState.canManageCurrentOrganizationSettings.mockResolvedValue(true);
	});

	it("allows owners without an admin employee row to update social oauth configs", async () => {
		mockState.requireUser.mockResolvedValue({
			session: {
				activeOrganizationId: "org-1",
			},
			employee: null,
		});
		mockState.updateSocialOAuthConfig.mockResolvedValue({
			id: "cfg-1",
			organizationId: "org-1",
			provider: "google",
			clientId: "client-id",
			providerConfig: null,
			isActive: true,
			lastTestAt: null,
			lastTestSuccess: null,
			lastTestError: null,
			createdAt: new Date("2026-01-01T00:00:00.000Z"),
			updatedAt: new Date("2026-01-01T00:00:00.000Z"),
		});

		await updateSocialOAuthConfigAction("cfg-1", {
			clientId: "client-id",
			isActive: true,
		});

		expect(mockState.updateSocialOAuthConfig).toHaveBeenCalledWith("cfg-1", "org-1", {
			clientId: "client-id",
			clientSecret: undefined,
			providerConfig: undefined,
			isActive: true,
		});
	});

	it("forwards organizationId to updateSocialOAuthConfig", async () => {
		mockState.updateSocialOAuthConfig.mockResolvedValue({
			id: "cfg-1",
			organizationId: "org-1",
			provider: "google",
			clientId: "client-id",
			providerConfig: null,
			isActive: true,
			lastTestAt: null,
			lastTestSuccess: null,
			lastTestError: null,
			createdAt: new Date("2026-01-01T00:00:00.000Z"),
			updatedAt: new Date("2026-01-01T00:00:00.000Z"),
		});

		await updateSocialOAuthConfigAction("cfg-1", {
			clientId: "client-id",
			isActive: true,
		});

		expect(mockState.updateSocialOAuthConfig).toHaveBeenCalledWith("cfg-1", "org-1", {
			clientId: "client-id",
			clientSecret: undefined,
			providerConfig: undefined,
			isActive: true,
		});
	});

	it("forwards organizationId to deleteSocialOAuthConfig", async () => {
		mockState.deleteSocialOAuthConfig.mockResolvedValue(undefined);

		await deleteSocialOAuthConfigAction("cfg-9");

		expect(mockState.deleteSocialOAuthConfig).toHaveBeenCalledWith("cfg-9", "org-1");
	});

	it("forwards organizationId to updateTestStatus on success", async () => {
		mockState.updateTestStatus.mockResolvedValue(undefined);

		const result = await testSocialOAuthConfigAction("cfg-4");

		expect(mockState.updateTestStatus).toHaveBeenCalledWith("cfg-4", "org-1", true);
		expect(result).toEqual({ success: true });
	});

	it("forwards organizationId to updateTestStatus on failure path", async () => {
		mockState.updateTestStatus
			.mockRejectedValueOnce(new Error("primary failure"))
			.mockResolvedValueOnce(undefined);

		const result = await testSocialOAuthConfigAction("cfg-5");

		expect(mockState.updateTestStatus).toHaveBeenNthCalledWith(1, "cfg-5", "org-1", true);
		expect(mockState.updateTestStatus).toHaveBeenNthCalledWith(
			2,
			"cfg-5",
			"org-1",
			false,
			"primary failure",
		);
		expect(result).toEqual({ success: false, error: "primary failure" });
	});
});
