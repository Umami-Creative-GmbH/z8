import type { EmailTemplateKey } from "@/db/schema";
import {
	renderAbsenceRequestApproved,
	renderAbsenceRequestPendingApproval,
	renderAbsenceRequestRejected,
	renderAbsenceRequestSubmitted,
	renderEmailVerification,
	renderExportFailed,
	renderExportReady,
	renderOrganizationInvitation,
	renderPasswordReset,
	renderSecurityAlert,
	renderTeamMemberAdded,
	renderTeamMemberRemoved,
	renderTimeCorrectionApproved,
	renderTimeCorrectionPendingApproval,
	renderTimeCorrectionRejected,
} from "./render";

export type EmailTemplateCategory =
	| "auth"
	| "absences"
	| "time-corrections"
	| "teams"
	| "security"
	| "exports";

export interface EmailTemplateVariableDefinition {
	name: string;
	label: string;
	description: string;
	example: string;
}

export interface EmailTemplateDefinition<
	TData extends Record<string, unknown> = Record<string, unknown>,
> {
	key: EmailTemplateKey;
	category: EmailTemplateCategory;
	label: string;
	description: string;
	defaultSubject: string;
	variables: EmailTemplateVariableDefinition[];
	previewData: TData;
	renderDefault(data: TData): Promise<string>;
}

const appUrl = "https://app.z8-time.app";
const approvalUrl = `${appUrl}/approvals`;

const variableExamples: Record<string, string> = {
	absenceType: "Vacation",
	addedByName: "Jordan Lee",
	appUrl,
	approvalUrl,
	approverName: "Jordan Lee",
	categories: "Time entries, Absences",
	correctedClockIn: "09:00",
	correctedClockOut: "17:30",
	date: "May 12, 2026",
	days: "3",
	downloadUrl: `${appUrl}/exports/preview/download`,
	email: "alex@example.com",
	employeeName: "Alex Morgan",
	endDate: "May 14, 2026",
	errorMessage: "The export could not be completed because one data source timed out.",
	eventType: "password_changed",
	expiresAt: "May 7, 2026 at 08:45 UTC",
	fileSize: "2.4 MB",
	invitationUrl: `${appUrl}/invitations/preview`,
	inviterName: "Jordan Lee",
	ipAddress: "203.0.113.42",
	managerName: "Jordan Lee",
	memberName: "Alex Morgan",
	notes: "Family trip planned in advance.",
	organizationName: "Acme Operations",
	originalClockIn: "09:30",
	originalClockOut: "17:00",
	reason: "Forgot to clock in after arriving on time.",
	recipientName: "Alex Morgan",
	rejectionReason: "Coverage is required for a scheduled audit.",
	removedByName: "Jordan Lee",
	resetUrl: `${appUrl}/reset-password?token=preview`,
	retryUrl: `${appUrl}/exports/new`,
	role: "Manager",
	securitySettingsUrl: `${appUrl}/settings/security`,
	startDate: "May 12, 2026",
	teamName: "Operations",
	teamUrl: `${appUrl}/teams/operations`,
	timestamp: "April 30, 2026 at 08:45 UTC",
	userAgent: "Firefox on Linux",
	userName: "Alex Morgan",
	verificationUrl: `${appUrl}/verify-email?token=preview`,
};

const variable = (
	name: string,
	label: string,
	description: string,
): EmailTemplateVariableDefinition => ({
	name,
	label,
	description,
	example: variableExamples[name] ?? "Example value",
});

export const EMAIL_TEMPLATE_REGISTRY = [
	{
		key: "email-verification",
		category: "auth",
		label: "Email verification",
		description: "Sent when a user needs to verify their email address.",
		defaultSubject: "Verify your email address",
		variables: [
			variable("userName", "User name", "Name of the user verifying their email."),
			variable(
				"verificationUrl",
				"Verification URL",
				"Secure link used to verify the email address.",
			),
			variable("appUrl", "App URL", "Base URL for the Z8 app."),
		],
		previewData: {
			userName: "Alex Morgan",
			verificationUrl: `${appUrl}/verify-email?token=preview`,
			appUrl,
		},
		renderDefault: renderEmailVerification,
	},
	{
		key: "password-reset",
		category: "auth",
		label: "Password reset",
		description: "Sent when a user requests a password reset link.",
		defaultSubject: "Reset your password",
		variables: [
			variable("userName", "User name", "Name of the user resetting their password."),
			variable("resetUrl", "Reset URL", "Secure link used to set a new password."),
		],
		previewData: {
			userName: "Alex Morgan",
			resetUrl: `${appUrl}/reset-password?token=preview`,
		},
		renderDefault: renderPasswordReset,
	},
	{
		key: "organization-invitation",
		category: "auth",
		label: "Organization invitation",
		description: "Sent when a user is invited to join an organization.",
		defaultSubject: "You have been invited to {{organizationName}}",
		variables: [
			variable("email", "Email", "Email address receiving the invitation."),
			variable("organizationName", "Organization name", "Name of the inviting organization."),
			variable("inviterName", "Inviter name", "Name of the person sending the invitation."),
			variable("role", "Role", "Role assigned to the invited member."),
			variable("invitationUrl", "Invitation URL", "Secure link used to accept the invitation."),
		],
		previewData: {
			email: "alex@example.com",
			organizationName: "Acme Operations",
			inviterName: "Jordan Lee",
			role: "Manager",
			invitationUrl: `${appUrl}/invitations/preview`,
		},
		renderDefault: renderOrganizationInvitation,
	},
	{
		key: "absence-request-submitted",
		category: "absences",
		label: "Absence request submitted",
		description: "Confirms that an employee submitted an absence request.",
		defaultSubject: "Absence request submitted",
		variables: [
			variable("employeeName", "Employee name", "Name of the employee requesting absence."),
			variable("startDate", "Start date", "First day of the requested absence."),
			variable("endDate", "End date", "Last day of the requested absence."),
			variable("absenceType", "Absence type", "Type of absence requested."),
			variable("days", "Days", "Total number of requested absence days."),
			variable("managerName", "Manager name", "Name of the responsible manager."),
			variable("appUrl", "App URL", "Base URL for the Z8 app."),
		],
		previewData: {
			employeeName: "Alex Morgan",
			startDate: "May 12, 2026",
			endDate: "May 14, 2026",
			absenceType: "Vacation",
			days: 3,
			managerName: "Jordan Lee",
			appUrl,
		},
		renderDefault: renderAbsenceRequestSubmitted,
	},
	{
		key: "absence-request-pending-approval",
		category: "absences",
		label: "Absence request pending approval",
		description: "Notifies a manager that an absence request needs approval.",
		defaultSubject: "Absence request pending approval",
		variables: [
			variable("managerName", "Manager name", "Name of the approving manager."),
			variable("employeeName", "Employee name", "Name of the employee requesting absence."),
			variable("startDate", "Start date", "First day of the requested absence."),
			variable("endDate", "End date", "Last day of the requested absence."),
			variable("absenceType", "Absence type", "Type of absence requested."),
			variable("days", "Days", "Total number of requested absence days."),
			variable("notes", "Notes", "Optional notes submitted with the request."),
			variable("approvalUrl", "Approval URL", "Link to review and approve the request."),
		],
		previewData: {
			managerName: "Jordan Lee",
			employeeName: "Alex Morgan",
			startDate: "May 12, 2026",
			endDate: "May 14, 2026",
			absenceType: "Vacation",
			days: 3,
			notes: "Family trip planned in advance.",
			approvalUrl,
		},
		renderDefault: renderAbsenceRequestPendingApproval,
	},
	{
		key: "absence-request-approved",
		category: "absences",
		label: "Absence request approved",
		description: "Notifies an employee that their absence request was approved.",
		defaultSubject: "Absence request approved",
		variables: [
			variable("employeeName", "Employee name", "Name of the employee requesting absence."),
			variable("approverName", "Approver name", "Name of the person who approved the request."),
			variable("startDate", "Start date", "First day of the approved absence."),
			variable("endDate", "End date", "Last day of the approved absence."),
			variable("absenceType", "Absence type", "Type of approved absence."),
			variable("days", "Days", "Total number of approved absence days."),
			variable("appUrl", "App URL", "Base URL for the Z8 app."),
		],
		previewData: {
			employeeName: "Alex Morgan",
			approverName: "Jordan Lee",
			startDate: "May 12, 2026",
			endDate: "May 14, 2026",
			absenceType: "Vacation",
			days: 3,
			appUrl,
		},
		renderDefault: renderAbsenceRequestApproved,
	},
	{
		key: "absence-request-rejected",
		category: "absences",
		label: "Absence request rejected",
		description: "Notifies an employee that their absence request was rejected.",
		defaultSubject: "Absence request rejected",
		variables: [
			variable("employeeName", "Employee name", "Name of the employee requesting absence."),
			variable("approverName", "Approver name", "Name of the person who rejected the request."),
			variable("startDate", "Start date", "First day of the requested absence."),
			variable("endDate", "End date", "Last day of the requested absence."),
			variable("absenceType", "Absence type", "Type of rejected absence."),
			variable("days", "Days", "Total number of requested absence days."),
			variable("rejectionReason", "Rejection reason", "Reason the absence request was rejected."),
			variable("appUrl", "App URL", "Base URL for the Z8 app."),
		],
		previewData: {
			employeeName: "Alex Morgan",
			approverName: "Jordan Lee",
			startDate: "May 12, 2026",
			endDate: "May 14, 2026",
			absenceType: "Vacation",
			days: 3,
			rejectionReason: "Coverage is required for a scheduled audit.",
			appUrl,
		},
		renderDefault: renderAbsenceRequestRejected,
	},
	{
		key: "time-correction-pending-approval",
		category: "time-corrections",
		label: "Time correction pending approval",
		description: "Notifies a manager that a time correction needs approval.",
		defaultSubject: "Time correction pending approval",
		variables: [
			variable("managerName", "Manager name", "Name of the approving manager."),
			variable("employeeName", "Employee name", "Name of the employee requesting correction."),
			variable("date", "Date", "Date of the time entry being corrected."),
			variable("originalClockIn", "Original clock-in", "Original recorded clock-in time."),
			variable("originalClockOut", "Original clock-out", "Original recorded clock-out time."),
			variable("correctedClockIn", "Corrected clock-in", "Requested corrected clock-in time."),
			variable("correctedClockOut", "Corrected clock-out", "Requested corrected clock-out time."),
			variable("reason", "Reason", "Reason for the requested correction."),
			variable("approvalUrl", "Approval URL", "Link to review and approve the correction."),
		],
		previewData: {
			managerName: "Jordan Lee",
			employeeName: "Alex Morgan",
			date: "May 12, 2026",
			originalClockIn: "09:30",
			originalClockOut: "17:00",
			correctedClockIn: "09:00",
			correctedClockOut: "17:30",
			reason: "Forgot to clock in after arriving on time.",
			approvalUrl,
		},
		renderDefault: renderTimeCorrectionPendingApproval,
	},
	{
		key: "time-correction-approved",
		category: "time-corrections",
		label: "Time correction approved",
		description: "Notifies an employee that their time correction was approved.",
		defaultSubject: "Time correction approved",
		variables: [
			variable("employeeName", "Employee name", "Name of the employee requesting correction."),
			variable("approverName", "Approver name", "Name of the person who approved the correction."),
			variable("date", "Date", "Date of the corrected time entry."),
			variable("correctedClockIn", "Corrected clock-in", "Approved corrected clock-in time."),
			variable("correctedClockOut", "Corrected clock-out", "Approved corrected clock-out time."),
			variable("appUrl", "App URL", "Base URL for the Z8 app."),
		],
		previewData: {
			employeeName: "Alex Morgan",
			approverName: "Jordan Lee",
			date: "May 12, 2026",
			correctedClockIn: "09:00",
			correctedClockOut: "17:30",
			appUrl,
		},
		renderDefault: renderTimeCorrectionApproved,
	},
	{
		key: "time-correction-rejected",
		category: "time-corrections",
		label: "Time correction rejected",
		description: "Notifies an employee that their time correction was rejected.",
		defaultSubject: "Time correction rejected",
		variables: [
			variable("employeeName", "Employee name", "Name of the employee requesting correction."),
			variable("approverName", "Approver name", "Name of the person who rejected the correction."),
			variable("date", "Date", "Date of the time entry being corrected."),
			variable("correctedClockIn", "Corrected clock-in", "Requested corrected clock-in time."),
			variable("correctedClockOut", "Corrected clock-out", "Requested corrected clock-out time."),
			variable("rejectionReason", "Rejection reason", "Reason the correction was rejected."),
			variable("appUrl", "App URL", "Base URL for the Z8 app."),
		],
		previewData: {
			employeeName: "Alex Morgan",
			approverName: "Jordan Lee",
			date: "May 12, 2026",
			correctedClockIn: "09:00",
			correctedClockOut: "17:30",
			rejectionReason: "The requested time conflicts with approved schedule records.",
			appUrl,
		},
		renderDefault: renderTimeCorrectionRejected,
	},
	{
		key: "team-member-added",
		category: "teams",
		label: "Team member added",
		description: "Notifies a member that they were added to a team.",
		defaultSubject: "You have been added to a team",
		variables: [
			variable("memberName", "Member name", "Name of the team member."),
			variable("teamName", "Team name", "Name of the team."),
			variable("addedByName", "Added by", "Name of the person who added the member."),
			variable("teamUrl", "Team URL", "Link to open the team."),
			variable("appUrl", "App URL", "Base URL for the Z8 app."),
		],
		previewData: {
			memberName: "Alex Morgan",
			teamName: "Operations",
			addedByName: "Jordan Lee",
			teamUrl: `${appUrl}/teams/operations`,
			appUrl,
		},
		renderDefault: renderTeamMemberAdded,
	},
	{
		key: "team-member-removed",
		category: "teams",
		label: "Team member removed",
		description: "Notifies a member that they were removed from a team.",
		defaultSubject: "You have been removed from a team",
		variables: [
			variable("memberName", "Member name", "Name of the team member."),
			variable("teamName", "Team name", "Name of the team."),
			variable("removedByName", "Removed by", "Name of the person who removed the member."),
			variable("appUrl", "App URL", "Base URL for the Z8 app."),
		],
		previewData: {
			memberName: "Alex Morgan",
			teamName: "Operations",
			removedByName: "Jordan Lee",
			appUrl,
		},
		renderDefault: renderTeamMemberRemoved,
	},
	{
		key: "security-alert",
		category: "security",
		label: "Security alert",
		description: "Notifies a user about an important account security event.",
		defaultSubject: "Security alert for your account",
		variables: [
			variable("userName", "User name", "Name of the affected user."),
			variable("eventType", "Event type", "Type of security event."),
			variable("timestamp", "Timestamp", "Time when the event occurred."),
			variable("ipAddress", "IP address", "IP address associated with the event."),
			variable("userAgent", "User agent", "Browser or device associated with the event."),
			variable(
				"securitySettingsUrl",
				"Security settings URL",
				"Link to review account security settings.",
			),
			variable("appUrl", "App URL", "Base URL for the Z8 app."),
		],
		previewData: {
			userName: "Alex Morgan",
			eventType: "password_changed",
			timestamp: "April 30, 2026 at 08:45 UTC",
			ipAddress: "203.0.113.42",
			userAgent: "Firefox on Linux",
			securitySettingsUrl: `${appUrl}/settings/security`,
			appUrl,
		},
		renderDefault: renderSecurityAlert,
	},
	{
		key: "export-ready",
		category: "exports",
		label: "Export ready",
		description: "Notifies a user that a requested export is ready to download.",
		defaultSubject: "Your export is ready",
		variables: [
			variable("recipientName", "Recipient name", "Name of the export recipient."),
			variable("organizationName", "Organization name", "Name of the organization for the export."),
			variable("categories", "Categories", "Exported data categories."),
			variable("fileSize", "File size", "Size of the generated export file."),
			variable("downloadUrl", "Download URL", "Secure link used to download the export."),
			variable("expiresAt", "Expires at", "Time when the download link expires."),
		],
		previewData: {
			recipientName: "Alex Morgan",
			organizationName: "Acme Operations",
			categories: ["Time entries", "Absences"],
			fileSize: "2.4 MB",
			downloadUrl: `${appUrl}/exports/preview/download`,
			expiresAt: "May 7, 2026 at 08:45 UTC",
		},
		renderDefault: renderExportReady,
	},
	{
		key: "export-failed",
		category: "exports",
		label: "Export failed",
		description: "Notifies a user that a requested export could not be generated.",
		defaultSubject: "Your export failed",
		variables: [
			variable("recipientName", "Recipient name", "Name of the export recipient."),
			variable("organizationName", "Organization name", "Name of the organization for the export."),
			variable("categories", "Categories", "Requested export data categories."),
			variable("errorMessage", "Error message", "Reason the export failed."),
			variable("retryUrl", "Retry URL", "Link used to retry the export."),
		],
		previewData: {
			recipientName: "Alex Morgan",
			organizationName: "Acme Operations",
			categories: ["Time entries", "Absences"],
			errorMessage: "The export could not be completed because one data source timed out.",
			retryUrl: `${appUrl}/exports/new`,
		},
		renderDefault: renderExportFailed,
	},
] satisfies EmailTemplateDefinition[];

export function getEmailTemplateDefinition(key: EmailTemplateKey) {
	const definition = EMAIL_TEMPLATE_REGISTRY.find((entry) => entry.key === key);

	if (!definition) {
		throw new Error(`Unknown email template key: ${key}`);
	}

	return definition;
}
