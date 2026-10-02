import type { useTranslate } from "@tolgee/react";

type Translate = ReturnType<typeof useTranslate>["t"];
export function getEmailTemplateCopy(
	t: Translate,
): Record<string, { label: string; description: string }> {
	return {
		"email-verification": {
			label: t(
				"settings.emailTemplates.definitions.email-verification.label",
				"Email verification",
			),
			description: t(
				"settings.emailTemplates.definitions.email-verification.description",
				"Sent when a user needs to verify their email address.",
			),
		},
		"password-reset": {
			label: t(
				"settings.emailTemplates.definitions.password-reset.label",
				"Password reset",
			),
			description: t(
				"settings.emailTemplates.definitions.password-reset.description",
				"Sent when a user requests a password reset link.",
			),
		},
		"organization-invitation": {
			label: t(
				"settings.emailTemplates.definitions.organization-invitation.label",
				"Organization invitation",
			),
			description: t(
				"settings.emailTemplates.definitions.organization-invitation.description",
				"Sent when a user is invited to join an organization.",
			),
		},
		"absence-request-submitted": {
			label: t(
				"settings.emailTemplates.definitions.absence-request-submitted.label",
				"Absence request submitted",
			),
			description: t(
				"settings.emailTemplates.definitions.absence-request-submitted.description",
				"Confirms that an employee submitted an absence request.",
			),
		},
		"absence-request-pending-approval": {
			label: t(
				"settings.emailTemplates.definitions.absence-request-pending-approval.label",
				"Absence request pending approval",
			),
			description: t(
				"settings.emailTemplates.definitions.absence-request-pending-approval.description",
				"Notifies a manager that an absence request needs approval.",
			),
		},
		"absence-request-approved": {
			label: t(
				"settings.emailTemplates.definitions.absence-request-approved.label",
				"Absence request approved",
			),
			description: t(
				"settings.emailTemplates.definitions.absence-request-approved.description",
				"Notifies an employee that their absence request was approved.",
			),
		},
		"absence-recorded-by-manager": {
			label: t(
				"settings.emailTemplates.definitions.absence-recorded-by-manager.label",
				"Absence recorded by manager",
			),
			description: t(
				"settings.emailTemplates.definitions.absence-recorded-by-manager.description",
				"Notifies an employee that a manager recorded an absence on their behalf.",
			),
		},
		"absence-request-rejected": {
			label: t(
				"settings.emailTemplates.definitions.absence-request-rejected.label",
				"Absence request rejected",
			),
			description: t(
				"settings.emailTemplates.definitions.absence-request-rejected.description",
				"Notifies an employee that their absence request was rejected.",
			),
		},
		"time-correction-pending-approval": {
			label: t(
				"settings.emailTemplates.definitions.time-correction-pending-approval.label",
				"Time correction pending approval",
			),
			description: t(
				"settings.emailTemplates.definitions.time-correction-pending-approval.description",
				"Notifies a manager that a time correction needs approval.",
			),
		},
		"time-correction-approved": {
			label: t(
				"settings.emailTemplates.definitions.time-correction-approved.label",
				"Time correction approved",
			),
			description: t(
				"settings.emailTemplates.definitions.time-correction-approved.description",
				"Notifies an employee that their time correction was approved.",
			),
		},
		"time-correction-rejected": {
			label: t(
				"settings.emailTemplates.definitions.time-correction-rejected.label",
				"Time correction rejected",
			),
			description: t(
				"settings.emailTemplates.definitions.time-correction-rejected.description",
				"Notifies an employee that their time correction was rejected.",
			),
		},
		"team-member-added": {
			label: t(
				"settings.emailTemplates.definitions.team-member-added.label",
				"Team member added",
			),
			description: t(
				"settings.emailTemplates.definitions.team-member-added.description",
				"Notifies a member that they were added to a team.",
			),
		},
		"team-member-removed": {
			label: t(
				"settings.emailTemplates.definitions.team-member-removed.label",
				"Team member removed",
			),
			description: t(
				"settings.emailTemplates.definitions.team-member-removed.description",
				"Notifies a member that they were removed from a team.",
			),
		},
		"security-alert": {
			label: t(
				"settings.emailTemplates.definitions.security-alert.label",
				"Security alert",
			),
			description: t(
				"settings.emailTemplates.definitions.security-alert.description",
				"Notifies a user about an important account security event.",
			),
		},
		"export-ready": {
			label: t(
				"settings.emailTemplates.definitions.export-ready.label",
				"Export ready",
			),
			description: t(
				"settings.emailTemplates.definitions.export-ready.description",
				"Notifies a user that a requested export is ready to download.",
			),
		},
		"export-failed": {
			label: t(
				"settings.emailTemplates.definitions.export-failed.label",
				"Export failed",
			),
			description: t(
				"settings.emailTemplates.definitions.export-failed.description",
				"Notifies a user that a requested export could not be generated.",
			),
		},
	};
}
export function getEmailTemplateVariableLabels(
	t: Translate,
): Record<string, string> {
	return {
		userName: t(
			"settings.emailTemplates.variableDefinitions.userName.label",
			"User name",
		),
		verificationUrl: t(
			"settings.emailTemplates.variableDefinitions.verificationUrl.label",
			"Verification URL",
		),
		appUrl: t(
			"settings.emailTemplates.variableDefinitions.appUrl.label",
			"App URL",
		),
		resetUrl: t(
			"settings.emailTemplates.variableDefinitions.resetUrl.label",
			"Reset URL",
		),
		email: t(
			"settings.emailTemplates.variableDefinitions.email.label",
			"Email",
		),
		organizationName: t(
			"settings.emailTemplates.variableDefinitions.organizationName.label",
			"Organization name",
		),
		inviterName: t(
			"settings.emailTemplates.variableDefinitions.inviterName.label",
			"Inviter name",
		),
		role: t("settings.emailTemplates.variableDefinitions.role.label", "Role"),
		invitationUrl: t(
			"settings.emailTemplates.variableDefinitions.invitationUrl.label",
			"Invitation URL",
		),
		employeeName: t(
			"settings.emailTemplates.variableDefinitions.employeeName.label",
			"Employee name",
		),
		startDate: t(
			"settings.emailTemplates.variableDefinitions.startDate.label",
			"Start date",
		),
		endDate: t(
			"settings.emailTemplates.variableDefinitions.endDate.label",
			"End date",
		),
		absenceType: t(
			"settings.emailTemplates.variableDefinitions.absenceType.label",
			"Absence type",
		),
		days: t("settings.emailTemplates.variableDefinitions.days.label", "Days"),
		managerName: t(
			"settings.emailTemplates.variableDefinitions.managerName.label",
			"Manager name",
		),
		notes: t(
			"settings.emailTemplates.variableDefinitions.notes.label",
			"Notes",
		),
		approvalUrl: t(
			"settings.emailTemplates.variableDefinitions.approvalUrl.label",
			"Approval URL",
		),
		approverName: t(
			"settings.emailTemplates.variableDefinitions.approverName.label",
			"Approver name",
		),
		rejectionReason: t(
			"settings.emailTemplates.variableDefinitions.rejectionReason.label",
			"Rejection reason",
		),
		date: t("settings.emailTemplates.variableDefinitions.date.label", "Date"),
		originalClockIn: t(
			"settings.emailTemplates.variableDefinitions.originalClockIn.label",
			"Original clock-in",
		),
		originalClockOut: t(
			"settings.emailTemplates.variableDefinitions.originalClockOut.label",
			"Original clock-out",
		),
		correctedClockIn: t(
			"settings.emailTemplates.variableDefinitions.correctedClockIn.label",
			"Corrected clock-in",
		),
		correctedClockOut: t(
			"settings.emailTemplates.variableDefinitions.correctedClockOut.label",
			"Corrected clock-out",
		),
		reason: t(
			"settings.emailTemplates.variableDefinitions.reason.label",
			"Reason",
		),
		memberName: t(
			"settings.emailTemplates.variableDefinitions.memberName.label",
			"Member name",
		),
		teamName: t(
			"settings.emailTemplates.variableDefinitions.teamName.label",
			"Team name",
		),
		addedByName: t(
			"settings.emailTemplates.variableDefinitions.addedByName.label",
			"Added by",
		),
		teamUrl: t(
			"settings.emailTemplates.variableDefinitions.teamUrl.label",
			"Team URL",
		),
		removedByName: t(
			"settings.emailTemplates.variableDefinitions.removedByName.label",
			"Removed by",
		),
		eventType: t(
			"settings.emailTemplates.variableDefinitions.eventType.label",
			"Event type",
		),
		timestamp: t(
			"settings.emailTemplates.variableDefinitions.timestamp.label",
			"Timestamp",
		),
		ipAddress: t(
			"settings.emailTemplates.variableDefinitions.ipAddress.label",
			"IP address",
		),
		userAgent: t(
			"settings.emailTemplates.variableDefinitions.userAgent.label",
			"User agent",
		),
		securitySettingsUrl: t(
			"settings.emailTemplates.variableDefinitions.securitySettingsUrl.label",
			"Security settings URL",
		),
		recipientName: t(
			"settings.emailTemplates.variableDefinitions.recipientName.label",
			"Recipient name",
		),
		categories: t(
			"settings.emailTemplates.variableDefinitions.categories.label",
			"Categories",
		),
		fileSize: t(
			"settings.emailTemplates.variableDefinitions.fileSize.label",
			"File size",
		),
		downloadUrl: t(
			"settings.emailTemplates.variableDefinitions.downloadUrl.label",
			"Download URL",
		),
		expiresAt: t(
			"settings.emailTemplates.variableDefinitions.expiresAt.label",
			"Expires at",
		),
		errorMessage: t(
			"settings.emailTemplates.variableDefinitions.errorMessage.label",
			"Error message",
		),
		retryUrl: t(
			"settings.emailTemplates.variableDefinitions.retryUrl.label",
			"Retry URL",
		),
	};
}
