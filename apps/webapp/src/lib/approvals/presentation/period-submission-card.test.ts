import { describe, expect, it, vi } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import type { PeriodSubmissionSubmittedFacts } from "../evidence/period-submission-facts";
import type { PeriodSubmissionSubmittedRevisionRecord } from "../evidence/store";

vi.mock("@/db", () => ({ db: {} }));
vi.mock("../evidence/store", () => ({}));
vi.mock("../evidence/invocation", () => ({}));
vi.mock("@/lib/bot-platform/i18n", () => ({}));
vi.mock("@/lib/notifications/recipient-display-context", () => ({}));
vi.mock("./review-navigation", () => ({}));

const { periodSubmissionCardFacts } = await import("./period-submission-card");

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

function revision(
	overrides: Partial<PeriodSubmissionSubmittedFacts> = {},
): PeriodSubmissionSubmittedRevisionRecord {
	return {
		id: "revision-1",
		organizationId: "org-1",
		workflowId: "workflow-1",
		periodSubmissionId: "submission-1",
		requestCycleKey: "period-submission:submission-1",
		revision: 1,
		subjectEmployeeId: "employee-1",
		submitter: { kind: "employee", employeeId: "employee-1", userId: "user-1" },
		materialFingerprint: "fingerprint",
		facts: { ...facts, ...overrides },
		labels: { subjectName: "Ada Lovelace" },
		submittedAt: parseInstant("2026-03-08T12:00:00Z"),
	};
}

const t = (_key: string, fallback: string, params?: Record<string, string | number>) =>
	fallback.replace(/\{(\w+)\}/g, (match, name: string) =>
		params && name in params ? String(params[name]) : match,
	);
const display = { locale: "en-US", timezone: "Europe/Berlin", timeFormat: "24h" as const };

describe("periodSubmissionCardFacts", () => {
	it("shows the employee, the period and its total, without a target when none was given", () => {
		const shown = periodSubmissionCardFacts(revision(), display, t);
		expect(shown.map((fact) => fact.label)).toEqual(["Employee", "Period", "Total", "Submitted"]);
		expect(shown[2]).toEqual({ label: "Total", value: "15:45 h" });
	});

	it("adds the target, the difference, absences, holidays and the number of violations", () => {
		const shown = periodSubmissionCardFacts(
			revision({
				target: { totalMinutes: 960, dayTargets: { "2026-03-02": 480, "2026-03-03": 480 } },
				absences: [
					{
						categoryName: "Doctor",
						startDate: "2026-03-06",
						startPeriod: "pm",
						endDate: "2026-03-06",
						endPeriod: "pm",
					},
				],
				holidays: [{ name: "Founders' Day", startDate: "2026-03-05", endDate: "2026-03-05" }],
				violations: [
					{ date: "2026-03-02", type: "max_daily" },
					{ date: "2026-03-03", type: "rest_period" },
				],
			}),
			display,
			t,
		);
		expect(shown).toEqual([
			{ label: "Employee", value: "Ada Lovelace" },
			expect.objectContaining({ label: "Period" }),
			{ label: "Total", value: "15:45 h" },
			{ label: "Target", value: "16:00 h" },
			{ label: "Difference", value: "-0:15 h" },
			{ label: "Absences", value: "Doctor (Mar 6)" },
			{ label: "Public holidays", value: "Founders' Day (Mar 5)" },
			{ label: "Compliance violations", value: "2" },
			expect.objectContaining({ label: "Submitted" }),
		]);
	});
});
