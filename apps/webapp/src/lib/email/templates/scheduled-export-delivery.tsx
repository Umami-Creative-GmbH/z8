// Mailer only: the email copy and its catalog never reach a route or the client.
import "server-only";

import { render } from "react-email";
import type { EmailTranslate } from "../email-i18n";
import { type EmailDetailRow, EmailLayout, EmailText } from "../layout/email-layout";

export interface ScheduledExportDeliveryEmailProps {
	/** The recipient language. */
	locale: string;
	/** The `emails` namespace translator in `locale`. */
	t: EmailTranslate;
	scheduleName: string;
	/** The run's date range, already formatted in `locale`. */
	dateRange: string;
	/** The number of records, already formatted in `locale`. */
	recordCount?: string;
	/** The run's download, when it produced a file. */
	download?: {
		url: string;
		/** How long the link is valid, e.g. "7 days", in `locale`. */
		lifetime: string;
		/** When the link expires, in the organization's timezone with the zone printed. */
		expiresAt: string;
	};
}

/** The default subject of a scheduled export delivery email. */
export function scheduledExportDeliverySubject(
	t: EmailTranslate,
	values: { scheduleName: string; dateRange: string },
): string {
	return t(
		"emails.scheduledExport.subject",
		"Scheduled Export: {scheduleName} ({dateRange})",
		values,
	);
}

/** A scheduled export run's delivery email in the shared layout, in the recipient language. */
export function ScheduledExportDeliveryEmail({
	locale,
	t,
	scheduleName,
	dateRange,
	recordCount,
	download,
}: ScheduledExportDeliveryEmailProps) {
	const details: EmailDetailRow[] = [
		{
			label: t("emails.scheduledExport.dateRangeLabel", "Date range"),
			value: dateRange,
		},
		...(recordCount === undefined
			? []
			: [
					{
						label: t("emails.scheduledExport.recordsLabel", "Records"),
						value: recordCount,
					},
				]),
	];
	const body = download
		? t(
				"emails.scheduledExport.ready.body",
				"Your scheduled export {scheduleName} has completed successfully.",
				{ scheduleName },
			)
		: t(
				"emails.scheduledExport.empty.body",
				"Your scheduled export {scheduleName} ran, but there is nothing to download.",
				{ scheduleName },
			);

	return (
		<EmailLayout
			locale={locale}
			t={t}
			title={
				download
					? t("emails.scheduledExport.ready.title", "Scheduled export ready")
					: t("emails.scheduledExport.empty.title", "Scheduled export finished")
			}
			preview={body}
			details={details}
			action={
				download
					? {
							label: t("emails.scheduledExport.ready.action", "Download export"),
							href: download.url,
						}
					: undefined
			}
			note={
				download
					? t(
							"emails.scheduledExport.ready.linkExpiry",
							"This download link is valid for {lifetime} and expires on {expiresAt}.",
							{ lifetime: download.lifetime, expiresAt: download.expiresAt },
						)
					: undefined
			}
		>
			<EmailText>{body}</EmailText>
			{download ? null : (
				<EmailText>
					{t("emails.scheduledExport.empty.noFile", "No file was produced for this run.")}
				</EmailText>
			)}
		</EmailLayout>
	);
}

/** `ScheduledExportDeliveryEmail` as an HTML string. */
export async function renderScheduledExportDeliveryEmail(
	props: ScheduledExportDeliveryEmailProps,
): Promise<string> {
	return render(<ScheduledExportDeliveryEmail {...props} />);
}
