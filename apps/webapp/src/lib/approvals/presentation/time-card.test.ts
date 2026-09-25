import { describe, expect, it } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import type {
	TimeCorrectionSubmittedRevisionRecord,
	WorkPeriodSubmittedRevisionRecord,
} from "../evidence/store";
import type { TimeCorrectionSubmittedFacts } from "../evidence/time-correction-facts";
import { buildTimeCorrectionCardFacts, buildWorkPeriodCardFacts } from "./time-card";

const t = (_key: string, fallback: string, params?: Record<string, string | number>) =>
	fallback.replace(/\{(\w+)\}/g, (_match, name: string) => String(params?.[name] ?? ""));

const berlin24 = { locale: "en", timezone: "Europe/Berlin", timeFormat: "24h" as const };

function workRevision(
	overrides: Partial<WorkPeriodSubmittedRevisionRecord> = {},
): WorkPeriodSubmittedRevisionRecord {
	return {
		id: "r1",
		organizationId: "org",
		lifecycle: { authority: "canonical", workflowId: "w1" },
		workflowType: "manual_time_submission",
		workPeriodId: "p1",
		requestCycleKey: "k",
		revision: 1,
		subjectEmployeeId: "e-subject",
		requesterEmployeeId: "e-subject",
		submitter: { kind: "employee", employeeId: "e-subject", userId: "u" },
		materialFingerprint: "work_period:v1:x",
		facts: {
			schemaVersion: 1,
			kind: "manual_time_submission",
			organizationId: "org",
			workPeriodId: "p1",
			canonicalRecordId: "t1",
			subjectEmployeeId: "e-subject",
			requesterEmployeeId: "e-subject",
			interval: {
				// Clock-in captured in Berlin summer time, clock-out after travel to UTC+1.
				clockIn: {
					entryId: "in",
					at: "2026-10-05T06:00:00Z",
					utcOffsetMinutes: 120,
					timezone: "Europe/Berlin",
					timezoneSource: "browser",
				},
				clockOut: {
					entryId: "out",
					at: "2026-10-05T14:30:40Z",
					utcOffsetMinutes: 60,
					timezone: "Europe/London",
					timezoneSource: "browser",
				},
				storedDurationMinutes: 511,
				elapsedSeconds: 30640,
			},
			policy: { kind: "manual_time_submission", surchargeSnapshot: null },
			attribution: { projectId: null, workCategoryId: null, workLocationType: null },
		},
		labels: {
			subjectName: "Avery Requester",
			requesterName: "Avery Requester",
			submitterName: "Avery Requester",
		},
		provenance: "captured_at_submission",
		submittedAt: parseInstant("2026-10-05T15:00:00Z"),
		...overrides,
	};
}

function byLabel(facts: { label: string; value: string }[] | null) {
	expect(facts).not.toBeNull();
	return Object.fromEntries(facts?.map((fact) => [fact.label, fact.value]) ?? []);
}

describe("buildWorkPeriodCardFacts", () => {
	it("shows a manual submission's endpoints with each captured offset and both durations, without a before state", () => {
		const facts = byLabel(
			buildWorkPeriodCardFacts(
				workRevision(),
				{ locale: "en", timezone: "Pacific/Kiritimati", timeFormat: "24h" },
				t,
			),
		);
		expect(facts).toEqual({
			Employee: "Avery Requester",
			"Clock in": "Oct 5, 2026, 08:00 (UTC+02:00)",
			"Clock out": "Oct 5, 2026, 15:30 (UTC+01:00)",
			"Submitted duration": "8 h 31 min",
			"Elapsed time": "8 h 30 min 40 s",
			Submitted: "Oct 6, 2026, 05:00 (Pacific/Kiritimati)",
		});
	});

	it("discloses that a break adjustment may apply to a policy clock-out, without predicting it", () => {
		const base = workRevision();
		const policy = (breakAdjustment: "may_apply" | "not_applicable") =>
			workRevision({
				workflowType: "policy_clock_out",
				facts: {
					...base.facts,
					kind: "policy_clock_out",
					policy: {
						kind: "policy_clock_out",
						breakAdjustment,
						breakPolicySnapshot: {} as never,
						surchargeSnapshot: null,
					},
				},
			});
		const mayApply = byLabel(buildWorkPeriodCardFacts(policy("may_apply"), berlin24, t));
		expect(mayApply["Break adjustment"]).toBe(
			"May apply when approved; the result is recorded separately",
		);
		expect(mayApply["Submitted duration"]).toBe("8 h 31 min");
		const none = byLabel(buildWorkPeriodCardFacts(policy("not_applicable"), berlin24, t));
		expect(none).not.toHaveProperty("Break adjustment");
	});

	it("names a separately evidenced submitter, and is review-only without the employee label", () => {
		const onBehalf = workRevision({
			submitter: { kind: "employee", employeeId: "e-manager", userId: "u-manager" },
			labels: {
				subjectName: "Avery Requester",
				requesterName: "Avery Requester",
				submitterName: "Morgan Manager",
			},
		});
		const facts = byLabel(buildWorkPeriodCardFacts(onBehalf, berlin24, t));
		expect(facts["Submitted by"]).toBe("Morgan Manager");
		expect(facts).not.toHaveProperty("Requested by");
		expect(
			buildWorkPeriodCardFacts(
				workRevision({
					labels: { subjectName: null, requesterName: null, submitterName: null },
				}),
				berlin24,
				t,
			),
		).toBeNull();
	});
});

const baselineIn = {
	entryId: "in",
	at: "2026-10-05T06:00:00Z",
	utcOffsetMinutes: 120,
	timezone: "Europe/Berlin",
	timezoneSource: "browser",
};
const baselineOut = {
	entryId: "out",
	at: "2026-10-05T14:00:00Z",
	utcOffsetMinutes: 120,
	timezone: "Europe/Berlin",
	timezoneSource: "browser",
};

function correctionRevision(
	facts: Partial<TimeCorrectionSubmittedFacts> = {},
	overrides: Partial<TimeCorrectionSubmittedRevisionRecord> = {},
): TimeCorrectionSubmittedRevisionRecord {
	return {
		id: "r2",
		organizationId: "org",
		lifecycle: { authority: "canonical", workflowId: "w2" },
		workPeriodId: "p1",
		requestCycleKey: "k2",
		revision: 1,
		subjectEmployeeId: "e-subject",
		requesterEmployeeId: "e-subject",
		submitter: { kind: "employee", employeeId: "e-subject", userId: "u" },
		materialFingerprint: "time_correction:v1:x",
		facts: {
			schemaVersion: 1,
			kind: "time_correction",
			organizationId: "org",
			workPeriodId: "p1",
			canonicalRecordId: "t1",
			subjectEmployeeId: "e-subject",
			requesterEmployeeId: "e-subject",
			intent: "edit",
			baseline: {
				clockIn: baselineIn,
				clockOut: baselineOut,
				storedDurationMinutes: 480,
				elapsedSeconds: 28800,
				attribution: { projectId: null, workCategoryId: null, workLocationType: "office" },
			},
			requested: {
				clockIn: {
					originalEntryId: "in",
					correctionEntryId: "c-in",
					// Requested after a DST change: its own capture differs from the baseline's.
					at: "2026-10-05T05:30:00Z",
					utcOffsetMinutes: 60,
					timezone: "Europe/London",
					timezoneSource: "browser",
				},
				clockOut: null,
				workLocationType: { kind: "unchanged" },
				workCategoryId: { kind: "unchanged" },
			},
			changeMask: { clockIn: true, clockOut: false, workLocation: false, workCategory: false },
			...facts,
		},
		labels: {
			subjectName: "Avery Requester",
			requesterName: "Avery Requester",
			submitterName: "Avery Requester",
		},
		provenance: "captured_at_submission",
		submittedAt: parseInstant("2026-10-06T07:00:00Z"),
		...overrides,
	};
}

describe("buildTimeCorrectionCardFacts", () => {
	it("shows a changed endpoint before and requested, each with its own captured offset", () => {
		const facts = byLabel(buildTimeCorrectionCardFacts(correctionRevision(), {}, berlin24, t));
		expect(facts).toEqual({
			Employee: "Avery Requester",
			Request: "Change times",
			Entry: "Oct 5, 2026, 08:00 (UTC+02:00) – Oct 5, 2026, 16:00 (UTC+02:00)",
			"Duration before": "8 h 0 min",
			"Clock in": "Oct 5, 2026, 08:00 (UTC+02:00) → Oct 5, 2026, 06:30 (UTC+01:00)",
			Submitted: "Oct 6, 2026, 09:00 (Europe/Berlin)",
		});
	});

	it("states a deletion request explicitly and never shows deletion markers as working times", () => {
		const deletion = correctionRevision({
			intent: "delete",
			requested: {
				clockIn: {
					originalEntryId: "in",
					correctionEntryId: "c-in",
					at: "2026-10-05T06:00:00Z",
					utcOffsetMinutes: 120,
					timezone: "Europe/Berlin",
					timezoneSource: "browser",
				},
				clockOut: {
					originalEntryId: "out",
					correctionEntryId: "c-out",
					at: "2026-10-05T06:00:00Z",
					utcOffsetMinutes: 120,
					timezone: "Europe/Berlin",
					timezoneSource: "browser",
				},
				workLocationType: { kind: "unchanged" },
				workCategoryId: { kind: "unchanged" },
			},
			changeMask: { clockIn: true, clockOut: true, workLocation: false, workCategory: false },
		});
		const facts = byLabel(buildTimeCorrectionCardFacts(deletion, {}, berlin24, t));
		expect(facts.Request).toBe("Delete this entry");
		expect(facts.Entry).toBe("Oct 5, 2026, 08:00 (UTC+02:00) – Oct 5, 2026, 16:00 (UTC+02:00)");
		expect(facts).not.toHaveProperty("Clock in");
		expect(facts).not.toHaveProperty("Clock out");
	});

	it("shows metadata-only changes before and requested, distinguishing no category from an unavailable one", () => {
		const metadataOnly = correctionRevision({
			intent: "metadata_only",
			requested: {
				clockIn: null,
				clockOut: null,
				workLocationType: { kind: "set", value: "home" },
				workCategoryId: { kind: "set", value: "cat-travel" },
			},
			changeMask: { clockIn: false, clockOut: false, workLocation: true, workCategory: true },
		});
		const facts = byLabel(
			buildTimeCorrectionCardFacts(metadataOnly, { "cat-travel": "Travel" }, berlin24, t),
		);
		expect(facts).toMatchObject({
			Request: "Change work details",
			"Work location": "Office → Home",
			"Category (current names)": "No category → Travel",
		});
		expect(facts).not.toHaveProperty("Clock in");
		// A category whose name cannot be shown makes the change unintelligible.
		expect(
			buildTimeCorrectionCardFacts(metadataOnly, { "cat-travel": null }, berlin24, t),
		).toBeNull();
	});
});
