/**
 * The README's explanation of every part and field of the Audit log category
 * (#811, #1171). See "Field guide" in `../collector.ts`.
 */

import type { PersonalDataFieldGuide } from "../collector";

export const auditLogFieldGuide: PersonalDataFieldGuide = (t) => ({
	entries: {
		summary: t(
			"personalDataExport.readme.fields.auditLog.entries.summary",
			"Audit log entries about you: what was done to your records, by whom and when.",
		),
		fields: {
			timestamp: t(
				"personalDataExport.readme.fields.auditLog.entries.timestamp",
				"When it happened (UTC).",
			),
			action: t(
				"personalDataExport.readme.fields.auditLog.entries.action",
				"What was done, as the app records it, e.g. absence.requested.",
			),
			entity_type: t(
				"personalDataExport.readme.fields.auditLog.entries.entityType",
				"The kind of record it was done to, e.g. absence_entry or employee.",
			),
			entity_id: t(
				"personalDataExport.readme.fields.auditLog.entries.entityId",
				"The ID of that record in the app.",
			),
			performed_by: t(
				"personalDataExport.readme.fields.auditLog.entries.performedBy",
				"The name of the person who did it.",
			),
			performed_by_you: t(
				"personalDataExport.readme.fields.auditLog.entries.performedByYou",
				"Whether you did it yourself.",
			),
			ip_address: t(
				"personalDataExport.readme.fields.auditLog.entries.ipAddress",
				"Your IP address when you did it; empty when someone else did it.",
			),
			user_agent: t(
				"personalDataExport.readme.fields.auditLog.entries.userAgent",
				"Your browser or app when you did it; empty when someone else did it.",
			),
			changes: t(
				"personalDataExport.readme.fields.auditLog.entries.changes",
				"What changed, as JSON (usually the values before and after).",
			),
			metadata: t(
				"personalDataExport.readme.fields.auditLog.entries.metadata",
				"More context the app recorded, as JSON.",
			),
		},
	},
	actions_on_others: {
		summary: t(
			"personalDataExport.readme.fields.auditLog.actionsOnOthers.summary",
			"What you did that is not about your own records: actions on colleagues' records or on the organization. Colleagues appear only by an anonymous ID.",
		),
		fields: {
			record_kind: t(
				"personalDataExport.readme.fields.auditLog.actionsOnOthers.recordKind",
				"The kind of record you acted on, e.g. absence_entry or time_entry.",
			),
			authority: t(
				"personalDataExport.readme.fields.auditLog.actionsOnOthers.authority",
				"Where the action is recorded: audit_log for the audit log, record for the record itself.",
			),
			action: t(
				"personalDataExport.readme.fields.auditLog.actionsOnOthers.action",
				"What you did.",
			),
			acted_at: t(
				"personalDataExport.readme.fields.auditLog.actionsOnOthers.actedAt",
				"When you did it (UTC).",
			),
			as_deputy: t(
				"personalDataExport.readme.fields.auditLog.actionsOnOthers.asDeputy",
				"Whether you acted as someone's deputy.",
			),
			other_person: t(
				"personalDataExport.readme.fields.auditLog.actionsOnOthers.otherPerson",
				"An anonymous ID for the colleague, the same for one colleague throughout this export; empty when the action concerned no person.",
			),
		},
	},
});
