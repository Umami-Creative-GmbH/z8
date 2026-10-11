import { describe, expect, it } from "vitest";
import type { PeriodSubmissionSubmittedFacts } from "../evidence/period-submission-facts";
import { isApprovalInboxDetailChange, localizedTextFallback } from "../inbox/localized-text";
import type { ApprovalInboxDetailSection } from "../inbox/types";
import { buildPeriodSubmissionReviewSections } from "./period-submission-review";

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
	work: { totalMinutes: 945, dayTotals: { "2026-03-02": 510, "2026-03-03": 435 } },
	absences: [],
	holidays: [],
	target: null,
	violations: [],
};

/** Each section as its English title and `[label, value, extras]` rows. */
function rendered(sections: ApprovalInboxDetailSection[]) {
	return sections.map((section) => {
		if (section.type !== "key_value") return { type: section.type };
		return {
			title: localizedTextFallback(section.title),
			rows: section.rows.map((row) => {
				const value = isApprovalInboxDetailChange(row.value)
					? "change"
					: localizedTextFallback(row.value);
				const extras = {
					...(row.tone ? { tone: row.tone } : {}),
					...(row.href ? { href: row.href } : {}),
				};
				return Object.keys(extras).length > 0
					? [localizedTextFallback(row.label), value, extras]
					: [localizedTextFallback(row.label), value];
			}),
		};
	});
}

const build = (overrides: Partial<PeriodSubmissionSubmittedFacts> = {}) =>
	rendered(
		buildPeriodSubmissionReviewSections({
			facts: { ...facts, ...overrides },
			employeeName: "Ada Lovelace",
			submittedAt: "2026-03-08T12:00:00.000Z",
		}),
	);

describe("buildPeriodSubmissionReviewSections", () => {
	it("shows the period, its overall total, the day totals and a link to the calendar", () => {
		expect(build()).toEqual([
			{
				title: "Period submission",
				rows: [
					["Employee", "Ada Lovelace"],
					["Period", "2026-03-02 – 2026-03-08"],
					["Total", "15:45 h"],
					["Submitted", "2026-03-08T12:00:00.000Z"],
					[
						"Calendar",
						"Open the calendar for this period",
						{ href: "/calendar/employee-1?date=2026-03-02" },
					],
				],
			},
			{
				title: "Day totals",
				rows: [
					["2026-03-02", "8:30 h"],
					["2026-03-03", "7:15 h"],
				],
			},
		]);
	});

	it("shows the target and the difference where a work policy gives a target", () => {
		const sections = build({
			target: {
				totalMinutes: 960,
				dayTargets: { "2026-03-02": 480, "2026-03-03": 480 },
			},
		});
		expect(sections[0]?.rows).toEqual([
			["Employee", "Ada Lovelace"],
			["Period", "2026-03-02 – 2026-03-08"],
			["Total", "15:45 h"],
			["Target", "16:00 h"],
			["Difference", "-0:15 h", { tone: "warning" }],
			["Submitted", "2026-03-08T12:00:00.000Z"],
			[
				"Calendar",
				"Open the calendar for this period",
				{ href: "/calendar/employee-1?date=2026-03-02" },
			],
		]);
		expect(sections[1]?.rows).toEqual([
			["2026-03-02", "8:30 h of 8:00 h"],
			["2026-03-03", "7:15 h of 8:00 h"],
		]);
	});

	it("lists target days without work and counts overtime as a positive difference", () => {
		const sections = build({
			work: { totalMinutes: 600, dayTotals: { "2026-03-03": 600 } },
			target: { totalMinutes: 480, dayTargets: { "2026-03-02": 480 } },
		});
		expect(sections[0]?.rows).toContainEqual(["Difference", "+2:00 h"]);
		expect(sections[1]?.rows).toEqual([
			["2026-03-02", "0:00 h of 8:00 h"],
			["2026-03-03", "10:00 h"],
		]);
	});

	it("lists the approved absences, public holidays and recorded compliance violations", () => {
		const sections = build({
			absences: [
				{
					categoryName: "Vacation",
					startDate: "2026-03-04",
					startPeriod: "full_day",
					endDate: "2026-03-05",
					endPeriod: "full_day",
				},
				{
					categoryName: "Doctor",
					startDate: "2026-03-06",
					startPeriod: "pm",
					endDate: "2026-03-06",
					endPeriod: "pm",
				},
				{
					categoryName: "Training",
					startDate: "2026-03-07",
					startPeriod: "pm",
					endDate: "2026-03-08",
					endPeriod: "full_day",
				},
			],
			holidays: [{ name: "Women's Day", startDate: "2026-03-08", endDate: "2026-03-08" }],
			violations: [
				{ date: "2026-03-02", type: "max_daily" },
				{ date: "2026-03-02", type: "break_required" },
				{ date: "2026-03-03", type: "rest_period" },
			],
		});
		expect(sections.slice(2)).toEqual([
			{
				title: "Approved absences",
				rows: [
					["2026-03-04 – 2026-03-05", "Vacation"],
					["2026-03-06", "Doctor (half day)"],
					["2026-03-07 – 2026-03-08", "Training (with half days)"],
				],
			},
			{
				title: "Public holidays",
				rows: [["2026-03-08", "Women's Day"]],
			},
			{
				title: "Compliance violations",
				rows: [
					[
						"2026-03-02",
						"Maximum daily hours exceeded; Required break missing",
						{ tone: "warning" },
					],
					["2026-03-03", "Rest period too short", { tone: "warning" }],
				],
			},
		]);
	});
});
