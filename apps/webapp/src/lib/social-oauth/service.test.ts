import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => {
	const dbFindFirst = vi.fn();
	const dbUpdateReturning = vi.fn();
	const dbUpdateWhere = vi.fn(() => ({ returning: dbUpdateReturning }));
	const dbUpdateSet = vi.fn(() => ({ where: dbUpdateWhere }));
	const dbUpdate = vi.fn(() => ({ set: dbUpdateSet }));
	const dbDeleteWhere = vi.fn();
	const dbDelete = vi.fn(() => ({ where: dbDeleteWhere }));

	return {
		dbFindFirst,
		dbUpdate,
		dbUpdateWhere,
		dbUpdateReturning,
		dbDelete,
		dbDeleteWhere,
		deleteOrgSecret: vi.fn(),
		storeOrgSecret: vi.fn(),
		getOrgSecret: vi.fn(),
	};
});

vi.mock("@/env", () => ({
	env: {
		BETTER_AUTH_SECRET: "test-secret-key-32-characters-minimum!",
	},
}));

vi.mock("@/lib/logger", () => ({
	createLogger: () => ({
		warn: vi.fn(),
		error: vi.fn(),
		info: vi.fn(),
	}),
}));

vi.mock("drizzle-orm", () => ({
	and: vi.fn((...args: unknown[]) => ({ and: args })),
	eq: vi.fn((left: unknown, right: unknown) => ({ eq: [left, right] })),
}));

vi.mock("@/db/schema", () => ({
	organizationSocialOAuth: {
		id: "id",
		organizationId: "organizationId",
		provider: "provider",
		clientId: "clientId",
		providerConfig: "providerConfig",
		isActive: "isActive",
		lastTestAt: "lastTestAt",
		lastTestSuccess: "lastTestSuccess",
		lastTestError: "lastTestError",
		createdAt: "createdAt",
		updatedAt: "updatedAt",
	},
}));

vi.mock("@/db", () => ({
	db: {
		query: {
			organizationSocialOAuth: {
				findFirst: mockState.dbFindFirst,
			},
		},
		update: mockState.dbUpdate,
		delete: mockState.dbDelete,
	},
}));

vi.mock("@/lib/vault/secrets", () => ({
	deleteOrgSecret: mockState.deleteOrgSecret,
	storeOrgSecret: mockState.storeOrgSecret,
	getOrgSecret: mockState.getOrgSecret,
}));

const { deleteSocialOAuthConfig, updateSocialOAuthConfig, updateTestStatus } = await import(
	"./service"
);

describe("social oauth org scoping", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("blocks cross-org update when scoped record is not found", async () => {
		mockState.dbFindFirst.mockResolvedValue(null);

		await expect(
			updateSocialOAuthConfig("cfg-1", "org-a", {
				clientId: "updated-client-id",
			}),
		).rejects.toThrow("Social OAuth config not found");

		expect(mockState.dbUpdate).not.toHaveBeenCalled();
	});

	it("blocks cross-org delete when scoped record is not found", async () => {
		mockState.dbFindFirst.mockResolvedValue(null);

		await expect(deleteSocialOAuthConfig("cfg-1", "org-a")).rejects.toThrow(
			"Social OAuth config not found",
		);

		expect(mockState.dbDelete).not.toHaveBeenCalled();
		expect(mockState.deleteOrgSecret).not.toHaveBeenCalled();
	});

	it("blocks test status update when scoped update affects zero rows", async () => {
		mockState.dbUpdateReturning.mockResolvedValue([]);

		await expect(updateTestStatus("cfg-1", "org-a", true)).rejects.toThrow(
			"Social OAuth config not found",
		);

		expect(mockState.dbUpdate).toHaveBeenCalledTimes(1);
		expect(mockState.dbUpdateWhere).toHaveBeenCalledTimes(1);
	});
});
