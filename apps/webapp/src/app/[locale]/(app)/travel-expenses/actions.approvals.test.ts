import { Effect } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
	getAuthContext: vi.fn(),
	revalidatePath: vi.fn(),
	dbUpdate: vi.fn(),
	dbInsert: vi.fn(),
	decide: vi.fn(),
	loadApprover: vi.fn(),
	databaseService: { db: { marker: "db" }, query: vi.fn() },
}));

vi.mock("next/cache", () => ({
	revalidatePath: mockState.revalidatePath,
}));

vi.mock("@/lib/auth-helpers", () => ({
	getAuthContext: mockState.getAuthContext,
}));

vi.mock("@/lib/audit-logger", () => ({
	AuditAction: {
		TRAVEL_EXPENSE_DRAFT_CREATED: "travel_expense.draft_created",
		TRAVEL_EXPENSE_SUBMITTED: "travel_expense.submitted",
	},
	logAudit: vi.fn().mockResolvedValue(undefined),
}));

// Every expense decision goes through the single decision owner (#296); its
// replay, holds, evidence and delivery run against PostgreSQL in
// lib/travel-expenses/expense-review-decision.integration.test.ts.
vi.mock("@/lib/approvals/server/travel-expense-approvals", () => ({
	createTravelExpenseApprovalWorkflow: vi.fn(),
	decideTravelExpenseClaimEffect: mockState.decide,
	loadTravelExpenseApprover: mockState.loadApprover,
}));

vi.mock("@/lib/effect/services/database.service", async () => {
	const { Context } = await import("effect");
	return { DatabaseService: Context.GenericTag<unknown>("DatabaseService") };
});

vi.mock("@/lib/effect/runtime", async () => {
	const { Context, Layer } = await import("effect");
	return {
		AppLayer: Layer.succeed(
			Context.GenericTag<unknown>("DatabaseService"),
			mockState.databaseService,
		),
	};
});

vi.mock("@/lib/effect/result", async () => {
	const { Cause, Effect, Exit, Option } = await import("effect");
	return {
		runServerActionSafe: async (effect: Effect.Effect<unknown, unknown, never>) => {
			const exit = await Effect.runPromiseExit(effect);
			if (Exit.isSuccess(exit)) return { success: true, data: exit.value };
			const failure = Option.getOrNull(Cause.failureOption(exit.cause)) as {
				message: string;
				_tag: string;
			};
			return { success: false, error: failure.message, code: failure._tag };
		},
	};
});

vi.mock("@/db", () => ({
	db: {
		query: {},
		update: mockState.dbUpdate,
		insert: mockState.dbInsert,
	},
}));

const { approveTravelExpenseClaim, rejectTravelExpenseClaim } = await import("./actions");

function authAs(employeeId: string, role: "manager" | "employee") {
	mockState.getAuthContext.mockResolvedValue({
		user: { id: `user-${employeeId}` },
		session: { activeOrganizationId: "org-1" },
		employee: { id: employeeId, organizationId: "org-1", role, teamId: null },
	});
}

function approver(employeeId: string) {
	return {
		id: employeeId,
		userId: `user-${employeeId}`,
		organizationId: "org-1",
		user: { id: `user-${employeeId}`, name: "Approver", email: "a@example.com", image: null },
	};
}

describe("travel expense approvals", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		authAs("manager-1", "manager");
		mockState.loadApprover.mockImplementation((_service: unknown, id: string) =>
			Effect.succeed(approver(id)),
		);
		mockState.decide.mockReturnValue(
			Effect.succeed({ kind: "decided", evidence: null, approvalRequestId: "request-1" }),
		);
	});

	it("approves as the session's employee through the decision owner", async () => {
		const result = await approveTravelExpenseClaim({ claimId: "claim-1", note: "Looks good" });

		expect(result).toEqual({ success: true, data: { status: "approved" } });
		expect(mockState.loadApprover).toHaveBeenCalledWith(mockState.databaseService, "manager-1");
		expect(mockState.decide).toHaveBeenCalledWith(
			mockState.databaseService,
			approver("manager-1"),
			{ claimId: "claim-1", action: "approve", note: "Looks good" },
		);
		// The owner writes; the action itself never touches claim rows.
		expect(mockState.dbUpdate).not.toHaveBeenCalled();
		expect(mockState.dbInsert).not.toHaveBeenCalled();
		expect(mockState.revalidatePath).toHaveBeenCalledWith("/travel-expenses");
	});

	it("rejects with the reason through the decision owner", async () => {
		authAs("employee-approver-1", "employee");

		const result = await rejectTravelExpenseClaim({
			claimId: "claim-1",
			reason: "Missing receipt",
		});

		expect(result).toEqual({ success: true, data: { status: "rejected" } });
		expect(mockState.decide).toHaveBeenCalledWith(
			mockState.databaseService,
			approver("employee-approver-1"),
			{ claimId: "claim-1", action: "reject", reason: "Missing receipt" },
		);
		expect(mockState.revalidatePath).toHaveBeenCalledWith("/travel-expenses");
	});

	it("returns the owner's refusal unchanged and revalidates nothing", async () => {
		const { AuthorizationError, ConflictError } = await import("@/lib/effect/errors");
		mockState.decide.mockReturnValueOnce(
			Effect.fail(new AuthorizationError({ message: "Unauthorized" })),
		);
		expect(await approveTravelExpenseClaim({ claimId: "claim-1" })).toMatchObject({
			success: false,
			error: "Unauthorized",
		});
		mockState.decide.mockReturnValueOnce(
			Effect.fail(
				new ConflictError({
					message: "This claim changed after it was submitted.",
					conflictType: "approval_evidence",
				}),
			),
		);
		expect(await rejectTravelExpenseClaim({ claimId: "claim-1", reason: "No" })).toMatchObject({
			success: false,
			code: "ConflictError",
		});
		expect(mockState.revalidatePath).not.toHaveBeenCalled();
	});

	it("refuses without an employee context before deciding anything", async () => {
		mockState.getAuthContext.mockResolvedValue(null);
		expect(await approveTravelExpenseClaim({ claimId: "claim-1" })).toEqual({
			success: false,
			error: "Unauthorized",
		});
		expect(mockState.decide).not.toHaveBeenCalled();
	});
});
