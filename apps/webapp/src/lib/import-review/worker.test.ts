import { beforeEach, describe, expect, it, vi } from "vitest";

const updateImportBatchJobMock = vi.fn();
const scanClockinImportPartitionMock = vi.fn();
const scanClockodoImportPartitionMock = vi.fn();
const commitAcceptedRowsForEntityMock = vi.fn();

vi.mock("./repository", () => ({
	updateImportBatchJob: updateImportBatchJobMock,
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
	scanClockinImportPartitionMock.mockResolvedValue(0);
	scanClockodoImportPartitionMock.mockResolvedValue(0);
	commitAcceptedRowsForEntityMock.mockResolvedValue(0);
});

describe("processImportReviewJob", () => {
	it("routes clockin scan jobs and marks them completed with processed row count", async () => {
		scanClockinImportPartitionMock.mockResolvedValue(7);

		const result = await processImportReviewJob({
			id: "bull_1",
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
		} as Parameters<typeof processImportReviewJob>[0]);

		expect(result).toEqual({
			success: true,
			message: "Import review scan completed",
			data: { processedRows: 7 },
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
	});

	it("routes clockodo scan jobs to the clockodo adapter", async () => {
		scanClockodoImportPartitionMock.mockResolvedValue(3);

		const result = await processImportReviewJob({
			id: "bull_2",
			data: {
				type: "import-review-scan",
				batchId: "batch_1",
				jobId: "job_2",
				organizationId: "org_1",
				provider: "clockodo",
				entityType: "time_entry",
				dateRange: { startDate: "2026-02-01", endDate: "2026-02-28" },
				employeeIds: ["emp_1"],
				secretId: "secret_1",
			},
		} as Parameters<typeof processImportReviewJob>[0]);

		expect(result.success).toBe(true);
		expect(result.data).toEqual({ processedRows: 3 });
		expect(scanClockodoImportPartitionMock).toHaveBeenCalledTimes(1);
		expect(scanClockinImportPartitionMock).not.toHaveBeenCalled();
	});

	it("routes commit jobs and marks them completed with committed row count", async () => {
		commitAcceptedRowsForEntityMock.mockResolvedValue(5);

		const result = await processImportReviewJob({
			id: "bull_3",
			data: {
				type: "import-review-commit",
				batchId: "batch_1",
				jobId: "job_3",
				organizationId: "org_1",
				entityType: "work_period",
				committedBy: "user_1",
			},
		} as Parameters<typeof processImportReviewJob>[0]);

		expect(result).toEqual({
			success: true,
			message: "Import review commit completed",
			data: { committedRows: 5 },
		});
		expect(commitAcceptedRowsForEntityMock).toHaveBeenCalledWith(
			expect.objectContaining({ entityType: "work_period", committedBy: "user_1" }),
		);
		expect(updateImportBatchJobMock).toHaveBeenNthCalledWith(2, {
			jobId: "job_3",
			organizationId: "org_1",
			status: "completed",
			processedRows: 5,
			errorMessage: null,
		});
	});

	it("marks jobs failed and returns the thrown error message", async () => {
		scanClockinImportPartitionMock.mockRejectedValue(new Error("provider unavailable"));

		const result = await processImportReviewJob({
			id: "bull_4",
			data: {
				type: "import-review-scan",
				batchId: "batch_1",
				jobId: "job_4",
				organizationId: "org_1",
				provider: "clockin",
				entityType: "work_period",
				dateRange: { startDate: "2026-01-01", endDate: "2026-01-31" },
				employeeIds: [],
				secretId: "secret_1",
			},
		} as Parameters<typeof processImportReviewJob>[0]);

		expect(result).toEqual({ success: false, error: "provider unavailable" });
		expect(updateImportBatchJobMock).toHaveBeenNthCalledWith(2, {
			jobId: "job_4",
			organizationId: "org_1",
			status: "failed",
			errorMessage: "provider unavailable",
		});
	});
});
