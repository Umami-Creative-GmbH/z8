import { describe, expect, it } from "vitest";
import { ApprovalEvidenceError } from "./errors";
import {
	buildTimeCorrectionSubmittedFacts,
	compareLiveTimeCorrectionWithRevision,
	fingerprintTimeCorrectionFacts,
	type TimeCorrectionFactsInput,
} from "./time-correction-facts";

const organizationId = "org-1";
const employeeId = "10000000-0000-4000-8000-000000000001";

function entry(
	id: string,
	type: string,
	timestamp: string,
	overrides: Partial<TimeCorrectionFactsInput["clockIn"] & object> = {},
) {
	return {
		id,
		organizationId,
		employeeId,
		type,
		timestamp: new Date(timestamp),
		utcOffsetMinutes: 120,
		timezone: "Europe/Berlin",
		timezoneSource: "browser",
		replacesEntryId: null,
		...overrides,
	};
}

function input(overrides: Partial<TimeCorrectionFactsInput> = {}): TimeCorrectionFactsInput {
	return {
		requesterEmployeeId: employeeId,
		period: {
			id: "period-1",
			organizationId,
			employeeId,
			clockInId: "in-1",
			clockOutId: "out-1",
			canonicalRecordId: "record-1",
			startTime: new Date("2026-07-22T06:00:00Z"),
			endTime: new Date("2026-07-22T08:00:40Z"),
			durationMinutes: 121,
			deletedAt: null,
			projectId: "project-1",
			workCategoryId: null,
			workLocationType: "office",
		},
		clockIn: entry("in-1", "clock_in", "2026-07-22T06:00:00Z"),
		clockOut: entry("out-1", "clock_out", "2026-07-22T08:00:40Z", { utcOffsetMinutes: 60 }),
		correction: { action: "edit", workLocationType: "office", workCategoryId: null },
		corrections: {
			clockIn: entry("correction-in", "correction", "2026-07-22T07:00:00Z", {
				replacesEntryId: "in-1",
			}),
			clockOut: null,
		},
		...overrides,
	};
}

describe("time correction submitted facts", () => {
	it("captures the locked baseline, requested values, mask and intent", () => {
		const facts = buildTimeCorrectionSubmittedFacts(input());

		expect(facts).toMatchObject({
			kind: "time_correction",
			intent: "edit",
			canonicalRecordId: "record-1",
			baseline: {
				clockIn: { entryId: "in-1", at: "2026-07-22T06:00:00Z", utcOffsetMinutes: 120 },
				clockOut: { entryId: "out-1", at: "2026-07-22T08:00:40Z", utcOffsetMinutes: 60 },
				storedDurationMinutes: 121,
				elapsedSeconds: 7240,
				attribution: { projectId: "project-1", workLocationType: "office" },
			},
			requested: {
				clockIn: {
					originalEntryId: "in-1",
					correctionEntryId: "correction-in",
					at: "2026-07-22T07:00:00Z",
				},
				clockOut: null,
				workLocationType: { kind: "set", value: "office" },
				workCategoryId: { kind: "set", value: null },
			},
			changeMask: { clockIn: true, clockOut: false, workLocation: false, workCategory: false },
		});
		expect(fingerprintTimeCorrectionFacts(facts)).toMatch(/^time_correction:v1:[0-9a-f]{64}$/);
	});

	it("keeps an explicit category clear apart from a legacy proposal without metadata", () => {
		const cleared = buildTimeCorrectionSubmittedFacts(
			input({
				period: { ...input().period, workCategoryId: "category-1" },
				correction: { action: "edit", workLocationType: "office", workCategoryId: null },
				corrections: { clockIn: null, clockOut: null },
			}),
		);
		const legacy = buildTimeCorrectionSubmittedFacts(input({ correction: { action: "edit" } }));

		expect(cleared).toMatchObject({
			intent: "metadata_only",
			requested: { workCategoryId: { kind: "set", value: null } },
			changeMask: { workCategory: true, clockIn: false },
		});
		expect(legacy.requested).toMatchObject({
			workLocationType: { kind: "unchanged" },
			workCategoryId: { kind: "unchanged" },
		});
		expect(legacy.changeMask).toMatchObject({ workLocation: false, workCategory: false });
	});

	it("records a deletion as both endpoints proposed", () => {
		const facts = buildTimeCorrectionSubmittedFacts(
			input({
				correction: { action: "delete", workLocationType: "office", workCategoryId: null },
				corrections: {
					clockIn: entry("deleted-in", "correction", "2026-07-22T06:00:00Z", {
						replacesEntryId: "in-1",
					}),
					clockOut: entry("deleted-out", "correction", "2026-07-22T06:00:00Z", {
						replacesEntryId: "out-1",
					}),
				},
			}),
		);

		expect(facts).toMatchObject({
			intent: "delete",
			changeMask: { clockIn: true, clockOut: true },
		});
	});

	it.each([
		["a foreign endpoint", { clockIn: entry("other", "clock_in", "2026-07-22T06:00:00Z") }],
		["a moved endpoint", { clockIn: entry("in-1", "clock_in", "2026-07-22T06:01:00Z") }],
		["another owner", { requesterEmployeeId: "20000000-0000-4000-8000-000000000001" }],
		[
			"a correction replacing another entry",
			{
				corrections: {
					clockIn: entry("correction-in", "correction", "2026-07-22T07:00:00Z", {
						replacesEntryId: "out-1",
					}),
					clockOut: null,
				},
			},
		],
	] as const)("refuses %s as incomplete evidence", (_label, override) => {
		expect(() => buildTimeCorrectionSubmittedFacts(input(override))).toThrow(ApprovalEvidenceError);
	});
});

describe("time correction revision comparison", () => {
	const submitted = buildTimeCorrectionSubmittedFacts(input());

	it("is current while the baseline and proposal stand", () => {
		expect(compareLiveTimeCorrectionWithRevision(submitted, input())).toEqual({
			kind: "current",
		});
	});

	it("holds when stored minutes or attribution changed", () => {
		expect(
			compareLiveTimeCorrectionWithRevision(
				submitted,
				input({ period: { ...input().period, durationMinutes: 120 } }),
			),
		).toEqual({ kind: "material_change", changedFields: ["baseline"] });
	});

	it("holds when the period can no longer be verified", () => {
		expect(
			compareLiveTimeCorrectionWithRevision(
				submitted,
				input({ period: { ...input().period, deletedAt: new Date() } }),
			),
		).toEqual({ kind: "material_change", changedFields: ["unverifiable:work_period"] });
	});
});
