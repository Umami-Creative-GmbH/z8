// Mailer only: the email copy and its catalog never reach a route or the client.
import "server-only";

import type { EmailTranslate } from "../email-i18n";
import { EmailLayout, EmailText } from "../layout/email-layout";

export type OrganizationDeletionData = {
	userName: string;
	organizationName: string;
	deletedByName: string;
	/** When the deletion was requested, formatted in the organization timezone. */
	deletionDate: string;
	/** When the organization is deleted for good, formatted in the organization timezone. */
	permanentDeletionDate: string;
	recoveryUrl: string;
};

export interface OrganizationDeletionProps extends OrganizationDeletionData {
	/** The recipient language. */
	locale: string;
	/** The `emails` namespace translator in `locale`. */
	t: EmailTranslate;
}

export function OrganizationDeletion({
	locale,
	t,
	userName,
	organizationName,
	deletedByName,
	deletionDate,
	permanentDeletionDate,
	recoveryUrl,
}: OrganizationDeletionProps) {
	const deletedItems = [
		t("emails.organizationDeletion.items.members", "All members and pending invitations"),
		t(
			"emails.organizationDeletion.items.employees",
			"All employees, teams and manager assignments",
		),
		t("emails.organizationDeletion.items.timeEntries", "All time entries and work periods"),
		t("emails.organizationDeletion.items.absences", "All absences and vacation allowances"),
		t("emails.organizationDeletion.items.projects", "All projects and their time assignments"),
		t("emails.organizationDeletion.items.settings", "All settings, schedules and configurations"),
	];

	return (
		<EmailLayout
			locale={locale}
			t={t}
			title={t("emails.organizationDeletion.title", "Organization scheduled for deletion")}
			preview={t(
				"emails.organizationDeletion.preview",
				"{organizationName} will be deleted permanently on {permanentDeletionDate}.",
				{ organizationName, permanentDeletionDate },
			)}
			details={[
				{
					label: t("emails.organizationDeletion.organization", "Organization"),
					value: organizationName,
				},
				{
					label: t("emails.organizationDeletion.initiatedBy", "Initiated by"),
					value: deletedByName,
				},
				{
					label: t("emails.organizationDeletion.requestedAt", "Deletion requested"),
					value: deletionDate,
				},
				{
					label: t("emails.organizationDeletion.permanentAt", "Permanent deletion"),
					value: permanentDeletionDate,
				},
			]}
			action={{
				label: t("emails.organizationDeletion.action", "Recover organization"),
				href: recoveryUrl,
			}}
			note={t(
				"emails.organizationDeletion.note",
				"If you meant to delete the organization, no action is needed. If you did not, recover it now and review your account security.",
			)}
		>
			<EmailText>{t("emails.common.greeting", "Hi {name},", { name: userName })}</EmailText>
			<EmailText>
				{t(
					"emails.organizationDeletion.body",
					"{deletedByName} scheduled the organization {organizationName} for deletion. You can recover it until {permanentDeletionDate}.",
					{ deletedByName, organizationName, permanentDeletionDate },
				)}
			</EmailText>
			<EmailText>
				{t("emails.organizationDeletion.itemsTitle", "What will be permanently deleted:")}
			</EmailText>
			<ul style={list}>
				{deletedItems.map((item) => (
					<li key={item} style={listItem}>
						{item}
					</li>
				))}
			</ul>
		</EmailLayout>
	);
}

export default OrganizationDeletion;

const list = {
	color: "#1f2937",
	fontSize: "15px",
	lineHeight: "24px",
	margin: "0 40px 16px",
	paddingLeft: "20px",
};

const listItem = {
	margin: "0 0 4px",
};
