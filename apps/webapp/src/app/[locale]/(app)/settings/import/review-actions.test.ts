import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
	requireUser: vi.fn(),
	findMember: vi.fn(),
	createImportBatch: vi.fn(),
	createImportBatchJob: vi.fn(),
	saveImportJobSecret: vi.fn(),
	updateImportBatchStatus: vi.fn(),
	enqueueImportScanJob: vi.fn(),
	encryptImportCredential: vi.fn(),
}));

vi.mock("drizzle-orm", async (importOriginal) => {
	const actual = await importOriginal<typeof import("drizzle-orm")>();

	return {
		...actual,
		and: vi.fn((...args: unknown[]) => ({ and: args })),
		eq: vi.fn((left: unknown, right: unknown) => ({ eq: [left, right] })),
	};
});

vi.mock("@/env", () => ({
	env: { BETTER_AUTH_SECRET: "test-secret-that-is-long-enough" },
}));

vi.mock("@/lib/auth-helpers", () => ({
	requireUser: mockState.requireUser,
}));

vi.mock("@/db", () => ({
	db: {
		query: {
			member: {
				findFirst: mockState.findMember,
			},
		},
	},
}));

vi.mock("@/db/auth-schema", () => ({
	member: {
		userId: "member.userId",
		organizationId: "member.organizationId",
	},
}));

vi.mock("@/lib/import-review/credential-secret", () => ({
	encryptImportCredential: mockState.encryptImportCredential,
}));

vi.mock("@/lib/import-review/repository", () => ({
	createImportBatch: mockState.createImportBatch,
	createImportBatchJob: mockState.createImportBatchJob,
	saveImportJobSecret: mockState.saveImportJobSecret,
	updateImportBatchStatus: mockState.updateImportBatchStatus,
}));

vi.mock("@/lib/import-review/queue", () => ({
	enqueueImportScanJob: mockState.enqueueImportScanJob,
}));

const { requireImportAdmin, startImportReviewScan } = await import("./review-actions");

describe("import review actions", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockState.requireUser.mockResolvedValue({ user: { id: "user_1" } });
		mockState.findMember.mockResolvedValue({ role: "admin" });
		mockState.createImportBatch.mockResolvedValue({ id: "batch_1" });
		mockState.createImportBatchJob.mockImplementation(async (input: { partitionKey: string }) => ({
			id: `job_${input.partitionKey}`,
		}));
		mockState.encryptImportCredential.mockReturnValue({
			ciphertext: "encrypted",
			iv: "iv",
			authTag: "tag",
			expiresAt: new Date("2026-01-02T00:00:00.000Z"),
		});
		mockState.saveImportJobSecret.mockResolvedValue({ id: "secret_1" });
		mockState.updateImportBatchStatus.mockResolvedValue(undefined);
		mockState.enqueueImportScanJob.mockResolvedValue(undefined);
	});

	it("requires owner or admin membership in the requested organization", async () => {
		await expect(requireImportAdmin("org_1")).resolves.toEqual({ user: { id: "user_1" } });

		expect(mockState.findMember).toHaveBeenCalledWith({
			where: {
				and: [
					{ eq: ["member.userId", "user_1"] },
					{ eq: ["member.organizationId", "org_1"] },
				],
			},
		});

		mockState.findMember.mockResolvedValue({ role: "member" });
		await expect(requireImportAdmin("org_1")).rejects.toThrow("Unauthorized");
	});

	it("creates a scanning batch and enqueues a scan job for each entity and monthly partition", async () => {
		const result = await startImportReviewScan({
			organizationId: "org_1",
			provider: "clockin",
			credential: "  token_1  ",
			selectedScope: { workdays: true },
			dateRange: { startDate: "2026-01-15", endDate: "2026-02-10" },
			employeeIds: ["emp_1"],
			entityTypes: ["work_period", "absence"],
		});

		expect(result).toEqual({ success: true, data: { batchId: "batch_1" } });
		expect(mockState.createImportBatch).toHaveBeenCalledWith({
			organizationId: "org_1",
			provider: "clockin",
			selectedScope: { workdays: true },
			dateRange: { startDate: "2026-01-15", endDate: "2026-02-10" },
			startedBy: "user_1",
		});
		expect(mockState.encryptImportCredential).toHaveBeenCalledWith(
			"token_1",
			"test-secret-that-is-long-enough",
		);
		expect(mockState.saveImportJobSecret).toHaveBeenCalledWith({
			batchId: "batch_1",
			organizationId: "org_1",
			credential: {
				ciphertext: "encrypted",
				iv: "iv",
				authTag: "tag",
				expiresAt: new Date("2026-01-02T00:00:00.000Z"),
			},
		});
		expect(mockState.updateImportBatchStatus).toHaveBeenCalledWith({
			batchId: "batch_1",
			organizationId: "org_1",
			status: "scanning",
		});
		expect(mockState.createImportBatchJob).toHaveBeenCalledTimes(4);
		expect(mockState.createImportBatchJob).toHaveBeenNthCalledWith(1, {
			batchId: "batch_1",
			organizationId: "org_1",
			kind: "scan",
			entityType: "work_period",
			partitionKey: "work_period:2026-01-15:2026-01-31",
		});
		expect(mockState.createImportBatchJob).toHaveBeenNthCalledWith(4, {
			batchId: "batch_1",
			organizationId: "org_1",
			kind: "scan",
			entityType: "absence",
			partitionKey: "absence:2026-02-01:2026-02-10",
		});
		expect(mockState.enqueueImportScanJob).toHaveBeenCalledTimes(4);
		expect(mockState.enqueueImportScanJob).toHaveBeenNthCalledWith(1, {
			type: "import-review-scan",
			batchId: "batch_1",
			jobId: "job_work_period:2026-01-15:2026-01-31",
			organizationId: "org_1",
			provider: "clockin",
			entityType: "work_period",
			dateRange: { startDate: "2026-01-15", endDate: "2026-01-31" },
			employeeIds: ["emp_1"],
			secretId: "secret_1",
		});
	});

	it("rejects blank credentials without creating a batch", async () => {
		const result = await startImportReviewScan({
			organizationId: "org_1",
			provider: "clockin",
			credential: "   ",
			selectedScope: {},
			dateRange: { startDate: "2026-01-01", endDate: "2026-01-31" },
			employeeIds: [],
			entityTypes: ["employee"],
		});

		expect(result).toEqual({ success: false, error: "Import credential is required" });
		expect(mockState.createImportBatch).not.toHaveBeenCalled();
	});

	it("rejects empty entity selections without creating a batch", async () => {
		const result = await startImportReviewScan({
			organizationId: "org_1",
			provider: "clockin",
			credential: "token_1",
			selectedScope: {},
			dateRange: { startDate: "2026-01-01", endDate: "2026-01-31" },
			employeeIds: [],
			entityTypes: [],
		});

		expect(result).toEqual({ success: false, error: "At least one import entity type is required" });
		expect(mockState.createImportBatch).not.toHaveBeenCalled();
	});

	it("returns date partition validation errors without creating a batch", async () => {
		const result = await startImportReviewScan({
			organizationId: "org_1",
			provider: "clockin",
			credential: "token_1",
			selectedScope: {},
			dateRange: { startDate: "2026-03-01", endDate: "2026-02-01" },
			employeeIds: [],
			entityTypes: ["employee"],
		});

		expect(result).toEqual({ success: false, error: "Import start date must be on or before end date" });
		expect(mockState.createImportBatch).not.toHaveBeenCalled();
	});

	it("returns repository errors without including the credential", async () => {
		mockState.createImportBatch.mockRejectedValue(new Error("database unavailable"));

		const result = await startImportReviewScan({
			organizationId: "org_1",
			provider: "clockin",
			credential: "token_1",
			selectedScope: {},
			dateRange: { startDate: "2026-01-01", endDate: "2026-01-31" },
			employeeIds: [],
			entityTypes: ["employee"],
		});

		expect(result).toEqual({ success: false, error: "database unavailable" });
		expect(JSON.stringify(result)).not.toContain("token_1");
	});
});
