import { and, eq } from "drizzle-orm";
import type { db as appDb } from "@/db";
import { employee } from "@/db/schema";
import { createLogger } from "@/lib/logger";
import { createNotification } from "@/lib/notifications/notification-service";
import type { CreateNotificationParams, NotificationType } from "@/lib/notifications/types";
import type { CurrencySettlement } from "./settlement";
import type { SettlementAccount, SettlementEntryView } from "./settlement-store";

/**
 * Tells the employee when money moved on their own travel expense (#752):
 * a reimbursement that leaves nothing outstanding, a partial reimbursement or
 * a recorded recovery. The content is what the owner view shows: amount,
 * currency, payment reference and a link, never who recorded it or their note.
 */

const logger = createLogger("TravelExpenseSettlementNotifications");

const settlementNotificationCopy = {
	reimbursed: {
		titleKey: "common:notifications.content.travelExpenseReimbursed.title",
		titleDefault: "Expense reimbursed",
		messageKey: "common:notifications.content.travelExpenseReimbursed.message",
		messageDefault:
			"Your travel expense has been fully reimbursed: {amount} {currency}, payment reference {reference}.",
	},
	partiallyReimbursed: {
		titleKey: "common:notifications.content.travelExpensePartiallyReimbursed.title",
		titleDefault: "Expense partially reimbursed",
		messageKey: "common:notifications.content.travelExpensePartiallyReimbursed.message",
		messageDefault:
			"{amount} {currency} of your travel expense has been reimbursed (payment reference {reference}). {remaining} {currency} is still awaiting reimbursement.",
	},
	recoveryRecorded: {
		titleKey: "common:notifications.content.travelExpenseRecoveryRecorded.title",
		titleDefault: "Expense recovery recorded",
		messageKey: "common:notifications.content.travelExpenseRecoveryRecorded.message",
		messageDefault:
			"A recovery of {amount} {currency} was recorded for your travel expense (payment reference {reference}).",
	},
} as const;

type SettlementNotificationCopy =
	(typeof settlementNotificationCopy)[keyof typeof settlementNotificationCopy];

function classify(
	entry: SettlementEntryView,
	line: CurrencySettlement | undefined,
): { type: NotificationType; copy: SettlementNotificationCopy } {
	if (entry.kind === "recovery") {
		return {
			type: "travel_expense_recovery_recorded",
			copy: settlementNotificationCopy.recoveryRecorded,
		};
	}
	return line?.state === "outstanding"
		? {
				type: "travel_expense_partially_reimbursed",
				copy: settlementNotificationCopy.partiallyReimbursed,
			}
		: { type: "travel_expense_reimbursed", copy: settlementNotificationCopy.reimbursed };
}

/**
 * The notification for one recorded entry. `account` is the account after
 * recording, so its balance in the entry's currency tells a full reimbursement
 * from a partial one.
 */
export function buildSettlementNotification(input: {
	account: SettlementAccount;
	entry: SettlementEntryView;
	/** The settlement entry's idempotency key: a retried command never notifies twice. */
	idempotencyKey: string;
	recipientUserId: string;
}): CreateNotificationParams {
	const { account, entry } = input;
	const line = account.summary.currencies.find(
		(candidate) => candidate.currency === entry.currency,
	);
	const { type, copy } = classify(entry, line);
	const params = {
		amount: entry.amount,
		currency: entry.currency,
		reference: entry.reference,
		remaining: line?.balance ?? "0.00",
	};
	const report = account.source.type === "report";
	return {
		userId: input.recipientUserId,
		organizationId: account.organizationId,
		type,
		title: copy.titleDefault,
		message: copy.messageDefault.replace(
			/\{(amount|currency|reference|remaining)\}/g,
			(_, key: keyof typeof params) => params[key],
		),
		entityType: report ? "travel_expense_report" : "travel_expense_claim",
		entityId: account.source.id,
		actionUrl: report
			? `/travel-expenses/reports/${account.source.id}`
			: `/travel-expenses/${account.source.id}`,
		idempotencyKey: `travel-expense-settlement:${input.idempotencyKey}`,
		metadata: {
			sourceType: account.source.type,
			entryId: entry.id,
			i18n: {
				titleKey: copy.titleKey,
				titleDefault: copy.titleDefault,
				messageKey: copy.messageKey,
				messageDefault: copy.messageDefault,
				params,
			},
		},
	};
}

type Database = typeof appDb;

/**
 * Notifies the employee of a newly recorded entry. Call it after the entry
 * committed and only when it was not a replay; it never throws, because the
 * money is recorded either way.
 */
export async function notifySettlementRecorded(
	database: Database,
	input: { account: SettlementAccount; entry: SettlementEntryView; idempotencyKey: string },
): Promise<void> {
	try {
		const [recipient] = await database
			.select({ userId: employee.userId })
			.from(employee)
			.where(
				and(
					eq(employee.id, input.account.employeeId),
					eq(employee.organizationId, input.account.organizationId),
				),
			)
			.limit(1);
		if (!recipient) return;
		await createNotification(
			buildSettlementNotification({ ...input, recipientUserId: recipient.userId }),
		);
	} catch (error) {
		logger.error(
			{ error, entryId: input.entry.id, organizationId: input.account.organizationId },
			"Failed to notify the employee of a recorded settlement entry",
		);
	}
}
