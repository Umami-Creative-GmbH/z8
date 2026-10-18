import { expect, it } from "vitest";
import type { AbsenceChangeOriginal } from "@/lib/absences/change-request-types";
import { evaluateAbsenceChangeCoverage } from "./absence-change-coverage";
import { snapshot } from "./absence-coverage-evidence.test-fixture";

const original: AbsenceChangeOriginal = {
	categoryId: "category",
	canonicalRecordId: null,
	canonical: null,
	updatedAt: "2026-10-18T08:00:00Z",
	startDate: "2026-10-19",
	endDate: "2026-10-19",
	startPeriod: "full_day",
	endPeriod: "full_day",
};
it("proves cancellation staffing using the restored subject instead of removing their whole shift", () => {
	const result = evaluateAbsenceChangeCoverage({
		organizationId: "org",
		employeeId: "subject",
		absenceId: "absence",
		kind: "cancel",
		original,
		proposed: null,
		shifts: snapshot.shifts.slice(0, 1),
		rules: snapshot.rules,
		absences: [
			{
				id: "absence",
				organizationId: "org",
				employeeId: "subject",
				status: "approved",
				startDate: original.startDate,
				endDate: original.endDate,
				startPeriod: "full_day",
				endPeriod: "full_day",
				requiresWorkTime: false,
			},
		],
	});
	expect(result).toMatchObject({ complete: true, shortfalls: [] });
});
it.each([
	{
		original: {
			...original,
			startPeriod: "am" as const,
			endPeriod: "am" as const,
		},
		kind: "cancel" as const,
		proposed: null,
	},
	{
		original: {
			...original,
			canonical: {
				startAt: "2026-10-19T08:00:00Z",
				endAt: "2026-10-19T12:00:00Z",
			},
		},
		kind: "cancel" as const,
		proposed: null,
	},
	{
		original,
		kind: "change" as const,
		proposed: {
			...original,
			startPeriod: "pm" as const,
			canonical: {
				startAt: "2026-10-19T12:00:00Z",
				endAt: "2026-10-19T23:59:59.999Z",
			},
			displacedVacations: [],
		},
	},
])(
	"leaves unsupported half/partial original-to-proposed effects unknown",
	({ original, kind, proposed }) => {
		const result = evaluateAbsenceChangeCoverage({
			organizationId: "org",
			employeeId: "subject",
			absenceId: "absence",
			kind,
			original,
			proposed,
			shifts: snapshot.shifts,
			rules: snapshot.rules,
			absences: [],
		});
		expect(result.complete).toBe(false);
		expect(result.shortfalls).toEqual([]);
	},
);
it("never certifies cancellation from the null proposal without actual staffing evidence", () => {
	expect(
		evaluateAbsenceChangeCoverage({
			organizationId: "org",
			employeeId: "subject",
			absenceId: "absence",
			kind: "cancel",
			original,
			proposed: null,
			shifts: [],
			rules: [],
			absences: [],
		}).complete,
	).toBe(false);
});
const proposedDays = (startDate: string, endDate = startDate) => ({
	startDate,
	endDate,
	startPeriod: "full_day" as const,
	endPeriod: "full_day" as const,
	canonical: {
		startAt: `${startDate}T00:00:00Z`,
		endAt: `${endDate}T23:59:59.999Z`,
	},
	displacedVacations: [],
});
it.each([
	["shorten", "2026-10-20", "2026-10-19", undefined],
	["extend", "2026-10-19", "2026-10-20", "2026-10-20"],
	["move", "2026-10-19", "2026-10-21", "2026-10-21"],
] as const)(
	"assesses the full-day %s effect with restored dates and newly absent dates",
	(kind, originalEnd, proposedEnd, shortfallDate) => {
		const own = snapshot.shifts[0];
		const rule = snapshot.rules[0];
		if (!own || !rule) throw new Error("Staffing fixture missing");
		const shifts = [
			own,
			...["2026-10-20", "2026-10-21"].map((date) => ({
				...own,
				id: date,
				date,
			})),
			...snapshot.shifts.slice(1),
		];
		const rules = [
			rule,
			...["tuesday", "wednesday"].map((dayOfWeek) => ({
				...rule,
				id: dayOfWeek,
				dayOfWeek,
			})),
		];
		const result = evaluateAbsenceChangeCoverage({
			organizationId: "org",
			employeeId: "subject",
			absenceId: "absence",
			kind: "change",
			original: { ...original, endDate: originalEnd },
			proposed:
				kind === "move"
					? proposedDays(proposedEnd)
					: proposedDays("2026-10-19", proposedEnd),
			shifts,
			rules,
			absences: [],
		});
		expect(result.complete).toBe(true);
		expect(result.shortfalls.map((row) => row.date)).toEqual(
			shortfallDate ? [shortfallDate] : [],
		);
	},
);
it("does not ignore residual staffing shortfalls after restoring a cancelled absence", () => {
	const rule = snapshot.rules[0];
	if (!rule) throw new Error("Rule missing");
	expect(
		evaluateAbsenceChangeCoverage({
			organizationId: "org",
			employeeId: "subject",
			absenceId: "absence",
			kind: "cancel",
			original,
			proposed: null,
			shifts: snapshot.shifts.slice(0, 1),
			rules: [{ ...rule, minimumStaffCount: 2 }],
			absences: [],
		}),
	).toMatchObject({
		complete: true,
		shortfalls: [{ staffCount: 1, minimumStaffCount: 2 }],
	});
});
