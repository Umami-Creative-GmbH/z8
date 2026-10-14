// Mailer only: the email copy and its catalog never reach a route or the client.
import "server-only";

import type { EmailTranslate } from "../email-i18n";
import { EmailLayout, EmailText } from "../layout/email-layout";

/** The invitation email's data; also the `{{variables}}` of its override. */
export type OrganizationInvitationData = {
	email: string;
	organizationName: string;
	inviterName: string;
	/** The organization role the invitee gets (`owner`, `admin`, `member`). */
	role: string;
	invitationUrl: string;
};

export interface OrganizationInvitationProps extends OrganizationInvitationData {
	/** The invitation language: the inviting organization's default. */
	locale: string;
	/** The `emails` namespace translator in `locale`. */
	t: EmailTranslate;
}

function roleLabel(t: EmailTranslate, role: string): string {
	switch (role) {
		case "owner":
			return t("emails.invitation.roles.owner", "Owner");
		case "admin":
			return t("emails.invitation.roles.admin", "Admin");
		case "member":
			return t("emails.invitation.roles.member", "Member");
		default:
			return role;
	}
}

// No inbox preview: the default body is also the override starter draft, whose plain text
// would pick up the preview's hidden padding.
export function OrganizationInvitation({
	locale,
	t,
	email,
	organizationName,
	inviterName,
	role,
	invitationUrl,
}: OrganizationInvitationProps) {
	const roleName = roleLabel(t, role);

	return (
		<EmailLayout
			locale={locale}
			t={t}
			title={t("emails.invitation.title", "You have been invited to {organizationName}", {
				organizationName,
			})}
			details={[
				{ label: t("emails.invitation.organization", "Organization"), value: organizationName },
				{ label: t("emails.invitation.email", "Your email"), value: email },
				{ label: t("emails.invitation.role", "Role"), value: roleName },
				{ label: t("emails.invitation.invitedBy", "Invited by"), value: inviterName },
			]}
			action={{ label: t("emails.invitation.action", "Accept invitation"), href: invitationUrl }}
			note={t(
				"emails.invitation.note",
				"If you did not expect this invitation, you can ignore this email.",
			)}
		>
			<EmailText>{t("emails.invitation.greeting", "Hello,")}</EmailText>
			<EmailText>
				{t(
					"emails.invitation.body",
					"{inviterName} has invited you to join {organizationName} as {role}.",
					{ inviterName, organizationName, role: roleName },
				)}
			</EmailText>
		</EmailLayout>
	);
}

export default OrganizationInvitation;
