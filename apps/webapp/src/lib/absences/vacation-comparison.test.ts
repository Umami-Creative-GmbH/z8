import { describe, expect, it } from "vitest";
import {
	addComparisonAlternative,
	canAddComparisonAlternative,
	comparisonDatesOf,
	comparisonOptionIssue,
	comparisonOptions,
	comparisonPreviewRequest,
	duplicateComparisonOption,
	isComparisonEligibleCategory,
	MAX_COMPARISON_ALTERNATIVES,
	removeComparisonAlternative,
	resumeVacationComparison,
	startVacationComparison,
	updateComparisonAlternative,
} from "./vacation-comparison";

const draft = {
	startDate: "2026-12-30",
	endDate: "2027-01-02",
	startPeriod: "full_day" as const,
	endPeriod: "full_day" as const,
	durationKind: "full_day" as const,
	startTime: "",
	endTime: "",
};

function start() {
	return startVacationComparison({ contextKey: "org-1:user-1", categoryId: "vacation", draft });
}

describe("isComparisonEligibleCategory", () => {
	it("accepts only a vacation-type category that counts against vacation", () => {
		expect(isComparisonEligibleCategory({ type: "vacation", countsAgainstVacation: true })).toBe(
			true,
		);
		expect(isComparisonEligibleCategory({ type: "vacation", countsAgainstVacation: false })).toBe(
			false,
		);
		// The balance flag alone is not enough.
		expect(isComparisonEligibleCategory({ type: "custom", countsAgainstVacation: true })).toBe(
			false,
		);
		expect(isComparisonEligibleCategory({ type: "sick", countsAgainstVacation: false })).toBe(
			false,
		);
		expect(
			isComparisonEligibleCategory({ type: "time_off_in_lieu", countsAgainstVacation: false }),
		).toBe(false);
		expect(isComparisonEligibleCategory(undefined)).toBe(false);
	});
});

describe("vacation comparison options", () => {
	it("starts with the draft as the labeled original and no alternatives", () => {
		const comparison = start();

		expect(comparisonOptions(comparison)).toEqual([
			expect.objectContaining({ kind: "original", position: 0, ...draft }),
		]);
		expect(comparison.categoryId).toBe("vacation");
		expect(comparison.contextKey).toBe("org-1:user-1");
	});

	it("adds blank alternatives up to the cap of two", () => {
		let comparison = start();
		comparison = addComparisonAlternative(comparison);
		comparison = addComparisonAlternative(comparison);

		expect(MAX_COMPARISON_ALTERNATIVES).toBe(2);
		expect(canAddComparisonAlternative(comparison)).toBe(false);
		expect(addComparisonAlternative(comparison)).toBe(comparison);
		expect(comparisonOptions(comparison).map((option) => [option.kind, option.position])).toEqual([
			["original", 0],
			["alternative", 1],
			["alternative", 2],
		]);
		expect(comparisonOptions(comparison)[1]).toMatchObject({
			startDate: "",
			endDate: "",
			durationKind: "full_day",
		});
	});

	it("duplicates the original or an alternative as a new alternative within the cap", () => {
		let comparison = duplicateComparisonOption(start(), start().original.id);
		const [, copy] = comparisonOptions(comparison);
		expect(copy).toMatchObject({ kind: "alternative", ...draft });

		comparison = updateComparisonAlternative(comparison, copy.id, { endDate: "2027-01-08" });
		comparison = duplicateComparisonOption(comparison, copy.id);
		expect(comparisonOptions(comparison)[2]).toMatchObject({
			kind: "alternative",
			endDate: "2027-01-08",
		});
		expect(duplicateComparisonOption(comparison, copy.id)).toBe(comparison);
	});

	it("keeps the original baseline while alternatives are edited and removed", () => {
		let comparison = addComparisonAlternative(start());
		const [, alternative] = comparisonOptions(comparison);

		comparison = updateComparisonAlternative(comparison, alternative.id, {
			startDate: "2027-02-01",
			endDate: "2027-02-05",
		});
		expect(comparison.original).toMatchObject(draft);
		expect(comparisonOptions(comparison)[1]).toMatchObject({
			startDate: "2027-02-01",
			endDate: "2027-02-05",
		});
		// The original is not an editable alternative.
		expect(
			updateComparisonAlternative(comparison, comparison.original.id, { startDate: "2027-03-01" }),
		).toBe(comparison);

		comparison = removeComparisonAlternative(comparison, alternative.id);
		expect(comparisonOptions(comparison)).toHaveLength(1);
		expect(comparison.original).toMatchObject(draft);
		expect(canAddComparisonAlternative(comparison)).toBe(true);
	});

	it("resumes with the current draft as the original and keeps the alternatives", () => {
		const comparison = addComparisonAlternative(start());
		const resumed = resumeVacationComparison(comparison, { ...draft, endDate: "2027-01-04" });

		expect(resumed.original).toMatchObject({ ...draft, endDate: "2027-01-04" });
		expect(resumed.alternatives).toEqual(comparison.alternatives);
	});

	it("gives every new alternative its own identity", () => {
		let comparison = addComparisonAlternative(start());
		const [, first] = comparisonOptions(comparison);
		comparison = removeComparisonAlternative(comparison, first.id);
		comparison = addComparisonAlternative(comparison);

		expect(comparisonOptions(comparison)[1].id).not.toBe(first.id);
	});
});

describe("comparisonOptionIssue", () => {
	const option = { ...draft };

	it("accepts full-day, same-day partial and overnight partial options", () => {
		expect(comparisonOptionIssue(option)).toBeNull();
		expect(
			comparisonOptionIssue({
				...option,
				startDate: "2026-12-31",
				endDate: "",
				durationKind: "partial_day",
				startTime: "09:00",
				endTime: "13:00",
			}),
		).toBeNull();
		expect(
			comparisonOptionIssue({
				...option,
				startDate: "2026-12-31",
				endDate: "2027-01-01",
				durationKind: "partial_day",
				startTime: "22:00",
				endTime: "02:00",
			}),
		).toBeNull();
	});

	it("names why an option cannot be evaluated", () => {
		expect(comparisonOptionIssue({ ...option, startDate: "" })).toBe("start_date_required");
		expect(
			comparisonOptionIssue({ ...option, startDate: "2026-12-31", endDate: "2026-12-01" }),
		).toBe("end_before_start");
		expect(
			comparisonOptionIssue({ ...option, durationKind: "partial_day", startTime: "", endTime: "" }),
		).toBe("times_required");
		expect(
			comparisonOptionIssue({
				...option,
				startDate: "2026-12-31",
				endDate: "2026-12-31",
				durationKind: "partial_day",
				startTime: "13:00",
				endTime: "09:00",
			}),
		).toBe("end_time_before_start");
		expect(
			comparisonOptionIssue({
				...option,
				durationKind: "partial_day",
				startTime: "09:00",
				endTime: "13:00",
			}),
		).toBe("partial_day_span");
		expect(comparisonOptionIssue({ ...option, endDate: "2026-13-01" })).toBe("invalid_date");
		expect(
			comparisonOptionIssue({
				...option,
				durationKind: "partial_day",
				endDate: "",
				startTime: "9",
				endTime: "13:00",
			}),
		).toBe("invalid_time");
	});
});

describe("comparisonPreviewRequest", () => {
	it("builds the same normalized request the ordinary preview sends", () => {
		expect(
			comparisonPreviewRequest("vacation", {
				...draft,
				startDate: "2026-12-31",
				endDate: "",
				durationKind: "partial_day",
				startTime: "09:00",
				endTime: "13:00",
			}),
		).toEqual({
			categoryId: "vacation",
			startDate: "2026-12-31",
			startPeriod: "am",
			endDate: "2026-12-31",
			endPeriod: "am",
			durationKind: "partial_day",
			startTime: "09:00",
			endTime: "13:00",
		});
		expect(comparisonPreviewRequest("vacation", draft)).toEqual({
			categoryId: "vacation",
			startDate: "2026-12-30",
			startPeriod: "full_day",
			endDate: "2027-01-02",
			endPeriod: "full_day",
			durationKind: "full_day",
			startTime: undefined,
			endTime: undefined,
		});
	});
});

describe("comparisonDatesOf", () => {
	it("copies only the dates, duration and exact times an option chooses", () => {
		const fields = comparisonDatesOf({
			id: "alternative-1",
			kind: "alternative",
			position: 1,
			...draft,
			startDate: "2026-12-31",
			endDate: "2027-01-01",
			durationKind: "partial_day",
			startTime: "22:00",
			endTime: "02:00",
		});

		expect(fields).toEqual({
			startDate: "2026-12-31",
			endDate: "2027-01-01",
			startPeriod: "full_day",
			endPeriod: "full_day",
			durationKind: "partial_day",
			startTime: "22:00",
			endTime: "02:00",
		});
	});
});
