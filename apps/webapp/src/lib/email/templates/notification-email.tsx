// Mailer only: the email copy and its catalog never reach a route or the client.
import "server-only";

import type { EmailTranslate } from "../email-i18n";
import { type EmailDetailRow, EmailLayout, EmailText } from "../layout/email-layout";

export interface NotificationEmailProps {
	/** The recipient language. */
	locale: string;
	/** The `emails` namespace translator in `locale`. */
	t: EmailTranslate;
	/** The notification title in the recipient language; also the heading. */
	title: string;
	/** The notification message in the recipient language. */
	message: string;
	/** Optional detail rows, labels and values already in the recipient language. */
	details?: readonly EmailDetailRow[];
	/** Where the "Open Z8" button leads; no button without one. */
	actionUrl?: string;
}

/** A notification's email: its translated title and message in the shared layout. */
export function NotificationEmail({
	locale,
	t,
	title,
	message,
	details,
	actionUrl,
}: NotificationEmailProps) {
	return (
		<EmailLayout
			locale={locale}
			t={t}
			title={title}
			preview={message}
			details={details}
			action={
				actionUrl
					? { label: t("emails.notification.openAction", "Open Z8"), href: actionUrl }
					: undefined
			}
		>
			{message ? <EmailText>{message}</EmailText> : null}
		</EmailLayout>
	);
}
