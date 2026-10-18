import { expect, it } from "vitest";
import {
	type AbsenceChangeCoverageSnapshot,
	loadAbsenceChangeCoverageTriageEvidence,
} from "./absence-change-coverage-evidence";
import { snapshot as staffing } from "./absence-coverage-evidence.test-fixture";
import type { ApprovalInboxTriageTarget } from "./triage-evidence";

const original = {
	categoryId: "category",
	canonicalRecordId: null,
	canonical: null,
	updatedAt: "2026-10-18T08:00:00Z",
	startDate: "2026-10-19",
	endDate: "2026-10-19",
	startPeriod: "full_day" as const,
	endPeriod: "full_day" as const,
};
const changeSnapshot: AbsenceChangeCoverageSnapshot = {
	organizationId: "org",
	requestId: "assignment",
	changeId: "change",
	absenceId: "absence",
	employeeId: "subject",
	kind: "cancel",
	status: "pending",
	currentAuthority: "canonical",
	original,
	proposed: null,
	submittedRevision: "audit:fingerprint",
	submittedMatchesCurrent: true,
	liveOriginal: original,
	timezone: "Europe/Berlin",
	requiresWorkTime: false,
	shifts: staffing.shifts.slice(0, 1),
	rules: staffing.rules,
	absences: [],
};
const target: ApprovalInboxTriageTarget = {
	context: {
		organizationId: "org",
		requestId: "assignment",
		entityId: "change",
		revision: null,
		scope: "submitted_request",
	},
	authority: "canonical_assignment",
	requestKind: "absence_change",
	type: "absence_change_request",
	status: "pending",
	createdAt: "2026-10-18T08:00:00Z",
	priority: "normal",
};
it("binds current cancellation evidence to the captured submitted original and exact canonical assignment", async () => {
	const result = await loadAbsenceChangeCoverageTriageEvidence(target, {
		readSnapshot: async () => changeSnapshot,
	});
	expect(result.context.revision).toBe("audit:fingerprint");
	expect(result.evidence).toMatchObject([
		{
			check: "coverage",
			state: "clear",
			validity: "current",
			facts: { kind: "cancel", originalStartDate: "2026-10-19" },
		},
	]);
});
it.each([
	{ ...changeSnapshot, organizationId: "other" },
	{ ...changeSnapshot, requestId: "other" },
	{ ...changeSnapshot, changeId: "other" },
	{ ...changeSnapshot, status: "obsolete" },
	{ ...changeSnapshot, currentAuthority: "legacy" as const },
	{ ...changeSnapshot, submittedRevision: null },
	{ ...changeSnapshot, submittedMatchesCurrent: false },
	{ ...changeSnapshot, liveOriginal: { ...original, endDate: "2026-10-20" } },
])(
	"refuses unverifiable, retired, foreign or modified captured change facts",
	async (snapshot) => {
		expect(
			(
				await loadAbsenceChangeCoverageTriageEvidence(target, {
					readSnapshot: async () => snapshot,
				})
			).evidence,
		).toMatchObject([{ state: "unknown" }]);
	},
);
it("retains staffing shortfalls with incomplete coverage while payroll remains unverified", async () => {
	const rule = changeSnapshot.rules[0];
	if (!rule) throw new Error("Rule missing");
	const result = await loadAbsenceChangeCoverageTriageEvidence(target, {
		readSnapshot: async () => ({
			...changeSnapshot,
			rules: [{ ...rule, endTime: "12:00", minimumStaffCount: 2 }],
		}),
	});
	const { assessApprovalTriage } = await import("../triage-assessment");
	const assessed = assessApprovalTriage({
		requestKind: "absence_change",
		context: result.context,
		status: "pending",
		createdAt: target.createdAt,
		now: new Date("2026-10-18T09:00:00Z"),
		policy: { staleAfterHours: 72, smallCorrectionMinutes: 15 },
		evidence: result.evidence,
	});
	expect(assessed.riskLevel).toBe("high");
	expect(assessed.riskReasons).toEqual(
		expect.arrayContaining([
			"staffing_shortfall",
			"coverage_unverified",
			"payroll_unverified",
		]),
	);
	expect(assessed.fastLaneGroup).toBeNull();
});
it("does not let a clear coverage check create a low-risk shortcut without supported payroll mapping", async () => {
	const result = await loadAbsenceChangeCoverageTriageEvidence(target, {
		readSnapshot: async () => changeSnapshot,
	});
	const { assessApprovalTriage } = await import("../triage-assessment");
	const assessed = assessApprovalTriage({
		requestKind: "absence_change",
		context: result.context,
		status: "pending",
		createdAt: target.createdAt,
		now: new Date("2026-10-18T09:00:00Z"),
		policy: { staleAfterHours: 72, smallCorrectionMinutes: 15 },
		evidence: result.evidence,
	});
	expect(assessed.riskLevel).toBe("medium");
	expect(assessed.riskReasons).toEqual(["payroll_unverified"]);
	expect(assessed.fastLaneGroup).toBeNull();
});
