import { createLogger } from "@/lib/logger";
import { employeeSettingsUrl } from "./former-employee-reports-without-manager";
import { type NotificationCopy, translatedContent } from "./notification-copy";
import { createNotification } from "./notification-service";

const logger = createLogger("InvitationContractorTermsNeedReview");

// The keys sit next to their English defaults, as the Tolgee extractor reads them.
const unpricedCopy = {
	titleKey: "common:notifications.content.invitationContractorTermsNeedReview.title",
	titleDefault: "An External Contractor's rate needs review",
	messageKey: "common:notifications.content.invitationContractorTermsNeedReview.message",
	messageDefault:
		"The rate from the invitation of {name} could not be applied when they joined. Set it in their External Contractor compensation; their work stays unpriced until then.",
} as const satisfies NotificationCopy;

const termsExistCopy = {
	titleKey: "common:notifications.content.invitationContractorTermsNeedReview.title",
	titleDefault: "An External Contractor's rate needs review",
	messageKey: "common:notifications.content.invitationContractorTermsNeedReview.termsExistMessage",
	messageDefault:
		"The rate from the invitation of {name} was not applied when they joined: their engagement already has compensation terms, which still apply. Review in their External Contractor compensation whether they should change.",
} as const satisfies NotificationCopy;

export type InvitationContractorTermsNotice = {
	organizationId: string;
	employeeId: string;
	/** One notice per invitation draft and recipient. */
	draftId: string;
	name: string;
	recipientUserIds: readonly string[];
	/**
	 * Why the terms were not written: `terms_exist` when the engagement already has terms
	 * (a reactivated contractor), which still price their work; anything else leaves it unpriced.
	 */
	reason: "terms_exist" | "not_applied";
};

/**
 * Tells org admins that a contractor invitation's first compensation terms
 * were not written when the contractor joined (#1935). Sent as an offboarding
 * review, like the planned engagement end's notice (no notification type of
 * its own), so it follows that notification's preferences. Links to the
 * employee's page, where the rate is set. Never throws.
 */
export async function notifyInvitationContractorTermsNeedReview(
	notice: InvitationContractorTermsNotice,
): Promise<void> {
	const content = translatedContent(
		notice.reason === "terms_exist" ? termsExistCopy : unpricedCopy,
		{ name: notice.name },
	);
	for (const userId of new Set(notice.recipientUserIds)) {
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
				idempotencyKey: `invitation-contractor-terms:${notice.draftId}:${userId}`,
				metadata: { i18n: content.i18n },
			});
		} catch (error) {
			logger.error(
				{ error, organizationId: notice.organizationId, employeeId: notice.employeeId },
				"Failed to tell an admin that an invitation's contractor rate needs review",
			);
		}
	}
}
