import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const insertMock = vi.fn();
const findImportBatchJobMock = vi.fn();
const findImportBatchMock = vi.fn();
const selectDistinctMock = vi.fn();

vi.mock("@/lib/queue", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/queue")>()),
	addJob: vi.fn().mockResolvedValue({ id: "bull-job-1" }),
}));

vi.mock("@/db", () => ({
	db: {
		insert: insertMock,
		selectDistinct: selectDistinctMock,
		query: {
			importBatch: {
				findFirst: findImportBatchMock,
			},
			importBatchJob: {
				findFirst: findImportBatchJobMock,
			},
		},
	},
}));

vi.mock("./worker", () => ({
	processImportReviewJob: vi
		.fn()
		.mockResolvedValue({ success: true, message: "Import review job completed" }),
	processImportReviewScanJob: vi
		.fn()
		.mockResolvedValue({ success: true, message: "Import review scan queued" }),
	processImportReviewCommitJob: vi
		.fn()
		.mockResolvedValue({ success: true, message: "Import review commit queued" }),
}));

const { addJob } = await import("@/lib/queue");
const { enqueueImportScanJob, enqueueImportCommitJob } = await import("./queue");
const {
	createCommitJobsForAcceptedRows,
	createImportBatchJob,
	insertImportIssues,
	insertStagedRows,
} = await import("./repository");
const { processOneOffJob } = await import("@/worker");
const { processImportReviewJob } = await import("./worker");

beforeEach(() => {
	vi.clearAllMocks();
	findImportBatchMock.mockResolvedValue({ status: "needs_review" });
});

describe("import review queue", () => {
	it("enqueues scan jobs with import-review-scan type", async () => {
		await enqueueImportScanJob({
			type: "import-review-scan",
			batchId: "batch_1",
			jobId: "job_1",
			organizationId: "org_1",
			provider: "clockin",
			entityType: "work_period",
			dateRange: { startDate: "2026-01-01", endDate: "2026-01-31" },
			employeeIds: ["emp_1"],
			secretId: "secret_1",
		});

		expect(addJob).toHaveBeenCalledWith(
			"import-review-scan-job_1",
			expect.objectContaining({ type: "import-review-scan", jobId: "job_1" }),
			expect.objectContaining({ priority: 4, jobId: "import-review-scan-job_1" }),
		);
	});

	it("enqueues commit jobs with import-review-commit type", async () => {
		await enqueueImportCommitJob({
			type: "import-review-commit",
			batchId: "batch_1",
			jobId: "job_2",
			organizationId: "org_1",
			entityType: "work_period",
			committedBy: "user_1",
		});

		expect(addJob).toHaveBeenCalledWith(
			"import-review-commit-job_2",
			expect.objectContaining({ type: "import-review-commit", jobId: "job_2" }),
			expect.objectContaining({ priority: 4, jobId: "import-review-commit-job_2" }),
		);
	});
});

describe("import review repository", () => {
	it("returns an existing import batch job when duplicate creation conflicts", async () => {
		const existingJob = { id: "job_existing", organizationId: "org_1" };
		insertMock.mockReturnValueOnce({
			values: vi.fn().mockReturnValue({
				onConflictDoNothing: vi.fn().mockReturnValue({
					returning: vi.fn().mockResolvedValue([]),
				}),
			}),
		});
		findImportBatchJobMock.mockResolvedValue(existingJob);

		const job = await createImportBatchJob({
			batchId: "batch_1",
			organizationId: "org_1",
			kind: "scan",
			entityType: "work_period",
			partitionKey: "work_period:2026-01",
		});

		expect(job).toBe(existingJob);
		expect(findImportBatchJobMock).toHaveBeenCalledTimes(1);
	});

	it("derives staged row hashes from canonical source payload serialization", async () => {
		let insertedRows: Array<{ sourcePayloadHash: string }> = [];
		insertMock.mockReturnValueOnce({
			values: vi.fn((rows) => {
				insertedRows = rows;
				return {
					onConflictDoNothing: vi.fn().mockReturnValue({
						returning: vi.fn().mockResolvedValue(rows),
					}),
				};
			}),
		});

		await insertStagedRows({
			batchId: "batch_1",
			organizationId: "org_1",
			rows: [
				{
					entityType: "work_period",
					providerSourceId: "source_1",
					sourcePayload: { z: 1, hash: "provider-controlled", a: { y: 2, x: 1 } },
					normalizedPayload: {},
					issueSeverity: "none",
					rowStatus: "staged",
				},
				{
					entityType: "work_period",
					providerSourceId: "source_2",
					sourcePayload: { hash: "different-provider-hash", a: { x: 1, y: 2 }, z: 1 },
					normalizedPayload: {},
					issueSeverity: "none",
					rowStatus: "staged",
				},
			],
		});

		const expectedHash = createHash("sha256").update('{"a":{"x":1,"y":2},"z":1}').digest("hex");

		expect(insertedRows[0]?.sourcePayloadHash).toBe(expectedHash);
		expect(insertedRows[1]?.sourcePayloadHash).toBe(expectedHash);
		expect(insertedRows[0]?.sourcePayloadHash).not.toBe("provider-controlled");
	});

	it("inserts import issues idempotently using the natural issue key", async () => {
		const onConflictDoNothing = vi.fn().mockReturnValue({
			returning: vi.fn().mockResolvedValue([{ id: "issue_1" }]),
		});
		insertMock.mockReturnValueOnce({
			values: vi.fn().mockReturnValue({ onConflictDoNothing }),
		});

		await insertImportIssues({
			batchId: "batch_1",
			organizationId: "org_1",
			stagedRowId: "row_1",
			issues: [
				{
					issueType: "duplicate",
					severity: "warning",
					clusterKey: "duplicate:1",
					message: "Duplicate row",
					details: {},
					detectionRuleVersion: "v1",
				},
			],
		});

		expect(onConflictDoNothing).toHaveBeenCalledTimes(1);
	});

	it("orders commit jobs by dependency group instead of alphabetically", async () => {
		const orderBy = vi
			.fn()
			.mockResolvedValue([
				{ entityType: "absence" },
				{ entityType: "employee" },
				{ entityType: "work_category" },
				{ entityType: "work_period" },
			]);
		const where = vi.fn().mockReturnValue({ orderBy });
		const from = vi.fn().mockReturnValue({ where });
		selectDistinctMock.mockReturnValue({ from });
		insertMock.mockImplementation((_table) => ({
			values: vi.fn((value) => ({
				onConflictDoNothing: vi.fn().mockReturnValue({
					returning: vi.fn().mockResolvedValue([{ id: `job_${value.entityType}`, ...value }]),
				}),
			})),
		}));
		const jobs = await createCommitJobsForAcceptedRows({
			batchId: "batch_1",
			organizationId: "org_1",
		});

		expect(jobs.map((job) => job?.entityType)).toEqual([
			"employee",
			"work_category",
			"absence",
			"work_period",
		]);
	});
});

describe("import review worker routing", () => {
	it("routes import review scan jobs without falling through to unknown job type", async () => {
		const result = await processOneOffJob({
			id: "bull_1",
			name: "import-review-scan-job_1",
			data: {
				type: "import-review-scan",
				batchId: "batch_1",
				jobId: "job_1",
				organizationId: "org_1",
				provider: "clockin",
				entityType: "work_period",
				dateRange: { startDate: "2026-01-01", endDate: "2026-01-31" },
				employeeIds: ["emp_1"],
				secretId: "secret_1",
			},
		} as Parameters<typeof processOneOffJob>[0]);

		expect(result.success).toBe(true);
		expect(processImportReviewJob).toHaveBeenCalledTimes(1);
	});

	it("routes import review commit jobs without falling through to unknown job type", async () => {
		const result = await processOneOffJob({
			id: "bull_2",
			name: "import-review-commit-job_2",
			data: {
				type: "import-review-commit",
				batchId: "batch_1",
				jobId: "job_2",
				organizationId: "org_1",
				entityType: "work_period",
				committedBy: "user_1",
			},
		} as Parameters<typeof processOneOffJob>[0]);

		expect(result.success).toBe(true);
		expect(processImportReviewJob).toHaveBeenCalledTimes(1);
	});

	it("propagates import review processor failures so BullMQ can retry", async () => {
		vi.mocked(processImportReviewJob).mockRejectedValueOnce(new Error("retry me"));

		await expect(
			processOneOffJob({
				id: "bull_3",
				name: "import-review-scan-job_3",
				data: {
					type: "import-review-scan",
					batchId: "batch_1",
					jobId: "job_3",
					organizationId: "org_1",
					provider: "clockin",
					entityType: "work_period",
					dateRange: { startDate: "2026-01-01", endDate: "2026-01-31" },
					employeeIds: ["emp_1"],
					secretId: "secret_1",
				},
			} as Parameters<typeof processOneOffJob>[0]),
		).rejects.toThrow("retry me");
	});
});
