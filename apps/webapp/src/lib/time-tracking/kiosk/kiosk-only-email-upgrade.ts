import "server-only";

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { organization, user } from "@/db/auth-schema";
import { getOrganizationBaseUrl } from "@/lib/app-url";
import { auth } from "@/lib/auth";
import { buildAuthUserDisplayName } from "@/lib/auth/derived-user-name";
import { sendEmail } from "@/lib/email/email-service";
import { renderOrganizationEmailTemplate } from "@/lib/email/template-renderer";
import type { KioskOnlyEmailUpgradeDeps } from "./kiosk-only-employee";
import { createPasswordSetupToken } from "./password-setup-token";

/**
 * Production wiring for adding a real email to a kiosk-only employee (#857):
 * a Better Auth password setup token on the organization's own domain, sent in
 * the organization's ordinary invitation email.
 */
export const kioskOnlyEmailUpgradeDeps: KioskOnlyEmailUpgradeDeps = {
	async createPasswordSetupUrl(organizationId, userId) {
		const token = await createPasswordSetupToken(await auth.$context, userId);
		const appUrl = await getOrganizationBaseUrl(organizationId);
		return `${appUrl}/reset-password?token=${encodeURIComponent(token)}`;
	},

	async sendInvitationEmail({ organizationId, email, invitationUrl, inviterUserId }) {
		const [[org], [inviter]] = await Promise.all([
			db
				.select({ name: organization.name })
				.from(organization)
				.where(eq(organization.id, organizationId))
				.limit(1),
			db
				.select({
					name: user.name,
					firstName: user.firstName,
					lastName: user.lastName,
					email: user.email,
				})
				.from(user)
				.where(eq(user.id, inviterUserId))
				.limit(1),
		]);
		const organizationName = org?.name ?? "";
		const rendered = await renderOrganizationEmailTemplate({
			organizationId,
			templateKey: "organization-invitation",
			data: {
				email,
				organizationName,
				inviterName: inviter ? buildAuthUserDisplayName(inviter) : "",
				role: "member",
				invitationUrl,
			},
			subjectOverride: `You've been invited to join ${organizationName}`,
		});
		const result = await sendEmail({
			to: email,
			subject: rendered.subject,
			html: rendered.html,
			actionUrl: invitationUrl,
			organizationId,
		});
		if (!result.success) {
			throw new Error(result.error ?? "The invitation email could not be sent");
		}
	},
};
