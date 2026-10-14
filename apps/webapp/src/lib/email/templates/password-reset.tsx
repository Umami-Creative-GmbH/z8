// Mailer only: the email copy and its catalog never reach a route or the client.
import "server-only";

import type { EmailTranslate } from "../email-i18n";
import { EmailLayout, EmailText } from "../layout/email-layout";

/** The password-reset email's data; also the `{{variables}}` of its override. */
export type PasswordResetData = {
	userName: string;
	resetUrl: string;
};

export interface PasswordResetProps extends PasswordResetData {
	/** The recipient language. */
	locale: string;
	/** The `emails` namespace translator in `locale`. */
	t: EmailTranslate;
}

// No inbox preview: the default body is also the override starter draft, whose plain text
// would pick up the preview's hidden padding.
export function PasswordReset({ locale, t, userName, resetUrl }: PasswordResetProps) {
	return (
		<EmailLayout
			locale={locale}
			t={t}
			title={t("emails.passwordReset.title", "Reset your password")}
			action={{ label: t("emails.passwordReset.action", "Reset password"), href: resetUrl }}
			note={t(
				"emails.passwordReset.note",
				"If you did not ask to reset your password, you can ignore this email; your password stays the same. The link expires in 1 hour.",
			)}
		>
			<EmailText>{t("emails.common.greeting", "Hi {name},", { name: userName })}</EmailText>
			<EmailText>
				{t(
					"emails.passwordReset.body",
					"We received a request to reset your password. Use the button below to choose a new one.",
				)}
			</EmailText>
		</EmailLayout>
	);
}

export default PasswordReset;
