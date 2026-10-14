// Mailer only: the email copy and its catalog never reach a route or the client.
import "server-only";

import type { EmailTranslate } from "../email-i18n";
import { EmailLayout, EmailText } from "../layout/email-layout";

/** The export-failed email's data; also the `{{variables}}` of its override. */
export type ExportFailedData = {
	recipientName: string;
	organizationName: string;
	/** The requested data categories, already in the recipient language. */
	categories: string[];
	errorMessage: string;
	retryUrl: string;
};

export interface ExportFailedProps extends ExportFailedData {
	/** The recipient language. */
	locale: string;
	/** The `emails` namespace translator in `locale`. */
	t: EmailTranslate;
}

// No inbox preview: the default body is also the override starter draft, whose plain text
// would pick up the preview's hidden padding.
export function ExportFailed({
	locale,
	t,
	recipientName,
	organizationName,
	categories,
	errorMessage,
	retryUrl,
}: ExportFailedProps) {
	return (
		<EmailLayout
			locale={locale}
			t={t}
			title={t("emails.exportFailed.title", "Data export failed")}
			details={[
				{ label: t("emails.export.organization", "Organization"), value: organizationName },
				{
					label: t("emails.exportFailed.categories", "Requested data"),
					value: categories.join(", "),
				},
				{ label: t("emails.exportFailed.error", "Error"), value: errorMessage },
			]}
			action={{ label: t("emails.exportFailed.action", "Try again"), href: retryUrl }}
			note={t(
				"emails.exportFailed.note",
				"If this error persists, contact support with the error message above. Exporting fewer data categories at once can also help.",
			)}
		>
			<EmailText>{t("emails.common.greeting", "Hi {name},", { name: recipientName })}</EmailText>
			<EmailText>
				{t(
					"emails.exportFailed.body",
					"Unfortunately, your data export for {organizationName} could not be completed.",
					{ organizationName },
				)}
			</EmailText>
		</EmailLayout>
	);
}

export default ExportFailed;
