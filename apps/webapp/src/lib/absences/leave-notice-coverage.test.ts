import { Temporal } from "temporal-polyfill";
import { describe, expect, it } from "vitest";
import { type CoverableLeaveNotice, leaveNoticeCoverage } from "./leave-notice-coverage";

const deadline = (value: string) => Temporal.Instant.from(value);

function notice(id: string, overrides: Partial<CoverableLeaveNotice> = {}): CoverableLeaveNotice {
	return {
		id,
		leaveYear: 2027,
		days: 5,
		deliveredOn: "2027-09-01",
		deadline: deadline("2027-12-31T22:59:59.999Z"),
		opportunityDocumented: true,
		...overrides,
	};
}

describe("leaveNoticeCoverage", () => {
	it("leaves noticed days outstanding until the opportunity to take them is documented", () => {
		expect(
			leaveNoticeCoverage(new Map([[2027, 5]]), [notice("a", { opportunityDocumented: false })]),
		).toEqual([
			{
				leaveYear: 2027,
				outstandingDays: 5,
				coveredDays: 0,
				awaitingOpportunityDays: 5,
				uncoveredDays: 0,
				notices: [{ id: "a", coveredDays: 0, awaitingOpportunityDays: 5 }],
			},
		]);
	});

	it("covers at most the notice's five days when two days are added after it", () => {
		expect(leaveNoticeCoverage(new Map([[2027, 7]]), [notice("a")])).toEqual([
			{
				leaveYear: 2027,
				outstandingDays: 7,
				coveredDays: 5,
				awaitingOpportunityDays: 0,
				uncoveredDays: 2,
				notices: [{ id: "a", coveredDays: 5, awaitingOpportunityDays: 0 }],
			},
		]);
	});

	it("covers the added days once a new notice and its opportunity assessment cover them", () => {
		const twoMore = notice("b", { days: 2, deliveredOn: "2027-10-01" });
		expect(leaveNoticeCoverage(new Map([[2027, 7]]), [notice("a"), twoMore])).toEqual([
			expect.objectContaining({ coveredDays: 7, uncoveredDays: 0 }),
		]);
		expect(
			leaveNoticeCoverage(new Map([[2027, 7]]), [
				notice("a"),
				{ ...twoMore, opportunityDocumented: false },
			]),
		).toEqual([
			expect.objectContaining({ coveredDays: 5, awaitingOpportunityDays: 2, uncoveredDays: 0 }),
		]);
	});

	it("never covers more than the days still outstanding, earliest deadline first", () => {
		const later = notice("later", { days: 7, deadline: deadline("2028-03-31T21:59:59.999Z") });
		expect(leaveNoticeCoverage(new Map([[2027, 6]]), [later, notice("a")])).toEqual([
			{
				leaveYear: 2027,
				outstandingDays: 6,
				coveredDays: 6,
				awaitingOpportunityDays: 0,
				uncoveredDays: 0,
				notices: [
					{ id: "a", coveredDays: 5, awaitingOpportunityDays: 0 },
					{ id: "later", coveredDays: 1, awaitingOpportunityDays: 0 },
				],
			},
		]);
	});

	it("keeps each leave year separate and reports notices of years with nothing outstanding", () => {
		expect(
			leaveNoticeCoverage(
				new Map([
					[2027, 3],
					[2028, 30],
				]),
				[notice("old", { leaveYear: 2026 }), notice("a")],
			),
		).toEqual([
			{
				leaveYear: 2026,
				outstandingDays: 0,
				coveredDays: 0,
				awaitingOpportunityDays: 0,
				uncoveredDays: 0,
				notices: [{ id: "old", coveredDays: 0, awaitingOpportunityDays: 0 }],
			},
			expect.objectContaining({ leaveYear: 2027, coveredDays: 3, uncoveredDays: 0 }),
			expect.objectContaining({ leaveYear: 2028, coveredDays: 0, uncoveredDays: 30, notices: [] }),
		]);
	});
});
