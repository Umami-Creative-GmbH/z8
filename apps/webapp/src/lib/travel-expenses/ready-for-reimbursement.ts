import type { db as appDb } from "@/db";
import { createLogger } from "@/lib/logger";
import { createNotification } from "@/lib/notifications/notification-service";
import type { CreateNotificationParams } from "@/lib/notifications/types";
import { latestApprovedAdjustment, loadApprovedAdjustments } from "./adjustment-read";
import { readApprovalTeamIds } from "./approval-teams";
import { listReimbursingOfficers } from "./expense-officer-grant-store";
import { parseUnits, STORED_AMOUNT_SCALE } from "./money";
import { fillMessageDefault } from "./notification-message";
import { coveringOfficers, type ReimbursingOfficer } from "./officer-scope";
import { paysThroughPayrollRuns } from "./reimbursement-channel";
import { loadSettlementAccount, type SettlementAccount } from "./settlement-store";

/**
 * Tells expense officers when reimbursement work arrives (#756): a report is
 * approved (a reviewer's approval or the owner's self-approval) with money
 * owed to its employee, or an approved adjustment raises what an account owes.
 * The recipients are the active officers who can record reimbursements and
 * whose scope covers the report, never its own employee; owners and admins
 * are not notified. One notification per officer and approved revision.
 *
 * With the payroll channel (#855, decision 19) approvals notify nobody: a
 * payroll run notifies per run instead (`payroll-run-notifications.ts`). A
 * report that needs a bank transfer after all, because a run left it out, it
 * was removed from a run or its run was discarded, notifies per report then,
 * under the same once-per-officer-and-approved-revision key.
 */

const logger = createLogger("TravelExpenseOfficerNotifications");

const readyCopy = {
	approved: {
		messageKey: "common:notifications.content.travelExpenseReadyForReimbursement.message",
		messageDefault:
			"{employee}'s expense report {report} is approved. Awaiting reimbursement: {amounts}.",
	},
	adjustment: {
		messageKey: "common:notifications.content.travelExpenseAdjustmentReadyForReimbursement.message",
		messageDefault:
			"An approved adjustment raised what is owed on {employee}'s expense report {report}. Awaiting reimbursement: {amounts}.",
	},
	leftOut: {
		messageKey: "common:notifications.content.travelExpenseLeftOutOfPayrollRun.message",
		messageDefault:
			"{employee}'s expense report {report} isn't reimbursed through a payroll run. Awaiting reimbursement: {amounts}.",
	},
} as const;
const readyTitle = {
	titleKey: "common:notifications.content.travelExpenseReadyForReimbursement.title",
	titleDefault: "Ready for reimbursement",
} as const;

/** Reimbursement work that arrived with one approval. */
export interface ReadyForReimbursement {
	/**
	 * `adjustment`: an approved adjustment (#615) raised what the account owes.
	 * `leftOut`: no payroll run carries the report, which awaits a bank transfer (#855).
	 */
	kind: "approved" | "adjustment" | "leftOut";
	/** The account money is owed on: the report's own, or the adjusted original's. */
	account: SettlementAccount;
	/** The approved revision of the decided report; one notification each. */
	revisionId: string;
	/** What the account awaits now, per currency. */
	awaiting: Array<{ currency: string; amount: string }>;
}

function isPositive(amount: string): boolean {
	const units = parseUnits(amount, STORED_AMOUNT_SCALE);
	return units !== null && units > BigInt(0);
}

/**
 * Whether approving `decided` brought reimbursement work, and which. `owed` is
 * the account money is owed on: `decided` itself, or for an adjustment report
 * the original report it corrects. Nothing is due when nothing is owed, or
 * when an adjustment lowers the amount.
 */
export function readyForReimbursement(
	decided: SettlementAccount,
	owed: SettlementAccount,
): ReadyForReimbursement | null {
	const revisionId = decided.basis?.revisionId;
	if (!decided.approved || !owed.approved || !revisionId) return null;
	if (decided.adjustmentOf !== null) {
		if (owed.source.id !== decided.adjustmentOf) return null;
		if (!decided.adjustmentDelta || !isPositive(decided.adjustmentDelta)) return null;
	}
	const awaiting = awaitingAmounts(owed);
	if (awaiting.length === 0) return null;
	return {
		kind: decided.adjustmentOf === null ? "approved" : "adjustment",
		account: owed,
		revisionId,
		awaiting,
	};
}

function awaitingAmounts(account: SettlementAccount): ReadyForReimbursement["awaiting"] {
	return account.summary.currencies
		.filter((line) => line.state === "outstanding")
		.map((line) => ({ currency: line.currency, amount: line.balance }));
}

/**
 * Whether an approved report no payroll run carries awaits reimbursement.
 * `revisionId` is its latest approved revision: its latest approved
 * adjustment's, else its own, so the key matches the approval's notification.
 * Nothing is due while an unconfirmed run still includes it.
 */
export function leftOutOfPayrollRun(
	account: SettlementAccount,
	revisionId: string,
): ReadyForReimbursement | null {
	if (!account.approved || account.adjustmentOf !== null || account.payrollRun) return null;
	const awaiting = awaitingAmounts(account);
	if (awaiting.length === 0) return null;
	return { kind: "leftOut", account, revisionId, awaiting };
}

function reportLabel(account: SettlementAccount): string {
	const { title } = account;
	switch (title.kind) {
		case "trip":
			return title.purpose?.trim() || "Untitled trip";
		case "standalone":
			return title.description?.trim() || "Untitled receipt";
		case "legacy_claim":
			return "Legacy claim";
	}
}

export function buildReadyForReimbursementNotification(
	due: ReadyForReimbursement,
	recipient: { userId: string },
): CreateNotificationParams {
	const { account } = due;
	const copy = readyCopy[due.kind];
	const params = {
		employee: account.employeeName?.trim() || "an employee",
		report: reportLabel(account),
		amounts: due.awaiting.map((line) => `${line.amount} ${line.currency}`).join(", "),
	};
	return {
		userId: recipient.userId,
		organizationId: account.organizationId,
		type: "travel_expense_ready_for_reimbursement",
		title: readyTitle.titleDefault,
		message: fillMessageDefault(copy.messageDefault, params),
		entityType: "travel_expense_report",
		entityId: account.source.id,
		actionUrl: `/travel-expenses/reports/${account.source.id}`,
		idempotencyKey: `travel-expense-ready-for-reimbursement:${due.revisionId}:${recipient.userId}`,
		metadata: {
			revisionId: due.revisionId,
			i18n: { ...readyTitle, ...copy, params },
		},
	};
}

type Database = typeof appDb;
type Executor = Database | Parameters<Parameters<Database["transaction"]>[0]>[0];

/**
 * Notifies the covering officers of an approved report. Call it after the
 * approval committed; it never throws, because the approval stands either way.
 * With the payroll channel it notifies nobody (#855).
 */
export async function notifyReadyForReimbursement(
	database: Executor,
	input: { organizationId: string; reportId: string },
): Promise<void> {
	const { organizationId } = input;
	try {
		if (await paysThroughPayrollRuns(database, organizationId)) return;
		const decided = await loadSettlementAccount(database, {
			organizationId,
			source: { type: "report", id: input.reportId },
		});
		if (!decided?.approved) return;
		const owed = decided.adjustmentOf
			? await loadSettlementAccount(database, {
					organizationId,
					source: { type: "report", id: decided.adjustmentOf },
				})
			: decided;
		if (!owed) return;
		const due = readyForReimbursement(decided, owed);
		if (!due) return;
		const officers = await listReimbursingOfficers(database, { organizationId });
		await notifyCoveringOfficers(database, due, officers);
	} catch (error) {
		logger.error(
			{ error, organizationId, reportId: input.reportId },
			"Failed to notify expense officers of an approved report",
		);
	}
}

async function notifyCoveringOfficers(
	database: Executor,
	due: ReadyForReimbursement,
	officers: readonly ReimbursingOfficer[],
): Promise<void> {
	if (officers.length === 0) return;
	const { account } = due;
	const approvalTeamIds = await readApprovalTeamIds(database, {
		organizationId: account.organizationId,
		source: account.source,
	});
	const recipients = coveringOfficers(officers, {
		employeeId: account.employeeId,
		approvalTeamIds,
	});
	await Promise.all(
		recipients.map((officer) =>
			createNotification(buildReadyForReimbursementNotification(due, officer)),
		),
	);
}

/**
 * Notifies the covering officers of approved reports that no payroll run
 * carries after all (#855): a run left them out, they were removed from a run
 * or their run was discarded. Whatever the channel, each notifies once per
 * officer and latest approved revision, sharing the approval's key: a report
 * whose approval already notified, or that a run left out before, notifies
 * nobody again. `exceptUserId` is the officer who freed them. Call it after
 * the change committed; it never throws.
 */
export async function notifyReportsLeftOutOfPayrollRun(
	database: Executor,
	input: { organizationId: string; reportIds: readonly string[]; exceptUserId?: string },
): Promise<void> {
	const { organizationId, reportIds } = input;
	if (reportIds.length === 0) return;
	try {
		const officers = (await listReimbursingOfficers(database, { organizationId })).filter(
			(officer) => officer.userId !== input.exceptUserId,
		);
		if (officers.length === 0) return;
		const adjustments = await loadApprovedAdjustments(database, {
			organizationId,
			originalReportIds: reportIds,
		});
		for (const reportId of reportIds) {
			const account = await loadSettlementAccount(database, {
				organizationId,
				source: { type: "report", id: reportId },
			});
			const revisionId =
				latestApprovedAdjustment(adjustments.get(reportId) ?? [])?.revisionId ??
				account?.basis?.revisionId;
			const due = account && revisionId ? leftOutOfPayrollRun(account, revisionId) : null;
			if (due) await notifyCoveringOfficers(database, due, officers);
		}
	} catch (error) {
		logger.error(
			{ error, organizationId, reportIds },
			"Failed to notify expense officers of reports no payroll run carries",
		);
	}
}
