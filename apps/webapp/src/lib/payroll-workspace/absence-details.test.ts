import { describe, expect, it } from "vitest";
import {
	buildPayrollAbsenceDetails,
	payrollAbsenceDetailDays,
} from "./absence-details";

const june2026 = { start: "2026-06-01", end: "2026-06-30" };

describe("buildPayrollAbsenceDetails", () => {
	it.each([
		"full_day",
		"am",
		"pm",
	] as const)("preserves a same-day %s absence", (dayPeriod) => {
		expect(
			buildPayrollAbsenceDetails(
				[
					{
						employeeId: "employee-1",
						categoryId: "vacation",
						categoryName: "Vacation",
						startDate: "2026-06-10",
						endDate: "2026-06-10",
						startPeriod: dayPeriod,
						endPeriod: dayPeriod,
					},
				],
				june2026,
			),
		).toEqual([
			{
				employeeId: "employee-1",
				categoryId: "vacation",
				categoryName: "Vacation",
				date: "2026-06-10",
				period: dayPeriod,
			},
		]);
	});

	it("uses a full day when a same-day record has different endpoint periods", () => {
		const details = buildPayrollAbsenceDetails(
			[
				{
					employeeId: "employee-1",
					categoryId: "vacation",
					categoryName: "Vacation",
					startDate: "2026-06-10",
					endDate: "2026-06-10",
					startPeriod: "am",
					endPeriod: "pm",
				},
			],
			june2026,
		);

		expect(details[0]?.period).toBe("full_day");
	});

	it("clips a multi-day range while preserving only original endpoint periods", () => {
		expect(
			buildPayrollAbsenceDetails(
				[
					{
						employeeId: "employee-1",
						categoryId: "vacation",
						categoryName: "Vacation",
						startDate: "2026-05-31",
						endDate: "2026-06-02",
						startPeriod: "pm",
						endPeriod: "am",
					},
				],
				june2026,
			),
		).toEqual([
			{
				employeeId: "employee-1",
				categoryId: "vacation",
				categoryName: "Vacation",
				date: "2026-06-01",
				period: "full_day",
			},
			{
				employeeId: "employee-1",
				categoryId: "vacation",
				categoryName: "Vacation",
				date: "2026-06-02",
				period: "am",
			},
		]);
	});

	it("includes weekends and sorts by employee, date, category name, then category id", () => {
		const details = buildPayrollAbsenceDetails(
			[
				{
					employeeId: "employee-b",
					categoryId: "vacation",
					categoryName: "Vacation",
					startDate: "2026-06-06",
					endDate: "2026-06-08",
					startPeriod: "full_day",
					endPeriod: "full_day",
				},
				{
					employeeId: "employee-a",
					categoryId: "category-b",
					categoryName: "Alpha",
					startDate: "2026-06-07",
					endDate: "2026-06-07",
					startPeriod: "pm",
					endPeriod: "pm",
				},
				{
					employeeId: "employee-a",
					categoryId: "category-z",
					categoryName: "Zeta",
					startDate: "2026-06-07",
					endDate: "2026-06-07",
					startPeriod: "am",
					endPeriod: "am",
				},
				{
					employeeId: "employee-a",
					categoryId: "category-a",
					categoryName: "Alpha",
					startDate: "2026-06-07",
					endDate: "2026-06-07",
					startPeriod: "full_day",
					endPeriod: "full_day",
				},
			],
			june2026,
		);

		expect(
			details.map(({ employeeId, date, categoryName, categoryId }) => [
				employeeId,
				date,
				categoryName,
				categoryId,
			]),
		).toEqual([
			["employee-a", "2026-06-07", "Alpha", "category-a"],
			["employee-a", "2026-06-07", "Alpha", "category-b"],
			["employee-a", "2026-06-07", "Zeta", "category-z"],
			["employee-b", "2026-06-06", "Vacation", "vacation"],
			["employee-b", "2026-06-07", "Vacation", "vacation"],
			["employee-b", "2026-06-08", "Vacation", "vacation"],
		]);
	});

	it("excludes reversed record ranges", () => {
		expect(
			buildPayrollAbsenceDetails(
				[
					{
						employeeId: "employee-1",
						categoryId: "vacation",
						categoryName: "Vacation",
						startDate: "2026-06-11",
						endDate: "2026-06-10",
						startPeriod: "full_day",
						endPeriod: "full_day",
					},
				],
				june2026,
			),
		).toEqual([]);
	});
});

describe("payrollAbsenceDetailDays", () => {
	it.each([
		["full_day", 1],
		["am", 0.5],
		["pm", 0.5],
	] as const)("returns %s as %s day", (period, expectedDays) => {
		expect(payrollAbsenceDetailDays(period)).toBe(expectedDays);
	});
});
