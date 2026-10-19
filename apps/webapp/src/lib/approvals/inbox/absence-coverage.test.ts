function required<T>(value: T | null | undefined): T {
	if (value === null || value === undefined)
		throw new Error("Missing fixture value");
	return value;
}

import { describe, expect, it } from "vitest";
import {
	type AbsenceCoverageInput,
	evaluateAbsenceCoverage,
} from "./absence-coverage";

const input: AbsenceCoverageInput = {
	organizationId: "org",
	employeeId: "requester",
	coverage: {
		kind: "full_day",
		startDate: "2026-10-19",
		endDate: "2026-10-19",
	},
	shifts: [
		{
			id: "own",
			organizationId: "org",
			employeeId: "requester",
			subareaId: "desk",
			date: "2026-10-19",
			startTime: "09:00",
			endTime: "17:00",
		},
		{
			id: "peer",
			organizationId: "org",
			employeeId: "colleague",
			subareaId: "desk",
			date: "2026-10-19",
			startTime: "09:00",
			endTime: "17:00",
		},
	],
	rules: [
		{
			id: "rule",
			organizationId: "org",
			subareaId: "desk",
			dayOfWeek: "monday",
			startTime: "09:00",
			endTime: "17:00",
			minimumStaffCount: 1,
		},
	],
	absences: [],
};
describe("absence coverage evidence", () => {
	it("keeps an uncovered shift segment unknown while retaining a proven shortfall", () => {
		const result = evaluateAbsenceCoverage({
			...input,
			shifts: input.shifts.slice(0, 1),
			rules: [{ ...required(input.rules[0]), endTime: "12:00" }],
		});
		expect(result).toMatchObject({
			complete: false,
			shortfalls: [
				{
					date: "2026-10-19",
					subareaId: "desk",
					startTime: "09:00",
					endTime: "12:00",
					minimumStaffCount: 1,
					staffCount: 0,
				},
			],
		});
	});
});
it("subtracts approved colleague absences before proving a shortfall", () => {
	expect(
		evaluateAbsenceCoverage({
			...input,
			absences: [
				{
					id: "leave",
					organizationId: "org",
					employeeId: "colleague",
					status: "approved",
					startDate: "2026-10-19",
					endDate: "2026-10-19",
					startPeriod: "full_day",
					endPeriod: "full_day",
					requiresWorkTime: false,
				},
			],
		}),
	).toMatchObject({ complete: true, shortfalls: [{ staffCount: 0 }] });
});
it("does not call partial colleague absences or incoming overnight shifts a clear assessment", () => {
	const partial = {
		id: "leave",
		organizationId: "org",
		employeeId: "colleague",
		status: "approved",
		startDate: "2026-10-19",
		endDate: "2026-10-19",
		startPeriod: "am",
		endPeriod: "am",
		requiresWorkTime: false,
	};
	expect(
		evaluateAbsenceCoverage({ ...input, absences: [partial] }),
	).toMatchObject({ complete: false, shortfalls: [] });
	expect(
		evaluateAbsenceCoverage({
			...input,
			shifts: [
				...input.shifts,
				{
					...required(input.shifts[1]),
					id: "night",
					date: "2026-10-18",
					startTime: "22:00",
					endTime: "10:00",
				},
			],
		}),
	).toMatchObject({ complete: false });
});
it("counts distinct staff, uses the strongest overlapping rule, and does not import foreign staffing", () => {
	expect(evaluateAbsenceCoverage(input)).toEqual({
		complete: true,
		shortfalls: [],
		limitations: [],
	});
	const result = evaluateAbsenceCoverage({
		...input,
		shifts: [
			...input.shifts,
			{ ...required(input.shifts[1]), id: "duplicate" },
			{
				...required(input.shifts[1]),
				id: "foreign",
				organizationId: "foreign",
				employeeId: "other",
			},
		],
		rules: [
			...input.rules,
			{
				...required(input.rules[0]),
				id: "stronger",
				startTime: "12:00",
				minimumStaffCount: 2,
			},
		],
	});
	expect(result).toMatchObject({
		complete: true,
		shortfalls: [
			{
				startTime: "12:00",
				endTime: "17:00",
				minimumStaffCount: 2,
				staffCount: 1,
			},
		],
	});
});
it.each(["half_day_periods", "explicit_partial"] as const)(
	"does not invent clock-time meaning for %s",
	(kind) => {
		const coverage =
			kind === "half_day_periods"
				? {
						kind,
						startDate: "2026-10-19",
						endDate: "2026-10-19",
						startPeriod: "am" as const,
						endPeriod: "am" as const,
					}
				: {
						kind,
						startDate: "2026-10-19",
						endDate: "2026-10-19",
						startTime: "10:00",
						endTime: "12:00",
						overnight: false,
						wallClockZone: "not_captured" as const,
					};
		expect(evaluateAbsenceCoverage({ ...input, coverage })).toMatchObject({
			complete: false,
			shortfalls: [],
			limitations: ["unsupported_absence_coverage"],
		});
	},
);
it("does not assume no rules, missing shifts, pending leave or invalid clock values are clear", () => {
	expect(evaluateAbsenceCoverage({ ...input, rules: [] })).toMatchObject({
		complete: false,
	});
	expect(evaluateAbsenceCoverage({ ...input, shifts: [] })).toMatchObject({
		complete: false,
	});
	expect(
		evaluateAbsenceCoverage({
			...input,
			shifts: [{ ...required(input.shifts[0]), startTime: "invalid" }],
		}),
	).toMatchObject({ complete: false, shortfalls: [] });
	expect(
		evaluateAbsenceCoverage({
			...input,
			absences: [
				{
					id: "pending",
					organizationId: "org",
					employeeId: "colleague",
					status: "pending",
					startDate: "2026-10-19",
					endDate: "2026-10-19",
					startPeriod: "full_day",
					endPeriod: "full_day",
					requiresWorkTime: false,
				},
			],
		}),
	).toMatchObject({ complete: false, shortfalls: [] });
});
it("does not omit coverage rules that spill from the preceding day", () => {
	const previousNight = {
		id: "night-rule",
		organizationId: "org",
		subareaId: "desk",
		dayOfWeek: "sunday",
		startTime: "22:00",
		endTime: "10:00",
		minimumStaffCount: 2,
	};
	expect(
		evaluateAbsenceCoverage({
			...input,
			rules: [...input.rules, previousNight],
		}),
	).toMatchObject({ complete: false, shortfalls: [] });
});
