import type { db } from "@/db";
import { createLogger } from "@/lib/logger";
import { sendEmailNotification } from "@/lib/notifications/email-notifications";
import { type NotificationCopy, translatedContent } from "@/lib/notifications/notification-copy";
import { insertInAppNotification } from "@/lib/notifications/notification-service";
import type { CreateNotificationParams } from "@/lib/notifications/types";
import type { PersonalDetailsPart } from "./types";

const logger = createLogger("PersonalDetailsChangedNotice");

/** The employee's own settings page, where they see their personal details. */
export const OWN_PERSONAL_DETAILS_PATH = "/settings/profile";

// Each key sits next to its English default so the Tolgee extractor reads both.
const bankAccountChangedCopy = {
	titleKey: "common:notifications.content.personalDetailsChanged.title",
	titleDefault: "Your personal details changed",
	messageKey: "common:notifications.content.personalDetailsChanged.bankAccountChanged",
	messageDefault:
		"Your bank account was changed from {validFrom}. The IBAN now on file ends in {lastFour}. If you didn't expect this change, contact your HR team right away.",
} as const satisfies NotificationCopy;

/** One applied change to an employee's personal details, as the notice tells it. */
export type PersonalDetailsChange = {
	organizationId: string;
	employeeId: string;
	/** The employee's user: the notice always goes to them, whoever made the change. */
	employeeUserId: string;
	part: PersonalDetailsPart;
	validFrom: string;
	/** The only part of an IBAN a notice ever shows. */
	ibanLastFour: string;
	/** Distinguishes notices of one employee's changes; any unique value per change. */
	changeId: string;
};

/**
 * The mandatory "personal details changed" notice (#2069): the safeguard against
 * payroll diversion. Never more of the IBAN than its last four characters.
 */
export function buildPersonalDetailsChangedNotice(
	change: PersonalDetailsChange,
): CreateNotificationParams {
	const content = translatedContent(bankAccountChangedCopy, {
		validFrom: { kind: "plainDate", date: change.validFrom, preset: "dateMedium" },
		lastFour: change.ibanLastFour,
	});
	return {
		userId: change.employeeUserId,
		organizationId: change.organizationId,
		type: "personal_details_changed",
		title: content.title,
		message: content.message,
		entityType: "employee",
		entityId: change.employeeId,
		actionUrl: OWN_PERSONAL_DETAILS_PATH,
		idempotencyKey: `personal-details-changed:${change.changeId}`,
		metadata: { part: change.part, i18n: content.i18n },
	};
}

type InsertClient = Pick<typeof db, "insert">;

/**
 * Stores the in-app notice inside the change's own transaction, so a change
 * never commits without it. Notification preferences are not consulted.
 */
export async function recordPersonalDetailsChangedNotice(
	tx: InsertClient,
	notice: CreateNotificationParams,
): Promise<void> {
	await insertInAppNotification(notice, tx as Parameters<typeof insertInAppNotification>[1]);
}

/**
 * Emails the notice after the change committed, whatever the employee's
 * notification preferences. A failed email is logged; the in-app notice stands.
 */
export async function emailPersonalDetailsChangedNotice(
	notice: CreateNotificationParams,
): Promise<void> {
	try {
		await sendEmailNotification({
			userId: notice.userId,
			organizationId: notice.organizationId,
			type: notice.type,
			title: notice.title,
			message: notice.message,
			metadata: notice.metadata,
			actionUrl: notice.actionUrl,
		});
	} catch (error) {
		logger.error(
			{ error, organizationId: notice.organizationId, entityId: notice.entityId },
			"Failed to email the personal details changed notice",
		);
	}
}
