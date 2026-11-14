/**
 * The time-entries table's approval adapter (#1678): what it asks the time
 * approval decision and how it translates the answer. The decision and the
 * work-period check run against PostgreSQL in
 * `approve-work-period.integration.test.ts`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TimeApprovalDecisionResult } from "@/lib/approvals/server/time-approval-decision";

const mockState = vi.hoisted(() => ({
	getCurrentSession: vi.fn(),
	getCurrentEmployee: vi.fn(),
	decideTimeApproval: vi.fn(),
	isTimeApprovalAboutWorkPeriod: vi.fn(),
	logger: { error: vi.fn() },
}));

vi.mock("@/db", () => ({ db: { name: "application-db" } }));
vi.mock("@/lib/approvals/server/time-approval-decision", () => ({
	decideTimeApproval: mockState.decideTimeApproval,
}));
vi.mock("@/lib/approvals/server/time-approval-work-period", () => ({
	isTimeApprovalAboutWorkPeriod: mockState.isTimeApprovalAboutWorkPeriod,
}));
vi.mock("./auth", () => ({
	getCurrentSession: mockState.getCurrentSession,
	getCurrentEmployee: mockState.getCurrentEmployee,
}));
vi.mock("./shared", () => ({ logger: mockState.logger }));
vi.mock("../actions", () => ({ updateWorkPeriodProject: vi.fn() }));
vi.mock("./work-period-split", () => ({ splitOwnWorkPeriod: vi.fn() }));

const { approveWorkPeriod } = await import("./mutations");

const REDACTED = {
	success: false,
	error: "Failed to approve work period. Please try again.",
};

function approve() {
	return approveWorkPeriod({ workPeriodId: "period-1", approvalRequestId: "approval-1" });
}

function refusedWith(reason: string) {
	mockState.decideTimeApproval.mockResolvedValue({
		status: "refused",
		reason,
	} as TimeApprovalDecisionResult);
}

describe("approveWorkPeriod", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockState.getCurrentSession.mockResolvedValue({ user: { id: "user-1" } });
		mockState.getCurrentEmployee.mockResolvedValue({ id: "employee-1", organizationId: "org-1" });
		mockState.isTimeApprovalAboutWorkPeriod.mockResolvedValue(true);
		mockState.decideTimeApproval.mockResolvedValue({
			status: "decided",
			kind: "manual_time_submission",
			workPeriodId: "period-1",
			outcome: "approved",
			replayed: false,
		} satisfies TimeApprovalDecisionResult);
	});

	it("approves as manager of approvals, for the signed-in employee in their organization", async () => {
		expect(await approve()).toEqual({ success: true, data: { workPeriodId: "period-1" } });
		expect(mockState.isTimeApprovalAboutWorkPeriod).toHaveBeenCalledWith(
			{ name: "application-db" },
			{ organizationId: "org-1", approvalId: "approval-1", workPeriodId: "period-1" },
		);
		expect(mockState.decideTimeApproval).toHaveBeenCalledWith({
			organizationId: "org-1",
			approvalId: "approval-1",
			actor: { employeeId: "employee-1", userId: "user-1" },
			right: { as: "approval_manager" },
			decision: { kind: "approve" },
		});
	});

	it("reports success when the approval only advanced to its next stage", async () => {
		mockState.decideTimeApproval.mockResolvedValue({
			status: "decided",
			kind: "policy_clock_out",
			workPeriodId: "period-1",
			outcome: "advanced",
			replayed: false,
		} satisfies TimeApprovalDecisionResult);

		expect(await approve()).toEqual({ success: true, data: { workPeriodId: "period-1" } });
	});

	it("refuses an approval about another work period before deciding", async () => {
		mockState.isTimeApprovalAboutWorkPeriod.mockResolvedValue(false);

		expect(await approve()).toEqual({ success: false, error: "Work period not found" });
		expect(mockState.decideTimeApproval).not.toHaveBeenCalled();
	});

	it("refuses someone who does not manage approvals with the table's missing-right message", async () => {
		refusedWith("right_not_held");

		expect(await approve()).toEqual({
			success: false,
			error: "You need the right to manage approvals to approve time entries",
			code: "AuthorizationError",
		});
	});

	it.each([
		["already_decided", "This approval has already been decided."],
		["changed", "This approval changed after it was loaded. Reload and try again."],
		[
			"evidence_required",
			"The evidence for this decision is incomplete. Review is required before a decision can be recorded.",
		],
		[
			"month_closed",
			"The month of this entry is closed. It must be reopened before its work can change.",
		],
	])("returns a %s refusal as the table's conflict result", async (reason, error) => {
		refusedWith(reason);

		expect(await approve()).toEqual({ success: false, error, code: "ConflictError" });
	});

	it.each(["not_found", "reassigned", "own_request", "unclassified", "guard_failed"])(
		"redacts a %s refusal",
		async (reason) => {
			refusedWith(reason);

			expect(await approve()).toEqual(REDACTED);
		},
	);

	it("redacts a failed decision", async () => {
		mockState.decideTimeApproval.mockRejectedValue(new Error("private connection detail"));

		expect(await approve()).toEqual(REDACTED);
		expect(mockState.logger.error).toHaveBeenCalled();
	});

	it("refuses without a session or an employee profile", async () => {
		mockState.getCurrentSession.mockResolvedValueOnce(null);
		expect(await approve()).toEqual({ success: false, error: "Not authenticated" });

		mockState.getCurrentEmployee.mockResolvedValueOnce(null);
		expect(await approve()).toEqual({ success: false, error: "Employee profile not found" });

		expect(mockState.decideTimeApproval).not.toHaveBeenCalled();
	});
});
