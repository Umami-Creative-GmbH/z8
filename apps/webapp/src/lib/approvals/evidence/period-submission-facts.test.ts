import { describe, expect, it } from "vitest";
import {
	isPeriodSubmissionSubmittedFacts,
	type PeriodSubmissionSubmittedFacts,
} from "./period-submission-facts";

const facts: PeriodSubmissionSubmittedFacts = {
	schemaVersion: 1,
	kind: "period_submission",
	organizationId: "org-1",
	periodSubmissionId: "submission-1",
	subjectEmployeeId: "employee-1",
	requesterEmployeeId: "employee-1",
	period: {
		cadence: "weekly",
		timezone: "Europe/Berlin",
		startDate: "2026-03-02",
		endDate: "2026-03-08",
		rangeStart: "2026-03-01T23:00:00Z",
		rangeEnd: "2026-03-08T23:00:00Z",
	},
	work: { totalMinutes: 0, dayTotals: {} },
	absences: [],
	holidays: [],
	target: null,
	violations: [],
};

describe("isPeriodSubmissionSubmittedFacts with driving details missing (#1127)", () => {
	it("keeps reading facts stored before driving details existed, in the same schema version", () => {
		expect(isPeriodSubmissionSubmittedFacts(facts)).toBe(true);
	});

	it("reads the work periods lacking driving details", () => {
		expect(
			isPeriodSubmissionSubmittedFacts({
				...facts,
				drivingDetailsMissing: [{ workPeriodId: "work-1", date: "2026-03-02" }],
			}),
		).toBe(true);
	});

	it("refuses malformed driving details facts", () => {
		expect(isPeriodSubmissionSubmittedFacts({ ...facts, drivingDetailsMissing: {} })).toBe(false);
		expect(
			isPeriodSubmissionSubmittedFacts({
				...facts,
				drivingDetailsMissing: [{ date: "2026-03-02" }],
			}),
		).toBe(false);
	});
});
