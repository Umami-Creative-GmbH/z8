import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
	getAuthContext: vi.fn(async () => ({
		user: { id: "user-1", email: "payroll@example.com", name: "Payroll User" },
		session: { activeOrganizationId: "org-1" },
		employee: { id: "employee-1", organizationId: "org-1", role: "manager" },
	})),
	hasActivePayrollAccessGrant: vi.fn(async () => true),
	previewSettleDays: vi.fn(),
	settleDays: vi.fn(),
	previewSettleSpecificDays: vi.fn(),
	settleSpecificDays: vi.fn(),
	settlementHistory: vi.fn(),
	revalidatePath: vi.fn(),
}));

vi.mock("@/db", () => ({ db: {}, payrollExportConfig: {}, payrollExportFormat: {} }));
vi.mock("next/cache", async (importOriginal) => ({
	...(await importOriginal<typeof import("next/cache")>()),
	revalidatePath: mockState.revalidatePath,
}));
vi.mock("@/lib/auth-helpers", () => ({
	getAuthContext: mockState.getAuthContext,
	getAbility: vi.fn(async () => ({ can: () => false })),
}));
vi.mock("@/lib/payroll-access/permissions", () => ({
	resolvePayrollAccessibleEmployeeIds: vi.fn(async () => ["employee-2"]),
	hasActivePayrollAccessGrant: mockState.hasActivePayrollAccessGrant,
	intersectPayrollScope: vi.fn(),
}));
vi.mock("@/lib/payroll-access/adjustment-coverage", () => ({
	listDepartedEmployeesCoveredForExport: vi.fn(async () => []),
}));
vi.mock("@/lib/payroll-export", () => ({}));
vi.mock("@/lib/payroll-workspace/pdf-exporter", () => ({}));
vi.mock("@/lib/payroll-workspace/summary", () => ({}));
vi.mock("@/lib/travel-expenses/payroll-run", () => ({}));
vi.mock("@/lib/payroll-period/settlement", () => ({
	MAX_SETTLE_SPECIFIC_DAYS: 5_000,
	previewSettleDays: mockState.previewSettleDays,
	settleDays: mockState.settleDays,
	previewSettleSpecificDays: mockState.previewSettleSpecificDays,
	settleSpecificDays: mockState.settleSpecificDays,
	settlementHistory: mockState.settlementHistory,
	unsettleDays: vi.fn(),
}));
vi.mock("@/tolgee/server", () => ({
	getTranslate: vi.fn(async () => (_key: string, fallback: string) => fallback),
}));
vi.mock("@/lib/effect/result", async () => {
	const { Effect } = await import("effect");
	return {
		runServerActionSafe: async <T>(effect: Parameters<typeof Effect.runPromise<T>>[0]) => ({
			success: true as const,
			data: await Effect.runPromise(effect),
		}),
	};
});

const {
	getPayrollSettlementHistoryAction,
	previewSettlePayrollDaysAction,
	previewSettleSpecificPayrollDaysAction,
	settlePayrollDaysAction,
	settleSpecificPayrollDaysAction,
} = await import("./actions");

const actor = { employeeId: "employee-1", userId: "user-1", name: "Payroll User" };
const range = { startDate: "2026-11-09", endDate: "2026-11-15", label: "November 2026" };
const plan = {
	newlySettled: [{ employeeId: "employee-2", date: "2026-11-10" }],
	alreadySettled: [{ employeeId: "employee-2", date: "2026-11-11" }],
	inUnclosedMonths: [{ employeeId: "employee-2", date: "2026-11-10" }],
	skippedWithoutEntries: [
		{ employeeId: "employee-2", date: "2026-11-09" },
		{ employeeId: "employee-2", date: "2026-11-14" },
	],
	skippedPendingAbsences: [{ employeeId: "employee-2", date: "2026-11-12" }],
	skippedUnclosedMonths: [],
	withPendingAbsences: [],
	employees: [{ employeeId: "employee-2", name: "Anna", days: 1, creditedMinutes: 480 }],
};
const counts = {
	newDays: 1,
	alreadySettledDays: 1,
	unclosedMonths: [{ month: "2026-11", days: 1 }],
	skippedWithoutEntriesDays: 2,
	skippedPendingAbsenceDays: 1,
	skippedUnclosedMonthDays: 0,
	pendingAbsenceDays: 0,
	employees: plan.employees,
};

describe("settling payroll days by hand", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockState.hasActivePayrollAccessGrant.mockResolvedValue(true);
		mockState.previewSettleDays.mockResolvedValue({ status: "ready", ...plan });
		mockState.settleDays.mockResolvedValue({ status: "settled", ...plan });
		mockState.previewSettleSpecificDays.mockResolvedValue({ status: "ready", ...plan });
		mockState.settleSpecificDays.mockResolvedValue({ status: "settled", ...plan });
	});

	it("previews a range with its options in the session's organization", async () => {
		const result = await previewSettlePayrollDaysAction({
			...range,
			employeeIds: ["employee-2"],
			skipPendingAbsences: false,
			skipUnclosedMonths: true,
		});

		expect(result).toEqual({ success: true, data: counts });
		expect(mockState.previewSettleDays).toHaveBeenCalledExactlyOnceWith(
			"org-1",
			actor,
			{ employeeIds: ["employee-2"] },
			{ startDate: "2026-11-09", endDate: "2026-11-15" },
			{ skipPendingAbsences: false, skipUnclosedMonths: true },
		);
		expect(mockState.revalidatePath).not.toHaveBeenCalled();
	});

	it("keeps the module's defaults when no options are sent", async () => {
		await settlePayrollDaysAction(range);

		expect(mockState.settleDays).toHaveBeenCalledExactlyOnceWith(
			"org-1",
			actor,
			{ employeeIds: undefined },
			{ startDate: "2026-11-09", endDate: "2026-11-15" },
			{},
		);
		expect(mockState.revalidatePath).toHaveBeenCalledWith("/payroll");
	});

	it("rejects options that are not booleans", async () => {
		await expect(
			settlePayrollDaysAction({
				...range,
				skipPendingAbsences: "no" as unknown as boolean,
			}),
		).rejects.toMatchObject({ message: "The request is not valid" });
		expect(mockState.settleDays).not.toHaveBeenCalled();
	});

	it("settles specific days of the session's organization", async () => {
		const days = [{ employeeId: "employee-2", date: "2026-11-10" }];

		await previewSettleSpecificPayrollDaysAction({ days });
		const result = await settleSpecificPayrollDaysAction({ days, skipPendingAbsences: true });

		expect(result).toEqual({ success: true, data: counts });
		expect(mockState.previewSettleSpecificDays).toHaveBeenCalledExactlyOnceWith(
			"org-1",
			actor,
			days,
			{},
		);
		expect(mockState.settleSpecificDays).toHaveBeenCalledExactlyOnceWith("org-1", actor, days, {
			skipPendingAbsences: true,
		});
		expect(mockState.revalidatePath).toHaveBeenCalledOnce();
	});

	it("rejects no, malformed or too many specific days before settling", async () => {
		const tooMany = Array.from({ length: 5_001 }, (_, index) => ({
			employeeId: `employee-${index}`,
			date: "2026-11-10",
		}));

		for (const days of [[], [{ employeeId: "employee-2", date: "10.11.2026" }], tooMany]) {
			await expect(settleSpecificPayrollDaysAction({ days })).rejects.toMatchObject({
				message: "The request is not valid",
			});
		}
		expect(mockState.settleSpecificDays).not.toHaveBeenCalled();
	});

	it("rejects specific days outside the grant", async () => {
		mockState.settleSpecificDays.mockResolvedValue({
			status: "out_of_scope",
			employeeIds: ["employee-9"],
		});

		await expect(
			settleSpecificPayrollDaysAction({ days: [{ employeeId: "employee-9", date: "2026-11-10" }] }),
		).rejects.toMatchObject({
			message: "Some selected employees are outside your payroll access",
		});
	});

	it("needs an active payroll access grant", async () => {
		mockState.hasActivePayrollAccessGrant.mockResolvedValue(false);

		await expect(
			settleSpecificPayrollDaysAction({ days: [{ employeeId: "employee-2", date: "2026-11-10" }] }),
		).rejects.toMatchObject({ message: "No payroll employees are assigned to your access scope" });
		await expect(settlePayrollDaysAction(range)).rejects.toBeTruthy();
		expect(mockState.settleSpecificDays).not.toHaveBeenCalled();
		expect(mockState.settleDays).not.toHaveBeenCalled();
	});
});

describe("getPayrollSettlementHistoryAction", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockState.hasActivePayrollAccessGrant.mockResolvedValue(true);
	});

	it("lists the newest 200 events of the scope and period, saying when there are more", async () => {
		const entries = Array.from({ length: 201 }, (_, index) => ({ id: `event-${index}` }));
		mockState.settlementHistory.mockResolvedValue(entries);

		const result = await getPayrollSettlementHistoryAction({
			...range,
			employeeIds: ["employee-2"],
		});

		expect(mockState.settlementHistory).toHaveBeenCalledExactlyOnceWith(
			"org-1",
			actor,
			{ employeeIds: ["employee-2"] },
			{ startDate: "2026-11-09", endDate: "2026-11-15" },
			{ limit: 201 },
		);
		expect(result.success && result.data.entries).toHaveLength(200);
		expect(result.success && result.data.hasMore).toBe(true);
	});
});
