import type { db as appDb } from "@/db";
import { createLogger } from "@/lib/logger";
import { createNotification } from "@/lib/notifications/notification-service";
import type { CreateNotificationParams } from "@/lib/notifications/types";
import { listReimbursingOfficers } from "./expense-officer-grant-store";
import { payrollRunToConfirmHref } from "./finance-queue-params";
import type { PayrollRunSkipped } from "./payroll-run";
import { loadIncludedReportsForConfirmer } from "./payroll-run-confirmation";
import { loadPayrollRunHeader, type PayrollRunHeader } from "./payroll-run-inclusion-read";
import { payrollPeriodText } from "./payroll-run-period";
import { notifyReportsLeftOutOfPayrollRun } from "./ready-for-reimbursement";

/**
 * Tells expense officers about a payroll run once it is exported (#855,
 * decision 19). With the payroll channel the per-report *ready for
 * reimbursement* notification is held back at approval; instead every active
 * officer who can record reimbursements gets one notification per run that
 * includes reports in their scope, never counting their own, linking to the
 * confirm action. Reports the run leaves out need a bank transfer, so they
 * notify per report as before, once.
 */

const logger = createLogger("PayrollRunNotifications");

const awaitingConfirmationCopy = {
	titleKey: "common:notifications.content.travelExpensePayrollRunAwaitingConfirmation.title",
	titleDefault: "Payroll run awaiting confirmation",
	messageKey: "common:notifications.content.travelExpensePayrollRunAwaitingConfirmation.message",
	messageDefault:
		"Payroll run {period} ({format}) is waiting for your confirmation. Reports in your scope: {count}.",
} as const;

export function buildPayrollRunAwaitingConfirmationNotification(
	run: Pick<PayrollRunHeader, "jobId" | "formatName" | "periodStart" | "periodEnd"> & {
		organizationId: string;
	},
	recipient: { userId: string; reports: number },
): CreateNotificationParams {
	const params = {
		period: payrollPeriodText(run.periodStart, run.periodEnd),
		format: run.formatName,
		count: recipient.reports,
	};
	return {
		userId: recipient.userId,
		organizationId: run.organizationId,
		type: "travel_expense_payroll_run_awaiting_confirmation",
		title: awaitingConfirmationCopy.titleDefault,
		message: awaitingConfirmationCopy.messageDefault.replace(
			/\{(period|format|count)\}/g,
			(_, key: keyof typeof params) => String(params[key]),
		),
		entityType: "payroll_export_job",
		entityId: run.jobId,
		actionUrl: payrollRunToConfirmHref(run.jobId),
		// A retried export of the same job tells nobody twice.
		idempotencyKey: `travel-expense-payroll-run-awaiting-confirmation:${run.jobId}:${recipient.userId}`,
		metadata: { i18n: { ...awaitingConfirmationCopy, params } },
	};
}

type Database = typeof appDb;

/**
 * Notifies the officers of an exported payroll run, and of every report it
 * left out that no other run carries. Call it after the export committed; it
 * never throws, because the export stands either way.
 */
export async function notifyPayrollRunExported(
	database: Database,
	input: { organizationId: string; jobId: string; skipped: readonly PayrollRunSkipped[] },
): Promise<void> {
	const { organizationId, jobId } = input;
	try {
		await notifyRunOfficers(database, { organizationId, jobId });
	} catch (error) {
		logger.error(
			{ error, organizationId, jobId },
			"Failed to notify expense officers of a payroll run awaiting confirmation",
		);
	}
	// Legacy claims never notified per report; a report another run includes needs no transfer.
	await notifyReportsLeftOutOfPayrollRun(database, {
		organizationId,
		reportIds: input.skipped.flatMap((skip) =>
			skip.source.type === "report" && skip.reason !== "included_in_other_run"
				? [skip.source.id]
				: [],
		),
	});
}

async function notifyRunOfficers(
	database: Database,
	input: { organizationId: string; jobId: string },
): Promise<void> {
	const { organizationId, jobId } = input;
	const officers = await listReimbursingOfficers(database, { organizationId });
	if (officers.length === 0) return;
	const reports = new Map<string, number>();
	for (const officer of officers) {
		// Counted as the list of runs to confirm counts: what the officer finds there.
		const included = await loadIncludedReportsForConfirmer(database, {
			organizationId,
			scope: officer.scope,
			confirmerEmployeeId: officer.officerEmployeeId,
			jobId,
		});
		const confirmable = included.filter((report) => report.confirmable).length;
		if (confirmable > 0) reports.set(officer.userId, confirmable);
	}
	if (reports.size === 0) return;
	const run = await loadPayrollRunHeader(database, { organizationId, jobId });
	if (!run) return;
	await Promise.all(
		[...reports].map(([userId, count]) =>
			createNotification(
				buildPayrollRunAwaitingConfirmationNotification(
					{ ...run, organizationId },
					{ userId, reports: count },
				),
			),
		),
	);
}
