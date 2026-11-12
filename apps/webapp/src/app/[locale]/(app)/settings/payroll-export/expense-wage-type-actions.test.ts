import { beforeEach, describe, expect, it, vi } from "vitest";
import { EMPTY_EXPENSE_WAGE_TYPE_CODES } from "@/lib/payroll-export/expense-wage-type.types";
import { PAYROLL_LINE_KINDS } from "@/lib/travel-expenses/payroll-line-kind";
import type { StubCaller } from "@/test/organization-action";

const mocks = vi.hoisted(() => ({
	caller: null as StubCaller | null,
	getReimbursementChannel: vi.fn(),
	getExpenseWageTypeMappings: vi.fn(),
	saveExpenseWageTypeMapping: vi.fn(),
	revalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/effect/runtime", async () => {
	const { runtimeModuleOver } = await import("@/test/effect-runtime");
	const { organizationActionStubLayer } = await import("@/test/organization-action");
	return runtimeModuleOver(organizationActionStubLayer(() => mocks.caller));
});
vi.mock("@/lib/travel-expenses/reimbursement-channel", () => ({
	getReimbursementChannel: mocks.getReimbursementChannel,
}));
vi.mock("@/lib/payroll-export/expense-wage-type", () => ({
	getExpenseWageTypeMappings: mocks.getExpenseWageTypeMappings,
	saveExpenseWageTypeMapping: mocks.saveExpenseWageTypeMapping,
}));

const { getExpenseWageTypeSetting, saveExpenseWageTypeSetting } = await import(
	"./expense-wage-type-actions"
);

const admin: StubCaller = {
	userId: "user-1",
	activeOrganizationId: "org-1",
	membershipRole: "owner",
	employee: null,
};
const scopedManager: StubCaller = {
	userId: "user-2",
	activeOrganizationId: "org-1",
	membershipRole: "member",
	employee: { id: "employee-2", role: "manager", former: false },
};
const unmapped = PAYROLL_LINE_KINDS.map((kind) => ({
	kind,
	codes: EMPTY_EXPENSE_WAGE_TYPE_CODES,
}));

describe("expense wage type actions (#851)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.caller = admin;
		mocks.getReimbursementChannel.mockResolvedValue("payroll_run");
		mocks.getExpenseWageTypeMappings.mockResolvedValue(unmapped);
	});

	it("refuses a scoped manager without reading or saving mappings", async () => {
		mocks.caller = scopedManager;

		expect(await getExpenseWageTypeSetting()).toMatchObject({
			success: false,
			code: "AuthorizationError",
		});
		expect(
			await saveExpenseWageTypeSetting({
				kind: "receipt_meals",
				codes: EMPTY_EXPENSE_WAGE_TYPE_CODES,
			}),
		).toMatchObject({ success: false, code: "AuthorizationError" });
		expect(mocks.getExpenseWageTypeMappings).not.toHaveBeenCalled();
		expect(mocks.saveExpenseWageTypeMapping).not.toHaveBeenCalled();
	});

	it("reads the active organization's channel and mappings", async () => {
		mocks.getReimbursementChannel.mockResolvedValue("bank_transfer");

		expect(await getExpenseWageTypeSetting()).toEqual({
			success: true,
			data: { channel: "bank_transfer", mappings: unmapped },
		});
		expect(mocks.getReimbursementChannel).toHaveBeenCalledWith("org-1", expect.anything());
		expect(mocks.getExpenseWageTypeMappings).toHaveBeenCalledWith("org-1", expect.anything());
	});

	it("saves for the active organization and actor, and refuses invalid input", async () => {
		mocks.saveExpenseWageTypeMapping.mockResolvedValue({ status: "invalid" });
		const codes = { ...EMPTY_EXPENSE_WAGE_TYPE_CODES, datev_lohn: "x".repeat(40) };

		expect(await saveExpenseWageTypeSetting({ kind: "receipt_meals", codes })).toMatchObject({
			success: false,
			code: "ValidationError",
			error: "Invalid wage type mapping",
		});
		expect(mocks.saveExpenseWageTypeMapping).toHaveBeenCalledWith(
			{ organizationId: "org-1", actorUserId: "user-1", kind: "receipt_meals", codes },
			expect.anything(),
		);
		expect(mocks.revalidatePath).not.toHaveBeenCalled();
	});

	it("returns the saved mapping and revalidates the settings page only on a change", async () => {
		const mapping = {
			kind: "receipt_meals",
			codes: { ...EMPTY_EXPENSE_WAGE_TYPE_CODES, sage_lohn: "4010" },
		};
		mocks.saveExpenseWageTypeMapping.mockResolvedValue({ status: "saved", mapping });

		expect(await saveExpenseWageTypeSetting(mapping)).toEqual({ success: true, data: mapping });
		expect(mocks.revalidatePath).toHaveBeenCalledWith("/settings/payroll-export");

		mocks.revalidatePath.mockClear();
		mocks.saveExpenseWageTypeMapping.mockResolvedValue({ status: "unchanged", mapping });
		expect(await saveExpenseWageTypeSetting(mapping)).toEqual({ success: true, data: mapping });
		expect(mocks.revalidatePath).not.toHaveBeenCalled();
	});
});
