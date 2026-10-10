import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	requireExpenseAdministrator: vi.fn(),
	isPayrollRunPreviewOpen: vi.fn(),
	getReimbursementChannel: vi.fn(),
	saveReimbursementChannel: vi.fn(),
	countUnconfirmedPayrollRuns: vi.fn(),
	revalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn() } }));
vi.mock("@/lib/travel-expenses/expense-administrator", () => ({
	requireExpenseAdministrator: mocks.requireExpenseAdministrator,
}));
vi.mock("@/lib/travel-expenses/payroll-run-preview", () => ({
	isPayrollRunPreviewOpen: mocks.isPayrollRunPreviewOpen,
}));
vi.mock("@/lib/travel-expenses/reimbursement-channel", () => ({
	getReimbursementChannel: mocks.getReimbursementChannel,
	saveReimbursementChannel: mocks.saveReimbursementChannel,
	countUnconfirmedPayrollRuns: mocks.countUnconfirmedPayrollRuns,
}));

const { getReimbursementChannelSetting, saveReimbursementChannelSetting } = await import(
	"./reimbursement-channel-actions"
);

const admin = { organizationId: "org-1", userId: "user-1", employeeId: null };

describe("reimbursement channel actions (#849)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.requireExpenseAdministrator.mockResolvedValue(admin);
		mocks.isPayrollRunPreviewOpen.mockResolvedValue(false);
		mocks.getReimbursementChannel.mockResolvedValue("bank_transfer");
		mocks.countUnconfirmedPayrollRuns.mockResolvedValue(0);
	});

	it("refuses a non-admin without reading or saving the channel", async () => {
		mocks.requireExpenseAdministrator.mockResolvedValue({
			error: "Unauthorized: Admin access required",
		});

		expect(await getReimbursementChannelSetting()).toEqual({
			success: false,
			error: "Unauthorized: Admin access required",
		});
		expect(await saveReimbursementChannelSetting({ channel: "bank_transfer" })).toEqual({
			success: false,
			error: "Unauthorized: Admin access required",
		});
		expect(mocks.getReimbursementChannel).not.toHaveBeenCalled();
		expect(mocks.saveReimbursementChannel).not.toHaveBeenCalled();
	});

	it("reads the active organization's channel, gate and unconfirmed runs", async () => {
		mocks.countUnconfirmedPayrollRuns.mockResolvedValue(2);

		expect(await getReimbursementChannelSetting()).toEqual({
			success: true,
			data: { channel: "bank_transfer", payrollRunAvailable: false, unconfirmedPayrollRuns: 2 },
		});
		expect(mocks.getReimbursementChannel).toHaveBeenCalledWith("org-1", expect.anything());
		expect(mocks.isPayrollRunPreviewOpen).toHaveBeenCalledWith("org-1", expect.anything());
	});

	it("saves for the active organization and actor, and refuses the closed preview", async () => {
		mocks.saveReimbursementChannel.mockResolvedValue({ kind: "preview_closed" });

		expect(await saveReimbursementChannelSetting({ channel: "payroll_run" })).toEqual({
			success: false,
			error: "The payroll run is not available for this organization",
		});
		expect(mocks.saveReimbursementChannel).toHaveBeenCalledWith(
			{ organizationId: "org-1", actorUserId: "user-1", channel: "payroll_run" },
			expect.anything(),
		);
		expect(mocks.revalidatePath).not.toHaveBeenCalled();
	});

	it("returns the saved channel with the unconfirmed runs to warn about", async () => {
		mocks.saveReimbursementChannel.mockResolvedValue({
			kind: "saved",
			channel: "bank_transfer",
			previous: "payroll_run",
		});
		mocks.isPayrollRunPreviewOpen.mockResolvedValue(true);
		mocks.countUnconfirmedPayrollRuns.mockResolvedValue(1);

		expect(await saveReimbursementChannelSetting({ channel: "bank_transfer" })).toEqual({
			success: true,
			data: { channel: "bank_transfer", payrollRunAvailable: true, unconfirmedPayrollRuns: 1 },
		});
		expect(mocks.getReimbursementChannel).not.toHaveBeenCalled();
		expect(mocks.revalidatePath).toHaveBeenCalledWith("/settings/travel-expenses");
	});
});
