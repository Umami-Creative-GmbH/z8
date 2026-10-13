import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { member } from "@/db/auth-schema";
import { getOrganizationBaseUrl } from "@/lib/app-url";
import { parseInstant } from "@/lib/datetime/temporal-core";
import { loadEmailTranslator } from "@/lib/email/email-i18n";
import { sendEmail } from "@/lib/email/email-service";
import { renderOrganizationDeletion } from "@/lib/email/render";
import { createLogger } from "@/lib/logger";
import {
	formatNotificationParam,
	notificationParam,
} from "@/lib/notifications/notification-params";
import { resolveRecipientNotificationLocale } from "@/lib/notifications/recipient-locale";
import type { OrganizationDeletionNotificationJobData } from "@/lib/queue";
import { loadOrganizationTimezone } from "@/lib/timezone/load-organization-timezone";

const logger = createLogger("OrganizationDeletionNotificationJob");

/** The recovery window; organization-cleanup deletes for good after the same 5 days. */
const RECOVERY_WINDOW_HOURS = 5 * 24;

export type OrganizationDeletionNotice = Omit<OrganizationDeletionNotificationJobData, "type">;

/**
 * Tells the organization's owners and admins that it is scheduled for deletion,
 * each in their recipient language, with both dates in the organization timezone.
 * The one sender for a deletion by an organization admin and by a platform admin.
 */
export async function sendOrganizationDeletionNotifications(
	notice: OrganizationDeletionNotice,
): Promise<void> {
	const { organizationId, organizationName, deletedByName } = notice;
	const deletedAt = parseInstant(notice.deletionDate);
	const permanentlyDeletedAt = deletedAt.add({ hours: RECOVERY_WINDOW_HOURS });

	const [recipients, timeZone, appUrl] = await Promise.all([
		db.query.member.findMany({
			where: and(
				eq(member.organizationId, organizationId),
				inArray(member.role, ["owner", "admin"]),
			),
			columns: { role: true },
			with: { user: { columns: { id: true, email: true, name: true } } },
		}),
		loadOrganizationTimezone(db, organizationId),
		getOrganizationBaseUrl(organizationId),
	]);
	const recoveryUrl = `${appUrl}/settings/organizations`;

	await Promise.all(
		recipients.map(async ({ user }) => {
			if (!user?.email) return;

			try {
				const translator = await loadEmailTranslator(
					await resolveRecipientNotificationLocale({ userId: user.id, organizationId }),
				);
				const { locale, t } = translator;
				const permanentDeletionDate = formatNotificationParam(
					notificationParam.zonedInstant(permanentlyDeletedAt, timeZone),
					{ locale },
				);
				const html = await renderOrganizationDeletion(
					{
						userName: user.name || user.email,
						organizationName,
						deletedByName,
						deletionDate: formatNotificationParam(
							notificationParam.zonedInstant(deletedAt, timeZone),
							{ locale },
						),
						permanentDeletionDate,
						recoveryUrl,
					},
					translator,
				);

				await sendEmail({
					to: user.email,
					subject: t(
						"emails.subjects.organizationDeletion",
						"Organization {organizationName} scheduled for deletion",
						{ organizationName },
					),
					html,
					actionUrl: recoveryUrl,
					organizationId,
				});
			} catch (error) {
				logger.warn({ error, organizationId }, "Failed to send deletion notification to user");
			}
		}),
	);
}
