import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/queue", () => ({
	addJob: vi.fn().mockResolvedValue({ id: "bull-job-1" }),
}));

const { addJob } = await import("@/lib/queue");
const { enqueueImportScanJob, enqueueImportCommitJob } = await import("./queue");

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
			expect.objectContaining({ priority: 4 }),
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
			expect.objectContaining({ priority: 4 }),
		);
	});
});
