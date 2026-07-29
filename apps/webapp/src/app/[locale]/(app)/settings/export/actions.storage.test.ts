import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	deleteOrgSecret: vi.fn(),
	findFirst: vi.fn(),
	isOrgAdminCasl: vi.fn(async () => true),
	returning: vi.fn(),
	set: vi.fn(),
	storeOrgSecret: vi.fn(),
	where: vi.fn(),
}));

vi.mock("drizzle-orm", async (importActual) => ({
	...(await importActual<typeof import("drizzle-orm")>()),
	eq: vi.fn((column, value) => ({ column, value })),
}));
vi.mock("@/db", () => ({
	db: {
		query: { exportStorageConfig: { findFirst: state.findFirst } },
		update: vi.fn(() => ({ set: state.set })),
		insert: vi.fn(),
		delete: vi.fn(),
	},
	exportStorageConfig: {
		id: "exportStorageConfig.id",
		organizationId: "exportStorageConfig.organizationId",
	},
}));
vi.mock("@/db/schema", () => ({ employee: {} }));
vi.mock("@/lib/auth-helpers", () => ({ isOrgAdminCasl: state.isOrgAdminCasl }));
vi.mock("@/lib/vault", () => ({
	deleteOrgSecret: state.deleteOrgSecret,
	storeOrgSecret: state.storeOrgSecret,
}));
vi.mock("@/lib/export/data-fetchers", () => ({ EXPORT_CATEGORIES: [] }));
vi.mock("@/lib/export/export-service", () => ({}));
vi.mock("@/lib/storage/export-s3-client", () => ({}));
vi.mock("@/lib/effect/services/database.service", async () => {
	const { Context } = await import("effect");
	return { DatabaseService: Context.GenericTag("DatabaseService") };
});
vi.mock("@/lib/effect/services/auth.service", async () => {
	const { Context } = await import("effect");
	return { AuthService: Context.GenericTag("AuthService") };
});
vi.mock("@/lib/effect/runtime", async () => {
	const { Effect, Layer } = await import("effect");
	const { AuthService } = await import("@/lib/effect/services/auth.service");
	return {
		AppLayer: Layer.succeed(AuthService, {
			getSession: () => Effect.succeed({ user: { id: "user-1" } }),
		}),
	};
});
vi.mock("@/lib/effect/result", async () => {
	const { Effect, Exit } = await import("effect");
	return {
		runServerActionSafe: async (
			effect: Parameters<typeof Effect.runPromiseExit>[0],
		) =>
			Exit.match(await Effect.runPromiseExit(effect), {
				onFailure: () => ({ success: false as const, error: "failed" }),
				onSuccess: (data) => ({ success: true as const, data }),
			}),
	};
});

const { saveStorageConfigAction } = await import("./actions");

const existing = {
	id: "storage-1",
	organizationId: "org-1",
	bucket: "old-bucket",
	region: "eu-central-1",
	endpoint: null,
	isVerified: true,
	lastVerifiedAt: new Date("2026-01-01T00:00:00Z"),
	createdAt: new Date("2026-01-01T00:00:00Z"),
	updatedAt: new Date("2026-01-01T00:00:00Z"),
};

describe("saveStorageConfigAction Vault boundary", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		state.findFirst.mockResolvedValue(existing);
		state.set.mockReturnValue({ where: state.where });
		state.where.mockReturnValue({ returning: state.returning });
		state.returning.mockResolvedValue([{ ...existing, bucket: "new-bucket" }]);
	});

	it("preserves existing Vault secrets when credentials are omitted", async () => {
		const result = await saveStorageConfigAction({
			organizationId: "org-1",
			bucket: "new-bucket",
			region: "eu-central-1",
		});

		expect(result.success).toBe(true);
		expect(state.storeOrgSecret).not.toHaveBeenCalled();
		expect(state.deleteOrgSecret).not.toHaveBeenCalled();
	});
});
