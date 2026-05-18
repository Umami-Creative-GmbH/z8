import { DateTime } from "luxon";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	calculateExpectedWorkHoursForEmployee: vi.fn(),
	db: {
		insert: vi.fn(),
		select: vi.fn(),
	},
}));

vi.mock("@/db", () => ({ db: mocks.db }));
vi.mock("@/lib/time-tracking/calculations", () => ({
	calculateExpectedWorkHoursForEmployee: mocks.calculateExpectedWorkHoursForEmployee,
}));

import {
	buildEmployeeTimeBalanceValues,
	calculateBalanceMinutes,
	calculateDayAbsenceAdjustmentMinutes,
	formatSignedBalance,
	getAbsenceDayFraction,
	getCurrentYearRange,
	refreshEmployeeTimeBalances,
} from "./team-time-balance";

function createEmptySelectChain() {
	const chain = {
		from: vi.fn(() => chain),
		where: vi.fn(async () => []),
	};
	return chain;
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe("team time balance helpers", () => {
	it("returns the current calendar year range", () => {
		const range = getCurrentYearRange(DateTime.fromISO("2026-05-18T12:00:00", { zone: "utc" }));
		expect(range.year).toBe(2026);
		expect(range.start.toISO()).toBe("2026-01-01T00:00:00.000Z");
		expect(range.end.toISO()).toBe("2026-12-31T23:59:59.999Z");
	});

	it("calculates positive, negative, and zero balances", () => {
		expect(
			calculateBalanceMinutes({
				actualMinutes: 2520,
				expectedMinutes: 2400,
				absenceAdjustedMinutes: 0,
			}),
		).toBe(120);
		expect(
			calculateBalanceMinutes({
				actualMinutes: 2100,
				expectedMinutes: 2400,
				absenceAdjustedMinutes: 0,
			}),
		).toBe(-300);
		expect(
			calculateBalanceMinutes({
				actualMinutes: 2100,
				expectedMinutes: 2400,
				absenceAdjustedMinutes: 300,
			}),
		).toBe(0);
	});

	it("never lets absence adjustment make expected minutes negative", () => {
		expect(
			calculateBalanceMinutes({
				actualMinutes: 60,
				expectedMinutes: 240,
				absenceAdjustedMinutes: 480,
			}),
		).toBe(60);
	});

	it("adjusts full and half-day absences by expected day minutes", () => {
		expect(calculateDayAbsenceAdjustmentMinutes(480, "full_day")).toBe(480);
		expect(calculateDayAbsenceAdjustmentMinutes(480, "am")).toBe(240);
		expect(calculateDayAbsenceAdjustmentMinutes(480, "pm")).toBe(240);
	});

	it("uses full day for same-day absences from am to pm", () => {
		expect(
			getAbsenceDayFraction({
				date: "2026-05-18",
				startDate: "2026-05-18",
				startPeriod: "am",
				endDate: "2026-05-18",
				endPeriod: "pm",
			}),
		).toBe(1);
	});

	it("uses half day for same-day absences from am to am", () => {
		expect(
			getAbsenceDayFraction({
				date: "2026-05-18",
				startDate: "2026-05-18",
				startPeriod: "am",
				endDate: "2026-05-18",
				endPeriod: "am",
			}),
		).toBe(0.5);
	});

	it("uses half day for a multi-day absence starting in pm", () => {
		expect(
			getAbsenceDayFraction({
				date: "2026-05-18",
				startDate: "2026-05-18",
				startPeriod: "pm",
				endDate: "2026-05-20",
				endPeriod: "full_day",
			}),
		).toBe(0.5);
	});

	it("uses half day for a multi-day absence ending in am", () => {
		expect(
			getAbsenceDayFraction({
				date: "2026-05-20",
				startDate: "2026-05-18",
				startPeriod: "full_day",
				endDate: "2026-05-20",
				endPeriod: "am",
			}),
		).toBe(0.5);
	});

	it("uses full day for a multi-day absence middle day", () => {
		expect(
			getAbsenceDayFraction({
				date: "2026-05-19",
				startDate: "2026-05-18",
				startPeriod: "pm",
				endDate: "2026-05-20",
				endPeriod: "am",
			}),
		).toBe(1);
	});

	it("uses UTC-derived date-only values for canonical day fractions", () => {
		expect(
			getAbsenceDayFraction({
				date: DateTime.fromISO("2026-03-29", { zone: "utc" }).toISODate()!,
				startDate: "2026-03-28",
				startPeriod: "pm",
				endDate: "2026-03-30",
				endPeriod: "am",
			}),
		).toBe(1);
	});

	it("formats signed balances for display", () => {
		expect(formatSignedBalance(750)).toBe("+12h 30m");
		expect(formatSignedBalance(-255)).toBe("-4h 15m");
		expect(formatSignedBalance(0)).toBe("0h");
	});
});

describe("employee time balance persistence values", () => {
	it("builds persisted values from actual, expected, and absence adjustment minutes", () => {
		const calculatedAt = new Date("2026-05-18T10:00:00.000Z");
		expect(
			buildEmployeeTimeBalanceValues({
				employeeId: "employee-1",
				organizationId: "org-1",
				year: 2026,
				actualMinutes: 2520,
				expectedMinutes: 2400,
				absenceAdjustedMinutes: 300,
				calculatedAt,
			}),
		).toEqual({
			employeeId: "employee-1",
			organizationId: "org-1",
			year: 2026,
			actualMinutes: 2520,
			expectedMinutes: 2400,
			absenceAdjustedMinutes: 300,
			balanceMinutes: 420,
			calculatedAt,
		});
	});

	it("does not calculate balances when supplied employees do not belong to the organization", async () => {
		mocks.db.select.mockImplementation(() => createEmptySelectChain());
		mocks.db.insert.mockReturnValue({
			values: vi.fn(() => ({
				onConflictDoUpdate: vi.fn(async () => undefined),
			})),
		});
		mocks.calculateExpectedWorkHoursForEmployee.mockResolvedValue({ totalMinutes: 0 });

		const result = await refreshEmployeeTimeBalances({
			employeeIds: ["employee-from-another-org"],
			organizationId: "org-1",
			now: DateTime.fromISO("2026-05-18T12:00:00", { zone: "utc" }),
		});

		expect(result.size).toBe(0);
		expect(mocks.calculateExpectedWorkHoursForEmployee).not.toHaveBeenCalled();
		expect(mocks.db.insert).not.toHaveBeenCalled();
	});
});
