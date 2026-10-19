import type { TimeCorrectionSubmittedFacts } from "../evidence/time-correction-facts";
import type { TimeCorrectionTriageSnapshot } from "./time-correction-evidence";
export const facts: TimeCorrectionSubmittedFacts = {
	schemaVersion: 1,
	kind: "time_correction",
	organizationId: "org",
	workPeriodId: "period",
	canonicalRecordId: "record",
	subjectEmployeeId: "employee",
	requesterEmployeeId: "employee",
	intent: "edit",
	baseline: {
		clockIn: {
			entryId: "in",
			at: "2026-10-15T07:00:00Z",
			utcOffsetMinutes: 120,
			timezone: "Europe/Berlin",
			timezoneSource: "browser",
		},
		clockOut: {
			entryId: "out",
			at: "2026-10-15T15:00:00Z",
			utcOffsetMinutes: 120,
			timezone: "Europe/Berlin",
			timezoneSource: "browser",
		},
		storedDurationMinutes: 480,
		elapsedSeconds: 28800,
		attribution: {
			projectId: null,
			workCategoryId: null,
			workLocationType: "office",
		},
	},
	requested: {
		clockIn: {
			originalEntryId: "in",
			correctionEntryId: "new-in",
			at: "2026-10-15T07:15:00Z",
			utcOffsetMinutes: 120,
			timezone: "Europe/Berlin",
			timezoneSource: "browser",
		},
		clockOut: null,
		workLocationType: { kind: "set", value: "office" },
		workCategoryId: { kind: "set", value: null },
	},
	changeMask: {
		clockIn: true,
		clockOut: false,
		workCategory: false,
		workLocation: false,
	},
};
export const snapshot: TimeCorrectionTriageSnapshot = {
	organizationId: "org",
	requestId: "request",
	workPeriodId: "period",
	authority: "compatibility_request",
	currentAuthority: "legacy",
	status: "pending",
	comparison: { kind: "current" },
	revision: { id: "revision", materialFingerprint: "fingerprint", facts },
};
