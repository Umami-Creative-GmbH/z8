import { beforeEach, describe, expect, it, vi } from "vitest";

const updateImportBatchJobMock = vi.fn();
const advanceImportBatchAfterJobMock = vi.fn();
const listImportBatchJobsForBatchMock = vi.fn();
const readyCommitJobsFromJobsMock = vi.fn();
const enqueueImportCommitJobMock = vi.fn();
const scanClockinImportPartitionMock = vi.fn();
const scanClockodoImportPartitionMock = vi.fn();
const commitAcceptedRowsForEntityMock = vi.fn();

vi.mock("./repository", () => ({
	advanceImportBatchAfterJob: advanceImportBatchAfterJobMock,
	listImportBatchJobsForBatch: listImportBatchJobsForBatchMock,
	readyCommitJobsFromJobs: readyCommitJobsFromJobsMock,
	updateImportBatchJob: updateImportBatchJobMock,
}));

vi.mock("./queue", () => ({
	enqueueImportCommitJob: enqueueImportCommitJobMock,
}));

vi.mock("./clockin-adapter", () => ({
	scanClockinImportPartition: scanClockinImportPartitionMock,
}));

vi.mock("./clockodo-adapter", () => ({
	scanClockodoImportPartition: scanClockodoImportPartitionMock,
}));

vi.mock("./committers", () => ({
	commitAcceptedRowsForEntity: commitAcceptedRowsForEntityMock,
}));

const { processImportReviewJob } = await import("./worker");

beforeEach(() => {
	vi.clearAllMocks();
	advanceImportBatchAfterJobMock.mockResolvedValue(undefined);
	listImportBatchJobsForBatchMock.mockResolvedValue([]);
	readyCommitJobsFromJobsMock.mockReturnValue([]);
	enqueueImportCommitJobMock.mockResolvedValue(undefined);
	scanClockinImportPartitionMock.mockRejectedValue(new Error("Clockin import scan is not implemented"));
	scanClockodoImportPartitionMock.mockRejectedValue(new Error("Clockodo import scan is not implemented"));
	commitAcceptedRowsForEntityMock.mockRejectedValue(new Error("Import review commit is not implemented"));
});

function scanJob(overrides: Record<string, unknown> = {}) {
	const { attemptsMade = 0, opts = { attempts: 3 }, ...dataOverrides } = overrides;
	return {
		id: "bull_1",
		attemptsMade,
		opts,
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
			...dataOverrides,
		},
	} as Parameters<typeof processImportReviewJob>[0];
}

function commitJob(overrides: Record<string, unknown> = {}) {
	const { attemptsMade = 0, opts = { attempts: 3 }, ...dataOverrides } = overrides;
	return {
		id: "bull_3",
		attemptsMade,
		opts,
		data: {
			type: "import-review-commit",
			batchId: "batch_1",
			jobId: "job_3",
			organizationId: "org_1",
			entityType: "work_period",
			committedBy: "user_1",
			...dataOverrides,
		},
	} as Parameters<typeof processImportReviewJob>[0];
}

describe("processImportReviewJob", () => {
	it("routes clockin scan jobs and marks them completed with staged row count", async () => {
		scanClockinImportPartitionMock.mockResolvedValue({ stagedRows: 7, issues: 2 });

		const result = await processImportReviewJob(scanJob());

		expect(result).toEqual({
			success: true,
			message: "Import review scan completed",
			data: { stagedRows: 7, issues: 2 },
		});
		expect(updateImportBatchJobMock).toHaveBeenNthCalledWith(1, {
			jobId: "job_1",
			organizationId: "org_1",
			status: "running",
			errorMessage: null,
		});
		expect(scanClockinImportPartitionMock).toHaveBeenCalledWith(
			expect.objectContaining({ provider: "clockin", jobId: "job_1" }),
		);
		expect(scanClockodoImportPartitionMock).not.toHaveBeenCalled();
		expect(updateImportBatchJobMock).toHaveBeenNthCalledWith(2, {
			jobId: "job_1",
			organizationId: "org_1",
			status: "completed",
			processedRows: 7,
			errorMessage: null,
		});
		expect(advanceImportBatchAfterJobMock).toHaveBeenCalledWith({
			batchId: "batch_1",
			organizationId: "org_1",
			kind: "scan",
		});
	});

	it("routes clockodo scan jobs to the clockodo adapter", async () => {
		scanClockodoImportPartitionMock.mockResolvedValue({ stagedRows: 3, issues: 1 });

		const result = await processImportReviewJob(
			scanJob({
				jobId: "job_2",
				provider: "clockodo",
				entityType: "time_entry",
				dateRange: { startDate: "2026-02-01", endDate: "2026-02-28" },
			}),
		);

		expect(result.success).toBe(true);
		expect(result.data).toEqual({ stagedRows: 3, issues: 1 });
		expect(scanClockodoImportPartitionMock).toHaveBeenCalledTimes(1);
		expect(scanClockinImportPartitionMock).not.toHaveBeenCalled();
	});

	it("routes commit jobs and marks them completed with committed row count", async () => {
		commitAcceptedRowsForEntityMock.mockResolvedValue({ committedRows: 5, failedRows: 0, errors: [] });

		const result = await processImportReviewJob(commitJob());

		expect(result).toEqual({
			success: true,
			message: "Import review commit completed",
			data: { committedRows: 5 },
		});
		expect(commitAcceptedRowsForEntityMock).toHaveBeenCalledWith(
			expect.objectContaining({ entityType: "work_period", committedBy: "user_1" }),
			{ finalAttempt: false },
		);
		expect(updateImportBatchJobMock).toHaveBeenNthCalledWith(2, {
			jobId: "job_3",
			organizationId: "org_1",
			status: "completed",
			processedRows: 5,
			errorMessage: null,
		});
		expect(advanceImportBatchAfterJobMock).toHaveBeenCalledWith({
			batchId: "batch_1",
			organizationId: "org_1",
			kind: "commit",
		});
	});

	it("marks commit jobs failed and rejects when committed rows report row failures", async () => {
		commitAcceptedRowsForEntityMock.mockResolvedValue({
			committedRows: 2,
			failedRows: 1,
			errors: [{ rowId: "row_3", message: "Employee emp_2 does not belong to organization org_1" }],
		});

		await expect(processImportReviewJob(commitJob({ attemptsMade: 2 }))).rejects.toThrow(
			"Import review commit failed for 1 row(s): row_3: Employee emp_2 does not belong to organization org_1",
		);

		expect(updateImportBatchJobMock).toHaveBeenNthCalledWith(2, {
			jobId: "job_3",
			organizationId: "org_1",
			status: "failed",
			errorMessage:
				"Import review commit failed for 1 row(s): row_3: Employee emp_2 does not belong to organization org_1",
		});
		expect(advanceImportBatchAfterJobMock).toHaveBeenCalledWith({
			batchId: "batch_1",
			organizationId: "org_1",
			kind: "commit",
		});
		expect(updateImportBatchJobMock).not.toHaveBeenCalledWith(
			expect.objectContaining({ status: "completed" }),
		);
	});

	it("passes finalAttempt false and rejects row failures so retries cannot complete by skipping failed rows", async () => {
		commitAcceptedRowsForEntityMock.mockResolvedValue({
			committedRows: 0,
			failedRows: 1,
			errors: [{ rowId: "row_1", message: "temporary database failure" }],
		});

		await expect(processImportReviewJob(commitJob())).rejects.toThrow(
			"Import review commit failed for 1 row(s): row_1: temporary database failure",
		);

		expect(commitAcceptedRowsForEntityMock).toHaveBeenCalledWith(
			expect.objectContaining({ entityType: "work_period" }),
			{ finalAttempt: false },
		);
		expect(updateImportBatchJobMock).not.toHaveBeenCalledWith(
			expect.objectContaining({ status: "completed" }),
		);
	});

	it("rejects non-final setup blockers so retry path cannot complete by skipping blocked rows", async () => {
		commitAcceptedRowsForEntityMock.mockResolvedValue({
			committedRows: 0,
			failedRows: 1,
			errors: [
				{
					rowId: "row_1",
					message: "employee import rows require mapping confirmation before commit",
				},
			],
		});

		await expect(processImportReviewJob(commitJob({ entityType: "employee" }))).rejects.toThrow(
			"Import review commit failed for 1 row(s): row_1: employee import rows require mapping confirmation before commit",
		);

		expect(commitAcceptedRowsForEntityMock).toHaveBeenCalledWith(
			expect.objectContaining({ entityType: "employee" }),
			{ finalAttempt: false },
		);
		expect(updateImportBatchJobMock).not.toHaveBeenCalledWith(
			expect.objectContaining({ status: "completed" }),
		);
	});

	it("passes finalAttempt true to committers on exhausted commit attempts", async () => {
		commitAcceptedRowsForEntityMock.mockResolvedValue({
			committedRows: 0,
			failedRows: 1,
			errors: [{ rowId: "row_1", message: "permanent validation failure" }],
		});

		await expect(processImportReviewJob(commitJob({ attemptsMade: 2 }))).rejects.toThrow(
			"Import review commit failed for 1 row(s): row_1: permanent validation failure",
		);

		expect(commitAcceptedRowsForEntityMock).toHaveBeenCalledWith(
			expect.objectContaining({ entityType: "work_period" }),
			{ finalAttempt: true },
		);
		expect(updateImportBatchJobMock).toHaveBeenNthCalledWith(2, {
			jobId: "job_3",
			organizationId: "org_1",
			status: "failed",
			errorMessage: "Import review commit failed for 1 row(s): row_1: permanent validation failure",
		});
	});

	it("rejects placeholder scan failures without marking the job completed", async () => {
		await expect(processImportReviewJob(scanJob())).rejects.toThrow("Clockin import scan is not implemented");

		expect(updateImportBatchJobMock).toHaveBeenCalledTimes(1);
		expect(updateImportBatchJobMock).toHaveBeenCalledWith({
			jobId: "job_1",
			organizationId: "org_1",
			status: "running",
			errorMessage: null,
		});
		expect(updateImportBatchJobMock).not.toHaveBeenCalledWith(
			expect.objectContaining({ status: "completed" }),
		);
	});

	it("rejects retryable failures without marking the job failed before the final attempt", async () => {
		scanClockinImportPartitionMock.mockRejectedValue(new Error("provider unavailable"));

		await expect(processImportReviewJob(scanJob({ jobId: "job_4" }))).rejects.toThrow("provider unavailable");

		expect(updateImportBatchJobMock).toHaveBeenCalledTimes(1);
		expect(updateImportBatchJobMock).not.toHaveBeenCalledWith(
			expect.objectContaining({ status: "failed" }),
		);
		expect(advanceImportBatchAfterJobMock).not.toHaveBeenCalled();
	});

	it("marks failed and rejects when the final BullMQ attempt is exhausted", async () => {
		scanClockinImportPartitionMock.mockRejectedValue(new Error("provider unavailable"));

		await expect(
			processImportReviewJob(scanJob({ jobId: "job_4", attemptsMade: 2 })),
		).rejects.toThrow("provider unavailable");

		expect(updateImportBatchJobMock).toHaveBeenNthCalledWith(2, {
			jobId: "job_4",
			organizationId: "org_1",
			status: "failed",
			errorMessage: "provider unavailable",
		});
		expect(advanceImportBatchAfterJobMock).toHaveBeenCalledWith({
			batchId: "batch_1",
			organizationId: "org_1",
			kind: "scan",
		});
	});

	it("rejects unsupported providers", async () => {
		await expect(processImportReviewJob(scanJob({ provider: "unknown" }))).rejects.toThrow(
			"Unsupported import review provider: unknown",
		);
		expect(scanClockinImportPartitionMock).not.toHaveBeenCalled();
		expect(scanClockodoImportPartitionMock).not.toHaveBeenCalled();
	});

	it("rejects unsupported job types", async () => {
		await expect(processImportReviewJob(scanJob({ type: "unknown-job" }))).rejects.toThrow(
			"Unsupported import review job type: unknown-job",
		);
		expect(scanClockinImportPartitionMock).not.toHaveBeenCalled();
		expect(commitAcceptedRowsForEntityMock).not.toHaveBeenCalled();
	});
});
