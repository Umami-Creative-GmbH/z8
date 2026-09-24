import { describe, expect, it, vi } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import { buildAbsenceSubmittedFacts } from "../evidence/absence-facts";
import type {
	AbsenceSubmittedRevisionRecord,
	DecisionEvidenceRecord,
} from "../evidence/store";
import {
	type AbsenceReviewEvidence,
	buildAbsenceReviewSections,
} from "./absence-review";

vi.mock("@/db", () => ({ db: {} }));

function revision(
	overrides: Partial<AbsenceSubmittedRevisionRecord> = {},
): AbsenceSubmittedRevisionRecord {
	const raw = {
		startDate: "2026-05-11",
		endDate: "2026-05-11",
		durationKind: "partial_day" as const,
		startTime: "09:00",
		endTime: "12:30",
	};
	return {
		id: "revision-1",
		organizationId: "org-1",
		workflowId: "workflow-1",
		sourceId: "absence-1",
		requestCycleKey: "absence:absence-1:submission",
		revision: 1,
		subjectEmployeeId: "employee-1",
		requesterEmployeeId: "employee-1",
		submitter: { kind: "employee", employeeId: "employee-1", userId: "user-1" },
		materialFingerprint: "absence:v1:x",
		facts: buildAbsenceSubmittedFacts({
			organizationId: "org-1",
			absenceId: "absence-1",
			subjectEmployeeId: "employee-1",
			requesterEmployeeId: "employee-1",
			categoryId: "category-1",
			raw,
			normalized: { ...raw, startPeriod: "am", endPeriod: "am" },
			entry: {
				startDate: "2026-05-11",
				startPeriod: "am",
				endDate: "2026-05-11",
				endPeriod: "am",
			},
			canonicalRecord: {
				id: "record-1",
				startAt: new Date("2026-05-11T09:00:00.000Z"),
				endAt: new Date("2026-05-11T12:30:00.000Z"),
			},
		}),
		labels: {
			subjectName: "Avery Employee",
			requesterName: "Avery Employee",
			submitterName: "Avery Employee",
			categoryName: "Vacation",
		},
		provenance: "captured_at_submission",
		submittedAt: parseInstant("2026-05-01T08:00:00Z"),
		...overrides,
	};
}

function decision(
	overrides: Partial<DecisionEvidenceRecord> = {},
): DecisionEvidenceRecord {
	return {
		id: "decision-1",
		organizationId: "org-1",
		workflowId: "workflow-1",
		submittedRevisionId: "revision-1",
		operationKind: "command",
		receipt: {
			idempotencyKey: "key-1",
			actorFingerprint: "actor",
			commandFingerprint: "command",
		},
		action: "approve",
		stageId: "stage-1",
		assignmentId: "assignment-1",
		assignmentOutcome: "approved",
		requestOutcome: "pending",
		actor: { kind: "employee", employeeId: "manager-1", userId: "user-2" },
		decidedAt: parseInstant("2026-05-02T10:15:00Z"),
		eventIds: ["event-1"],
		result: { absenceStatus: "pending", terminalTransition: null },
		labels: { actorName: "Morgan Manager" },
		reviewedBindingId: null,
		...overrides,
	};
}

function evidenced(
	overrides: Partial<
		Extract<AbsenceReviewEvidence, { status: "evidenced" }>
	> = {},
): AbsenceReviewEvidence {
	return {
		status: "evidenced",
		revision: revision(),
		comparison: { kind: "current", labelChanges: [] },
		decisions: [],
		...overrides,
	};
}

describe("buildAbsenceReviewSections", () => {
	it("shows the submitted explicit times instead of the lossy AM/AM encoding", () => {
		const { sections, decisionsBlocked } = buildAbsenceReviewSections(
			evidenced(),
		);

		expect(decisionsBlocked).toBe(false);
		const submitted = sections[0];
		expect(submitted?.type).toBe("key_value");
		expect(JSON.stringify(submitted)).toContain("09:00 – 12:30");
		expect(JSON.stringify(submitted)).not.toContain("Morning");
	});

	it("distinguishes a label-only category rename from the submitted label", () => {
		const { sections, decisionsBlocked } = buildAbsenceReviewSections(
			evidenced({
				comparison: {
					kind: "current",
					labelChanges: [
						{
							field: "categoryName",
							submitted: "Vacation",
							current: "Annual leave",
						},
					],
				},
			}),
		);

		expect(decisionsBlocked).toBe(false);
		const rows = sections[0]?.type === "key_value" ? sections[0].rows : [];
		expect(rows).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ value: "Vacation" }),
				expect.objectContaining({
					label: expect.objectContaining({ fallback: "Current category name" }),
					value: "Annual leave",
				}),
			]),
		);
	});

	it("blocks decisions and requires resubmission after a material change", () => {
		const { sections, decisionsBlocked } = buildAbsenceReviewSections(
			evidenced({
				comparison: { kind: "material_change", changedFields: ["endDate"] },
			}),
		);

		expect(decisionsBlocked).toBe(true);
		expect(sections).toContainEqual(
			expect.objectContaining({
				type: "callout",
				tone: "danger",
				body: expect.stringContaining("cancelled and resubmitted"),
			}),
		);
	});

	it("distinguishes an intermediate assignment approval from request finality", () => {
		const { sections } = buildAbsenceReviewSections(
			evidenced({
				decisions: [
					decision(),
					decision({
						id: "decision-2",
						requestOutcome: "approved",
						decidedAt: parseInstant("2026-05-03T07:00:00Z"),
					}),
				],
			}),
		);
		const timeline = sections.find((section) => section.type === "timeline");

		expect(timeline).toEqual(
			expect.objectContaining({
				events: [
					expect.objectContaining({
						label: "Submitted",
						at: "2026-05-01T08:00:00Z",
					}),
					expect.objectContaining({
						label: "Approval recorded — awaiting further approval",
						at: "2026-05-02T10:15:00Z",
						actorName: "Morgan Manager",
					}),
					expect.objectContaining({
						label: "Request approved",
						at: "2026-05-03T07:00:00Z",
					}),
				],
			}),
		);
	});

	it("names distinct requester and submitter roles only when they differ", () => {
		const onBehalf = buildAbsenceReviewSections(
			evidenced({
				revision: revision({
					submitter: {
						kind: "employee",
						employeeId: "manager-1",
						userId: "user-2",
					},
					labels: {
						subjectName: "Avery Employee",
						requesterName: "Avery Employee",
						submitterName: "Morgan Manager",
						categoryName: "Vacation",
					},
				}),
			}),
		);

		expect(JSON.stringify(onBehalf.sections[0])).toContain("Submitted by");
		expect(
			JSON.stringify(buildAbsenceReviewSections(evidenced()).sections[0]),
		).not.toContain("Submitted by");
	});

	it("holds requests without captured facts only while capture is active", () => {
		expect(
			buildAbsenceReviewSections({ status: "not_captured", held: true }),
		).toMatchObject({
			decisionsBlocked: true,
			sections: [{ type: "callout" }],
		});
		expect(
			buildAbsenceReviewSections({ status: "not_captured", held: false }),
		).toEqual({ decisionsBlocked: false, sections: [] });
	});
});
