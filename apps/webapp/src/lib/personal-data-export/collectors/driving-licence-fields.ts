import type { PersonalDataFieldGuide } from "../collector";

export const drivingLicenceFieldGuide: PersonalDataFieldGuide = (t) => {
	const fields = {
		occasion_key: t(
			"personalDataExport.readme.fields.drivingLicence.occasionKey",
			"The occurrence this reminder or task concerns; it identifies the employment, class deadline or suspension without copying the check.",
		),
		created_at: t(
			"personalDataExport.readme.fields.drivingLicence.createdAt",
			"When this task or delivery was first recorded, as a UTC instant.",
		),
		completed_at: t(
			"personalDataExport.readme.fields.drivingLicence.completedAt",
			"When a verifier marked the personal reminder completed; empty for an uncompleted task.",
		),
		completed_by: t(
			"personalDataExport.readme.fields.drivingLicence.completedBy",
			"The name of the person who marked the reminder completed; this does not establish direct delivery or a read receipt.",
		),
		recipient_name: t(
			"personalDataExport.readme.fields.drivingLicence.recipientName",
			"The name of the person to whom this reminder about your check was addressed.",
		),
		notification_id: t(
			"personalDataExport.readme.fields.drivingLicence.notificationId",
			"The app notification linked to this reminder; empty when none was created.",
		),
		email_state: t(
			"personalDataExport.readme.fields.drivingLicence.emailState",
			"Whether email delivery was pending, sent, suppressed, obsolete or unavailable; this is not a read receipt.",
		),
		emailed_at: t(
			"personalDataExport.readme.fields.drivingLicence.emailedAt",
			"When this reminder's email was sent; empty when no email was sent.",
		),
		reported_at: t(
			"personalDataExport.readme.fields.drivingLicence.reportedAt",
			"When you reported a person-wide driving impediment, as a UTC instant.",
		),
		reporter_name: t(
			"personalDataExport.readme.fields.drivingLicence.reporterName",
			"The name of the person who reported the impediment.",
		),
		resolved_at: t(
			"personalDataExport.readme.fields.drivingLicence.resolvedAt",
			"When a verifier explicitly resolved this report; empty for an unresolved report.",
		),
		resolved_by: t(
			"personalDataExport.readme.fields.drivingLicence.resolvedBy",
			"The name of the verifier who explicitly resolved this report.",
		),
		id: t(
			"personalDataExport.readme.fields.drivingLicence.id",
			"The record's ID in the app, so the other files can refer to it.",
		),
		employment_period_id: t(
			"personalDataExport.readme.fields.drivingLicence.employment_period_id",
			"The employment period this evidence belongs to; empty for legacy employment.",
		),
		controlled_at: t(
			"personalDataExport.readme.fields.drivingLicence.controlled_at",
			"When the original licence was personally inspected, as a UTC instant.",
		),
		verifier_name: t(
			"personalDataExport.readme.fields.drivingLicence.verifier_name",
			"The recorded name of the person who inspected your original licence.",
		),
		document_issued_on: t(
			"personalDataExport.readme.fields.drivingLicence.document_issued_on",
			"The document's issue date, without a time or time zone.",
		),
		document_expires_on: t(
			"personalDataExport.readme.fields.drivingLicence.document_expires_on",
			"The document's expiry date, separate from expiry of individual classes.",
		),
		original_inspected: t(
			"personalDataExport.readme.fields.drivingLicence.original_inspected",
			"Whether the verifier confirmed personally inspecting the original document.",
		),
		identity_confirmed: t(
			"personalDataExport.readme.fields.drivingLicence.identity_confirmed",
			"Whether the verifier confirmed that the original matched your identity.",
		),
		employee_declaration: t(
			"personalDataExport.readme.fields.drivingLicence.employee_declaration",
			"Whether your declaration was confirmed during the inspection.",
		),
		declaration_text: t(
			"personalDataExport.readme.fields.drivingLicence.declaration_text",
			"The exact declaration text recorded during the original inspection.",
		),
		verifier_confirmed: t(
			"personalDataExport.readme.fields.drivingLicence.verifier_confirmed",
			"Whether the verifier confirmed the inspection record.",
		),
		failure_scope: t(
			"personalDataExport.readme.fields.drivingLicence.failure_scope",
			"Whether an unsuccessful inspection concerned classes, the document or the person.",
		),
		policy_version: t(
			"personalDataExport.readme.fields.drivingLicence.policy_version",
			"The version of the organization's driving licence check policy.",
		),
		interval_months: t(
			"personalDataExport.readme.fields.drivingLicence.interval_months",
			"The number of calendar months between routine checks under this policy.",
		),
		deadline_timezone: t(
			"personalDataExport.readme.fields.drivingLicence.deadline_timezone",
			"The explicit calendar time zone used for the policy's deadline dates.",
		),
		check_id: t(
			"personalDataExport.readme.fields.drivingLicence.check_id",
			"The original check this class, supplement or authorization references.",
		),
		class_code: t(
			"personalDataExport.readme.fields.drivingLicence.class_code",
			"The explicitly inspected licence class; empty for a person-wide or document-wide event.",
		),
		result: t(
			"personalDataExport.readme.fields.drivingLicence.result",
			"The outcome for this inspected class: successful, unsuccessful or inconclusive.",
		),
		expiry_date: t(
			"personalDataExport.readme.fields.drivingLicence.expiry_date",
			"The class expiry date recorded at inspection; empty if none was recorded.",
		),
		restrictions: t(
			"personalDataExport.readme.fields.drivingLicence.restrictions",
			"The relevant driving restrictions recorded for this class.",
		),
		recorded_at: t(
			"personalDataExport.readme.fields.drivingLicence.recorded_at",
			"When the supplement or event was recorded, as a UTC instant.",
		),
		author_name: t(
			"personalDataExport.readme.fields.drivingLicence.author_name",
			"The recorded name of the person who added this supplement.",
		),
		reason: t(
			"personalDataExport.readme.fields.drivingLicence.reason",
			"The structured reason for the supplement or authorization event; report references link to an event ID.",
		),
		field: t(
			"personalDataExport.readme.fields.drivingLicence.field",
			"The corrected evidence field; the original check is preserved.",
		),
		value: t(
			"personalDataExport.readme.fields.drivingLicence.value",
			"The value supplied by this supplement; empty means the optional class expiry was cleared.",
		),
		kind: t(
			"personalDataExport.readme.fields.drivingLicence.kind",
			"The authorization event, suspension or task kind; tasks are personal_reminder or reassignment.",
		),
		effective_at: t(
			"personalDataExport.readme.fields.drivingLicence.effective_at",
			"When the authorization event took effect, as a UTC instant.",
		),
		actor_name: t(
			"personalDataExport.readme.fields.drivingLicence.actor_name",
			"The name of the person who performed this action; empty for a system action or unavailable actor.",
		),
		last_successful_at: t(
			"personalDataExport.readme.fields.drivingLicence.last_successful_at",
			"When this class last passed a successful original inspection.",
		),
		routine_valid_through: t(
			"personalDataExport.readme.fields.drivingLicence.routine_valid_through",
			"The last calendar day covered by the routine check interval.",
		),
		document_valid_through: t(
			"personalDataExport.readme.fields.drivingLicence.document_valid_through",
			"The last calendar day covered by the document's validity.",
		),
		class_valid_through: t(
			"personalDataExport.readme.fields.drivingLicence.class_valid_through",
			"The last calendar day covered by this class's validity; empty when no class expiry was recorded.",
		),
		valid_through: t(
			"personalDataExport.readme.fields.drivingLicence.valid_through",
			"The earliest applicable final calendar day of this class clearance.",
		),
		expires_at: t(
			"personalDataExport.readme.fields.drivingLicence.expires_at",
			"The UTC instant when this authorization or verifier grant expires.",
		),
		state: t(
			"personalDataExport.readme.fields.drivingLicence.state",
			"The stored class authorization state (active, suspended, ended) or reminder task state (pending, completed, obsolete); history explains the changes.",
		),
		suspended_at: t(
			"personalDataExport.readme.fields.drivingLicence.suspended_at",
			"When the authorization was suspended, as a UTC instant.",
		),
		enrolled_at: t(
			"personalDataExport.readme.fields.drivingLicence.enrolled_at",
			"When you were enrolled in the organization's driving licence checks.",
		),
		scope: t(
			"personalDataExport.readme.fields.drivingLicence.scope",
			"The scope of a person-wide report (person), or whether your verifier responsibility covers all employees or specific employees and teams.",
		),
		team_ids: t(
			"personalDataExport.readme.fields.drivingLicence.team_ids",
			"The opaque team IDs in your specific verifier scope, encoded as a JSON array.",
		),
		employee_ids: t(
			"personalDataExport.readme.fields.drivingLicence.employee_ids",
			"The opaque employee IDs in your specific verifier scope, encoded as a JSON array.",
		),
		granted_at: t(
			"personalDataExport.readme.fields.drivingLicence.granted_at",
			"When your verifier responsibility was granted, as a UTC instant.",
		),
		granted_by: t(
			"personalDataExport.readme.fields.drivingLicence.granted_by",
			"The name of the person who granted your verifier responsibility.",
		),
		revoked_at: t(
			"personalDataExport.readme.fields.drivingLicence.revoked_at",
			"When your verifier responsibility was revoked; empty while it has not been revoked.",
		),
		revoked_by: t(
			"personalDataExport.readme.fields.drivingLicence.revoked_by",
			"The name of the person who revoked your verifier responsibility.",
		),
		employee_id: t(
			"personalDataExport.readme.fields.drivingLicence.employee_id",
			"The opaque ID of another employee whose record you acted on; their check contents are excluded.",
		),
		enabled: t(
			"personalDataExport.readme.fields.drivingLicence.enabled",
			"Whether the referenced organization check policy was enabled.",
		),
		reminder_lead_days: t(
			"personalDataExport.readme.fields.drivingLicence.reminder_lead_days",
			"The configured reminder lead times in calendar days, encoded as a JSON array.",
		),
		retention_months: t(
			"personalDataExport.readme.fields.drivingLicence.retention_months",
			"The organization's justified retention period in months after evidence no longer supports active authorization.",
		),
		retention_justification: t(
			"personalDataExport.readme.fields.drivingLicence.retention_justification",
			"The organization's documented reason for its evidence retention period.",
		),
		changed_at: t(
			"personalDataExport.readme.fields.drivingLicence.changed_at",
			"When this organization policy version was recorded, as a UTC instant.",
		),
	};
	return {
		reminder_tasks: {
			summary: t(
				"personalDataExport.readme.fields.drivingLicence.reminderTasks.summary",
				"Personal-reminder and reassignment tasks concerning your checks, including their recorded completion; completion does not establish direct delivery or reading.",
			),
			fields,
		},
		reminder_tasks_completed: {
			summary: t(
				"personalDataExport.readme.fields.drivingLicence.reminderTasksCompleted.summary",
				"Reminder tasks you completed for other employees, limited to opaque IDs, task kind and completion time.",
			),
			fields,
		},
		reminder_deliveries: {
			summary: t(
				"personalDataExport.readme.fields.drivingLicence.reminderDeliveries.summary",
				"The reminder delivery records concerning your checks, without email addresses, transport retries or read receipts.",
			),
			fields,
		},
		impediment_reports: {
			summary: t(
				"personalDataExport.readme.fields.drivingLicence.impedimentReports.summary",
				"Your minimal driving impediment reports and their explicit resolution, without medical explanations or private reasons.",
			),
			fields,
		},
		checks: {
			summary: t(
				"personalDataExport.readme.fields.drivingLicence.checks.summary",
				"Driving licence original check records, with the exact declaration and inspection confirmations.",
			),
			fields,
		},
		checked_classes: {
			summary: t(
				"personalDataExport.readme.fields.drivingLicence.checked_classes.summary",
				"The explicitly inspected classes and their recorded outcomes, restrictions and expiry dates.",
			),
			fields,
		},
		supplements: {
			summary: t(
				"personalDataExport.readme.fields.drivingLicence.supplements.summary",
				"Dated, attributed, typed corrections kept alongside each original check.",
			),
			fields,
		},
		authorization_events: {
			summary: t(
				"personalDataExport.readme.fields.drivingLicence.authorization_events.summary",
				"Your driving authorization history, including impediment reports, resolutions and explicit reinstatements.",
			),
			fields,
		},
		authorizations: {
			summary: t(
				"personalDataExport.readme.fields.drivingLicence.authorizations.summary",
				"Your stored class-specific authorization records; the event history explains changes and effective times.",
			),
			fields,
		},
		participation: {
			summary: t(
				"personalDataExport.readme.fields.drivingLicence.participation.summary",
				"Your enrolment in the organization's driving licence checks.",
			),
			fields,
		},
		suspension: {
			summary: t(
				"personalDataExport.readme.fields.drivingLicence.suspension.summary",
				"Your current person-wide or document-wide driving authorization suspension record.",
			),
			fields,
		},
		verifier_grants: {
			summary: t(
				"personalDataExport.readme.fields.drivingLicence.verifier_grants.summary",
				"Your own verifier grants, including historical and revoked responsibility.",
			),
			fields,
		},
		checks_performed: {
			summary: t(
				"personalDataExport.readme.fields.drivingLicence.checks_performed.summary",
				"Checks you performed on other employees: only opaque subject and record IDs and the inspection time.",
			),
			fields,
		},
		supplements_authored: {
			summary: t(
				"personalDataExport.readme.fields.drivingLicence.supplements_authored.summary",
				"Supplements you authored on other employees' records, without those employees' evidence values.",
			),
			fields,
		},
		policies: {
			summary: t(
				"personalDataExport.readme.fields.drivingLicence.policies.summary",
				"Policy versions referenced by your checks and authorization history, including their retention context. Evidence follows this retention policy; this export does not extend retention in the application.",
			),
			fields,
		},
	};
};
