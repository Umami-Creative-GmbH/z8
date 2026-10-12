import { and, eq, inArray } from "drizzle-orm";
import type { db as appDb } from "@/db";
import { user } from "@/db/auth-schema";
import { employee } from "@/db/schema";
import { DEFAULT_FINANCE_QUEUE_VIEW, financeQueueSearch } from "./finance-queue-params";
import { classifyPayrollRunCandidates } from "./payroll-run";
import type { PayrollRunSkip } from "./payroll-run-classification";
import { paysThroughPayrollRuns } from "./reimbursement-channel";
import type { SettlementSource, SettlementTitle } from "./settlement-store";

/**
 * Payroll readiness for payroll runs (#854, decision 18): each report or
 * legacy claim awaiting reimbursement that a payroll export of the period,
 * format and employees would not carry, with the reason. It never blocks the
 * export: these are paid by bank transfer, from the finance queue.
 *
 * It classifies with `classifyPayrollRunCandidates`, as the export does, so a
 * report is listed exactly when the export would skip it.
 */

type Database = typeof appDb;

export interface PayrollRunReadinessEntry {
	source: SettlementSource;
	employeeId: string;
	employeeName: string | null;
	title: SettlementTitle;
	/** What is still owed, per currency. */
	outstanding: Array<{ currency: string; amount: string }>;
	skip: PayrollRunSkip;
	/** The finance queue, filtered to the employee and currency, to pay it by bank transfer. */
	financeQueueHref: string;
}

export type PayrollRunReadiness =
	/** The organization pays by bank transfer (or the preview gate is closed): nothing to report. */
	{ applies: false } | { applies: true; entries: PayrollRunReadinessEntry[] };

export async function getPayrollRunReadiness(
	database: Database,
	input: {
		organizationId: string;
		/** Any payroll export format; an API connector carries nothing. */
		formatId: string;
		period: { startDate: string; endDate: string };
		/** The employees the export would cover: the reader's payroll scope, or a selection inside it. */
		employeeIds: readonly string[];
	},
): Promise<PayrollRunReadiness> {
	const { organizationId } = input;
	if (!(await paysThroughPayrollRuns(database, organizationId))) return { applies: false };
	const candidates = await classifyPayrollRunCandidates(database, {
		organizationId,
		format: input.formatId,
		period: input.period,
		employeeIds: input.employeeIds,
	});
	const skipped = candidates.flatMap(({ account, classification }) =>
		classification.outcome === "skip" ? [{ account, skip: classification.skip }] : [],
	);
	const names = await employeeNames(database, {
		organizationId,
		employeeIds: [...new Set(skipped.map(({ account }) => account.employeeId))],
	});
	return {
		applies: true,
		entries: skipped.map(({ account, skip }) => ({
			source: account.source,
			employeeId: account.employeeId,
			employeeName: names.get(account.employeeId) ?? null,
			title: account.title,
			outstanding: account.summary.currencies
				.filter((line) => line.state === "outstanding")
				.map((line) => ({ currency: line.currency, amount: line.balance })),
			skip,
			financeQueueHref: `/travel-expenses/finance?${financeQueueSearch({
				...DEFAULT_FINANCE_QUEUE_VIEW,
				employeeId: account.employeeId,
				currency: account.currency,
			})}`,
		})),
	};
}

async function employeeNames(
	database: Database,
	input: { organizationId: string; employeeIds: string[] },
): Promise<Map<string, string | null>> {
	if (input.employeeIds.length === 0) return new Map();
	const rows = await database
		.select({ id: employee.id, name: user.name })
		.from(employee)
		.leftJoin(user, eq(user.id, employee.userId))
		.where(
			and(
				eq(employee.organizationId, input.organizationId),
				inArray(employee.id, input.employeeIds),
			),
		);
	return new Map(rows.map((row) => [row.id, row.name]));
}
