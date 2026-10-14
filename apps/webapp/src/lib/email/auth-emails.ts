// Mailer only: the email copy and its catalog never reach a route or the client.
import "server-only";

import { getOrganizationBaseUrl } from "@/lib/app-url";
import { getUserPrimaryOrganizationId } from "@/lib/auth/primary-organization";
import {
	resolveOrganizationNotificationLocale,
	resolveRecipientNotificationLocale,
} from "@/lib/notifications/recipient-locale";
import { loadEmailTranslator } from "./email-i18n";
import { sendEmail } from "./email-service";
import {
	renderEmailVerification,
	renderOrganizationInvitation,
	renderPasswordReset,
} from "./render";
import { renderOrganizationEmailTemplate } from "./template-renderer";
import type { EmailTransportResult } from "./transports";

/** The Better Auth user a sign-in email goes to. */
interface AuthEmailUser {
	id: string;
	email: string;
	name: string;
}

interface SignInEmailInput {
	user: AuthEmailUser;
	/** The link Better Auth built; it is moved onto the organization's own domain. */
	url: string;
	/** The request that asked for the email, for its page language. */
	request?: Request;
}

/**
 * The organization, recipient language and link of a verification or password-reset
 * email: saved language, then the request's page language, then the primary
 * organization's default, then `en`. The link moves to the organization's domain.
 */
async function signInEmailContext({ user, url, request }: SignInEmailInput) {
	const organizationId = await getUserPrimaryOrganizationId(user.id);
	const [appUrl, locale] = await Promise.all([
		getOrganizationBaseUrl(organizationId),
		resolveRecipientNotificationLocale({ userId: user.id, organizationId, request }),
	]);
	const link = new URL(url);

	return {
		organizationId,
		appUrl,
		translator: await loadEmailTranslator(locale),
		correctedUrl: `${appUrl}${link.pathname}${link.search}`,
	};
}

/** Better Auth's `sendResetPassword`: the password-reset email in the recipient language. */
export async function sendPasswordResetEmail(input: SignInEmailInput): Promise<void> {
	const { organizationId, translator, correctedUrl } = await signInEmailContext(input);
	const data = { userName: input.user.name, resetUrl: correctedUrl };

	const rendered = await renderOrganizationEmailTemplate({
		organizationId,
		templateKey: "password-reset",
		data,
		subjectOverride: translator.t("emails.subjects.passwordReset", "Reset your password"),
		renderDefaultHtml: () => renderPasswordReset(data, translator),
	});

	await sendEmail({
		to: input.user.email,
		subject: rendered.subject,
		html: rendered.html,
		actionUrl: correctedUrl,
		organizationId,
	});
}

/** Better Auth's `sendVerificationEmail`: the verification email in the recipient language. */
export async function sendVerificationEmail(input: SignInEmailInput): Promise<void> {
	const { organizationId, appUrl, translator, correctedUrl } = await signInEmailContext(input);
	const data = { userName: input.user.name, verificationUrl: correctedUrl, appUrl };

	const rendered = await renderOrganizationEmailTemplate({
		organizationId,
		templateKey: "email-verification",
		data,
		subjectOverride: translator.t("emails.subjects.verifyEmail", "Verify your email address"),
		renderDefaultHtml: () => renderEmailVerification(data, translator),
	});

	await sendEmail({
		to: input.user.email,
		subject: rendered.subject,
		html: rendered.html,
		actionUrl: correctedUrl,
		organizationId,
	});
}

export interface OrganizationInvitationEmailInput {
	organizationId: string;
	organizationName: string;
	email: string;
	inviterName: string;
	role: string;
	invitationUrl: string;
}

/**
 * The organization invitation, in the inviting organization's default language
 * (the inviter's own language is ignored), on the organization's transport.
 */
export async function sendOrganizationInvitationEmail({
	organizationId,
	...data
}: OrganizationInvitationEmailInput): Promise<EmailTransportResult> {
	const translator = await loadEmailTranslator(
		await resolveOrganizationNotificationLocale(organizationId),
	);

	const rendered = await renderOrganizationEmailTemplate({
		organizationId,
		templateKey: "organization-invitation",
		data,
		subjectOverride: translator.t(
			"emails.subjects.organizationInvitation",
			"You have been invited to join {organizationName}",
			{ organizationName: data.organizationName },
		),
		renderDefaultHtml: () => renderOrganizationInvitation(data, translator),
	});

	return sendEmail({
		to: data.email,
		subject: rendered.subject,
		html: rendered.html,
		actionUrl: data.invitationUrl,
		organizationId,
	});
}
