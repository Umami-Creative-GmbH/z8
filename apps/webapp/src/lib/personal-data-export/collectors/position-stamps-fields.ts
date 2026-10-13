/**
 * The README's explanation of every part and field of the Position stamps
 * category (#811, #1172). See "Field guide" in `../collector.ts`.
 */

import type { PersonalDataFieldGuide } from "../collector";

export const positionStampsFieldGuide: PersonalDataFieldGuide = (t) => {
	const noticeVersion = () =>
		t(
			"personalDataExport.readme.fields.positionStamps.shared.noticeVersion",
			"The version of the position notice you answered.",
		);
	const purposeStatement = () =>
		t(
			"personalDataExport.readme.fields.positionStamps.shared.purposeStatement",
			"Why the organization records positions, as the notice stated it.",
		);
	const retentionDays = () =>
		t(
			"personalDataExport.readme.fields.positionStamps.shared.retentionDays",
			"How many days positions are kept, as the notice stated it.",
		);

	return {
		stamps: {
			summary: t(
				"personalDataExport.readme.fields.positionStamps.stamps.summary",
				"The positions recorded when you clocked in or out. Each is deleted automatically at purge_at.",
			),
			fields: {
				time_entry_id: t(
					"personalDataExport.readme.fields.positionStamps.stamps.timeEntryId",
					"The ID of the clock-in or clock-out in time.json > time_entries.",
				),
				clock_event: t(
					"personalDataExport.readme.fields.positionStamps.stamps.clockEvent",
					"Whether the position was recorded at a clock_in or a clock_out.",
				),
				latitude: t(
					"personalDataExport.readme.fields.positionStamps.stamps.latitude",
					"The latitude, in decimal degrees.",
				),
				longitude: t(
					"personalDataExport.readme.fields.positionStamps.stamps.longitude",
					"The longitude, in decimal degrees.",
				),
				accuracy_meters: t(
					"personalDataExport.readme.fields.positionStamps.stamps.accuracyMeters",
					"How accurate the position is, in metres, as your device reported it.",
				),
				fixed_at: t(
					"personalDataExport.readme.fields.positionStamps.stamps.fixedAt",
					"When your device determined the position (UTC); it can be a little earlier than the clock event.",
				),
				captured_at: t(
					"personalDataExport.readme.fields.positionStamps.stamps.capturedAt",
					"When the position was recorded with the clock event (UTC).",
				),
				utc_offset_minutes: t(
					"personalDataExport.readme.fields.positionStamps.stamps.utcOffsetMinutes",
					"The UTC offset of the clock event, in minutes (120 means UTC+2).",
				),
				purge_at: t(
					"personalDataExport.readme.fields.positionStamps.stamps.purgeAt",
					"When the position will be deleted (UTC).",
				),
				consent_id: t(
					"personalDataExport.readme.fields.positionStamps.stamps.consentId",
					"The ID of the consent in consents the position was recorded under.",
				),
				created_at: t(
					"personalDataExport.readme.fields.positionStamps.stamps.createdAt",
					"When the position was saved (UTC).",
				),
			},
		},
		consents: {
			summary: t(
				"personalDataExport.readme.fields.positionStamps.consents.summary",
				"Every consent you gave to recording your position, and when you withdrew it.",
			),
			fields: {
				consent_id: t(
					"personalDataExport.readme.fields.positionStamps.consents.consentId",
					"The consent's ID in the app.",
				),
				notice_version: noticeVersion(),
				purpose_statement: purposeStatement(),
				retention_days: retentionDays(),
				granted_at: t(
					"personalDataExport.readme.fields.positionStamps.consents.grantedAt",
					"When you gave your consent (UTC).",
				),
				withdrawn_at: t(
					"personalDataExport.readme.fields.positionStamps.consents.withdrawnAt",
					"When you withdrew your consent (UTC); empty while it stands.",
				),
			},
		},
		notice_declines: {
			summary: t(
				"personalDataExport.readme.fields.positionStamps.noticeDeclines.summary",
				'The times you answered the position notice with "not now".',
			),
			fields: {
				notice_version: noticeVersion(),
				purpose_statement: purposeStatement(),
				retention_days: retentionDays(),
				declined_at: t(
					"personalDataExport.readme.fields.positionStamps.noticeDeclines.declinedAt",
					"When you answered (UTC).",
				),
			},
		},
		access_log: {
			summary: t(
				"personalDataExport.readme.fields.positionStamps.accessLog.summary",
				"Who other than you was shown your positions, and when: one row per work period shown, or one row per export.",
			),
			fields: {
				accessed_at: t(
					"personalDataExport.readme.fields.positionStamps.accessLog.accessedAt",
					"When your positions were shown (UTC).",
				),
				kind: t(
					"personalDataExport.readme.fields.positionStamps.accessLog.kind",
					"How they were shown: on a work period's details (work_period_detail) or in an export (data_export).",
				),
				viewer: t(
					"personalDataExport.readme.fields.positionStamps.accessLog.viewer",
					"Who was shown your positions.",
				),
				work_period_id: t(
					"personalDataExport.readme.fields.positionStamps.accessLog.workPeriodId",
					"The ID of the work period shown, in time.json > work_periods.",
				),
				work_period_started_at: t(
					"personalDataExport.readme.fields.positionStamps.accessLog.workPeriodStartedAt",
					"When that work period started (UTC).",
				),
				work_period_utc_offset_minutes: t(
					"personalDataExport.readme.fields.positionStamps.accessLog.workPeriodUtcOffsetMinutes",
					"The UTC offset of that work period's clock-in, in minutes.",
				),
				export_id: t(
					"personalDataExport.readme.fields.positionStamps.accessLog.exportId",
					"For an export: the export's ID.",
				),
			},
		},
	};
};
