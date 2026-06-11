import { and, eq } from "drizzle-orm";
import { render } from "react-email";
import { db } from "@/db";
import { member } from "@/db/auth-schema";
import { getOrganizationBaseUrl } from "@/lib/app-url";
import { sendEmail } from "@/lib/email/email-service";
import { OrganizationDeletion } from "@/lib/email/templates/organization-deletion";
import { createLogger } from "@/lib/logger";
import type { OrganizationDeletionNotificationJobData } from "@/lib/queue";

const logger = createLogger("OrganizationDeletionNotificationJob");

type MemberWithUser = {
	role: string;
	user?: {
		email?: string | null;
		name?: string | null;
	} | null;
};

export async function sendOrganizationDeletionNotifications(
	data: OrganizationDeletionNotificationJobData,
): Promise<void> {
	const deletionDate = new Date(data.deletionDate);
	const permanentDeletionDate = new Date(deletionDate);
	permanentDeletionDate.setDate(permanentDeletionDate.getDate() + 5);

	const adminMembers = (await db.query.member.findMany({
		where: and(eq(member.organizationId, data.organizationId)),
		with: {
			user: true,
		},
	})) as MemberWithUser[];

	const appUrl = await getOrganizationBaseUrl(data.organizationId);
	const recoveryUrl = `${appUrl}/settings/organizations`;
	const recipients = adminMembers.filter((m) => m.role === "admin" || m.role === "owner");

	await Promise.all(
		recipients.map(async (recipient) => {
			const userEmail = recipient.user?.email;
			if (!userEmail) return;

			try {
				const html = await render(
					OrganizationDeletion({
						userName: recipient.user?.name || userEmail,
						organizationName: data.organizationName,
						deletedByName: data.deletedByName,
						deletionDate: deletionDate.toLocaleString(),
						permanentDeletionDate: permanentDeletionDate.toLocaleString(),
						recoveryUrl,
						appUrl,
					}),
				);

				await sendEmail({
					to: userEmail,
					subject: `Organization "${data.organizationName}" scheduled for deletion`,
					html,
					actionUrl: recoveryUrl,
					organizationId: data.organizationId,
				});
			} catch (error) {
				logger.warn(
					{ error, organizationId: data.organizationId },
					"Failed to send deletion notification to user",
				);
			}
		}),
	);
}
