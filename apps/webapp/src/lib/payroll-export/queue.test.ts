import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
	addJob: vi.fn(),
	logger: {
		info: vi.fn(),
		error: vi.fn(),
	},
	markPayrollExportJobFailed: vi.fn(),
	processExport: vi.fn(),
	processExportJob: vi.fn(),
}));

vi.mock("@/lib/logger", () => ({
	createLogger: () => mockState.logger,
}));

vi.mock("@/lib/queue", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/queue")>()),
	addJob: mockState.addJob,
}));

vi.mock("./export-service", () => ({
	markPayrollExportJobFailed: mockState.markPayrollExportJobFailed,
}));

vi.mock("@/lib/payroll-export", () => ({
	processExportJob: mockState.processExportJob,
}));

vi.mock("@/lib/exports/processor", () => ({
	processExport: mockState.processExport,
}));

const { enqueuePayrollExportJob } = await import("./queue");
const { processOneOffJob } = await import("@/worker");

beforeEach(() => {
	vi.clearAllMocks();
	mockState.addJob.mockResolvedValue({ id: "bull-job-1" });
	mockState.markPayrollExportJobFailed.mockResolvedValue(undefined);
	mockState.processExportJob.mockResolvedValue(undefined);
});

describe("enqueuePayrollExportJob", () => {
	it("enqueues a tenant-scoped payroll export with a deterministic queue ID", async () => {
		const queueResult = { id: "bull-job-1" };
		mockState.addJob.mockResolvedValueOnce(queueResult);

		const result = await enqueuePayrollExportJob({
			jobId: "job-1",
			organizationId: "org-1",
		});

		expect(mockState.addJob).toHaveBeenCalledWith(
			"process-payroll-export",
			{
				type: "payroll-export",
				jobId: "job-1",
				organizationId: "org-1",
			},
			{ priority: 4, jobId: "payroll-export-job-1" },
		);
		expect(result).toBe(queueResult);
	});

	it("marks the scoped payroll job failed and rethrows the queue error", async () => {
		const queueError = new Error("queue unavailable");
		mockState.addJob.mockRejectedValueOnce(queueError);

		await expect(enqueuePayrollExportJob({ jobId: "job-1", organizationId: "org-1" })).rejects.toBe(
			queueError,
		);

		expect(mockState.markPayrollExportJobFailed).toHaveBeenCalledWith({
			jobId: "job-1",
			organizationId: "org-1",
			errorMessage: "Failed to queue payroll export",
		});
	});

	it("preserves the queue error when marking the payroll job failed also rejects", async () => {
		const queueError = new Error("queue unavailable");
		const statusError = new Error("database unavailable");
		mockState.addJob.mockRejectedValueOnce(queueError);
		mockState.markPayrollExportJobFailed.mockRejectedValueOnce(statusError);

		await expect(enqueuePayrollExportJob({ jobId: "job-1", organizationId: "org-1" })).rejects.toBe(
			queueError,
		);

		expect(mockState.logger.error).toHaveBeenCalledWith(
			{ error: statusError, jobId: "job-1", organizationId: "org-1" },
			"Failed to mark payroll export as failed",
		);
	});
});

describe("payroll export worker routing", () => {
	it("routes payroll jobs to the tenant-scoped payroll processor", async () => {
		const result = await processOneOffJob({
			id: "bull-job-1",
			name: "process-payroll-export",
			data: {
				type: "payroll-export",
				jobId: "job-1",
				organizationId: "org-1",
			},
		} as Parameters<typeof processOneOffJob>[0]);

		expect(mockState.processExportJob).toHaveBeenCalledWith({
			jobId: "job-1",
			organizationId: "org-1",
		});
		expect(result).toEqual({ success: true, message: "Payroll export processed" });
		expect(mockState.processExport).not.toHaveBeenCalled();
	});
});
