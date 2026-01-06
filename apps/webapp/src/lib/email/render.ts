import { render } from "@react-email/render";
import { AbsenceRequestApproved } from "./templates/absence-request-approved";
import { AbsenceRequestPendingApproval } from "./templates/absence-request-pending-approval";
import { AbsenceRequestRejected } from "./templates/absence-request-rejected";
import { AbsenceRequestSubmitted } from "./templates/absence-request-submitted";
import { EmailVerification } from "./templates/email-verification";
import { OrganizationInvitation } from "./templates/organization-invitation";
import { PasswordReset } from "./templates/password-reset";
import { TimeCorrectionPendingApproval } from "./templates/time-correction-pending-approval";

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
