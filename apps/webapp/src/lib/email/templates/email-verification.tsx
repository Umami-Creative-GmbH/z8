// Mailer only: the email copy and its catalog never reach a route or the client.
import "server-only";

import type { EmailTranslate } from "../email-i18n";
import { EmailLayout, EmailText } from "../layout/email-layout";

/** The verification email's data; also the `{{variables}}` of its override. */
export type EmailVerificationData = {
	userName: string;
	verificationUrl: string;
	appUrl: string;
};

export interface EmailVerificationProps extends EmailVerificationData {
	/** The recipient language. */
	locale: string;
	/** The `emails` namespace translator in `locale`. */
	t: EmailTranslate;
}

// No inbox preview: the default body is also the override starter draft, whose plain text
// would pick up the preview's hidden padding.
export function EmailVerification({
	locale,
	t,
	userName,
	verificationUrl,
}: EmailVerificationProps) {
	return (
		<EmailLayout
			locale={locale}
			t={t}
			title={t("emails.verification.title", "Verify your email address")}
			action={{
				label: t("emails.verification.action", "Verify email address"),
				href: verificationUrl,
			}}
			note={t(
				"emails.verification.note",
				"If you did not create an account, you can ignore this email. The link expires in 1 hour.",
			)}
		>
			<EmailText>{t("emails.common.greeting", "Hi {name},", { name: userName })}</EmailText>
			<EmailText>
				{t(
					"emails.verification.body",
					"Welcome to Z8! Please verify your email address with the button below to finish your registration.",
				)}
			</EmailText>
		</EmailLayout>
	);
}

export default EmailVerification;
