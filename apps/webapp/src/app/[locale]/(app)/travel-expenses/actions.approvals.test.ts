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
		mockState.findClaim.mockResolvedValue({
			id: "claim-1",
			organizationId: "org-1",
			status: "submitted",
			approverId: "manager-1",
		});
		mockState.updateReturning.mockResolvedValue([{ id: "claim-1" }]);

		const result = await approveTravelExpenseClaim({ claimId: "claim-1", note: "Looks good" });

		expect(result).toEqual({ success: true, data: { status: "approved" } });
		expect(mockState.dbUpdate).toHaveBeenCalledTimes(1);
		expect(mockState.dbInsert).toHaveBeenCalledTimes(1);
		expect(mockState.insertValues).toHaveBeenCalledWith(
			expect.objectContaining({
				organizationId: "org-1",
				claimId: "claim-1",
				actorEmployeeId: "manager-1",
				approverId: "manager-1",
				action: "approved",
				comment: "Looks good",
			}),
		);
		expect(mockState.revalidatePath).toHaveBeenCalledWith("/travel-expenses");
	});

	it("reject fails for manager when claim approverId differs", async () => {
		mockState.findClaim.mockResolvedValue({
			id: "claim-2",
			organizationId: "org-1",
			status: "submitted",
			approverId: "manager-2",
		});

		const result = await rejectTravelExpenseClaim({ claimId: "claim-2", reason: "Missing receipt" });

		expect(result).toEqual({ success: false, error: "Unauthorized" });
		expect(mockState.dbUpdate).not.toHaveBeenCalled();
		expect(mockState.dbInsert).not.toHaveBeenCalled();
		expect(mockState.revalidatePath).not.toHaveBeenCalled();
	});
});
