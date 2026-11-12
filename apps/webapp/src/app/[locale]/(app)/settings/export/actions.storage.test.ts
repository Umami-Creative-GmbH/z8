import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StubCaller } from "@/test/organization-action";

const mocks = vi.hoisted(() => ({
	caller: null as StubCaller | null,
	createExportRequest: vi.fn(),
	deleteExportRecord: vi.fn(),
	deleteOrgSecret: vi.fn(),
	findFirst: vi.fn(),
	getExportHistory: vi.fn(),
	getStorageConfig: vi.fn(),
	regeneratePresignedUrl: vi.fn(),
	returning: vi.fn(),
	set: vi.fn(),
	storeOrgSecret: vi.fn(),
	testS3Connection: vi.fn(),
	update: vi.fn(),
	where: vi.fn(),
}));

vi.mock("@/lib/effect/runtime", async () => {
	const { runtimeModuleOver } = await import("@/test/effect-runtime");
	const { organizationActionStubLayer } = await import("@/test/organization-action");
	return runtimeModuleOver(
		organizationActionStubLayer(() => mocks.caller, {
			db: {
				query: { exportStorageConfig: { findFirst: mocks.findFirst } },
				update: mocks.update,
				insert: vi.fn(),
				delete: vi.fn(() => ({ where: vi.fn() })),
			},
		}),
	);
});
vi.mock("@/lib/vault", () => ({
	deleteOrgSecret: mocks.deleteOrgSecret,
	storeOrgSecret: mocks.storeOrgSecret,
}));
vi.mock("@/lib/export/export-service", () => ({
	createExportRequest: mocks.createExportRequest,
	deleteExportRecord: mocks.deleteExportRecord,
	getExportHistory: mocks.getExportHistory,
	regeneratePresignedUrl: mocks.regeneratePresignedUrl,
}));
vi.mock("@/lib/storage/export-s3-client", () => ({
	getStorageConfig: mocks.getStorageConfig,
	testS3Connection: mocks.testS3Connection,
}));

const {
	deleteExportAction,
	deleteStorageConfigAction,
	getExportHistoryAction,
	getStorageConfigAction,
	regenerateDownloadUrlAction,
	saveStorageConfigAction,
	startExportAction,
	testStorageConnectionAction,
} = await import("./actions");

const orgAdmin: StubCaller = {
	userId: "user-1",
	activeOrganizationId: "org-1",
	membershipRole: "admin",
	employee: { id: "employee-1", role: "admin", former: false },
};
const scopedManager: StubCaller = {
	...orgAdmin,
	membershipRole: "member",
	employee: { id: "employee-1", role: "manager", former: false },
};

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

beforeEach(() => {
	vi.clearAllMocks();
	mocks.caller = orgAdmin;
	mocks.findFirst.mockResolvedValue(existing);
	mocks.update.mockReturnValue({ set: mocks.set });
	mocks.set.mockReturnValue({ where: mocks.where });
	mocks.where.mockReturnValue({ returning: mocks.returning });
	mocks.returning.mockResolvedValue([{ ...existing, bucket: "new-bucket" }]);
	mocks.createExportRequest.mockResolvedValue({ id: "export-1" });
});

describe("data export settings actions", () => {
	it.each([
		["startExportAction", () => startExportAction({ categories: ["employees"] })],
		["getExportHistoryAction", () => getExportHistoryAction()],
		["regenerateDownloadUrlAction", () => regenerateDownloadUrlAction({ exportId: "export-1" })],
		["deleteExportAction", () => deleteExportAction({ exportId: "export-1" })],
		["getStorageConfigAction", () => getStorageConfigAction()],
		[
			"saveStorageConfigAction",
			() => saveStorageConfigAction({ bucket: "b", region: "eu-central-1" }),
		],
		["testStorageConnectionAction", () => testStorageConnectionAction({})],
		["deleteStorageConfigAction", () => deleteStorageConfigAction()],
	])("%s refuses a scoped manager", async (_name, run) => {
		mocks.caller = scopedManager;

		const result = await run();

		expect(result).toMatchObject({ success: false, code: "AuthorizationError" });
		expect(mocks.findFirst).not.toHaveBeenCalled();
		expect(mocks.createExportRequest).not.toHaveBeenCalled();
		expect(mocks.deleteExportRecord).not.toHaveBeenCalled();
		expect(mocks.deleteOrgSecret).not.toHaveBeenCalled();
		expect(mocks.storeOrgSecret).not.toHaveBeenCalled();
		expect(mocks.testS3Connection).not.toHaveBeenCalled();
	});

	it("preserves existing Vault secrets when credentials are omitted", async () => {
		const result = await saveStorageConfigAction({
			bucket: "new-bucket",
			region: "eu-central-1",
		});

		expect(result.success).toBe(true);
		expect(mocks.storeOrgSecret).not.toHaveBeenCalled();
		expect(mocks.deleteOrgSecret).not.toHaveBeenCalled();
	});

	it("stores replaced credentials under the session's organization", async () => {
		await saveStorageConfigAction({
			bucket: "new-bucket",
			region: "eu-central-1",
			accessKeyId: "key",
			secretAccessKey: "secret",
		});

		expect(mocks.storeOrgSecret).toHaveBeenCalledWith("org-1", "storage/access_key_id", "key");
		expect(mocks.storeOrgSecret).toHaveBeenCalledWith(
			"org-1",
			"storage/secret_access_key",
			"secret",
		);
	});

	it("starts an export of the known categories for the caller's employee record", async () => {
		const result = await startExportAction({ categories: ["employees", "unknown"] });

		expect(result).toEqual({ success: true, data: { id: "export-1" } });
		expect(mocks.createExportRequest).toHaveBeenCalledWith({
			organizationId: "org-1",
			requestedById: "employee-1",
			categories: ["employees"],
		});
	});

	it("refuses an export with no known category", async () => {
		const result = await startExportAction({ categories: ["unknown"] });

		expect(result).toMatchObject({
			success: false,
			code: "ValidationError",
			error: "At least one valid export category must be selected",
		});
		expect(mocks.createExportRequest).not.toHaveBeenCalled();
	});

	it("regenerates a download URL only within the session's organization", async () => {
		mocks.regeneratePresignedUrl.mockResolvedValue("https://example.test/export");

		await regenerateDownloadUrlAction({ exportId: "export-1" });

		expect(mocks.regeneratePresignedUrl).toHaveBeenCalledWith("export-1", "org-1");
	});
});
