import { createLogger } from "@/lib/logger";
import { employeeSettingsUrl } from "./former-employee-reports-without-manager";
import { type NotificationCopy, translatedContent } from "./notification-copy";
import { createNotification } from "./notification-service";

const logger = createLogger("FormerEmployeeNeedsRehire");

const copy = {
	titleKey: "common:notifications.content.formerEmployeeNeedsRehire.title",
	titleDefault: "A former employee needs a rehire",
	messageKey: "common:notifications.content.formerEmployeeNeedsRehire.message",
	messageDefault:
		"{name} is a member again, but their earlier employment ended. They have no access until you rehire them.",
} as const satisfies NotificationCopy;

export type FormerEmployeeNeedsRehireNotice = {
	organizationId: string;
	/** The membership the former employee regained; one notice per membership and recipient. */
	membershipId: string;
	employeeId: string;
	name: string;
	recipientUserIds: readonly string[];
};

/**
 * Tells the admins who brought a former employee back into the organization
 * that the membership did not bring them back onto the current roster: only a
 * rehire does (#1672, spec #1664 decision 4). Links to the employee's page,
 * where the rehire starts. Never throws.
 */
export async function notifyFormerEmployeeNeedsRehire(
	notice: FormerEmployeeNeedsRehireNotice,
): Promise<void> {
	const content = translatedContent(copy, { name: notice.name });
	for (const userId of new Set(notice.recipientUserIds)) {
		try {
			await createNotification({
				userId,
				organizationId: notice.organizationId,
				type: "former_employee_needs_rehire",
				title: content.title,
				message: content.message,
				entityType: "employee",
				entityId: notice.employeeId,
				actionUrl: employeeSettingsUrl(notice.employeeId),
				idempotencyKey: `former-employee-needs-rehire:${notice.membershipId}:${userId}`,
				metadata: { i18n: content.i18n },
			});
		} catch (error) {
			logger.error(
				{ error, organizationId: notice.organizationId, employeeId: notice.employeeId },
				"Failed to tell an admin that a former employee needs a rehire",
			);
		}
	}
}
