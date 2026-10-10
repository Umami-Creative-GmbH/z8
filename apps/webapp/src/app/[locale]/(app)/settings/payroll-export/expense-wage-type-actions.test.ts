import { beforeEach, describe, expect, it, vi } from "vitest";
import { EMPTY_EXPENSE_WAGE_TYPE_CODES } from "@/lib/payroll-export/expense-wage-type.types";
import { PAYROLL_LINE_KINDS } from "@/lib/travel-expenses/payroll-line-kind";

const mocks = vi.hoisted(() => ({
	requireExpenseAdministrator: vi.fn(),
	getReimbursementChannel: vi.fn(),
	getExpenseWageTypeMappings: vi.fn(),
	saveExpenseWageTypeMapping: vi.fn(),
	revalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn() } }));
vi.mock("@/lib/travel-expenses/expense-administrator", () => ({
	requireExpenseAdministrator: mocks.requireExpenseAdministrator,
}));
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

const admin = { organizationId: "org-1", userId: "user-1", employeeId: null };
const unmapped = PAYROLL_LINE_KINDS.map((kind) => ({
	kind,
	codes: EMPTY_EXPENSE_WAGE_TYPE_CODES,
}));

describe("expense wage type actions (#851)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.requireExpenseAdministrator.mockResolvedValue(admin);
		mocks.getReimbursementChannel.mockResolvedValue("payroll_run");
		mocks.getExpenseWageTypeMappings.mockResolvedValue(unmapped);
	});

	it("refuses a non-admin without reading or saving mappings", async () => {
		mocks.requireExpenseAdministrator.mockResolvedValue({
			error: "Unauthorized: Admin access required",
		});

		expect(await getExpenseWageTypeSetting()).toEqual({
			success: false,
			error: "Unauthorized: Admin access required",
		});
		expect(
			await saveExpenseWageTypeSetting({
				kind: "receipt_meals",
				codes: EMPTY_EXPENSE_WAGE_TYPE_CODES,
			}),
		).toEqual({ success: false, error: "Unauthorized: Admin access required" });
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

		expect(await saveExpenseWageTypeSetting({ kind: "receipt_meals", codes })).toEqual({
			success: false,
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
