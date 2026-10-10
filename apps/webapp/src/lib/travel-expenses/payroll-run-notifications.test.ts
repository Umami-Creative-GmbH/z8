import { describe, expect, it } from "vitest";
import { buildPayrollRunAwaitingConfirmationNotification } from "./payroll-run-notifications";

describe("buildPayrollRunAwaitingConfirmationNotification (#855)", () => {
	const run = {
		organizationId: "org-1",
		jobId: "job-1",
		formatName: "DATEV Lohn & Gehalt",
		periodStart: "2026-10-01",
		periodEnd: "2026-10-31",
	};

	it("names the run and the reports in the officer's scope, and links the confirm action", () => {
		const notification = buildPayrollRunAwaitingConfirmationNotification(run, {
			userId: "user-berlin",
			reports: 3,
		});

		expect(notification).toMatchObject({
			userId: "user-berlin",
			organizationId: "org-1",
			type: "travel_expense_payroll_run_awaiting_confirmation",
			title: "Payroll run awaiting confirmation",
			message:
				"Payroll run 2026-10 (DATEV Lohn & Gehalt) is waiting for your confirmation. Reports in your scope: 3.",
			entityType: "payroll_export_job",
			entityId: "job-1",
			actionUrl: "/travel-expenses/finance#payroll-runs",
			idempotencyKey: "travel-expense-payroll-run-awaiting-confirmation:job-1:user-berlin",
		});
		expect(notification.metadata?.i18n).toEqual({
			titleKey: "common:notifications.content.travelExpensePayrollRunAwaitingConfirmation.title",
			titleDefault: "Payroll run awaiting confirmation",
			messageKey:
				"common:notifications.content.travelExpensePayrollRunAwaitingConfirmation.message",
			messageDefault:
				"Payroll run {period} ({format}) is waiting for your confirmation. Reports in your scope: {count}.",
			params: { period: "2026-10", format: "DATEV Lohn & Gehalt", count: 3 },
		});
	});

	it("names a period other than a calendar month by its dates", () => {
		const notification = buildPayrollRunAwaitingConfirmationNotification(
			{ ...run, periodEnd: "2026-10-15" },
			{ userId: "user-all", reports: 1 },
		);
		expect(notification.message).toBe(
			"Payroll run 2026-10-01 – 2026-10-15 (DATEV Lohn & Gehalt) is waiting for your confirmation. Reports in your scope: 1.",
		);
	});
});
