import { describe, expect, it } from "vitest";
import { mondayToFriday } from "./absence-days";
import {
	type AbsencePlanPreviewInput,
	buildAbsencePlanPreview,
	type CoverageEvaluationInput,
} from "./absence-plan-preview";
import type { VacationYearBalanceEvidence } from "./vacation-year-balance";
import { workingDaysFrom } from "./working-days";

function available(year: number, remainingDays: number): VacationYearBalanceEvidence {
	return {
		year,
		status: "available",
		balance: {
			year,
			totalDays: 20,
			allowanceDays: 20,
			usedDays: 4,
			pendingDays: 20 - 4 - remainingDays,
			remainingDays,
			overdrawnDays: 0,
		},
	};
}

const baseInput: AbsencePlanPreviewInput = {
	category: {
		id: "cat-vacation",
		name: "Vacation",
		requiresApproval: true,
		countsAgainstVacation: true,
	},
	request: {
		categoryId: "cat-vacation",
		startDate: "2026-05-04",
		startPeriod: "full_day",
		endDate: "2026-05-05",
		endPeriod: "full_day",
	},
	vacationBalances: [available(2026, 14)],
	evaluatedAt: "2026-10-18T08:00:00Z",
	timezone: "Europe/Berlin",
	holidays: [],
	isWorkingDay: mondayToFriday,
	existingAbsences: [],
	affectedShifts: [],
	coverage: { risks: [], hasConfiguredRulesForAffectedShifts: true },
	hasManager: true,
};

function withHolidays(holidays: AbsencePlanPreviewInput["holidays"]) {
	return { holidays, isWorkingDay: workingDaysFrom({ assignments: [], holidays }) };
}
describe("buildAbsencePlanPreview for time off in lieu", () => {
	const timeOffInLieu: AbsencePlanPreviewInput = {
		...baseInput,
		category: {
			id: "cat-toil",
			name: "Time off in lieu",
			requiresApproval: true,
			countsAgainstVacation: false,
			drawsOnWorkBalance: true,
		},
	};

	it("shows the projected work balance after the request", () => {
		const workBalance = {
			currentBalanceMinutes: 1200,
			drawnMinutes: 960,
			projectedBalanceMinutes: 240,
			wouldBeNegative: false,
		};

		const preview = buildAbsencePlanPreview({ ...timeOffInLieu, workBalance });

		expect(preview.workBalance).toEqual(workBalance);
		expect(preview.countsAgainstVacation).toBe(false);
		expect(preview.balances).toEqual([]);
		expect(preview.warnings).toEqual([]);
		expect(preview.approvalSignal).toBe("likely");
	});

	it("warns, without refusing, when the work balance would be negative", () => {
		const preview = buildAbsencePlanPreview({
			...timeOffInLieu,
			workBalance: {
				currentBalanceMinutes: 240,
				drawnMinutes: 960,
				projectedBalanceMinutes: -720,
				wouldBeNegative: true,
			},
		});

		expect(preview.warnings).toContain("Work balance would be negative after this request.");
		expect(preview.approvalSignal).toBe("risky");
	});

	it("has no work balance projection for other categories", () => {
		expect(buildAbsencePlanPreview(baseInput).workBalance).toBeNull();
	});
});

describe("buildAbsencePlanPreview", () => {
	it("calculates balance impact for vacation-counting categories", () => {
		const preview = buildAbsencePlanPreview(baseInput);

		expect(preview.requestedAbsenceDays).toBe(2);
		expect(preview.countsAgainstVacation).toBe(true);
		expect(preview.evaluatedAt).toBe("2026-10-18T08:00:00Z");
		expect(preview.balances).toEqual([
			{
				year: 2026,
				chargedAbsenceDays: 2,
				futureYear: false,
				status: "available",
				remainingDays: 14,
				remainingAfterRequest: 12,
			},
		]);
		expect(preview.approvalSignal).toBe("likely");
		expect(preview.reasons).toContain("Request follows the normal approval path.");
	});

	it("counts explicit partial-day time requests as half a vacation day", () => {
		const preview = buildAbsencePlanPreview({
			...baseInput,
			request: {
				categoryId: "cat-vacation",
				startDate: "2026-05-15",
				startPeriod: "am",
				endDate: "2026-05-15",
				endPeriod: "am",
				durationKind: "partial_day",
				startTime: "09:00",
				endTime: "13:00",
			},
			category: {
				...baseInput.category,
				countsAgainstVacation: true,
			},
			vacationBalances: [available(2026, 10)],
		});

		expect(preview.requestedAbsenceDays).toBe(0.5);
		expect(preview.balances[0]).toMatchObject({
			chargedAbsenceDays: 0.5,
			remainingAfterRequest: 9.5,
		});
	});

	it("does not reduce balance for explicit partial-day time requests on holidays", () => {
		const preview = buildAbsencePlanPreview({
			...baseInput,
			request: {
				categoryId: "cat-vacation",
				startDate: "2026-05-15",
				startPeriod: "am",
				endDate: "2026-05-15",
				endPeriod: "am",
				durationKind: "partial_day",
				startTime: "09:00",
				endTime: "13:00",
			},
			vacationBalances: [available(2026, 10)],
			...withHolidays([
				{
					id: "holiday-1",
					name: "Liberation Day",
					startDate: new Date("2026-05-15T00:00:00.000Z"),
					endDate: new Date("2026-05-15T00:00:00.000Z"),
					categoryId: "public",
				},
			]),
		});

		expect(preview.requestedAbsenceDays).toBe(0);
		expect(preview.balances[0]).toMatchObject({ chargedAbsenceDays: 0, remainingAfterRequest: 10 });
	});

	it("does not reduce balance for non-vacation categories", () => {
		const preview = buildAbsencePlanPreview({
			...baseInput,
			category: {
				...baseInput.category,
				countsAgainstVacation: false,
			},
		});

		expect(preview.countsAgainstVacation).toBe(false);
		expect(preview.balances).toEqual([]);
		expect(preview.reasons).toContain("This absence type does not reduce vacation balance.");
	});

	it("marks insufficient balance as risky", () => {
		const preview = buildAbsencePlanPreview({
			...baseInput,
			vacationBalances: [available(2026, 1)],
		});

		expect(preview.approvalSignal).toBe("risky");
		expect(preview.balances[0]).toMatchObject({ status: "available", remainingAfterRequest: -1 });
	});

	it("includes holidays inside the request range", () => {
		const preview = buildAbsencePlanPreview({
			...baseInput,
			...withHolidays([
				{
					id: "holiday-1",
					name: "Liberation Day",
					startDate: new Date("2026-05-05T00:00:00.000Z"),
					endDate: new Date("2026-05-05T00:00:00.000Z"),
					categoryId: "public",
				},
			]),
		});

		expect(preview.holidays).toEqual([
			{
				id: "holiday-1",
				name: "Liberation Day",
				startDate: "2026-05-05",
				endDate: "2026-05-05",
			},
		]);
		expect(preview.requestedAbsenceDays).toBe(1);
	});

	it("marks pending or approved absence overlaps as risky", () => {
		const preview = buildAbsencePlanPreview({
			...baseInput,
			existingAbsences: [
				{
					id: "absence-1",
					startDate: "2026-05-05",
					endDate: "2026-05-06",
					status: "pending",
					categoryName: "Vacation",
				},
			],
		});

		expect(preview.approvalSignal).toBe("risky");
		expect(preview.overlaps).toHaveLength(1);
		expect(preview.warnings).toContain("Request overlaps an existing pending absence.");
	});

	it("marks missing balance as needs_review", () => {
		const preview = buildAbsencePlanPreview({
			...baseInput,
			vacationBalances: [{ year: 2026, status: "unavailable", reason: "missing_policy" }],
		});

		expect(preview.approvalSignal).toBe("needs_review");
		expect(preview.balances).toEqual([
			{
				year: 2026,
				chargedAbsenceDays: 2,
				futureYear: false,
				status: "unavailable",
				reason: "missing_policy",
			},
		]);
	});

	it("marks coverage risks as risky", () => {
		const coverage: CoverageEvaluationInput = {
			risks: [
				{
					date: "2026-05-04",
					subareaId: "subarea-1",
					subareaName: "Front Desk",
					startTime: "09:00",
					endTime: "17:00",
					minimumStaffCount: 2,
					staffCountAfterAbsence: 1,
				},
			],
			hasConfiguredRulesForAffectedShifts: true,
		};

		const preview = buildAbsencePlanPreview({ ...baseInput, coverage });

		expect(preview.approvalSignal).toBe("risky");
		expect(preview.coverage.risks[0]?.subareaName).toBe("Front Desk");
		expect(preview.warnings).toContain(
			"Published coverage would drop below the configured minimum.",
		);
	});

	it("marks missing coverage rules for affected shifts as needs_review", () => {
		const preview = buildAbsencePlanPreview({
			...baseInput,
			affectedShifts: [{ id: "shift-1" }],
			coverage: { risks: [], hasConfiguredRulesForAffectedShifts: false },
		});

		expect(preview.approvalSignal).toBe("needs_review");
		expect(preview.reasons).toEqual(expect.arrayContaining([expect.stringMatching(/coverage/i)]));
	});

	it("does not require coverage review when no shifts are affected and no rules exist", () => {
		const preview = buildAbsencePlanPreview({
			...baseInput,
			affectedShifts: [],
			coverage: { risks: [], hasConfiguredRulesForAffectedShifts: false },
		});

		expect(preview.approvalSignal).toBe("likely");
		expect(preview.reasons).toContain("Request follows the normal approval path.");
		expect(preview.reasons).not.toContain(
			"Coverage rules are not configured for the affected scheduled work.",
		);
	});

	it("explains manager-less approval behavior when approval is required", () => {
		const preview = buildAbsencePlanPreview({ ...baseInput, hasManager: false });

		expect(preview.approvalSignal).toBe("likely");
		expect(preview.reasons).toContain(
			"No manager is assigned, so this request follows the current auto-approval behavior.",
		);
	});

	it("explains when approval is not required", () => {
		const preview = buildAbsencePlanPreview({
			...baseInput,
			category: { ...baseInput.category, requiresApproval: false },
		});

		expect(preview.approvalSignal).toBe("likely");
		expect(preview.reasons).toContain("This absence type does not require approval.");
		expect(preview.reasons).not.toContain("Request follows the normal approval path.");
	});

	it("excludes rejected absences from overlap warnings", () => {
		const preview = buildAbsencePlanPreview({
			...baseInput,
			existingAbsences: [
				{
					id: "absence-1",
					startDate: "2026-05-05",
					endDate: "2026-05-06",
					status: "rejected",
					categoryName: "Vacation",
				},
			],
		});

		expect(preview.approvalSignal).toBe("likely");
		expect(preview.overlaps).toHaveLength(0);
		expect(preview.warnings).not.toContain("Request overlaps an existing rejected absence.");
	});

	it("uses risky signal when warnings and review reasons both exist", () => {
		const preview = buildAbsencePlanPreview({
			...baseInput,
			vacationBalances: [{ year: 2026, status: "unavailable", reason: "read_failed" }],
			coverage: {
				risks: [
					{
						date: "2026-05-04",
						subareaId: "subarea-1",
						subareaName: "Front Desk",
						startTime: "09:00",
						endTime: "17:00",
						minimumStaffCount: 2,
						staffCountAfterAbsence: 1,
					},
				],
				hasConfiguredRulesForAffectedShifts: true,
			},
		});

		expect(preview.approvalSignal).toBe("risky");
		expect(preview.balances[0]).toMatchObject({ status: "unavailable" });
		expect(preview.warnings).toContain(
			"Published coverage would drop below the configured minimum.",
		);
	});

	it("counts only the employee's working days", () => {
		const preview = buildAbsencePlanPreview({
			...baseInput,
			request: { ...baseInput.request, startDate: "2026-10-12", endDate: "2026-10-16" },
			isWorkingDay: (day) => day.dayOfWeek <= 4,
		});

		expect(preview.requestedAbsenceDays).toBe(4);
		expect(preview.balances[0]).toMatchObject({ remainingAfterRequest: 10 });
		expect(preview.refusal).toBeNull();
	});

	it("refuses vacation that covers no working day", () => {
		const preview = buildAbsencePlanPreview({
			...baseInput,
			request: { ...baseInput.request, startDate: "2026-10-16", endDate: "2026-10-18" },
			isWorkingDay: (day) => day.dayOfWeek <= 4,
		});

		expect(preview.requestedAbsenceDays).toBe(0);
		expect(preview.refusal).toBe("no_working_days");
		expect(preview.approvalSignal).toBe("risky");
	});

	it("accepts a category that does not count against vacation on no working day", () => {
		const preview = buildAbsencePlanPreview({
			...baseInput,
			category: { ...baseInput.category, name: "Sick leave", countsAgainstVacation: false },
			request: { ...baseInput.request, startDate: "2026-10-17", endDate: "2026-10-18" },
		});

		expect(preview.requestedAbsenceDays).toBe(0);
		expect(preview.refusal).toBeNull();
	});
});

describe("buildAbsencePlanPreview across calendar years", () => {
	// Wed 2026-12-30, Thu 12-31, Fri 2027-01-01, Sat 01-02.
	const acrossNewYear: AbsencePlanPreviewInput = {
		...baseInput,
		request: {
			categoryId: "cat-vacation",
			startDate: "2026-12-30",
			startPeriod: "full_day",
			endDate: "2027-01-02",
			endPeriod: "full_day",
		},
		vacationBalances: [available(2026, 5), available(2027, 20)],
	};

	it("deducts from each year only the working days that fall in it", () => {
		const preview = buildAbsencePlanPreview(acrossNewYear);

		expect(preview.requestedAbsenceDays).toBe(3);
		expect(preview.balances).toEqual([
			{
				year: 2026,
				chargedAbsenceDays: 2,
				futureYear: false,
				status: "available",
				remainingDays: 5,
				remainingAfterRequest: 3,
			},
			{
				year: 2027,
				chargedAbsenceDays: 1,
				futureYear: true,
				status: "available",
				remainingDays: 20,
				remainingAfterRequest: 19,
			},
		]);
		expect(preview.approvalSignal).toBe("likely");
	});

	it("does not take the whole request from a single year's balance", () => {
		// 2026 has room for its own 2 days, though not for all 3 requested.
		const preview = buildAbsencePlanPreview({
			...acrossNewYear,
			vacationBalances: [available(2026, 2), available(2027, 1)],
		});

		expect(
			preview.balances.map((year) => year.status === "available" && year.remainingAfterRequest),
		).toEqual([0, 0]);
		expect(preview.approvalSignal).toBe("likely");
	});

	it("respects holidays and part-time schedules in each year", () => {
		const preview = buildAbsencePlanPreview({
			...acrossNewYear,
			isWorkingDay: (day) => day.dayOfWeek <= 4 && day.toString() !== "2026-12-31",
		});

		expect(preview.balances.map((year) => year.chargedAbsenceDays)).toEqual([1, 0]);
	});

	it("marks a year short on balance as risky, keeping the other year's numbers", () => {
		const preview = buildAbsencePlanPreview({
			...acrossNewYear,
			vacationBalances: [available(2026, 5), available(2027, 0.5)],
		});

		expect(preview.balances[1]).toMatchObject({ year: 2027, remainingAfterRequest: -0.5 });
		expect(preview.balances[0]).toMatchObject({ year: 2026, remainingAfterRequest: 3 });
		expect(preview.approvalSignal).toBe("risky");
	});

	it("shows a year without balance evidence as unavailable, not zero", () => {
		const preview = buildAbsencePlanPreview({
			...acrossNewYear,
			vacationBalances: [
				available(2026, 5),
				{ year: 2027, status: "unavailable", reason: "missing_policy" },
			],
		});

		expect(preview.balances).toEqual([
			expect.objectContaining({ year: 2026, status: "available", remainingAfterRequest: 3 }),
			{
				year: 2027,
				chargedAbsenceDays: 1,
				futureYear: true,
				status: "unavailable",
				reason: "missing_policy",
			},
		]);
		expect(preview.approvalSignal).toBe("needs_review");
	});

	it("treats a year whose evidence was never loaded as a failed read", () => {
		const preview = buildAbsencePlanPreview({
			...acrossNewYear,
			vacationBalances: [available(2026, 5)],
		});

		expect(preview.balances[1]).toMatchObject({
			year: 2027,
			status: "unavailable",
			reason: "read_failed",
		});
	});

	it("splits legacy half-day endpoints between the two years", () => {
		const preview = buildAbsencePlanPreview({
			...acrossNewYear,
			request: {
				categoryId: "cat-vacation",
				startDate: "2026-12-31",
				startPeriod: "pm",
				endDate: "2027-01-01",
				endPeriod: "am",
			},
		});

		expect(preview.requestedAbsenceDays).toBe(1);
		expect(preview.balances.map((year) => year.chargedAbsenceDays)).toEqual([0.5, 0.5]);
	});

	it("charges an overnight New Year's Eve partial day half a day to its start year only", () => {
		const overnight = {
			categoryId: "cat-vacation",
			startDate: "2026-12-31",
			startPeriod: "am" as const,
			endDate: "2027-01-01",
			endPeriod: "am" as const,
			durationKind: "partial_day" as const,
			startTime: "22:00",
			endTime: "06:00",
		};

		const onWorkingDay = buildAbsencePlanPreview({ ...acrossNewYear, request: overnight });
		const onHoliday = buildAbsencePlanPreview({
			...acrossNewYear,
			request: overnight,
			...withHolidays([
				{
					id: "new-years-eve",
					name: "New Year's Eve",
					startDate: new Date("2026-12-31T00:00:00.000Z"),
					endDate: new Date("2026-12-31T00:00:00.000Z"),
					categoryId: "public",
				},
			]),
		});

		expect(onWorkingDay.requestedAbsenceDays).toBe(0.5);
		expect(onWorkingDay.balances).toEqual([
			expect.objectContaining({ year: 2026, chargedAbsenceDays: 0.5, remainingAfterRequest: 4.5 }),
		]);
		expect(onHoliday.requestedAbsenceDays).toBe(0);
		expect(onHoliday.balances).toEqual([
			expect.objectContaining({ year: 2026, chargedAbsenceDays: 0, remainingAfterRequest: 5 }),
		]);
	});

	it("judges a future year by the evaluation time in the organization's zone", () => {
		// 23:30 UTC on New Year's Eve is already 2027 in Berlin.
		const preview = buildAbsencePlanPreview({
			...acrossNewYear,
			evaluatedAt: "2026-12-31T23:30:00Z",
		});

		expect(preview.balances.map((year) => year.futureYear)).toEqual([false, false]);
	});
});
