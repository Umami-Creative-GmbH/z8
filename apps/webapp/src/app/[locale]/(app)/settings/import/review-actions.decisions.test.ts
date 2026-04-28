import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
	requireUser: vi.fn(),
	findMember: vi.fn(),
	getImportReviewSummary: vi.fn(),
	listImportReviewRows: vi.fn(),
	applyImportRowDecision: vi.fn(),
	listRejectedImportReviewRowsForExport: vi.fn(),
	recordRejectedExport: vi.fn(),
	createCommitJobsForAcceptedRows: vi.fn(),
	updateImportBatchStatus: vi.fn(),
	enqueueImportCommitJob: vi.fn(),
	select: vi.fn(),
	update: vi.fn(),
	findImportBatch: vi.fn(),
}));

vi.mock("drizzle-orm", async (importOriginal) => {
	const actual = await importOriginal<typeof import("drizzle-orm")>();

	return {
		...actual,
		and: vi.fn((...args: unknown[]) => ({ and: args })),
		eq: vi.fn((left: unknown, right: unknown) => ({ eq: [left, right] })),
		inArray: vi.fn((left: unknown, right: unknown) => ({ inArray: [left, right] })),
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
		select: mockState.select,
		update: mockState.update,
		query: {
			member: {
				findFirst: mockState.findMember,
			},
			importBatch: {
				findFirst: mockState.findImportBatch,
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
	encryptImportCredential: vi.fn(),
}));

vi.mock("@/lib/import-review/repository", () => ({
	createImportBatch: vi.fn(),
	createImportBatchJob: vi.fn(),
	saveImportJobSecret: vi.fn(),
	getImportReviewSummary: mockState.getImportReviewSummary,
	listImportReviewRows: mockState.listImportReviewRows,
	applyImportRowDecision: mockState.applyImportRowDecision,
	listRejectedImportReviewRowsForExport: mockState.listRejectedImportReviewRowsForExport,
	recordRejectedExport: mockState.recordRejectedExport,
	createCommitJobsForAcceptedRows: mockState.createCommitJobsForAcceptedRows,
	updateImportBatchStatus: mockState.updateImportBatchStatus,
}));

vi.mock("@/lib/import-review/queue", () => ({
	enqueueImportScanJob: vi.fn(),
	enqueueImportCommitJob: mockState.enqueueImportCommitJob,
}));

const {
	applyImportDecisionAction,
	exportRejectedRowsAction,
	getImportReviewSummaryAction,
	listImportReviewRowsAction,
	startImportCommitAction,
} = await import("./review-actions");

describe("import review decision actions", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockState.requireUser.mockResolvedValue({ user: { id: "user_1" } });
		mockState.findMember.mockResolvedValue({ role: "admin" });
		mockState.getImportReviewSummary.mockResolvedValue({
			totalRows: 4,
			acceptedRows: 1,
			rejectedRows: 1,
			blockedRows: 1,
			committedRows: 1,
			issueCount: 2,
		});
		mockState.listImportReviewRows.mockResolvedValue([{ id: "row_1" }]);
		mockState.applyImportRowDecision.mockResolvedValue({ updatedCount: 2 });
		mockState.listRejectedImportReviewRowsForExport.mockResolvedValue([
			{
				id: "row_1",
				entityType: "employee",
				providerSourceId: "provider_1",
				issueSeverity: "warning",
				decisionReason: "Duplicate employee",
				normalizedPayload: { employeeNumber: "E-1", name: "Ada" },
				sourcePayload: { id: "provider_1" },
			},
		]);
		mockState.recordRejectedExport.mockResolvedValue({
			id: "export_1",
			fileName: "import-batch_1-rejected.csv",
		});
		mockState.createCommitJobsForAcceptedRows.mockResolvedValue([
			{ id: "job_1", entityType: "employee" },
			{ id: "job_2", entityType: "work_period" },
		]);
		mockState.updateImportBatchStatus.mockResolvedValue(undefined);
		mockState.enqueueImportCommitJob.mockResolvedValue(undefined);
	});

	it("requires owner or admin before reading review summaries", async () => {
		mockState.findMember.mockResolvedValue({ role: "member" });

		const result = await getImportReviewSummaryAction("org_1", "batch_1");

		expect(result).toEqual({ success: false, error: "Unauthorized" });
		expect(mockState.getImportReviewSummary).not.toHaveBeenCalled();
	});

	it("validates and forwards paginated row list requests", async () => {
		const result = await listImportReviewRowsAction({
			organizationId: "org_1",
			batchId: "batch_1",
			status: "accepted",
			limit: 50,
			offset: 10,
		});

		expect(result).toEqual({ success: true, data: [{ id: "row_1" }] });
		expect(mockState.listImportReviewRows).toHaveBeenCalledWith({
			organizationId: "org_1",
			batchId: "batch_1",
			status: "accepted",
			limit: 50,
			offset: 10,
		});
	});

	it("rejects invalid row list bounds before querying", async () => {
		const result = await listImportReviewRowsAction({
			organizationId: "org_1",
			batchId: "batch_1",
			limit: 501,
			offset: 0,
		});

		expect(result).toEqual({ success: false, error: "Invalid import review page limit" });
		expect(mockState.listImportReviewRows).not.toHaveBeenCalled();
	});

	it("applies accepted or rejected decisions with bounded non-empty row IDs", async () => {
		const result = await applyImportDecisionAction({
			organizationId: "org_1",
			batchId: "batch_1",
			rowIds: ["row_1", "row_2"],
			decision: "accepted",
			reason: "Reviewed source records",
		});

		expect(result).toEqual({ success: true, data: { updatedCount: 2 } });
		expect(mockState.applyImportRowDecision).toHaveBeenCalledWith({
			organizationId: "org_1",
			batchId: "batch_1",
			rowIds: ["row_1", "row_2"],
			decision: "accepted",
			reason: "Reviewed source records",
			decidedBy: "user_1",
		});
	});

	it("rejects empty decisions before updating rows", async () => {
		const result = await applyImportDecisionAction({
			organizationId: "org_1",
			batchId: "batch_1",
			rowIds: [],
			decision: "rejected",
		});

		expect(result).toEqual({ success: false, error: "At least one import review row is required" });
		expect(mockState.applyImportRowDecision).not.toHaveBeenCalled();
	});

	it("returns rejected export CSV content and records the included row count", async () => {
		mockState.getImportReviewSummary.mockResolvedValue({
			totalRows: 20,
			acceptedRows: 10,
			rejectedRows: 7,
			blockedRows: 1,
			committedRows: 0,
			issueCount: 8,
		});

		const result = await exportRejectedRowsAction({ organizationId: "org_1", batchId: "batch_1" });

		expect(result).toEqual({
			success: true,
			data: {
				exportId: "export_1",
				fileName: "import-batch_1-rejected.csv",
				content:
					'id,entityType,providerSourceId,issueSeverity,decisionReason,normalizedPayload,sourcePayload\nrow_1,employee,provider_1,warning,Duplicate employee,"{""employeeNumber"":""E-1"",""name"":""Ada""}","{""id"":""provider_1""}"',
			},
		});
		expect(mockState.listRejectedImportReviewRowsForExport).toHaveBeenCalledWith({
			organizationId: "org_1",
			batchId: "batch_1",
		});
		expect(mockState.recordRejectedExport).toHaveBeenCalledWith({
			organizationId: "org_1",
			batchId: "batch_1",
			exportedBy: "user_1",
			rowCount: 1,
			fileName: "import-batch_1-rejected.csv",
		});
	});

	it("starts commit jobs for accepted rows and enqueues each job", async () => {
		const result = await startImportCommitAction({ organizationId: "org_1", batchId: "batch_1" });

		expect(result).toEqual({ success: true, data: { queuedCount: 2 } });
		expect(mockState.updateImportBatchStatus).toHaveBeenNthCalledWith(1, {
			organizationId: "org_1",
			batchId: "batch_1",
			status: "committing",
			expectedStatus: "needs_review",
		});
		expect(mockState.createCommitJobsForAcceptedRows).toHaveBeenCalledWith({
			organizationId: "org_1",
			batchId: "batch_1",
		});
		expect(mockState.enqueueImportCommitJob).toHaveBeenNthCalledWith(1, {
			type: "import-review-commit",
			organizationId: "org_1",
			batchId: "batch_1",
			jobId: "job_1",
			entityType: "employee",
			committedBy: "user_1",
		});
	});

	it("does not transition to committing when there are no accepted rows", async () => {
		mockState.createCommitJobsForAcceptedRows.mockResolvedValue([]);

		const result = await startImportCommitAction({ organizationId: "org_1", batchId: "batch_1" });

		expect(result).toEqual({
			success: false,
			error: "No accepted import review rows are available to commit",
		});
		expect(mockState.updateImportBatchStatus).not.toHaveBeenCalled();
		expect(mockState.enqueueImportCommitJob).not.toHaveBeenCalled();
	});

	it("does not mutate batch status when commit authorization fails", async () => {
		mockState.findMember.mockResolvedValue({ role: "member" });

		const result = await startImportCommitAction({ organizationId: "org_1", batchId: "batch_1" });

		expect(result).toEqual({ success: false, error: "Unauthorized" });
		expect(mockState.updateImportBatchStatus).not.toHaveBeenCalled();
		expect(mockState.createCommitJobsForAcceptedRows).not.toHaveBeenCalled();
	});

	it("marks commit_failed with a sanitized error when enqueue fails after committing starts", async () => {
		mockState.enqueueImportCommitJob.mockRejectedValueOnce(
			new Error("queue failed because secret token leaked"),
		);

		const result = await startImportCommitAction({ organizationId: "org_1", batchId: "batch_1" });

		expect(result).toEqual({ success: false, error: "queue failed because secret token leaked" });
		expect(mockState.updateImportBatchStatus).toHaveBeenLastCalledWith({
			organizationId: "org_1",
			batchId: "batch_1",
			status: "commit_failed",
			errorMessage: "queue failed because secret token leaked",
		});
	});
});

describe("import review repository decision safety", () => {
	async function importActualRepository() {
		vi.resetModules();
		vi.doUnmock("@/lib/import-review/repository");
		vi.doMock("@/db/schema", () => ({
			importBatch: {
				id: "importBatch.id",
				organizationId: "importBatch.organizationId",
				status: "importBatch.status",
			},
			importBatchJob: {},
			importIssue: {},
			importJobSecret: {},
			importRejectedExport: {},
			importStagedRow: {
				id: "importStagedRow.id",
				batchId: "importStagedRow.batchId",
				organizationId: "importStagedRow.organizationId",
				rowStatus: "importStagedRow.rowStatus",
				issueSeverity: "importStagedRow.issueSeverity",
			},
		}));
		return import("@/lib/import-review/repository");
	}

	beforeEach(() => {
		vi.clearAllMocks();
		mockState.findImportBatch.mockResolvedValue({ id: "batch_1", status: "needs_review" });
	});

	it("does not mutate committing rows when applying decisions", async () => {
		const selectWhere = vi.fn().mockResolvedValue([]);
		mockState.select.mockReturnValue({
			from: vi.fn().mockReturnValue({ where: selectWhere }),
		});
		mockState.update.mockReturnValue({
			set: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ returning: vi.fn() }) }),
		});

		const { applyImportRowDecision } = await importActualRepository();
		const result = await applyImportRowDecision({
			organizationId: "org_1",
			batchId: "batch_1",
			rowIds: ["row_committing"],
			decision: "rejected",
			decidedBy: "user_1",
		});

		expect(result).toEqual({ updatedCount: 0 });
		expect(mockState.update).not.toHaveBeenCalled();
		expect(selectWhere).toHaveBeenCalledWith(
			expect.objectContaining({
				and: expect.arrayContaining([
					expect.objectContaining({
						inArray: expect.arrayContaining([
							expect.anything(),
							["staged", "accepted", "rejected", "blocked", "needs_mapping"],
						]),
					}),
				]),
			}),
		);
	});

	it("does not mutate committed rows when applying decisions", async () => {
		mockState.select.mockReturnValue({
			from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
		});
		mockState.update.mockReturnValue({
			set: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ returning: vi.fn() }) }),
		});

		const { applyImportRowDecision } = await importActualRepository();
		const result = await applyImportRowDecision({
			organizationId: "org_1",
			batchId: "batch_1",
			rowIds: ["row_committed"],
			decision: "accepted",
			decidedBy: "user_1",
		});

		expect(result).toEqual({ updatedCount: 0 });
		expect(mockState.update).not.toHaveBeenCalled();
	});

	it("requires the batch to be in needs_review before applying decisions", async () => {
		mockState.findImportBatch.mockResolvedValue({ id: "batch_1", status: "committing" });

		const { applyImportRowDecision } = await importActualRepository();

		await expect(
			applyImportRowDecision({
				organizationId: "org_1",
				batchId: "batch_1",
				rowIds: ["row_1"],
				decision: "rejected",
				decidedBy: "user_1",
			}),
		).rejects.toThrow("Import batch is not ready for review decisions");
		expect(mockState.update).not.toHaveBeenCalled();
	});
});
