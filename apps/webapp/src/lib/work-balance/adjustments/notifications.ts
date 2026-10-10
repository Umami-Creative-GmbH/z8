import { and, eq, inArray } from "drizzle-orm";
import type { db as appDb } from "@/db";
import { employee } from "@/db/schema";
import { employeeHasOrganizationAccess } from "@/lib/employee-lifecycle/access";
import { createLogger } from "@/lib/logger";
import { createNotification } from "@/lib/notifications/notification-service";
import { resolveRecipientNotificationLocale } from "@/lib/notifications/recipient-locale";
import type { CreateNotificationParams } from "@/lib/notifications/types";
import { formatAbsenceDateRange } from "@/lib/personnel-file/sick-note-labels";
import { formatSignedWorkBalance } from "@/lib/work-balance/format";
import type { BalanceAdjustmentKind } from "./types";

/**
 * Tells the employee when a balance adjustment on their own work balance is
 * recorded or cancelled (#996): one notification per adjustment and event,
 * delivered in-app and on the employee's configured channels (email by
 * default) through the notification service and its preferences. The text
 * names the kind, the day and the time, and nothing about anyone else.
 */

const logger = createLogger("BalanceAdjustmentNotifications");

export const BALANCE_ADJUSTMENT_NOTIFICATION_PATH = "/time-tracking";

export type BalanceAdjustmentNotificationEvent = "recorded" | "cancelled";

export type NotifiedBalanceAdjustment = {
	id: string;
	kind: BalanceAdjustmentKind;
	/** Local date in the employee's effective timezone (`YYYY-MM-DD`). */
	day: string;
	/** Signed minutes as stored: an overtime payout is negative. */
	minutes: number;
};

/** A committed ledger change the employee is told about. */
export type BalanceAdjustmentChange = {
	event: BalanceAdjustmentNotificationEvent;
	employeeId: string;
	adjustment: NotifiedBalanceAdjustment;
};

const payoutRecordedCopy = {
	titleKey: "common:notifications.content.balanceAdjustment.payoutRecorded.title",
	titleDefault: "Overtime payout recorded",
	messageKey: "common:notifications.content.balanceAdjustment.payoutRecorded.message",
	messageDefault:
		"An overtime payout of {amount} for {dateRange} was recorded on your work balance.",
} as const;

const payoutCancelledCopy = {
	titleKey: "common:notifications.content.balanceAdjustment.payoutCancelled.title",
	titleDefault: "Overtime payout cancelled",
	messageKey: "common:notifications.content.balanceAdjustment.payoutCancelled.message",
	messageDefault: "The overtime payout of {amount} for {dateRange} was cancelled.",
} as const;

const openingBalanceRecordedCopy = {
	titleKey: "common:notifications.content.balanceAdjustment.openingBalanceRecorded.title",
	titleDefault: "Opening balance recorded",
	messageKey: "common:notifications.content.balanceAdjustment.openingBalanceRecorded.message",
	messageDefault:
		"An opening balance of {amount} for {dateRange} was recorded on your work balance.",
} as const;

const openingBalanceCancelledCopy = {
	titleKey: "common:notifications.content.balanceAdjustment.openingBalanceCancelled.title",
	titleDefault: "Opening balance cancelled",
	messageKey: "common:notifications.content.balanceAdjustment.openingBalanceCancelled.message",
	messageDefault: "The opening balance of {amount} for {dateRange} was cancelled.",
} as const;

function copyFor(kind: BalanceAdjustmentKind, event: BalanceAdjustmentNotificationEvent) {
	if (kind === "overtime_payout") {
		return event === "recorded" ? payoutRecordedCopy : payoutCancelledCopy;
	}
	return event === "recorded" ? openingBalanceRecordedCopy : openingBalanceCancelledCopy;
}

/** A payout is an amount taken off ("5:00h"); an opening balance keeps its sign. */
function formatAmount(adjustment: NotifiedBalanceAdjustment): string {
	if (adjustment.kind === "overtime_payout") {
		return formatSignedWorkBalance(Math.abs(adjustment.minutes)).replace(/^\+/u, "");
	}
	return formatSignedWorkBalance(adjustment.minutes);
}

export function buildBalanceAdjustmentNotification(input: {
	organizationId: string;
	recipientUserId: string;
	event: BalanceAdjustmentNotificationEvent;
	adjustment: NotifiedBalanceAdjustment;
	/** The recipient's notification locale, for the day in the stored text and the email. */
	locale: string;
}): CreateNotificationParams {
	const { adjustment, event } = input;
	const copy = copyFor(adjustment.kind, event);
	const params = {
		amount: formatAmount(adjustment),
		// `dateRange` is the param the in-app reader re-formats from `dateRangeDays`.
		dateRange: formatAbsenceDateRange(adjustment.day, adjustment.day, input.locale),
	};
	return {
		userId: input.recipientUserId,
		organizationId: input.organizationId,
		type:
			event === "recorded"
				? "work_balance_adjustment_recorded"
				: "work_balance_adjustment_cancelled",
		title: copy.titleDefault,
		message: copy.messageDefault
			.replace("{amount}", params.amount)
			.replace("{dateRange}", params.dateRange),
		entityType: "balance_adjustment",
		entityId: adjustment.id,
		actionUrl: BALANCE_ADJUSTMENT_NOTIFICATION_PATH,
		idempotencyKey: `balance-adjustment:${adjustment.id}:${event}:${input.recipientUserId}`,
		metadata: {
			kind: adjustment.kind,
			day: adjustment.day,
			minutes: adjustment.minutes,
			dateRangeDays: { startDate: adjustment.day, endDate: adjustment.day },
			i18n: { ...copy, params },
		},
	};
}

const FALLBACK_LOCALE = "en";

/**
 * Notifies each employee of their committed ledger changes, one at a time.
 * Call after the transaction committed. Never throws: the adjustment stands
 * either way. An employee who can no longer use the organization (left or
 * deactivated) is not notified.
 */
export async function notifyBalanceAdjustmentChanges(
	database: Pick<typeof appDb, "select">,
	input: { organizationId: string; changes: readonly BalanceAdjustmentChange[] },
): Promise<void> {
	if (input.changes.length === 0) return;
	try {
		const employeeIds = [...new Set(input.changes.map((change) => change.employeeId))];
		const recipients = await database
			.select({ employeeId: employee.id, userId: employee.userId })
			.from(employee)
			.where(
				and(
					inArray(employee.id, employeeIds),
					eq(employee.organizationId, input.organizationId),
					employeeHasOrganizationAccess(),
				),
			);
		const userIdByEmployee = new Map(recipients.map((row) => [row.employeeId, row.userId]));
		const locales = new Map<string, string>();
		for (const change of input.changes) {
			const recipientUserId = userIdByEmployee.get(change.employeeId);
			if (!recipientUserId) continue;
			try {
				let locale = locales.get(recipientUserId);
				if (!locale) {
					locale = await resolveRecipientNotificationLocale({
						userId: recipientUserId,
						organizationId: input.organizationId,
					}).catch(() => FALLBACK_LOCALE);
					locales.set(recipientUserId, locale);
				}
				await createNotification(
					buildBalanceAdjustmentNotification({
						organizationId: input.organizationId,
						recipientUserId,
						event: change.event,
						adjustment: change.adjustment,
						locale,
					}),
				);
			} catch (error) {
				logger.error(
					{ error, adjustmentId: change.adjustment.id, organizationId: input.organizationId },
					"Failed to notify the employee of a balance adjustment",
				);
			}
		}
	} catch (error) {
		logger.error(
			{ error, organizationId: input.organizationId },
			"Failed to notify employees of balance adjustments",
		);
	}
}
