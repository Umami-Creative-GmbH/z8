import type { db as appDb } from "@/db";
import { createLogger } from "@/lib/logger";
import { createNotification } from "@/lib/notifications/notification-service";
import type { CreateNotificationParams } from "@/lib/notifications/types";
import { readApprovalTeamIds } from "./approval-teams";
import { listReimbursingOfficers } from "./expense-officer-grant-store";
import { parseUnits, STORED_AMOUNT_SCALE } from "./money";
import { coveringOfficers } from "./officer-scope";
import { loadSettlementAccount, type SettlementAccount } from "./settlement-store";

/**
 * Tells expense officers when reimbursement work arrives (#756): a report is
 * approved (a reviewer's approval or the owner's self-approval) with money
 * owed to its employee, or an approved adjustment raises what an account owes.
 * The recipients are the active officers who can record reimbursements and
 * whose scope covers the report, never its own employee; owners and admins
 * are not notified. One notification per officer and approved revision.
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
} as const;
const readyTitle = {
	titleKey: "common:notifications.content.travelExpenseReadyForReimbursement.title",
	titleDefault: "Ready for reimbursement",
} as const;

/** Reimbursement work that arrived with one approval. */
export interface ReadyForReimbursement {
	/** `adjustment`: an approved adjustment (#615) raised what the account owes. */
	kind: "approved" | "adjustment";
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
	const awaiting = owed.summary.currencies
		.filter((line) => line.state === "outstanding")
		.map((line) => ({ currency: line.currency, amount: line.balance }));
	if (awaiting.length === 0) return null;
	return {
		kind: decided.adjustmentOf === null ? "approved" : "adjustment",
		account: owed,
		revisionId,
		awaiting,
	};
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
		message: copy.messageDefault.replace(
			/\{(employee|report|amounts)\}/g,
			(_, key: keyof typeof params) => params[key],
		),
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

/**
 * Notifies the covering officers of an approved report. Call it after the
 * approval committed; it never throws, because the approval stands either way.
 */
export async function notifyReadyForReimbursement(
	database: Database | Parameters<Parameters<Database["transaction"]>[0]>[0],
	input: { organizationId: string; reportId: string },
): Promise<void> {
	const { organizationId } = input;
	try {
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
		if (officers.length === 0) return;
		const approvalTeamIds = await readApprovalTeamIds(database, {
			organizationId,
			source: owed.source,
		});
		const recipients = coveringOfficers(officers, {
			employeeId: owed.employeeId,
			approvalTeamIds,
		});
		await Promise.all(
			recipients.map((officer) =>
				createNotification(buildReadyForReimbursementNotification(due, officer)),
			),
		);
	} catch (error) {
		logger.error(
			{ error, organizationId, reportId: input.reportId },
			"Failed to notify expense officers of an approved report",
		);
	}
}
