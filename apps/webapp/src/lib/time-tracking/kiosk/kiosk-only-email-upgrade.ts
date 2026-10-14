import "server-only";

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { organization, user } from "@/db/auth-schema";
import { getOrganizationBaseUrl } from "@/lib/app-url";
import { auth } from "@/lib/auth";
import { buildAuthUserDisplayName } from "@/lib/auth/derived-user-name";
import { sendOrganizationInvitationEmail } from "@/lib/email/auth-emails";
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
		const result = await sendOrganizationInvitationEmail({
			organizationId,
			organizationName: org?.name ?? "",
			email,
			inviterName: inviter ? buildAuthUserDisplayName(inviter) : "",
			role: "member",
			invitationUrl,
		});
		if (!result.success) {
			throw new Error(result.error ?? "The invitation email could not be sent");
		}
	},
};
