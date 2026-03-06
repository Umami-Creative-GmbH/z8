import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/[locale]/(app)/travel-expenses/actions", () => ({
	getTravelExpenseApprovalQueue: vi.fn(),
	approveTravelExpenseClaim: vi.fn(),
	rejectTravelExpenseClaim: vi.fn(),
}));

vi.mock("@/lib/query/keys", () => ({
	queryKeys: {
		travelExpenses: {
			approvals: vi.fn(() => ["travel-expenses", "approvals"]),
			list: vi.fn(() => ["travel-expenses", "list"]),
			detail: vi.fn(() => ["travel-expenses", "detail"]),
		},
	},
}));

const { canDecideClaim } = await import("./travel-expense-approval-queue");

describe("canDecideClaim", () => {
	it("returns true for manager assigned to claim", () => {
		expect(canDecideClaim("manager", "manager-1", "manager-1")).toBe(true);
	});

	it("returns false for manager when claim is unassigned", () => {
		expect(canDecideClaim("manager", null, "manager-1")).toBe(false);
	});

	it("returns true for admin regardless of approver", () => {
		expect(canDecideClaim("admin", null, "admin-1")).toBe(true);
	});
});
