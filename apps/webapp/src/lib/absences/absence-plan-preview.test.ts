import { describe, expect, it } from "vitest";
import { mondayToFriday } from "./absence-days";
import {
	type AbsencePlanPreviewInput,
	buildAbsencePlanPreview,
	type CoverageEvaluation,
} from "./absence-plan-preview";
import { workingDaysFrom } from "./working-days";

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
	vacationBalance: {
		year: 2026,
		totalDays: 20,
		usedDays: 4,
		pendingDays: 2,
		remainingDays: 14,
	},
	holidays: [],
	isWorkingDay: mondayToFriday,
	existingAbsences: [],
	affectedShifts: [],
	coverage: { status: "complete", gaps: [], risks: [] },
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
		expect(preview.balance?.remainingAfterRequest).toBe(14);
		expect(preview.warnings).toEqual([]);
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
	});

	it("has no work balance projection for other categories", () => {
		expect(buildAbsencePlanPreview(baseInput).workBalance).toBeNull();
	});
});

describe("buildAbsencePlanPreview", () => {
	it("calculates balance impact for vacation-counting categories", () => {
		const preview = buildAbsencePlanPreview(baseInput);

		expect(preview.requestedAbsenceDays).toBe(2);
		expect(preview.balance?.remainingAfterRequest).toBe(12);
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
			vacationBalance: {
				...baseInput.vacationBalance!,
				remainingDays: 10,
			},
		});

		expect(preview.requestedAbsenceDays).toBe(0.5);
		expect(preview.balance?.remainingAfterRequest).toBe(9.5);
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
			vacationBalance: {
				...baseInput.vacationBalance!,
				remainingDays: 10,
			},
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
		expect(preview.balance?.remainingAfterRequest).toBe(10);
	});

	it("does not reduce balance for non-vacation categories", () => {
		const preview = buildAbsencePlanPreview({
			...baseInput,
			category: {
				...baseInput.category,
				countsAgainstVacation: false,
			},
		});

		expect(preview.balance?.remainingAfterRequest).toBe(14);
		expect(preview.reasons).toContain("This absence type does not reduce vacation balance.");
	});

	it("marks insufficient balance as risky", () => {
		const preview = buildAbsencePlanPreview({
			...baseInput,
			vacationBalance: {
				...baseInput.vacationBalance!,
				remainingDays: 1,
			},
		});
		expect(preview.warnings).toContain("Vacation balance would be negative after this request.");
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
		expect(preview.overlaps).toHaveLength(1);
		expect(preview.warnings).toContain("Request overlaps an existing pending absence.");
	});

	it("marks missing balance as needs_review", () => {
		const preview = buildAbsencePlanPreview({
			...baseInput,
			vacationBalance: null,
		});
		expect(preview.reasons).toContain("Vacation balance is unavailable for this year.");
	});

	const coverageRisk = {
		date: "2026-05-04",
		subareaId: "subarea-1",
		subareaName: "Front Desk",
		startTime: "09:00",
		endTime: "17:00",
		minimumStaffCount: 2,
		staffCountAfterAbsence: 1,
	};

	it("passes coverage warnings through as structured evidence, not server-built text", () => {
		const coverage: CoverageEvaluation = { status: "complete", gaps: [], risks: [coverageRisk] };

		const preview = buildAbsencePlanPreview({ ...baseInput, coverage });

		expect(preview.coverage).toEqual(coverage);
		expect(preview.warnings).toEqual([]);
		expect(preview.reasons).not.toContain("Request follows the normal approval path.");
	});

	it("keeps incomplete coverage evidence visible without describing the normal approval path", () => {
		const coverage: CoverageEvaluation = {
			status: "incomplete",
			gaps: ["rules_missing"],
			risks: [],
		};

		const preview = buildAbsencePlanPreview({ ...baseInput, coverage });

		expect(preview.coverage).toEqual(coverage);
		expect(preview.reasons).not.toContain("Request follows the normal approval path.");
		expect(preview.reasons.join(" ")).not.toMatch(/coverage/i);
	});

	it("follows the normal approval path when coverage evidence is complete without warnings", () => {
		const preview = buildAbsencePlanPreview(baseInput);

		expect(preview.reasons).toContain("Request follows the normal approval path.");
	});

	it("does not predict approval", () => {
		expect(buildAbsencePlanPreview(baseInput)).not.toHaveProperty("approvalSignal");
	});

	it("exposes only the requester's own affected shift fields", () => {
		const affectedShift = {
			id: "shift-1",
			subareaId: "subarea-1",
			subareaName: "Front Desk",
			date: "2026-05-04",
			startTime: "22:00",
			endTime: "06:00",
			affectedStartTime: "22:00",
			affectedEndTime: "00:00",
		};

		const preview = buildAbsencePlanPreview({
			...baseInput,
			affectedShifts: [{ ...affectedShift, employeeId: "emp-1" } as typeof affectedShift],
		});

		expect(preview.affectedShifts).toEqual([affectedShift]);
	});

	it("explains manager-less approval behavior when approval is required", () => {
		const preview = buildAbsencePlanPreview({ ...baseInput, hasManager: false });
		expect(preview.reasons).toContain(
			"No manager is assigned, so this request follows the current auto-approval behavior.",
		);
	});

	it("explains when approval is not required", () => {
		const preview = buildAbsencePlanPreview({
			...baseInput,
			category: { ...baseInput.category, requiresApproval: false },
		});
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
		expect(preview.overlaps).toHaveLength(0);
		expect(preview.warnings).not.toContain("Request overlaps an existing rejected absence.");
	});

	it("keeps the balance reason alongside coverage warnings", () => {
		const preview = buildAbsencePlanPreview({
			...baseInput,
			vacationBalance: null,
			coverage: { status: "complete", gaps: [], risks: [coverageRisk] },
		});
		expect(preview.reasons).toContain("Vacation balance is unavailable for this year.");
		expect(preview.coverage.risks).toEqual([coverageRisk]);
	});

	it("counts only the employee's working days", () => {
		const preview = buildAbsencePlanPreview({
			...baseInput,
			request: { ...baseInput.request, startDate: "2026-10-12", endDate: "2026-10-16" },
			isWorkingDay: (day) => day.dayOfWeek <= 4,
		});

		expect(preview.requestedAbsenceDays).toBe(4);
		expect(preview.balance?.remainingAfterRequest).toBe(10);
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
