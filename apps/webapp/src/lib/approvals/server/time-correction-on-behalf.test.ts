import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	eligibleManagerIds: vi.fn(),
	isEligibleForRequest: vi.fn(),
	decide: vi.fn(),
	approvalRequestFindFirst: vi.fn(),
	approvalWorkflowFindFirst: vi.fn(),
	assignmentFindFirst: vi.fn(),
	employeeFindFirst: vi.fn(),
	logError: vi.fn(),
	logWarn: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/app/[locale]/(app)/time-tracking/actions/shared", () => ({
	logger: { error: state.logError, warn: state.logWarn },
}));
vi.mock("@/lib/approvals/policies/manager-eligibility-db", () => ({
	getEligibleManagerIdsForRequester: state.eligibleManagerIds,
	isEligibleManagerForApprovalRequest: state.isEligibleForRequest,
}));
vi.mock("@/lib/approvals/server/time-approval-decision", () => ({
	decideTimeApproval: state.decide,
}));

const {
	approveOnBehalfCorrectionAsEditor,
	resolveEditorDecisionClaim,
	resolveOnBehalfCorrectionAuthority,
} = await import("./time-correction-on-behalf");

const db = {
	query: {
		approvalRequest: { findFirst: state.approvalRequestFindFirst },
		approvalWorkflow: { findFirst: state.approvalWorkflowFindFirst },
		approvalStageAssignment: { findFirst: state.assignmentFindFirst },
		employee: { findFirst: state.employeeFindFirst },
	},
};

const base = {
	organizationId: "org-1",
	workPeriodId: "period-1",
	approvalRequestId: "request-1",
	editorEmployeeId: "employee-manager",
};

describe("resolveOnBehalfCorrectionAuthority", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		state.eligibleManagerIds.mockResolvedValue(["employee-manager"]);
	});

	const input = {
		db: db as never,
		organizationId: "org-1",
		actorEmployeeId: "employee-manager",
		actorMemberRole: "member",
		ownerEmployeeId: "employee-owner",
	};

	it("grants organization admins and owners", async () => {
		await expect(
			resolveOnBehalfCorrectionAuthority({ ...input, actorMemberRole: "admin" }),
		).resolves.toBe("organization_admin");
		await expect(
			resolveOnBehalfCorrectionAuthority({ ...input, actorMemberRole: "owner" }),
		).resolves.toBe("organization_admin");
		expect(state.eligibleManagerIds).not.toHaveBeenCalled();
	});

	it("grants the owner's eligible managers", async () => {
		await expect(resolveOnBehalfCorrectionAuthority(input)).resolves.toBe("eligible_manager");
		expect(state.eligibleManagerIds).toHaveBeenCalledWith(
			expect.objectContaining({
				requesterEmployeeId: "employee-owner",
				organizationId: "org-1",
			}),
		);
	});

	it("refuses other members and self-service through this path", async () => {
		state.eligibleManagerIds.mockResolvedValue(["employee-someone-else"]);
		await expect(resolveOnBehalfCorrectionAuthority(input)).resolves.toBeNull();
		await expect(
			resolveOnBehalfCorrectionAuthority({
				...input,
				actorMemberRole: "admin",
				ownerEmployeeId: "employee-manager",
			}),
		).resolves.toBeNull();
	});
});

describe("resolveEditorDecisionClaim", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		state.isEligibleForRequest.mockResolvedValue(false);
	});

	it("claims approver for the legacy request's approver", async () => {
		state.approvalRequestFindFirst.mockResolvedValue({
			id: "request-1",
			approverId: "employee-manager",
		});
		await expect(resolveEditorDecisionClaim({ db: db as never, ...base })).resolves.toEqual({
			approvalId: "request-1",
			right: { as: "approver" },
		});
	});

	it("claims eligible manager for an eligible manager of the legacy request", async () => {
		state.approvalRequestFindFirst.mockResolvedValue({
			id: "request-1",
			approverId: "employee-other-manager",
		});
		state.isEligibleForRequest.mockResolvedValue(true);
		await expect(resolveEditorDecisionClaim({ db: db as never, ...base })).resolves.toEqual({
			approvalId: "request-1",
			right: { as: "eligible_manager" },
		});
	});

	it("claims nothing for an editor who is neither, such as an organization admin", async () => {
		state.approvalRequestFindFirst.mockResolvedValue({
			id: "request-1",
			approverId: "employee-other-manager",
		});
		await expect(resolveEditorDecisionClaim({ db: db as never, ...base })).resolves.toBeNull();
	});

	it("claims approver on the editor's own pending canonical assignment", async () => {
		state.approvalRequestFindFirst.mockResolvedValue(undefined);
		state.approvalWorkflowFindFirst.mockResolvedValue({ id: "workflow-1" });
		state.assignmentFindFirst.mockResolvedValue({ id: "assignment-editor" });
		await expect(resolveEditorDecisionClaim({ db: db as never, ...base })).resolves.toEqual({
			approvalId: "assignment-editor",
			right: { as: "approver" },
		});

		state.assignmentFindFirst.mockResolvedValue(undefined);
		await expect(resolveEditorDecisionClaim({ db: db as never, ...base })).resolves.toBeNull();
	});
});

describe("approveOnBehalfCorrectionAsEditor", () => {
	const decided = (outcome: "approved" | "advanced") => ({
		status: "decided",
		kind: "time_correction",
		workPeriodId: "period-1",
		outcome,
		replayed: false,
	});

	beforeEach(() => {
		vi.clearAllMocks();
		state.isEligibleForRequest.mockResolvedValue(false);
		state.employeeFindFirst.mockResolvedValue({ id: "employee-manager", userId: "user-manager" });
		state.approvalRequestFindFirst.mockResolvedValue({
			id: "request-1",
			approverId: "employee-manager",
		});
		state.decide.mockResolvedValue(decided("approved"));
	});

	it("decides as the claimed right and reports an approved correction", async () => {
		await expect(
			approveOnBehalfCorrectionAsEditor({ dbService: { db } as never, ...base }),
		).resolves.toBe("approved");
		expect(state.decide).toHaveBeenCalledWith({
			organizationId: "org-1",
			approvalId: "request-1",
			actor: { employeeId: "employee-manager", userId: "user-manager" },
			right: { as: "approver" },
			decision: { kind: "approve" },
			database: db,
		});
	});

	it("claims eligible manager, never manager of approvals", async () => {
		state.approvalRequestFindFirst.mockResolvedValue({
			id: "request-1",
			approverId: "employee-other-manager",
		});
		state.isEligibleForRequest.mockResolvedValue(true);

		await approveOnBehalfCorrectionAsEditor({ dbService: { db } as never, ...base });
		expect(state.decide).toHaveBeenCalledWith(
			expect.objectContaining({ right: { as: "eligible_manager" } }),
		);
	});

	it("reports pending when a later chain stage still waits", async () => {
		state.decide.mockResolvedValue(decided("advanced"));
		await expect(
			approveOnBehalfCorrectionAsEditor({ dbService: { db } as never, ...base }),
		).resolves.toBe("pending");
	});

	it("leaves the change to the chain when the editor claims no right", async () => {
		state.approvalRequestFindFirst.mockResolvedValue({
			id: "request-1",
			approverId: "employee-other-manager",
		});
		await expect(
			approveOnBehalfCorrectionAsEditor({ dbService: { db } as never, ...base }),
		).resolves.toBe("pending");
		expect(state.decide).not.toHaveBeenCalled();
	});

	it("keeps the correction pending on a refusal and claims no other right", async () => {
		state.decide.mockResolvedValue({ status: "refused", reason: "reassigned" });
		await expect(
			approveOnBehalfCorrectionAsEditor({ dbService: { db } as never, ...base }),
		).resolves.toBe("pending");
		expect(state.decide).toHaveBeenCalledOnce();
		expect(state.logWarn).toHaveBeenCalledOnce();
	});

	it("keeps the submission pending when the decision fails", async () => {
		state.decide.mockRejectedValue(new Error("connection lost"));
		await expect(
			approveOnBehalfCorrectionAsEditor({ dbService: { db } as never, ...base }),
		).resolves.toBe("pending");
		expect(state.logError).toHaveBeenCalledOnce();
	});
});
