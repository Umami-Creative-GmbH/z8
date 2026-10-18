import { describe, expect, it } from "vitest";
import type { ProratedAllowance } from "./prorated-allowance";
import type { VacationBalance } from "./types";
import { workingWeekNoticeRow } from "./working-week-notice";

const fourDays: ProratedAllowance = {
	fullAllowance: 24,
	days: 24,
	reason: { kind: "none", cause: "full_year" },
	workingWeek: {
		referenceAllowance: 30,
		periods: [{ startDate: "2026-01-01", endDate: "2026-12-31", workingDaysPerWeek: 4 }],
	},
};

function balance(input: Partial<VacationBalance>): VacationBalance {
	return {
		year: 2026,
		totalDays: 24,
		allowanceDays: 24,
		usedDays: 0,
		pendingDays: 0,
		remainingDays: 24,
		overdrawnDays: 0,
		allowance: fourDays,
		...input,
	};
}

const employee = { employeeId: "employee-1", name: "Ada Lovelace" };

describe("workingWeekNoticeRow (Absences ADR 0003)", () => {
	it("lists an employee whose allowance the working week reduces, with overdrawn days", () => {
		expect(
			workingWeekNoticeRow({ ...employee, balance: balance({ usedDays: 27, overdrawnDays: 3 }) }),
		).toEqual({
			employeeId: "employee-1",
			name: "Ada Lovelace",
			referenceAllowance: 30,
			convertedAllowance: 24,
			overdrawnDays: 3,
			allowance: fourDays,
		});
	});

	it("leaves out five-day, longer-week and custom allowances", () => {
		expect(
			workingWeekNoticeRow({
				...employee,
				balance: balance({
					allowance: { fullAllowance: 30, days: 30, reason: { kind: "none", cause: "full_year" } },
				}),
			}),
		).toBeNull();
		expect(
			workingWeekNoticeRow({
				...employee,
				balance: balance({
					allowance: {
						...fourDays,
						fullAllowance: 36,
						days: 36,
						workingWeek: { ...fourDays.workingWeek!, referenceAllowance: 30 },
					},
				}),
			}),
		).toBeNull();
		expect(
			workingWeekNoticeRow({
				...employee,
				balance: balance({
					allowance: {
						fullAllowance: 24,
						days: 24,
						reason: { kind: "none", cause: "custom_allowance" },
					},
				}),
			}),
		).toBeNull();
		expect(workingWeekNoticeRow({ ...employee, balance: null })).toBeNull();
	});
});
