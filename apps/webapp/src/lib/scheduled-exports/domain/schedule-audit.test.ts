import { describe, expect, it } from "vitest";
import { type AuditedSchedule, scheduleUpdateAudit } from "./schedule-audit";

function schedule(overrides: Partial<AuditedSchedule> = {}): AuditedSchedule {
	return {
		name: "Monthly payroll",
		description: null,
		scheduleType: "monthly",
		cronExpression: null,
		timezone: "Europe/Berlin",
		reportType: "payroll_export",
		reportConfig: { formatId: "datev_lohn" },
		payrollConfigId: null,
		filters: null,
		dateRangeStrategy: "previous_month",
		customOffset: null,
		deliveryMethod: "email_only",
		emailRecipients: ["payroll@example.com", "hr@example.com"],
		emailSubjectTemplate: null,
		isActive: true,
		...overrides,
	};
}

describe("scheduleUpdateAudit", () => {
	it("records nothing when an update changes nothing", () => {
		expect(scheduleUpdateAudit(schedule(), schedule())).toEqual([]);
	});

	it("diffs recipients, delivery method, report type and filters before and after", () => {
		const entries = scheduleUpdateAudit(
			schedule(),
			schedule({
				deliveryMethod: "s3_and_email",
				reportType: "data_export",
				filters: { teamIds: ["team-1"] },
				emailRecipients: ["hr@example.com", "tax@example.com"],
			}),
		);

		expect(entries).toEqual([
			{
				kind: "updated",
				changes: {
					reportType: { before: "payroll_export", after: "data_export" },
					filters: { before: null, after: { teamIds: ["team-1"] } },
					deliveryMethod: { before: "email_only", after: "s3_and_email" },
					emailRecipients: {
						before: ["payroll@example.com", "hr@example.com"],
						after: ["hr@example.com", "tax@example.com"],
						added: ["tax@example.com"],
						removed: ["payroll@example.com"],
					},
				},
			},
		]);
	});

	it("does not count reordered recipients or reordered filter keys as a change", () => {
		expect(
			scheduleUpdateAudit(
				schedule({ filters: { teamIds: ["team-1"], projectIds: ["project-1"] } }),
				schedule({
					emailRecipients: ["hr@example.com", "payroll@example.com"],
					filters: { projectIds: ["project-1"], teamIds: ["team-1"] },
				}),
			),
		).toEqual([]);
	});

	it("records a pause or a resume as its own entry, apart from other changes", () => {
		expect(scheduleUpdateAudit(schedule(), schedule({ isActive: false }))).toEqual([
			{ kind: "paused" },
		]);
		expect(
			scheduleUpdateAudit(
				schedule({ isActive: false }),
				schedule({ name: "Payroll", isActive: true }),
			),
		).toEqual([
			{ kind: "updated", changes: { name: { before: "Monthly payroll", after: "Payroll" } } },
			{ kind: "resumed" },
		]);
	});
});
