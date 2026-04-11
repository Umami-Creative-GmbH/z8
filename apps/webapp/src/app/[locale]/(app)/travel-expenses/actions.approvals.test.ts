import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => {
	const updateReturning = vi.fn();
	const updateWhere = vi.fn(() => ({ returning: updateReturning }));
	const updateSet = vi.fn(() => ({ where: updateWhere }));
	const insertValues = vi.fn();

	return {
		getAuthContext: vi.fn(),
		revalidatePath: vi.fn(),
		findClaim: vi.fn(),
		dbUpdate: vi.fn(() => ({ set: updateSet })),
		dbInsert: vi.fn(() => ({ values: insertValues })),
		updateReturning,
		insertValues,
	};
});

vi.mock("drizzle-orm", () => ({
	and: vi.fn((...args: unknown[]) => ({ and: args })),
	eq: vi.fn((left: unknown, right: unknown) => ({ eq: [left, right] })),
	asc: vi.fn((value: unknown) => ({ asc: value })),
	desc: vi.fn((value: unknown) => ({ desc: value })),
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

const processApproval = vi.fn();

vi.mock("@/lib/approvals/server/shared", () => ({
	processApproval,
}));

vi.mock("@/db/schema", () => ({
	travelExpenseClaim: {
		id: "id",
		organizationId: "organizationId",
		status: "status",
		approverId: "approverId",
		submittedAt: "submittedAt",
		createdAt: "createdAt",
	},
	travelExpenseAttachment: {
		id: "id",
	},
	travelExpenseDecisionLog: {
		id: "id",
	},
	employee: {
		id: "id",
		organizationId: "organizationId",
		role: "role",
		isActive: "isActive",
		createdAt: "createdAt",
	},
}));

vi.mock("@/db", () => ({
	db: {
		query: {
			travelExpenseClaim: {
				findFirst: mockState.findClaim,
				findMany: vi.fn(),
			},
			employee: {
				findFirst: vi.fn(),
			},
		},
		update: mockState.dbUpdate,
		insert: mockState.dbInsert,
	},
}));

const { approveTravelExpenseClaim, rejectTravelExpenseClaim } = await import("./actions");

describe("travel expense approvals", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockState.getAuthContext.mockResolvedValue({
			user: { id: "user-1" },
			session: { activeOrganizationId: "org-1" },
			employee: {
				id: "manager-1",
				organizationId: "org-1",
				role: "manager",
				teamId: null,
			},
		});
		mockState.insertValues.mockResolvedValue(undefined);
	});

	it("approve succeeds for manager when claim is assigned and submitted", async () => {
		processApproval.mockResolvedValue({ success: true, data: undefined });

		const result = await approveTravelExpenseClaim({ claimId: "claim-1", note: "Looks good" });

		expect(result).toEqual({ success: true, data: { status: "approved" } });
		expect(processApproval).toHaveBeenCalledWith(
			"travel_expense_claim",
			"claim-1",
			"approve",
			undefined,
			expect.any(Function),
			expect.any(Function),
			{ transactional: true },
		);
		expect(mockState.dbUpdate).not.toHaveBeenCalled();
		expect(mockState.dbInsert).not.toHaveBeenCalled();
	});

	it("reject fails for manager when claim approverId differs", async () => {
		processApproval.mockResolvedValue({ success: false, error: "Unauthorized" });

		const result = await rejectTravelExpenseClaim({ claimId: "claim-2", reason: "Missing receipt" });

		expect(result).toEqual({ success: false, error: "Unauthorized" });
		expect(processApproval).toHaveBeenCalledWith(
			"travel_expense_claim",
			"claim-2",
			"reject",
			"Missing receipt",
			expect.any(Function),
			expect.any(Function),
			{ transactional: true },
		);
		expect(mockState.dbUpdate).not.toHaveBeenCalled();
		expect(mockState.dbInsert).not.toHaveBeenCalled();
		expect(mockState.revalidatePath).not.toHaveBeenCalled();
	});
});
