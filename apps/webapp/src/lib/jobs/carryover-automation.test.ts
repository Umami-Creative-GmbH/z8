import { beforeEach, describe, expect, it, vi } from "vitest";

const findManyOrganizationsMock = vi.fn();
const getVacationAllowanceMock = vi.fn();
const calculateAnnualCarryoverMock = vi.fn();
const accrueVacationPeriodsMock = vi.fn();
const accrueDueVacationPeriodsMock = vi.fn();
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

vi.mock("@/lib/absences/vacation-accrual", () => ({
	accrueVacationPeriods: accrueVacationPeriodsMock,
	accrueDueVacationPeriods: accrueDueVacationPeriodsMock,
}));

vi.mock("@/lib/absences/vacation.service", () => ({
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
	vi.setSystemTime(new Date("2026-01-02T10:00:00.000Z"));
	findManyOrganizationsMock.mockReset();
	getVacationAllowanceMock.mockReset();
	calculateAnnualCarryoverMock.mockReset();
	accrueVacationPeriodsMock.mockReset();
	accrueDueVacationPeriodsMock.mockReset();
	expireCarryoverDaysMock.mockReset();
	logAuditMock.mockReset();
	getVacationAllowanceMock.mockResolvedValue({ allowCarryover: true, accrualType: "monthly" });
	calculateAnnualCarryoverMock.mockResolvedValue({
		organizationId: "org-1",
		fromYear: 2025,
		toYear: 2026,
		processedAt: new Date("2026-01-01T00:00:00.000Z"),
		employeesProcessed: 0,
		totalDaysCarriedOver: 0,
		results: [],
		errors: [],
	});
	accrueVacationPeriodsMock.mockResolvedValue({
		employeesProcessed: 1,
		totalDaysAccrued: 2.5,
		rowsWritten: 1,
	});
	accrueDueVacationPeriodsMock.mockResolvedValue({
		employeesProcessed: 1,
		totalDaysAccrued: 2.5,
		rowsWritten: 1,
		year: 2026,
		throughMonth: 1,
	});
	expireCarryoverDaysMock.mockResolvedValue({
		employeesAffected: 0,
		daysExpired: 0,
		details: [],
	});
	logAuditMock.mockResolvedValue(undefined);
});

describe("runAnnualCarryover calendar-year scheduling", () => {
	it("does not process organizations after January 1 when no target year is supplied", async () => {
		findManyOrganizationsMock.mockResolvedValue([{ id: "org-1", name: "Calendar Org" }]);

		const { runAnnualCarryover } = await import("./carryover-automation");
		await runAnnualCarryover();

		expect(getVacationAllowanceMock).not.toHaveBeenCalled();
		expect(calculateAnnualCarryoverMock).not.toHaveBeenCalled();
	});

	it("processes the previous calendar year on January 1", async () => {
		vi.setSystemTime(new Date("2026-01-01T10:00:00.000Z"));
		findManyOrganizationsMock.mockResolvedValue([
			{ id: "org-1", name: "Calendar Org", timezone: "UTC" },
		]);

		const { runAnnualCarryover } = await import("./carryover-automation");
		await runAnnualCarryover();

		expect(getVacationAllowanceMock).toHaveBeenCalledWith("org-1", 2025);
		expect(calculateAnnualCarryoverMock).toHaveBeenCalledWith(
			"org-1",
			2025,
			"system-automation",
			"UTC",
		);
	});

	it("uses the organization timezone for January 1 due checks", async () => {
		vi.setSystemTime(new Date("2025-12-31T23:30:00.000Z"));
		findManyOrganizationsMock.mockResolvedValue([
			{ id: "org-1", name: "Berlin Org", timezone: "Europe/Berlin" },
		]);

		const { runAnnualCarryover } = await import("./carryover-automation");
		await runAnnualCarryover();

		expect(getVacationAllowanceMock).toHaveBeenCalledWith("org-1", 2025);
		expect(calculateAnnualCarryoverMock).toHaveBeenCalledWith(
			"org-1",
			2025,
			"system-automation",
			"Europe/Berlin",
		);
	});

	it("treats targetYear as an explicit calendar year override", async () => {
		findManyOrganizationsMock.mockResolvedValue([{ id: "org-1", name: "Calendar Org" }]);

		const { runAnnualCarryover } = await import("./carryover-automation");
		await runAnnualCarryover(2024);

		expect(getVacationAllowanceMock).toHaveBeenCalledWith("org-1", 2024);
		expect(calculateAnnualCarryoverMock).toHaveBeenCalledWith(
			"org-1",
			2024,
			"system-automation",
			"UTC",
		);
	});
});

describe("runCarryoverExpiry calendar-year timezone", () => {
	it("passes each organization's timezone to expiry processing", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2025-12-31T23:30:00.000Z"));
		findManyOrganizationsMock.mockResolvedValue([
			{ id: "org-1", name: "Berlin Org", timezone: "Europe/Berlin" },
			{ id: "org-2", name: "UTC Org" },
		]);

		const { runCarryoverExpiry } = await import("./carryover-automation");
		await runCarryoverExpiry();

		expect(expireCarryoverDaysMock).toHaveBeenCalledWith(
			"org-1",
			"system-automation",
			expect.any(Date),
			"Europe/Berlin",
		);
		expect(expireCarryoverDaysMock).toHaveBeenCalledWith(
			"org-2",
			"system-automation",
			expect.any(Date),
			"UTC",
		);
	});
});

describe("runVacationAutomation calendar-year scheduling", () => {
	it("delegates annual carryover to January 1 gating", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-01-01T10:00:00.000Z"));
		findManyOrganizationsMock.mockResolvedValue([{ id: "org-1", name: "Calendar Org" }]);
		getVacationAllowanceMock.mockResolvedValue({ allowCarryover: true, accrualType: "annual" });

		const { runVacationAutomation } = await import("./carryover-automation");
		await runVacationAutomation();

		expect(calculateAnnualCarryoverMock).toHaveBeenCalledWith(
			"org-1",
			2025,
			"system-automation",
			"UTC",
		);
	});

	it("runs the accrual catch-up for every organization on every day, in its timezone", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-10-13T10:00:00.000Z"));
		findManyOrganizationsMock.mockResolvedValue([
			{ id: "org-1", name: "Berlin Org", timezone: "Europe/Berlin" },
			{ id: "org-2", name: "New York Org", timezone: "America/New_York" },
		]);

		const { runVacationAutomation } = await import("./carryover-automation");
		await runVacationAutomation();

		const calls = accrueDueVacationPeriodsMock.mock.calls.map(([organizationId, input]) => [
			organizationId,
			input.timezone,
			input.now.toString(),
		]);
		expect(calls).toEqual([
			["org-1", "Europe/Berlin", "2026-10-13T10:00:00Z"],
			["org-2", "America/New_York", "2026-10-13T10:00:00Z"],
		]);
		expect(accrueVacationPeriodsMock).not.toHaveBeenCalled();
	});
});

describe("runMonthlyAccrual calendar-year labels", () => {
	it("uses the requested calendar year for policy lookup and accrual", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-03-01T10:00:00.000Z"));
		findManyOrganizationsMock.mockResolvedValue([{ id: "org-1", name: "Calendar Org" }]);

		const { runMonthlyAccrual } = await import("./carryover-automation");
		await runMonthlyAccrual(3, 2026);

		expect(getVacationAllowanceMock).toHaveBeenCalledWith("org-1", 2026);
		expect(accrueVacationPeriodsMock).toHaveBeenCalledWith("org-1", { year: 2026, months: [3] });
		expect(accrueDueVacationPeriodsMock).not.toHaveBeenCalled();
	});

	it("derives implicit month and year from each organization's timezone", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2025-12-31T23:30:00.000Z"));
		findManyOrganizationsMock.mockResolvedValue([
			{ id: "org-1", name: "Berlin Org", timezone: "Europe/Berlin" },
			{ id: "org-2", name: "New York Org", timezone: "America/New_York" },
		]);

		const { runMonthlyAccrual } = await import("./carryover-automation");
		const result = await runMonthlyAccrual();

		expect(getVacationAllowanceMock).toHaveBeenCalledWith("org-1", 2026);
		expect(getVacationAllowanceMock).toHaveBeenCalledWith("org-2", 2025);
		expect(
			accrueDueVacationPeriodsMock.mock.calls.map(([organizationId]) => organizationId),
		).toEqual(["org-1", "org-2"]);
		expect(result.month).toBe(1);
		expect(result.year).toBe(2026);
	});
});
