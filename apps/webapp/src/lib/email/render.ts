import { render } from "@react-email/render";
import { AbsenceRequestApproved } from "./templates/absence-request-approved";
import { AbsenceRequestPendingApproval } from "./templates/absence-request-pending-approval";
import { AbsenceRequestRejected } from "./templates/absence-request-rejected";
import { AbsenceRequestSubmitted } from "./templates/absence-request-submitted";
import { EmailVerification } from "./templates/email-verification";
import { ExportFailed } from "./templates/export-failed";
import { ExportReady } from "./templates/export-ready";
import { OrganizationInvitation } from "./templates/organization-invitation";
import { PasswordReset } from "./templates/password-reset";
import { SecurityAlert } from "./templates/security-alert";
import { TeamMemberAdded } from "./templates/team-member-added";
import { TeamMemberRemoved } from "./templates/team-member-removed";
import { TimeCorrectionApproved } from "./templates/time-correction-approved";
import { TimeCorrectionPendingApproval } from "./templates/time-correction-pending-approval";
import { TimeCorrectionRejected } from "./templates/time-correction-rejected";

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

export async function renderEmailVerification(props: {
	userName: string;
	verificationUrl: string;
	appUrl: string;
}) {
	return render(EmailVerification(props));
}

export async function renderOrganizationInvitation(props: {
	email: string;
	organizationName: string;
	inviterName: string;
	role: string;
	invitationUrl: string;
}) {
	return render(OrganizationInvitation(props));
}

export async function renderPasswordReset(props: { userName: string; resetUrl: string }) {
	return render(PasswordReset(props));
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

export async function renderSecurityAlert(props: {
	userName: string;
	eventType: "password_changed" | "two_factor_enabled" | "two_factor_disabled";
	timestamp: string;
	ipAddress?: string;
	userAgent?: string;
	securitySettingsUrl: string;
	appUrl: string;
}) {
	return render(SecurityAlert(props));
}

export async function renderExportReady(props: {
	recipientName: string;
	organizationName: string;
	categories: string[];
	fileSize: string;
	downloadUrl: string;
	expiresAt: string;
}) {
	return render(ExportReady(props));
}

export async function renderExportFailed(props: {
	recipientName: string;
	organizationName: string;
	categories: string[];
	errorMessage: string;
	retryUrl: string;
}) {
	return render(ExportFailed(props));
}
