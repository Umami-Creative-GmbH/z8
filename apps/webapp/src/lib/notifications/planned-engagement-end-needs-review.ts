import { createLogger } from "@/lib/logger";
import { employeeSettingsUrl } from "./former-employee-reports-without-manager";
import { type NotificationCopy, translatedContent } from "./notification-copy";
import { createNotification } from "./notification-service";

const logger = createLogger("PlannedEngagementEndNeedsReview");

// Each key sits next to its English default, as the Tolgee extractor reads them.
const copies = {
	passed: {
		titleKey: "common:notifications.content.plannedEngagementEndNeedsReview.title",
		titleDefault: "A planned engagement end needs review",
		messageKey: "common:notifications.content.plannedEngagementEndNeedsReview.passed",
		messageDefault:
			"The planned engagement end of {name} ({plannedEndDate}) had passed when they joined, so their leaving date is today ({leavingDate}). Change it if the engagement continues.",
	},
	not_scheduled: {
		titleKey: "common:notifications.content.plannedEngagementEndNeedsReview.title",
		titleDefault: "A planned engagement end needs review",
		messageKey: "common:notifications.content.plannedEngagementEndNeedsReview.notScheduled",
		messageDefault:
			"The planned engagement end of {name} ({plannedEndDate}) could not be scheduled as their leaving date. Schedule it on their employee page.",
	},
} as const satisfies Record<string, NotificationCopy>;

export type PlannedEngagementEndNotice = {
	organizationId: string;
	employeeId: string;
	/** One notice per invitation draft and recipient. */
	draftId: string;
	name: string;
	/** The org-local day the invitation planned. */
	plannedEndDate: string;
	/** The leaving date scheduled instead; null when none was scheduled. */
	leavingDate: string | null;
	recipientUserIds: readonly string[];
};

/**
 * Tells org admins that a contractor invitation's planned engagement end was
 * not scheduled as planned when the contractor joined (#1995): it had passed
 * (the leaving date became today), or scheduling was refused. Sent as an
 * offboarding review, so it follows that notification's preferences. Links to
 * the employee's page, where the leaving date is changed. Never throws.
 */
export async function notifyPlannedEngagementEndNeedsReview(
	notice: PlannedEngagementEndNotice,
): Promise<void> {
	const content = translatedContent(notice.leavingDate ? copies.passed : copies.not_scheduled, {
		name: notice.name,
		plannedEndDate: { kind: "plainDate", date: notice.plannedEndDate },
		...(notice.leavingDate
			? { leavingDate: { kind: "plainDate", date: notice.leavingDate } as const }
			: {}),
	});
	// Each recipient's notice is independent and idempotent; one failure leaves the others.
	await Promise.all(
		[...new Set(notice.recipientUserIds)].map(async (userId) => {
			try {
				await createNotification({
					userId,
					organizationId: notice.organizationId,
					type: "employee_offboarding_review",
					title: content.title,
					message: content.message,
					entityType: "employee",
					entityId: notice.employeeId,
					actionUrl: employeeSettingsUrl(notice.employeeId),
					idempotencyKey: `planned-engagement-end:${notice.draftId}:${userId}`,
					metadata: { i18n: content.i18n },
				});
			} catch (error) {
				logger.error(
					{ error, organizationId: notice.organizationId, employeeId: notice.employeeId },
					"Failed to tell an admin that a planned engagement end needs review",
				);
			}
		}),
	);
}
