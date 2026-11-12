import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StubCaller } from "@/test/organization-action";

const mocks = vi.hoisted(() => ({
	caller: null as StubCaller | null,
	db: { name: "scoped-db" },
	recordOvertimePayout: vi.fn(),
	setOpeningBalance: vi.fn(),
	cancelBalanceAdjustment: vi.fn(),
	listBalanceAdjustments: vi.fn(),
	loadWorkBalanceEmployee: vi.fn(),
	getEmployeeWorkBalance: vi.fn(),
	revalidateWorkBalancePaths: vi.fn(),
}));

vi.mock("@/lib/effect/runtime", async () => {
	const { runtimeModuleOver } = await import("@/test/effect-runtime");
	const { organizationActionStubLayer } = await import("@/test/organization-action");
	return runtimeModuleOver(organizationActionStubLayer(() => mocks.caller, { db: mocks.db }));
});
vi.mock("@/lib/audit-trail", () => ({
	withAuditTrail: (write: (audit: unknown) => unknown) => write({ name: "audit" }),
}));
vi.mock("@/lib/work-balance/adjustments/store", () => ({
	recordOvertimePayout: mocks.recordOvertimePayout,
	setOpeningBalance: mocks.setOpeningBalance,
	cancelBalanceAdjustment: mocks.cancelBalanceAdjustment,
	listBalanceAdjustments: mocks.listBalanceAdjustments,
}));
vi.mock("@/lib/work-balance/service", () => ({
	loadWorkBalanceEmployee: mocks.loadWorkBalanceEmployee,
	getEmployeeWorkBalance: mocks.getEmployeeWorkBalance,
}));
vi.mock("./work-balance-paths", () => ({
	revalidateWorkBalancePaths: mocks.revalidateWorkBalancePaths,
}));

const { BalanceAdjustmentRefusal } = await import("@/lib/work-balance/adjustments/types");
const actions = await import("./work-balance-actions");

const EMPLOYEE_ID = "7d3c8f8e-2b7a-4f7e-9a51-0d6f1c2b3a4e";
const ADJUSTMENT_ID = "1f0d2c3b-4a59-4e68-8f7a-6b5c4d3e2f10";

const orgAdmin: StubCaller = {
	userId: "admin-user",
	activeOrganizationId: "org-1",
	membershipRole: "admin",
	employee: null,
};
/** One level below an org member: a membership that is not approved yet. */
const pendingMember: StubCaller = {
	userId: "pending-user",
	activeOrganizationId: "org-1",
	membershipRole: null,
	employee: null,
};

const payout = {
	employeeId: EMPLOYEE_ID,
	day: "2026-05-04",
	hours: 2,
	minutes: 30,
	reason: "Paid in May",
};

describe("work balance actions (#993, #1613)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.caller = orgAdmin;
		mocks.loadWorkBalanceEmployee.mockResolvedValue({ timezone: "Europe/Berlin" });
		mocks.getEmployeeWorkBalance.mockResolvedValue(null);
		mocks.listBalanceAdjustments.mockResolvedValue([]);
	});

	it("records an org admin's payout in the session's organization", async () => {
		mocks.recordOvertimePayout.mockResolvedValue({ adjustmentId: ADJUSTMENT_ID });

		await expect(actions.recordOvertimePayoutAction(payout)).resolves.toEqual({
			success: true,
			data: { adjustmentId: ADJUSTMENT_ID },
		});
		expect(mocks.recordOvertimePayout).toHaveBeenCalledWith(
			mocks.db,
			{ name: "audit" },
			expect.objectContaining({
				organizationId: "org-1",
				actorUserId: "admin-user",
				employeeId: EMPLOYEE_ID,
				amountMinutes: 150,
				auditMetadata: null,
			}),
		);
		expect(mocks.revalidateWorkBalancePaths).toHaveBeenCalledWith([EMPLOYEE_ID]);
	});

	it("shows an org admin the section with canManage", async () => {
		await expect(
			actions.getEmployeeWorkBalanceSectionAction({ employeeId: EMPLOYEE_ID }),
		).resolves.toMatchObject({
			success: true,
			data: { adjustments: [], timezone: "Europe/Berlin", canManage: true },
		});
		expect(mocks.listBalanceAdjustments).toHaveBeenCalledWith(mocks.db, {
			organizationId: "org-1",
			employeeId: EMPLOYEE_ID,
		});
	});

	it("sets and cancels for an org admin", async () => {
		mocks.setOpeningBalance.mockResolvedValue({
			adjustmentId: ADJUSTMENT_ID,
			cancelledAdjustmentId: null,
		});
		mocks.cancelBalanceAdjustment.mockResolvedValue({ adjustmentId: ADJUSTMENT_ID });

		await expect(
			actions.setOpeningBalanceAction({ ...payout, negative: true }),
		).resolves.toMatchObject({ success: true });
		expect(mocks.setOpeningBalance).toHaveBeenCalledWith(
			mocks.db,
			expect.anything(),
			expect.objectContaining({ minutes: -150, organizationId: "org-1" }),
		);
		await expect(
			actions.cancelBalanceAdjustmentAction({
				employeeId: EMPLOYEE_ID,
				adjustmentId: ADJUSTMENT_ID,
				reason: "Wrong month",
			}),
		).resolves.toMatchObject({ success: true });
	});

	it("refuses a pending membership, one level below an org member, before any read or write", async () => {
		mocks.caller = pendingMember;

		for (const result of [
			await actions.getEmployeeWorkBalanceSectionAction({ employeeId: EMPLOYEE_ID }),
			await actions.recordOvertimePayoutAction(payout),
			await actions.setOpeningBalanceAction({ ...payout, negative: false }),
			await actions.cancelBalanceAdjustmentAction({
				employeeId: EMPLOYEE_ID,
				adjustmentId: ADJUSTMENT_ID,
				reason: "No",
			}),
		]) {
			expect(result).toMatchObject({ success: false, code: "AuthorizationError" });
		}
		expect(mocks.listBalanceAdjustments).not.toHaveBeenCalled();
		expect(mocks.recordOvertimePayout).not.toHaveBeenCalled();
		expect(mocks.setOpeningBalance).not.toHaveBeenCalled();
		expect(mocks.cancelBalanceAdjustment).not.toHaveBeenCalled();
	});

	it("returns a store refusal with its code and details", async () => {
		const conflictingPayouts = [{ id: ADJUSTMENT_ID, day: "2026-05-04", minutes: -60 }];
		mocks.setOpeningBalance.mockRejectedValue(
			new BalanceAdjustmentRefusal("conflicting_payouts", "Payouts conflict", {
				conflictingPayouts,
			}),
		);

		await expect(actions.setOpeningBalanceAction({ ...payout, negative: false })).resolves.toEqual({
			success: false,
			error: "Payouts conflict",
			code: "ValidationError",
			refusal: "conflicting_payouts",
			details: { conflictingPayouts },
		});
	});

	it("refuses an employee id that is not a UUID without calling the store", async () => {
		await expect(
			actions.recordOvertimePayoutAction({ ...payout, employeeId: "nope" }),
		).resolves.toMatchObject({ success: false, code: "ValidationError" });
		expect(mocks.recordOvertimePayout).not.toHaveBeenCalled();
	});
});
