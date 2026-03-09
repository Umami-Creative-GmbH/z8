import { beforeEach, describe, expect, it, vi } from "vitest";
import { TRAVEL_EXPENSE_VALIDATION_MESSAGES } from "@/lib/travel-expenses/types";

const mockState = vi.hoisted(() => {
	const updateReturning = vi.fn();
	const updateWhere = vi.fn(() => ({ returning: updateReturning }));
	const updateSet = vi.fn(() => ({ where: updateWhere }));

	return {
		getAuthContext: vi.fn(),
		revalidatePath: vi.fn(),
		logAudit: vi.fn().mockResolvedValue(undefined),
		findClaim: vi.fn(),
		findEmployee: vi.fn(),
		dbUpdate: vi.fn(() => ({ set: updateSet })),
		updateSet,
		updateWhere,
		updateReturning,
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
	logAudit: mockState.logAudit,
}));

vi.mock("@/db/schema", () => ({
	travelExpenseClaim: {
		id: "id",
		organizationId: "organizationId",
		employeeId: "employeeId",
		status: "status",
		createdAt: "createdAt",
	},
	travelExpenseAttachment: {
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
				findFirst: mockState.findEmployee,
			},
		},
		update: mockState.dbUpdate,
		insert: vi.fn(),
	},
}));

const { submitTravelExpenseClaim } = await import("./actions");

describe("submitTravelExpenseClaim", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockState.getAuthContext.mockResolvedValue({
			user: { id: "user-1" },
			session: { activeOrganizationId: "org-1" },
			employee: {
				id: "emp-1",
				organizationId: "org-1",
				role: "employee",
				teamId: null,
			},
		});
	});

	it("succeeds and returns submitted status when manager exists", async () => {
		mockState.findClaim.mockResolvedValue({
			id: "claim-1",
			employeeId: "emp-1",
			organizationId: "org-1",
			status: "draft",
			type: "receipt",
			attachments: [{ id: "att-1" }],
		});
		mockState.findEmployee.mockResolvedValueOnce({ managerId: "manager-1" });
		mockState.updateReturning.mockResolvedValue([{ id: "claim-1" }]);

		const result = await submitTravelExpenseClaim({ claimId: "claim-1" });

		expect(result).toEqual({ success: true, data: { status: "submitted" } });
		expect(mockState.dbUpdate).toHaveBeenCalledTimes(1);
		expect(mockState.revalidatePath).toHaveBeenCalledWith("/travel-expenses");
		expect(mockState.logAudit).toHaveBeenCalledTimes(1);
	});

	it("fails for receipt claim without attachment", async () => {
		mockState.findClaim.mockResolvedValue({
			id: "claim-2",
			employeeId: "emp-1",
			organizationId: "org-1",
			status: "draft",
			type: "receipt",
			attachments: [],
		});

		const result = await submitTravelExpenseClaim({ claimId: "claim-2" });

		expect(result).toEqual({
			success: false,
			error: TRAVEL_EXPENSE_VALIDATION_MESSAGES.RECEIPT_ATTACHMENT_REQUIRED,
		});
		expect(mockState.dbUpdate).not.toHaveBeenCalled();
		expect(mockState.logAudit).not.toHaveBeenCalled();
	});
});
