import { beforeEach, describe, expect, it, vi } from "vitest";

const findManyOrganizationsMock = vi.fn();
const getVacationAllowanceMock = vi.fn();
const calculateAnnualCarryoverMock = vi.fn();
const accrueVacationDaysMock = vi.fn();
const expireCarryoverDaysMock = vi.fn();
const logAuditMock = vi.fn();

vi.mock("@/db", () => ({
	db: {
		query: {
			organization: {
				findMany: findManyOrganizationsMock,
			},
		},
	},
}));

vi.mock("@/lib/query/vacation.queries", () => ({
	getVacationAllowance: getVacationAllowanceMock,
}));

vi.mock("@/lib/absences/vacation.service", () => ({
	accrueVacationDays: accrueVacationDaysMock,
	calculateAnnualCarryover: calculateAnnualCarryoverMock,
	expireCarryoverDays: expireCarryoverDaysMock,
}));

vi.mock("@/lib/audit-logger", () => ({
	AuditAction: { TIME_ENTRY_CHAIN_VERIFIED: "TIME_ENTRY_CHAIN_VERIFIED" },
	logAudit: logAuditMock,
}));

vi.mock("@/lib/logger", () => ({
	createLogger: () => ({
		info: vi.fn(),
		error: vi.fn(),
	}),
}));

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date("2026-03-31T10:00:00.000Z"));
	findManyOrganizationsMock.mockReset();
	getVacationAllowanceMock.mockReset();
	calculateAnnualCarryoverMock.mockReset();
	accrueVacationDaysMock.mockReset();
	expireCarryoverDaysMock.mockReset();
	logAuditMock.mockReset();
	getVacationAllowanceMock.mockResolvedValue({ allowCarryover: true, accrualType: "monthly" });
	calculateAnnualCarryoverMock.mockResolvedValue({
		organizationId: "org-1",
		fromYear: 2025,
		toYear: 2026,
		processedAt: new Date("2026-04-01T00:00:00.000Z"),
		employeesProcessed: 0,
		totalDaysCarriedOver: 0,
		results: [],
		errors: [],
	});
	accrueVacationDaysMock.mockResolvedValue({ employeesProcessed: 1, totalDaysAccrued: 2.5 });
	expireCarryoverDaysMock.mockResolvedValue({
		employeesAffected: 0,
		daysExpired: 0,
		details: [],
	});
	logAuditMock.mockResolvedValue(undefined);
});

describe("runAnnualCarryover fiscal-year scheduling", () => {
	it("does not process non-January organizations before their fiscal year start day", async () => {
		findManyOrganizationsMock.mockResolvedValue([
			{ id: "org-1", name: "April Org", fiscalYearStartMonth: 4 },
		]);

		const { runAnnualCarryover } = await import("./carryover-automation");
		await runAnnualCarryover();

		expect(getVacationAllowanceMock).not.toHaveBeenCalled();
		expect(calculateAnnualCarryoverMock).not.toHaveBeenCalled();
	});

	it("processes the previous fiscal label year on the organization's fiscal year start", async () => {
		vi.setSystemTime(new Date("2026-04-01T10:00:00.000Z"));
		findManyOrganizationsMock.mockResolvedValue([
			{ id: "org-1", name: "April Org", fiscalYearStartMonth: 4 },
		]);

		const { runAnnualCarryover } = await import("./carryover-automation");
		await runAnnualCarryover();

		expect(getVacationAllowanceMock).toHaveBeenCalledWith("org-1", 2025, 4);
		expect(calculateAnnualCarryoverMock).toHaveBeenCalledWith(
			"org-1",
			2025,
			"system-automation",
			4,
		);
	});

	it("treats targetYear as an explicit fiscal label override", async () => {
		findManyOrganizationsMock.mockResolvedValue([
			{ id: "org-1", name: "April Org", fiscalYearStartMonth: 4 },
		]);

		const { runAnnualCarryover } = await import("./carryover-automation");
		await runAnnualCarryover(2024);

		expect(getVacationAllowanceMock).toHaveBeenCalledWith("org-1", 2024, 4);
		expect(calculateAnnualCarryoverMock).toHaveBeenCalledWith(
			"org-1",
			2024,
			"system-automation",
			4,
		);
	});

	it("falls back to January when the persisted fiscal month is invalid", async () => {
		vi.setSystemTime(new Date("2026-01-01T10:00:00.000Z"));
		findManyOrganizationsMock.mockResolvedValue([
			{ id: "org-1", name: "Invalid Month Org", fiscalYearStartMonth: 13 },
		]);

		const { runAnnualCarryover } = await import("./carryover-automation");
		await runAnnualCarryover();

		expect(getVacationAllowanceMock).toHaveBeenCalledWith("org-1", 2025, 1);
		expect(calculateAnnualCarryoverMock).toHaveBeenCalledWith(
			"org-1",
			2025,
			"system-automation",
			1,
		);
	});
});

describe("runVacationAutomation fiscal-year scheduling", () => {
	it("delegates annual carryover to per-organization fiscal-start gating", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-04-01T10:00:00.000Z"));
		findManyOrganizationsMock.mockResolvedValue([
			{ id: "org-1", name: "April Org", fiscalYearStartMonth: 4 },
		]);
		getVacationAllowanceMock.mockResolvedValue({ allowCarryover: true, accrualType: "annual" });

		const { runVacationAutomation } = await import("./carryover-automation");
		await runVacationAutomation();

		expect(calculateAnnualCarryoverMock).toHaveBeenCalledWith(
			"org-1",
			2025,
			"system-automation",
			4,
		);
	});
});

describe("runMonthlyAccrual fiscal-year labels", () => {
	it("uses the fiscal label year and fiscal start month for policy lookup and accrual", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-03-01T10:00:00.000Z"));
		findManyOrganizationsMock.mockResolvedValue([
			{ id: "org-1", name: "April Org", fiscalYearStartMonth: 4 },
		]);

		const { runMonthlyAccrual } = await import("./carryover-automation");
		await runMonthlyAccrual(3, 2026);

		expect(getVacationAllowanceMock).toHaveBeenCalledWith("org-1", 2025, 4);
		expect(accrueVacationDaysMock).toHaveBeenCalledWith(
			"org-1",
			3,
			2025,
			"system-automation",
			4,
			2026,
		);
	});
});
