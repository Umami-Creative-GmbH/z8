import { Effect } from "effect-v3";
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
}));

vi.mock("server-only", () => ({}));
vi.mock("@/app/[locale]/(app)/time-tracking/actions/shared", () => ({
	logger: { error: state.logError },
}));
vi.mock("@/lib/approvals/policies/manager-eligibility-db", () => ({
	getEligibleManagerIdsForRequester: state.eligibleManagerIds,
	isEligibleManagerForApprovalRequest: state.isEligibleForRequest,
}));
vi.mock("@/lib/approvals/server/time-correction-approvals", () => ({
	decideTimeCorrectionWithStableTargetEffect: state.decide,
}));

const {
	approveOnBehalfCorrectionAsEditor,
	isEditorCurrentCorrectionApprover,
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

describe("isEditorCurrentCorrectionApprover", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		state.isEligibleForRequest.mockResolvedValue(false);
	});

	it("accepts the legacy request's approver or one of its eligible managers", async () => {
		state.approvalRequestFindFirst.mockResolvedValue({
			id: "request-1",
			approverId: "employee-manager",
		});
		await expect(isEditorCurrentCorrectionApprover({ db: db as never, ...base })).resolves.toBe(
			true,
		);

		state.approvalRequestFindFirst.mockResolvedValue({
			id: "request-1",
			approverId: "employee-other-manager",
		});
		await expect(isEditorCurrentCorrectionApprover({ db: db as never, ...base })).resolves.toBe(
			false,
		);
		state.isEligibleForRequest.mockResolvedValue(true);
		await expect(isEditorCurrentCorrectionApprover({ db: db as never, ...base })).resolves.toBe(
			true,
		);
	});

	it("uses the pending canonical assignment when no legacy request exists", async () => {
		state.approvalRequestFindFirst.mockResolvedValue(undefined);
		state.approvalWorkflowFindFirst.mockResolvedValue({ id: "workflow-1" });
		state.assignmentFindFirst.mockResolvedValue({ id: "assignment-1" });
		await expect(isEditorCurrentCorrectionApprover({ db: db as never, ...base })).resolves.toBe(
			true,
		);

		state.assignmentFindFirst.mockResolvedValue(undefined);
		await expect(isEditorCurrentCorrectionApprover({ db: db as never, ...base })).resolves.toBe(
			false,
		);
	});
});

describe("approveOnBehalfCorrectionAsEditor", () => {
	const editor = {
		id: "employee-manager",
		userId: "user-manager",
		organizationId: "org-1",
		user: { id: "user-manager", name: "John Doe" },
	};

	beforeEach(() => {
		vi.clearAllMocks();
		state.isEligibleForRequest.mockResolvedValue(false);
		state.employeeFindFirst.mockResolvedValue(editor);
		state.decide.mockReturnValue(Effect.void);
	});

	it("decides the stage as the editor and reports the applied change", async () => {
		state.approvalRequestFindFirst
			.mockResolvedValueOnce({ id: "request-1", approverId: "employee-manager" })
			.mockResolvedValue(undefined);
		state.approvalWorkflowFindFirst.mockResolvedValue(undefined);

		await expect(
			approveOnBehalfCorrectionAsEditor({ dbService: { db } as never, ...base }),
		).resolves.toBe("approved");
		expect(state.decide).toHaveBeenCalledWith({ db }, editor, "request-1", "approve");
	});

	it("reports pending when a later chain stage still waits", async () => {
		state.approvalRequestFindFirst
			.mockResolvedValueOnce({ id: "request-1", approverId: "employee-manager" })
			.mockResolvedValue({ id: "request-2" });

		await expect(
			approveOnBehalfCorrectionAsEditor({ dbService: { db } as never, ...base }),
		).resolves.toBe("pending");
		expect(state.decide).toHaveBeenCalledOnce();
	});

	it("leaves the change to the configured approver when the editor is not one", async () => {
		state.approvalRequestFindFirst.mockResolvedValue({
			id: "request-1",
			approverId: "employee-other-manager",
		});

		await expect(
			approveOnBehalfCorrectionAsEditor({ dbService: { db } as never, ...base }),
		).resolves.toBe("pending");
		expect(state.decide).not.toHaveBeenCalled();
	});

	it("keeps the submission pending when the editor's decision fails", async () => {
		state.approvalRequestFindFirst.mockResolvedValue({
			id: "request-1",
			approverId: "employee-manager",
		});
		state.decide.mockReturnValue(Effect.fail(new Error("stale")));

		await expect(
			approveOnBehalfCorrectionAsEditor({ dbService: { db } as never, ...base }),
		).resolves.toBe("pending");
		expect(state.logError).toHaveBeenCalledOnce();
	});
});
