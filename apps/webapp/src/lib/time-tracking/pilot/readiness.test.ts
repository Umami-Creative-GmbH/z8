import { describe, expect, it } from "vitest";
import {
	assessTimePilotReadiness,
	type TimePilotEmployeeEvidence,
	type TimePilotSnapshot,
} from "./readiness";

function employee(overrides: Partial<TimePilotEmployeeEvidence> = {}): TimePilotEmployeeEvidence {
	return {
		employeeId: "e1",
		admission: "verified_lineage",
		lineage: "single",
		continuity: "established",
		...overrides,
	};
}

/** An adopted organization with nothing outstanding. */
function readySnapshot(overrides: Partial<TimePilotSnapshot> = {}): TimePilotSnapshot {
	return {
		organizationId: "org-pilot",
		append: { mode: "active", activatedAt: "2026-09-20T06:00:00.000Z" },
		employees: [employee()],
		openWork: 0,
		historyFindings: [{ kind: "capture_inferred", treatment: "disclosed", blocking: false }],
		approvalKinds: [
			{
				workflowType: "manual_time_submission",
				lifecycleMode: "legacy",
				evidenceMode: "capture",
				pending: { current: 2, notCaptured: 0, materialChange: 0, multiStage: 0 },
			},
			{
				workflowType: "policy_clock_out",
				lifecycleMode: null,
				evidenceMode: "capture",
				pending: { current: 0, notCaptured: 0, materialChange: 0, multiStage: 0 },
			},
			{
				workflowType: "time_correction",
				lifecycleMode: "canonical",
				evidenceMode: "capture",
				pending: { current: 0, notCaptured: 0, materialChange: 0, multiStage: 0 },
			},
		],
		unclassifiedPending: 0,
		operations: {
			sinceActivation: { web_clock_out: 4, manual_entry: 1 },
			legacyAdmissionSinceActivation: 0,
			serverIdentityOnBehalf: 0,
		},
		imports: { heldRows: 0, failedBatches: 0, inProgressBatches: 0 },
		followUps: {
			payrollCollection: "active",
			historicalRepair: "inactive",
			pendingRebuildIntents: 0,
			openProposals: 0,
			pendingBreakAdjustments: 0,
		},
		...overrides,
	};
}

describe("assessTimePilotReadiness", () => {
	it("reports an adopted organization with nothing outstanding as ready", () => {
		const report = assessTimePilotReadiness(readySnapshot());

		expect(report.verdict).toBe("ready");
		expect(report.adoption).toMatchObject({
			appendMode: "active",
			activatedAt: "2026-09-20T06:00:00.000Z",
			employees: {
				total: 1,
				admitted: { empty_history: 0, verified_lineage: 1, authorized_continuation: 0 },
				notAdmitted: 0,
				lineageReview: 0,
				continuityInterrupted: 0,
			},
			verdict: "ready",
			findings: [],
		});
		// Disclosures never make the history uncertain.
		expect(report.history).toMatchObject({ verdict: "ready", findings: [] });
		expect(report.history.treatments.disclosed).toBe(1);
		expect(report.approvals.kinds.map((kind) => [kind.workflowType, kind.authority])).toEqual([
			["manual_time_submission", "legacy"],
			["policy_clock_out", "legacy"],
			["time_correction", "canonical"],
		]);
		expect(report.approvals.kinds[0]?.pending.total).toBe(2);
		expect(report.operations.receiptsSinceActivation).toEqual({
			web_clock_out: 4,
			manual_entry: 1,
		});
		for (const section of [report.approvals, report.operations, report.imports, report.followUps]) {
			expect(section).toMatchObject({ verdict: "ready", findings: [] });
		}
	});

	it("classifies an unadopted organization's in-flight work and lineage before activation", () => {
		const report = assessTimePilotReadiness(
			readySnapshot({
				append: { mode: "inactive", activatedAt: null },
				employees: [
					employee({ employeeId: "e1", admission: null, continuity: "not_adopted" }),
					employee({
						employeeId: "e2",
						admission: null,
						lineage: "empty",
						continuity: "not_adopted",
					}),
					employee({
						employeeId: "e3",
						admission: null,
						lineage: "review_required",
						continuity: "not_adopted",
					}),
				],
				openWork: 2,
				operations: {
					sinceActivation: {},
					legacyAdmissionSinceActivation: 0,
					serverIdentityOnBehalf: 0,
				},
			}),
		);

		expect(report.adoption.employees).toMatchObject({
			total: 3,
			notAdmitted: 3,
			lineageReview: 1,
		});
		expect(report.adoption.findings).toEqual([
			{ code: "append_inactive", severity: "hold" },
			{ code: "open_work_in_flight", severity: "hold", count: 2 },
			{ code: "lineage_review_required", severity: "hold", count: 1 },
		]);
		expect(report.adoption.verdict).toBe("hold");
		expect(report.verdict).toBe("hold");
	});

	it("blocks on interrupted continuity but not on work that is open after activation", () => {
		const report = assessTimePilotReadiness(
			readySnapshot({
				employees: [employee(), employee({ employeeId: "e2", continuity: "interrupted" })],
				openWork: 3,
			}),
		);

		expect(report.adoption.findings).toEqual([
			{ code: "continuity_interrupted", severity: "blocker", count: 1 },
		]);
		expect(report.adoption.verdict).toBe("blocked");
		expect(report.verdict).toBe("blocked");
	});

	it("turns diagnostic treatments into pilot findings", () => {
		const report = assessTimePilotReadiness(
			readySnapshot({
				historyFindings: [
					{ kind: "duration_conflict", treatment: "integrity_incident", blocking: true },
					{ kind: "endpoint_missing", treatment: "investigation_required", blocking: true },
					{ kind: "endpoint_missing", treatment: "investigation_required", blocking: true },
					{ kind: "manual_trimmed", treatment: "review_required", blocking: false },
					{ kind: "duration_missing", treatment: "historical_gap", blocking: true },
					{ kind: "capture_inferred", treatment: "disclosed", blocking: false },
				],
			}),
		);

		expect(report.history.treatments).toEqual({
			historical_gap: 1,
			review_required: 1,
			integrity_incident: 1,
			investigation_required: 2,
			disclosed: 1,
		});
		expect(report.history.blockingKinds).toEqual({
			duration_conflict: 1,
			duration_missing: 1,
			endpoint_missing: 2,
		});
		expect(report.history.findings).toEqual([
			{ code: "history_integrity_incident", severity: "blocker", count: 1 },
			{ code: "history_investigation_required", severity: "blocker", count: 2 },
			{ code: "history_review_required", severity: "hold", count: 1 },
			{ code: "history_gap", severity: "hold", count: 1 },
		]);
		expect(report.history.verdict).toBe("blocked");
	});

	it("separates pending time approvals by the capture state they will meet", () => {
		const report = assessTimePilotReadiness(
			readySnapshot({
				approvalKinds: [
					{
						workflowType: "manual_time_submission",
						lifecycleMode: "legacy",
						evidenceMode: "inactive",
						pending: { current: 0, notCaptured: 3, materialChange: 0, multiStage: 0 },
					},
					{
						workflowType: "policy_clock_out",
						lifecycleMode: "shadow",
						evidenceMode: "capture",
						pending: { current: 1, notCaptured: 1, materialChange: 1, multiStage: 2 },
					},
				],
				unclassifiedPending: 1,
			}),
		);

		const [manual, clockOut] = report.approvals.kinds;
		expect(manual).toMatchObject({
			authority: "legacy",
			pending: { total: 3, notCaptured: 3 },
			verdict: "hold",
			findings: [
				{ code: "evidence_capture_inactive", severity: "hold" },
				{ code: "in_flight_without_revision", severity: "hold", count: 3 },
			],
		});
		expect(clockOut).toMatchObject({
			authority: "unverified",
			pending: { total: 3 },
			verdict: "blocked",
			findings: [
				{ code: "rollout_mode_unverified", severity: "blocker" },
				{ code: "multi_stage_unverified", severity: "blocker", count: 2 },
				{ code: "evidence_held", severity: "hold", count: 1 },
				{ code: "evidence_material_change", severity: "hold", count: 1 },
			],
		});
		expect(report.approvals.findings).toEqual([
			{ code: "pending_unclassified", severity: "hold", count: 1 },
		]);
		expect(report.approvals.verdict).toBe("blocked");
	});

	it("reports old writers and old clients seen since activation", () => {
		const report = assessTimePilotReadiness(
			readySnapshot({
				operations: {
					sinceActivation: { manager_on_behalf: 2 },
					legacyAdmissionSinceActivation: 1,
					serverIdentityOnBehalf: 2,
				},
			}),
		);

		expect(report.operations.findings).toEqual([
			{ code: "legacy_admission_after_activation", severity: "blocker", count: 1 },
			{ code: "server_identity_on_behalf", severity: "hold", count: 2 },
		]);
		expect(report.operations.verdict).toBe("blocked");
	});

	it("holds on unresolved imports and outstanding follow-up work", () => {
		const report = assessTimePilotReadiness(
			readySnapshot({
				imports: { heldRows: 4, failedBatches: 1, inProgressBatches: 1 },
				followUps: {
					payrollCollection: "inactive",
					historicalRepair: "active",
					pendingRebuildIntents: 1,
					openProposals: 2,
					pendingBreakAdjustments: 3,
				},
			}),
		);

		expect(report.imports.findings).toEqual([
			{ code: "import_rows_held", severity: "hold", count: 4 },
			{ code: "import_commit_failed", severity: "hold", count: 1 },
			{ code: "import_in_progress", severity: "hold", count: 1 },
		]);
		expect(report.followUps.findings).toEqual([
			{ code: "payroll_collection_inactive", severity: "hold" },
			{ code: "balance_rebuild_pending", severity: "hold", count: 1 },
			{ code: "proposals_open", severity: "hold", count: 2 },
			{ code: "break_adjustment_pending", severity: "hold", count: 3 },
		]);
		expect(report.verdict).toBe("hold");
	});
});
