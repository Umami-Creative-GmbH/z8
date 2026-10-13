import { render } from "react-email";
import { DEFAULT_LANGUAGE } from "@/tolgee/shared";
import { type EmailTranslator, loadEmailTranslator } from "./email-i18n";
import { AbsenceRecordedByManager } from "./templates/absence-recorded-by-manager";
import { AbsenceRequestApproved } from "./templates/absence-request-approved";
import { AbsenceRequestPendingApproval } from "./templates/absence-request-pending-approval";
import { AbsenceRequestRejected } from "./templates/absence-request-rejected";
import { AbsenceRequestSubmitted } from "./templates/absence-request-submitted";
import { EmailVerification, type EmailVerificationData } from "./templates/email-verification";
import { ExportFailed, type ExportFailedData } from "./templates/export-failed";
import { ExportReady, type ExportReadyData } from "./templates/export-ready";
import { NotificationEmail, type NotificationEmailProps } from "./templates/notification-email";
import {
	OrganizationDeletion,
	type OrganizationDeletionData,
} from "./templates/organization-deletion";
import {
	OrganizationInvitation,
	type OrganizationInvitationData,
} from "./templates/organization-invitation";
import { PasswordReset, type PasswordResetData } from "./templates/password-reset";
import { SecurityAlert, type SecurityAlertData } from "./templates/security-alert";
import { TeamMemberAdded } from "./templates/team-member-added";
import { TeamMemberRemoved } from "./templates/team-member-removed";
import { TimeCorrectionApproved } from "./templates/time-correction-approved";
import { TimeCorrectionPendingApproval } from "./templates/time-correction-pending-approval";
import { TimeCorrectionRejected } from "./templates/time-correction-rejected";

/** A notification email in the shared layout, in the recipient language (#1150). */
export async function renderNotificationEmail(props: NotificationEmailProps) {
	return render(NotificationEmail(props));
}

export async function renderAbsenceRequestSubmitted(props: {
	employeeName: string;
	startDate: string;
	endDate: string;
	absenceType: string;
	days: number;
	managerName: string;
	appUrl: string;
}) {
	return render(AbsenceRequestSubmitted(props));
}

export async function renderAbsenceRequestPendingApproval(props: {
	managerName: string;
	employeeName: string;
	startDate: string;
	endDate: string;
	absenceType: string;
	days: number;
	notes?: string;
	approvalUrl: string;
}) {
	return render(AbsenceRequestPendingApproval(props));
}

export async function renderAbsenceRequestApproved(props: {
	employeeName: string;
	approverName: string;
	startDate: string;
	endDate: string;
	absenceType: string;
	days: number;
	appUrl: string;
}) {
	return render(AbsenceRequestApproved(props));
}

export async function renderAbsenceRequestRejected(props: {
	employeeName: string;
	approverName: string;
	startDate: string;
	endDate: string;
	absenceType: string;
	days: number;
	rejectionReason: string;
	appUrl: string;
}) {
	return render(AbsenceRequestRejected(props));
}

export async function renderAbsenceRecordedByManager(props: {
	employeeName: string;
	managerName: string;
	startDate: string;
	endDate: string;
	absenceType: string;
	days: number;
	appUrl: string;
}) {
	return render(AbsenceRecordedByManager(props));
}

export async function renderTimeCorrectionPendingApproval(props: {
	managerName: string;
	employeeName: string;
	date: string;
	originalClockIn: string;
	originalClockOut: string;
	correctedClockIn: string;
	correctedClockOut: string;
	reason: string;
	approvalUrl: string;
}) {
	return render(TimeCorrectionPendingApproval(props));
}

/**
 * The dedicated templates (#1151) render in the translator's language. Without
 * one (the template editors' preview and test send) they render in English.
 */
async function translatorOrEnglish(translator?: EmailTranslator): Promise<EmailTranslator> {
	return translator ?? loadEmailTranslator(DEFAULT_LANGUAGE);
}

export async function renderEmailVerification(
	data: EmailVerificationData,
	translator?: EmailTranslator,
) {
	return render(EmailVerification({ ...data, ...(await translatorOrEnglish(translator)) }));
}

export async function renderOrganizationInvitation(
	data: OrganizationInvitationData,
	translator?: EmailTranslator,
) {
	return render(OrganizationInvitation({ ...data, ...(await translatorOrEnglish(translator)) }));
}

export async function renderPasswordReset(data: PasswordResetData, translator?: EmailTranslator) {
	return render(PasswordReset({ ...data, ...(await translatorOrEnglish(translator)) }));
}

export async function renderOrganizationDeletion(
	data: OrganizationDeletionData,
	translator?: EmailTranslator,
) {
	return render(OrganizationDeletion({ ...data, ...(await translatorOrEnglish(translator)) }));
}

export async function renderTimeCorrectionApproved(props: {
	employeeName: string;
	approverName: string;
	date: string;
	correctedClockIn: string;
	correctedClockOut: string;
	appUrl: string;
}) {
	return render(TimeCorrectionApproved(props));
}

export async function renderTimeCorrectionRejected(props: {
	employeeName: string;
	approverName: string;
	date: string;
	correctedClockIn: string;
	correctedClockOut: string;
	rejectionReason: string;
	appUrl: string;
}) {
	return render(TimeCorrectionRejected(props));
}

export async function renderTeamMemberAdded(props: {
	memberName: string;
	teamName: string;
	addedByName: string;
	teamUrl: string;
	appUrl: string;
}) {
	return render(TeamMemberAdded(props));
}

export async function renderTeamMemberRemoved(props: {
	memberName: string;
	teamName: string;
	removedByName: string;
	appUrl: string;
}) {
	return render(TeamMemberRemoved(props));
}

export async function renderSecurityAlert(data: SecurityAlertData, translator?: EmailTranslator) {
	return render(SecurityAlert({ ...data, ...(await translatorOrEnglish(translator)) }));
}

export async function renderExportReady(data: ExportReadyData, translator?: EmailTranslator) {
	return render(ExportReady({ ...data, ...(await translatorOrEnglish(translator)) }));
}

export async function renderExportFailed(data: ExportFailedData, translator?: EmailTranslator) {
	return render(ExportFailed({ ...data, ...(await translatorOrEnglish(translator)) }));
}
