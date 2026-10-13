// Mailer only: the email copy and its catalog never reach a route or the client.
import "server-only";

import type { EmailTranslate } from "../email-i18n";
import { EmailLayout, EmailText } from "../layout/email-layout";

/** The export-ready email's data; also the `{{variables}}` of its override. */
export type ExportReadyData = {
	recipientName: string;
	organizationName: string;
	/** The exported data categories, already in the recipient language. */
	categories: string[];
	fileSize: string;
	downloadUrl: string;
	/** When the file is deleted, already formatted in the organization timezone. */
	expiresAt: string;
};

export interface ExportReadyProps extends ExportReadyData {
	/** The recipient language. */
	locale: string;
	/** The `emails` namespace translator in `locale`. */
	t: EmailTranslate;
}

// No inbox preview: the default body is also the override starter draft, whose plain text
// would pick up the preview's hidden padding.
export function ExportReady({
	locale,
	t,
	recipientName,
	organizationName,
	categories,
	fileSize,
	downloadUrl,
	expiresAt,
}: ExportReadyProps) {
	return (
		<EmailLayout
			locale={locale}
			t={t}
			title={t("emails.exportReady.title", "Your data export is ready")}
			details={[
				{ label: t("emails.export.organization", "Organization"), value: organizationName },
				{
					label: t("emails.exportReady.categories", "Data included"),
					value: categories.join(", "),
				},
				{ label: t("emails.exportReady.fileSize", "File size"), value: fileSize },
				{ label: t("emails.exportReady.expiresAt", "Available until"), value: expiresAt },
			]}
			action={{ label: t("emails.exportReady.action", "Open export history"), href: downloadUrl }}
			note={t(
				"emails.exportReady.note",
				"Sign in to Z8 as an organization admin to download the file. Each download starts with a fresh, secure link. After the date above, the export file is deleted automatically.",
			)}
		>
			<EmailText>{t("emails.common.greeting", "Hi {name},", { name: recipientName })}</EmailText>
			<EmailText>
				{t(
					"emails.exportReady.body",
					"Your data export for {organizationName} is complete. You can download it from the export history in Z8.",
					{ organizationName },
				)}
			</EmailText>
		</EmailLayout>
	);
}

export default ExportReady;
