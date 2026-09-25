import { describe, expect, it } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import type {
	DecisionEvidenceRecord,
	TimeCorrectionSubmittedRevisionRecord,
	WorkPeriodSubmittedRevisionRecord,
} from "../evidence/store";
import type { ApprovalInboxDetailSection } from "../inbox/types";
import { buildTimeReviewSections } from "./time-review";

const endpoint = (entryId: string, at: string, utcOffsetMinutes: number) => ({
	entryId,
	at,
	utcOffsetMinutes,
	timezone: "Europe/Berlin",
	timezoneSource: "browser",
});

const policyRevision: WorkPeriodSubmittedRevisionRecord = {
	id: "r1",
	organizationId: "org",
	lifecycle: { authority: "canonical", workflowId: "w1" },
	workflowType: "policy_clock_out",
	workPeriodId: "p1",
	requestCycleKey: "k",
	revision: 1,
	subjectEmployeeId: "e-subject",
	requesterEmployeeId: "e-subject",
	submitter: { kind: "employee", employeeId: "e-subject", userId: "u" },
	materialFingerprint: "work_period:v1:x",
	facts: {
		schemaVersion: 1,
		kind: "policy_clock_out",
		organizationId: "org",
		workPeriodId: "p1",
		canonicalRecordId: "t1",
		subjectEmployeeId: "e-subject",
		requesterEmployeeId: "e-subject",
		interval: {
			clockIn: endpoint("in", "2026-10-05T06:00:00Z", 120),
			clockOut: endpoint("out", "2026-10-05T12:31:00Z", 120),
			storedDurationMinutes: 391,
			elapsedSeconds: 23460,
		},
		policy: {
			kind: "policy_clock_out",
			breakAdjustment: "may_apply",
			breakPolicySnapshot: {} as never,
			surchargeSnapshot: null,
		},
		attribution: { projectId: null, workCategoryId: null, workLocationType: null },
	},
	labels: { subjectName: "Avery Requester", requesterName: "Avery Requester", submitterName: "Avery Requester" },
	provenance: "captured_at_submission",
	submittedAt: parseInstant("2026-10-05T12:31:05Z"),
};

function decision(overrides: Partial<DecisionEvidenceRecord>): DecisionEvidenceRecord {
	return {
		id: "d1",
		organizationId: "org",
		workflowId: "w1",
		submittedRevisionId: "r1",
		operationKind: "command",
		receipt: { idempotencyKey: "k", actorFingerprint: "a", commandFingerprint: "c" },
		action: "approve",
		stageId: "s1",
		assignmentId: "a1",
		assignmentOutcome: "approved",
		requestOutcome: "approved",
		actor: { kind: "employee", employeeId: "e-manager", userId: "u-manager" },
		decidedAt: parseInstant("2026-10-06T08:00:00Z"),
		eventIds: [],
		result: {},
		labels: { actorName: "Morgan Manager" },
		reviewedBindingId: null,
		...overrides,
	};
}

function rows(sections: ApprovalInboxDetailSection[], title: string) {
	const section = sections.find(
		(candidate) =>
			candidate.type === "key_value" &&
			(typeof candidate.title === "string" ? candidate.title : candidate.title.fallback) === title,
	);
	if (section?.type !== "key_value") throw new Error(`missing section ${title}`);
	return section.rows.map((row) => [
		typeof row.label === "string" ? row.label : row.label.fallback,
		typeof row.value === "string" ? row.value : "fallback" in row.value ? row.value.fallback : row.value,
	]);
}

describe("buildTimeReviewSections", () => {
	it("keeps the submitted interval apart from the committed break adjustment and every resulting segment", () => {
		const { sections, decisionsBlocked } = buildTimeReviewSections({
			status: "evidenced",
			kind: "work_period",
			revision: policyRevision,
			comparison: null,
			decisions: [
				decision({
					result: {
						workPeriodStatus: "approved",
						terminal: {
							status: "approved",
							adjustment: { kind: "break_enforced", breakMinutes: 30 },
							segments: [
								{
									workPeriodId: "p1",
									canonicalRecordId: "t1",
									approvalStatus: "approved",
									clockIn: endpoint("in", "2026-10-05T06:00:00Z", 120),
									clockOut: endpoint("b1", "2026-10-05T12:00:00Z", 120),
									storedDurationMinutes: 360,
									elapsedSeconds: 21600,
								},
								{
									workPeriodId: "p2",
									canonicalRecordId: "t2",
									approvalStatus: "approved",
									clockIn: endpoint("b2", "2026-10-05T12:30:00Z", 120),
									clockOut: endpoint("out", "2026-10-05T12:31:00Z", 120),
									storedDurationMinutes: 1,
									elapsedSeconds: 60,
								},
							],
							followUps: null,
						},
					},
				}),
			],
		});
		expect(decisionsBlocked).toBe(false);
		expect(rows(sections, "Submitted times")).toEqual([
			["Employee", "Avery Requester"],
			["Clock in", "2026-10-05 08:00 (UTC+02:00)"],
			["Clock out", "2026-10-05 14:31 (UTC+02:00)"],
			["Submitted duration", "6 h 31 min"],
			["Elapsed time", "6 h 31 min"],
			["Break adjustment", "May apply when approved; the result is recorded separately"],
		]);
		expect(rows(sections, "Result")).toEqual([
			["Outcome", "Approved"],
			["Break adjustment", "30 min break inserted"],
			["Segment 1", "2026-10-05 08:00 (UTC+02:00) – 2026-10-05 14:00 (UTC+02:00) · 6 h 0 min"],
			["Segment 2", "2026-10-05 14:30 (UTC+02:00) – 2026-10-05 14:31 (UTC+02:00) · 0 h 1 min"],
		]);
		const history = sections.find((section) => section.type === "timeline");
		expect(history?.type === "timeline" && history.events.map((event) => event.label)).toEqual([
			"Submitted",
			"Request approved",
		]);
	});

	it("shows a correction's requested change apart from its committed result and holds a changed entry", () => {
		const correction: TimeCorrectionSubmittedRevisionRecord = {
			...policyRevision,
			id: "r2",
			lifecycle: { authority: "legacy", legacy: { approvalRequestId: "q1", chainInstanceId: "c1", observedWorkflowId: null } },
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
					clockIn: endpoint("in", "2026-10-05T06:00:00Z", 120),
					clockOut: endpoint("out", "2026-10-05T14:00:00Z", 120),
					storedDurationMinutes: 480,
					elapsedSeconds: 28800,
					attribution: { projectId: null, workCategoryId: "cat-old", workLocationType: "office" },
				},
				requested: {
					clockIn: null,
					clockOut: {
						originalEntryId: "out",
						correctionEntryId: "c-out",
						at: "2026-10-05T15:00:00Z",
						utcOffsetMinutes: 60,
						timezone: "Europe/London",
						timezoneSource: "browser",
					},
					workLocationType: { kind: "set", value: "home" },
					workCategoryId: { kind: "set", value: null },
				},
				changeMask: { clockIn: false, clockOut: true, workLocation: true, workCategory: true },
			},
		};
		const intermediate = decision({ assignmentOutcome: "approved", requestOutcome: "pending", result: { terminal: null } });
		const final = decision({
			id: "d2",
			result: {
				terminal: {
					transition: "approved",
					kind: "amended",
					graphRevision: 3,
					segment: {
						clockIn: endpoint("in", "2026-10-05T06:00:00Z", 120),
						clockOut: endpoint("c-out", "2026-10-05T15:00:00Z", 60),
						storedDurationMinutes: 540,
						elapsedSeconds: 32400,
						attribution: { projectId: null, workCategoryId: null, workLocationType: "home" },
					},
				},
			},
		});
		const reviewed = buildTimeReviewSections({
			status: "evidenced",
			kind: "time_correction",
			revision: correction,
			comparison: null,
			decisions: [intermediate, final],
			categoryNames: { "cat-old": "Consulting" },
		});
		expect(rows(reviewed.sections, "Requested correction")).toEqual([
			["Employee", "Avery Requester"],
			["Request", "Change times"],
			["Entry", "2026-10-05 08:00 (UTC+02:00) – 2026-10-05 16:00 (UTC+02:00)"],
			["Duration before", "8 h 0 min"],
			["Clock out", "2026-10-05 16:00 (UTC+02:00) → 2026-10-05 16:00 (UTC+01:00)"],
			[
				"Work location",
				{ kind: "change", original: { kind: "work_location", value: "office" }, requested: { kind: "work_location", value: "home" } },
			],
			[
				"Work category",
				{
					kind: "change",
					original: { kind: "work_category", value: { state: "named", id: "cat-old", name: "Consulting" } },
					requested: { kind: "work_category", value: { state: "none" } },
				},
			],
		]);
		expect(rows(reviewed.sections, "Result")).toEqual([
			["Outcome", "Approved"],
			["Entry", "2026-10-05 08:00 (UTC+02:00) – 2026-10-05 16:00 (UTC+01:00) · 9 h 0 min"],
		]);
		const history = reviewed.sections.find((section) => section.type === "timeline");
		expect(history?.type === "timeline" && history.events.map((event) => event.label)).toEqual([
			"Submitted",
			"Approval recorded — awaiting further approval",
			"Request approved",
		]);

		const deleted = buildTimeReviewSections({
			status: "evidenced",
			kind: "time_correction",
			revision: { ...correction, facts: { ...correction.facts, intent: "delete" } },
			comparison: null,
			decisions: [
				decision({
					result: {
						terminal: {
							transition: "approved",
							kind: "deleted",
							graphRevision: 4,
							deletedAt: "2026-10-06T08:00:00Z",
							sentinel: { startAt: "2026-10-05T06:00:00Z", endAt: "2026-10-05T06:00:00Z", durationMinutes: 0 },
						},
					},
				}),
			],
			categoryNames: {},
		});
		expect(rows(deleted.sections, "Requested correction")[1]).toEqual(["Request", "Delete this entry"]);
		expect(rows(deleted.sections, "Result")).toEqual([
			["Outcome", "Approved"],
			["Entry", "Deleted"],
		]);

		const changed = buildTimeReviewSections({
			status: "evidenced",
			kind: "time_correction",
			revision: correction,
			comparison: { kind: "material_change", changedFields: ["baseline"] },
			decisions: [],
			categoryNames: {},
		});
		expect(changed.decisionsBlocked).toBe(true);
		expect(changed.sections.some((section) => section.type === "callout" && section.tone === "danger")).toBe(true);
		// A category without a known name stays explicitly unavailable, never "no category".
		expect(rows(changed.sections, "Requested correction")[6]?.[1]).toMatchObject({
			original: { kind: "work_category", value: { state: "unavailable", id: "cat-old" } },
		});
	});
});
