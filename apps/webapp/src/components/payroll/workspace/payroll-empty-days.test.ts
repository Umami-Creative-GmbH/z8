import { describe, expect, it } from "vitest";
import type { PayrollPeriodDay } from "@/lib/payroll-period/types";
import { datesWithEntries, daysWithEntries } from "./payroll-empty-days";

function day(
	date: string,
	kind: "work" | "absence" | "empty" | "holiday" | "settledEmpty" | "changed",
): PayrollPeriodDay {
	const settledAt = "2026-11-20T10:00:00.000Z";
	return {
		date,
		creditedMinutes: kind === "work" ? 480 : 0,
		requiredMinutes: null,
		differenceMinutes: null,
		absences:
			kind === "absence"
				? [
						{
							absenceId: `absence-${date}`,
							categoryId: "sick",
							categoryName: "Sick",
							categoryType: "sick",
							categoryColor: null,
							period: "full_day",
							approvalState: "approved",
						},
					]
				: [],
		holiday: kind === "holiday" ? { name: "Holiday" } : null,
		hasEntries: kind === "work" || kind === "absence",
		settlement:
			kind === "settledEmpty"
				? {
						state: "settled",
						settledDayId: `settled-${date}`,
						method: "manual",
						payrollExportJobId: null,
						settledAt,
						paid: { creditedMinutes: 0, absences: [] },
					}
				: kind === "changed"
					? {
							state: "changed_since_settled",
							settledDayId: `settled-${date}`,
							method: "manual",
							payrollExportJobId: null,
							settledAt,
							paid: { creditedMinutes: 480, absences: [] },
							change: { creditedMinutesDifference: -480, absencesChanged: false },
						}
					: { state: "unsettled" },
	} as PayrollPeriodDay;
}

const dates = ["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05"];

describe("datesWithEntries", () => {
	it("keeps a date while any employee has entries on it or a day changed since settled", () => {
		const anna = {
			days: [
				day("2026-11-01", "empty"),
				day("2026-11-02", "work"),
				day("2026-11-03", "holiday"),
				day("2026-11-04", "settledEmpty"),
				day("2026-11-05", "empty"),
			],
		};
		const ben = {
			days: [
				day("2026-11-01", "empty"),
				day("2026-11-02", "empty"),
				day("2026-11-03", "absence"),
				day("2026-11-04", "empty"),
				day("2026-11-05", "changed"),
			],
		};

		expect(datesWithEntries(dates, [anna, ben])).toEqual([
			"2026-11-02",
			"2026-11-03",
			"2026-11-05",
		]);
	});

	it("keeps no date when nobody recorded anything", () => {
		expect(datesWithEntries(dates, [{ days: dates.map((date) => day(date, "empty")) }])).toEqual(
			[],
		);
	});
});

describe("daysWithEntries", () => {
	it("keeps one employee's days with entries or a change since settled", () => {
		const days = [
			day("2026-11-01", "holiday"),
			day("2026-11-02", "work"),
			day("2026-11-03", "settledEmpty"),
			day("2026-11-04", "absence"),
			day("2026-11-05", "changed"),
		];

		expect(daysWithEntries(days).map((row) => row.date)).toEqual([
			"2026-11-02",
			"2026-11-04",
			"2026-11-05",
		]);
	});
});
