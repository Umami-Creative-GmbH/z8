import { and, eq, inArray } from "drizzle-orm";
import { employee } from "@/db/schema";
import { employeeHasOrganizationAccess } from "@/lib/employee-lifecycle/access";
import { createLogger } from "@/lib/logger";
import { sendEmailNotification } from "@/lib/notifications/email-notifications";
import {
	createNotification,
	loadNotificationChannelPreferences,
} from "@/lib/notifications/notification-service";
import { resolveRecipientNotificationLocale } from "@/lib/notifications/recipient-locale";
import type { CreateNotificationParams } from "@/lib/notifications/types";
import { formatAbsenceDateRange } from "@/lib/personnel-file/sick-note-labels";
import type { WorkBalanceDbClient } from "@/lib/work-balance/db-client";
import { formatSignedWorkBalance } from "@/lib/work-balance/format";
import type { BalanceAdjustmentKind } from "./types";

/**
 * Tells the employee when a balance adjustment on their own work balance is
 * recorded or cancelled (#996): one notification per adjustment and event,
 * delivered in-app and on the employee's configured channels (email by
 * default) through the notification service and its preferences. The text
 * names the kind, the day and the time, and for a cancellation its reason,
 * and nothing about anyone else. An employee who has left gets the email only,
 * so a final payout still reaches them.
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
	/** Why it was cancelled; named in a cancellation notification. */
	cancellationReason?: string | null;
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
	messageDefault: "The overtime payout of {amount} for {dateRange} was cancelled. Reason: {reason}",
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
	messageDefault: "The opening balance of {amount} for {dateRange} was cancelled. Reason: {reason}",
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
		...(event === "cancelled" ? { reason: adjustment.cancellationReason ?? "" } : {}),
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
			.replace("{dateRange}", params.dateRange)
			.replace("{reason}", params.reason ?? ""),
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
 * deactivated) gets no in-app notification, only the email when their email
 * preference for the type is on.
 */
export async function notifyBalanceAdjustmentChanges(
	database: Pick<WorkBalanceDbClient, "select">,
	input: { organizationId: string; changes: readonly BalanceAdjustmentChange[] },
): Promise<void> {
	if (input.changes.length === 0) return;
	try {
		const employeeIds = [...new Set(input.changes.map((change) => change.employeeId))];
		const recipients = await database
			.select({
				employeeId: employee.id,
				userId: employee.userId,
				hasAccess: employeeHasOrganizationAccess(),
			})
			.from(employee)
			.where(
				and(inArray(employee.id, employeeIds), eq(employee.organizationId, input.organizationId)),
			);
		const recipientByEmployee = new Map(recipients.map((row) => [row.employeeId, row]));
		const locales = new Map<string, string>();
		for (const change of input.changes) {
			const recipient = recipientByEmployee.get(change.employeeId);
			if (!recipient) continue;
			const recipientUserId = recipient.userId;
			try {
				let locale = locales.get(recipientUserId);
				if (!locale) {
					locale = await resolveRecipientNotificationLocale({
						userId: recipientUserId,
						organizationId: input.organizationId,
					}).catch(() => FALLBACK_LOCALE);
					locales.set(recipientUserId, locale);
				}
				const notification = buildBalanceAdjustmentNotification({
					organizationId: input.organizationId,
					recipientUserId,
					event: change.event,
					adjustment: change.adjustment,
					locale,
				});
				if (recipient.hasAccess) {
					await createNotification(notification);
				} else {
					await emailFormerEmployee(notification);
				}
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

/**
 * Someone who has left cannot open the app, so they get no in-app notification
 * (or push or chat message); the email follows their email preference.
 */
async function emailFormerEmployee(notification: CreateNotificationParams) {
	const channels = await loadNotificationChannelPreferences(notification.userId, notification.type);
	if (!channels.email) return;
	await sendEmailNotification({
		userId: notification.userId,
		organizationId: notification.organizationId,
		type: notification.type,
		title: notification.title,
		message: notification.message,
		metadata: notification.metadata,
		actionUrl: notification.actionUrl,
	});
}
