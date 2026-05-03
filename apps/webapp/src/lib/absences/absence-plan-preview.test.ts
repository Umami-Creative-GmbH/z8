import { describe, expect, it } from "vitest";
import {
	buildAbsencePlanPreview,
	type AbsencePlanPreviewInput,
	type CoverageEvaluationInput,
} from "./absence-plan-preview";

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
	existingAbsences: [],
	affectedShifts: [],
	coverage: { risks: [], hasConfiguredRulesForAffectedShifts: true },
	hasManager: true,
};

describe("buildAbsencePlanPreview", () => {
	it("calculates balance impact for vacation-counting categories", () => {
		const preview = buildAbsencePlanPreview(baseInput);

		expect(preview.requestedDays).toBe(2);
		expect(preview.balance?.remainingAfterRequest).toBe(12);
		expect(preview.approvalSignal).toBe("likely");
		expect(preview.reasons).toContain("Request follows the normal approval path.");
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

		expect(preview.approvalSignal).toBe("risky");
		expect(preview.warnings).toContain("Vacation balance would be negative after this request.");
	});

	it("includes holidays inside the request range", () => {
		const preview = buildAbsencePlanPreview({
			...baseInput,
			holidays: [
				{
					id: "holiday-1",
					name: "Liberation Day",
					startDate: new Date("2026-05-05T00:00:00.000Z"),
					endDate: new Date("2026-05-05T00:00:00.000Z"),
					categoryId: "public",
				},
			],
		});

		expect(preview.holidays).toEqual([
			{
				id: "holiday-1",
				name: "Liberation Day",
				startDate: "2026-05-05",
				endDate: "2026-05-05",
			},
		]);
		expect(preview.requestedDays).toBe(1);
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
			vacationBalance: null,
		});

		expect(preview.approvalSignal).toBe("needs_review");
		expect(preview.reasons).toContain("Vacation balance is unavailable for this year.");
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
		expect(preview.warnings).toContain("Published coverage would drop below the configured minimum.");
	});
});
