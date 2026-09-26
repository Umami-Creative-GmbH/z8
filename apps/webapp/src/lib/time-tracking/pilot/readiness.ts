import type { ApprovalEvidenceMode } from "@/db/schema";
import type { CompletedWorkWriter, HistoricalWorkRepairMode } from "@/db/schema/completed-work";
import type { PayrollWorkCollectionMode } from "@/db/schema/payroll-export";
import {
	TIME_ENTRY_APPEND_ADMISSIONS,
	type TimeEntryAppendAdmission,
	type TimeEntryAppendMode,
} from "@/db/schema/time-entry-append";
import type { TimeApprovalWorkflowType } from "@/lib/approvals/time-approval-kinds";
import type { AppendContinuity, AppendLineageAssessment } from "../append-assurance";
import type { WorkFindingKind, WorkFindingTreatment } from "../historical-work-diagnostics";

/**
 * Readiness of one organization for the time pilot (#329 / T64): whether its
 * completed work, append adoption, time approvals, imports and follow-up work
 * can enter or continue the pilot. This module only classifies a snapshot the
 * reader took; it changes nothing. Activation, drains, repairs and control
 * changes stay separately authorized operator steps (docs/refs/time-pilot.md).
 */

export type TimePilotVerdict = "ready" | "hold" | "blocked";

export type TimePilotFindingCode =
	// Append adoption
	| "append_inactive"
	| "open_work_in_flight"
	| "lineage_review_required"
	| "continuity_interrupted"
	// Historical work (#319 treatments)
	| "history_integrity_incident"
	| "history_investigation_required"
	| "history_review_required"
	| "history_gap"
	// Time approvals (#301/#302)
	| "rollout_mode_unverified"
	| "multi_stage_unverified"
	| "evidence_capture_inactive"
	| "in_flight_without_revision"
	| "evidence_held"
	| "evidence_material_change"
	| "pending_unclassified"
	// Writers and clients seen since activation
	| "legacy_admission_after_activation"
	| "server_identity_on_behalf"
	// Reviewed imports (#284)
	| "import_rows_held"
	| "import_commit_failed"
	| "import_in_progress"
	// Follow-up work
	| "payroll_collection_inactive"
	| "balance_rebuild_pending"
	| "proposals_open"
	| "break_adjustment_pending";

export interface TimePilotFinding {
	code: TimePilotFindingCode;
	/** A blocker prevents activation; a hold needs an explicit operator decision. */
	severity: "blocker" | "hold";
	/** Number of affected employees, lifecycles or rows, when the finding counts them. */
	count?: number;
}

// ---------------------------------------------------------------------------
// Snapshot (what the reader collects)
// ---------------------------------------------------------------------------

export interface TimePilotEmployeeEvidence {
	employeeId: string;
	/** How the append position was admitted; null without a position. */
	admission: TimeEntryAppendAdmission | null;
	lineage: AppendLineageAssessment["status"];
	continuity: AppendContinuity["status"];
}

export interface TimePilotPendingEvidence {
	/** Evidenced and still matching the live work. */
	current: number;
	/** No submitted revision: submitted before capture, or capture is off. */
	notCaptured: number;
	/** Live work changed after the submitted revision. */
	materialChange: number;
	/** Pending requests on a legacy multi-stage chain (a subset of the above). */
	multiStage: number;
}

export interface TimePilotApprovalKindEvidence {
	workflowType: TimeApprovalWorkflowType;
	/** Stored rollout mode; null when the organization has no rollout row. */
	lifecycleMode: string | null;
	evidenceMode: ApprovalEvidenceMode;
	pending: TimePilotPendingEvidence;
}

export interface TimePilotSnapshot {
	organizationId: string;
	/** `activatedAt` is the control's last update while `active` (it has no setter). */
	append: { mode: TimeEntryAppendMode; activatedAt: string | null };
	employees: TimePilotEmployeeEvidence[];
	/** Work periods without an end: live work in flight at the snapshot. */
	openWork: number;
	/** Every #319 finding over the whole retained history. */
	historyFindings: Array<{
		kind: WorkFindingKind;
		treatment: WorkFindingTreatment;
		blocking: boolean;
	}>;
	approvalKinds: TimePilotApprovalKindEvidence[];
	/** Pending time approval requests whose kind cannot be established. */
	unclassifiedPending: number;
	operations: {
		/** Committed completed-work receipts since activation, by writer. */
		sinceActivation: Partial<Record<CompletedWorkWriter, number>>;
		/** Receipts committed under legacy admission after activation. */
		legacyAdmissionSinceActivation: number;
		/** On-behalf clock-outs since activation that carried no client identity (#276). */
		serverIdentityOnBehalf: number;
	};
	imports: { heldRows: number; failedBatches: number; inProgressBatches: number };
	followUps: {
		payrollCollection: PayrollWorkCollectionMode;
		historicalRepair: HistoricalWorkRepairMode;
		pendingRebuildIntents: number;
		/** Historical work proposals still proposed or approved (#323). */
		openProposals: number;
		pendingBreakAdjustments: number;
	};
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

interface Section {
	verdict: TimePilotVerdict;
	findings: TimePilotFinding[];
}

export interface TimePilotAdoptionReadiness extends Section {
	appendMode: TimeEntryAppendMode;
	activatedAt: string | null;
	employees: {
		total: number;
		admitted: Record<TimeEntryAppendAdmission, number>;
		notAdmitted: number;
		/** Without a position and not one lineage: fresh appends hold for review (#323). */
		lineageReview: number;
		continuityInterrupted: number;
	};
	openWork: number;
}

export interface TimePilotHistoryReadiness extends Section {
	treatments: Record<WorkFindingTreatment, number>;
	/** Blocking findings by kind, for triage. */
	blockingKinds: Partial<Record<WorkFindingKind, number>>;
}

export interface TimePilotApprovalKindReadiness extends Section {
	workflowType: TimeApprovalWorkflowType;
	/** `unverified`: a `shadow`, `ready` or `complete` rollout, not verified for time kinds. */
	authority: "legacy" | "canonical" | "unverified";
	lifecycleMode: string | null;
	evidenceMode: ApprovalEvidenceMode;
	pending: TimePilotPendingEvidence & { total: number };
}

export interface TimePilotApprovalReadiness extends Section {
	kinds: TimePilotApprovalKindReadiness[];
	unclassifiedPending: number;
}

export interface TimePilotOperationsReadiness extends Section {
	receiptsSinceActivation: Partial<Record<CompletedWorkWriter, number>>;
}

export interface TimePilotImportReadiness extends Section {
	heldRows: number;
	failedBatches: number;
	inProgressBatches: number;
}

export interface TimePilotFollowUpReadiness extends Section {
	payrollCollection: PayrollWorkCollectionMode;
	historicalRepair: HistoricalWorkRepairMode;
	pendingRebuildIntents: number;
	openProposals: number;
	pendingBreakAdjustments: number;
}

export interface TimePilotReadiness {
	organizationId: string;
	/** The worst section verdict. */
	verdict: TimePilotVerdict;
	adoption: TimePilotAdoptionReadiness;
	history: TimePilotHistoryReadiness;
	approvals: TimePilotApprovalReadiness;
	operations: TimePilotOperationsReadiness;
	imports: TimePilotImportReadiness;
	followUps: TimePilotFollowUpReadiness;
}

function verdictOf(findings: readonly TimePilotFinding[]): TimePilotVerdict {
	if (findings.some((finding) => finding.severity === "blocker")) return "blocked";
	return findings.length > 0 ? "hold" : "ready";
}

/** Adds a counted finding only when something is affected. */
function counted(
	findings: TimePilotFinding[],
	code: TimePilotFindingCode,
	severity: TimePilotFinding["severity"],
	count: number,
) {
	if (count > 0) findings.push({ code, severity, count });
}

function section<T extends object>(details: T, findings: TimePilotFinding[]): T & Section {
	return { ...details, verdict: verdictOf(findings), findings };
}

function assessAdoption(snapshot: TimePilotSnapshot): TimePilotAdoptionReadiness {
	const { employees } = snapshot;
	const admitted = Object.fromEntries(
		TIME_ENTRY_APPEND_ADMISSIONS.map((admission) => [
			admission,
			employees.filter((employee) => employee.admission === admission).length,
		]),
	) as Record<TimeEntryAppendAdmission, number>;
	const notAdmitted = employees.filter((employee) => employee.admission === null);
	const lineageReview = notAdmitted.filter(
		(employee) => employee.lineage === "review_required",
	).length;
	const continuityInterrupted = employees.filter(
		(employee) => employee.continuity === "interrupted",
	).length;

	const findings: TimePilotFinding[] = [];
	if (snapshot.append.mode !== "active") {
		findings.push({ code: "append_inactive", severity: "hold" });
		// Live work open at activation closes through the adopted path; #308
		// suggests activating outside working hours.
		counted(findings, "open_work_in_flight", "hold", snapshot.openWork);
	}
	counted(findings, "lineage_review_required", "hold", lineageReview);
	counted(findings, "continuity_interrupted", "blocker", continuityInterrupted);

	return section(
		{
			appendMode: snapshot.append.mode,
			activatedAt: snapshot.append.activatedAt,
			employees: {
				total: employees.length,
				admitted,
				notAdmitted: notAdmitted.length,
				lineageReview,
				continuityInterrupted,
			},
			openWork: snapshot.openWork,
		},
		findings,
	);
}

const TREATMENT_FINDINGS: ReadonlyArray<
	[WorkFindingTreatment, TimePilotFindingCode, TimePilotFinding["severity"]]
> = [
	// #319: incidents and ambiguous provenance must be resolved before activation.
	["integrity_incident", "history_integrity_incident", "blocker"],
	["investigation_required", "history_investigation_required", "blocker"],
	// Pre-adoption conflicts and suspected defects need an authorized review;
	// gaps may go to evidence-only repair (#320).
	["review_required", "history_review_required", "hold"],
	["historical_gap", "history_gap", "hold"],
];

function assessHistory(snapshot: TimePilotSnapshot): TimePilotHistoryReadiness {
	const treatments: Record<WorkFindingTreatment, number> = {
		historical_gap: 0,
		review_required: 0,
		integrity_incident: 0,
		investigation_required: 0,
		disclosed: 0,
	};
	const blockingKinds: Partial<Record<WorkFindingKind, number>> = {};
	for (const finding of snapshot.historyFindings) {
		treatments[finding.treatment] += 1;
		if (finding.blocking) blockingKinds[finding.kind] = (blockingKinds[finding.kind] ?? 0) + 1;
	}
	const findings: TimePilotFinding[] = [];
	for (const [treatment, code, severity] of TREATMENT_FINDINGS) {
		counted(findings, code, severity, treatments[treatment]);
	}
	return section(
		{
			treatments,
			blockingKinds: Object.fromEntries(
				Object.entries(blockingKinds).toSorted(([left], [right]) => left.localeCompare(right)),
			),
		},
		findings,
	);
}

function authorityOf(lifecycleMode: string | null): TimePilotApprovalKindReadiness["authority"] {
	if (lifecycleMode === null || lifecycleMode === "legacy") return "legacy";
	if (lifecycleMode === "canonical") return "canonical";
	// `shadow`, `ready` and `complete` were never exercised for time kinds.
	return "unverified";
}

function assessApprovalKind(kind: TimePilotApprovalKindEvidence): TimePilotApprovalKindReadiness {
	const { pending } = kind;
	const authority = authorityOf(kind.lifecycleMode);
	const findings: TimePilotFinding[] = [];
	// #302/#301: only legacy and canonical single-stage lifecycles were verified.
	if (authority === "unverified") {
		findings.push({ code: "rollout_mode_unverified", severity: "blocker" });
	}
	counted(findings, "multi_stage_unverified", "blocker", pending.multiStage);
	if (kind.evidenceMode === "capture") {
		// Held with `evidence_required` until drained or cancelled.
		counted(findings, "evidence_held", "hold", pending.notCaptured);
	} else {
		findings.push({ code: "evidence_capture_inactive", severity: "hold" });
		// Enabling capture would hold these: drain them first.
		counted(findings, "in_flight_without_revision", "hold", pending.notCaptured);
	}
	// Refused for approve and reject; there is no supported resubmission yet.
	counted(findings, "evidence_material_change", "hold", pending.materialChange);
	return section(
		{
			workflowType: kind.workflowType,
			authority,
			lifecycleMode: kind.lifecycleMode,
			evidenceMode: kind.evidenceMode,
			pending: {
				...pending,
				total: pending.current + pending.notCaptured + pending.materialChange,
			},
		},
		findings,
	);
}

function assessApprovals(snapshot: TimePilotSnapshot): TimePilotApprovalReadiness {
	const kinds = snapshot.approvalKinds.map(assessApprovalKind);
	const requestFindings: TimePilotFinding[] = [];
	counted(requestFindings, "pending_unclassified", "hold", snapshot.unclassifiedPending);
	const all = [...kinds.flatMap((kind) => kind.findings), ...requestFindings];
	return {
		kinds,
		unclassifiedPending: snapshot.unclassifiedPending,
		verdict: verdictOf(all),
		findings: requestFindings,
	};
}

function assessOperations(snapshot: TimePilotSnapshot): TimePilotOperationsReadiness {
	const { operations } = snapshot;
	const findings: TimePilotFinding[] = [];
	// A writer that read the control before activation, or never reads it.
	counted(
		findings,
		"legacy_admission_after_activation",
		"blocker",
		operations.legacyAdmissionSinceActivation,
	);
	// Calendar bundles deployed before #401 cannot recover a lost response.
	counted(findings, "server_identity_on_behalf", "hold", operations.serverIdentityOnBehalf);
	return section({ receiptsSinceActivation: operations.sinceActivation }, findings);
}

function assessImports(snapshot: TimePilotSnapshot): TimePilotImportReadiness {
	const { imports } = snapshot;
	const findings: TimePilotFinding[] = [];
	// There is no reviewer flow for held rows yet (#284).
	counted(findings, "import_rows_held", "hold", imports.heldRows);
	counted(findings, "import_commit_failed", "hold", imports.failedBatches);
	counted(findings, "import_in_progress", "hold", imports.inProgressBatches);
	return section({ ...imports }, findings);
}

function assessFollowUps(snapshot: TimePilotSnapshot): TimePilotFollowUpReadiness {
	const { followUps } = snapshot;
	const findings: TimePilotFinding[] = [];
	if (followUps.payrollCollection !== "active") {
		findings.push({ code: "payroll_collection_inactive", severity: "hold" });
	}
	counted(findings, "balance_rebuild_pending", "hold", followUps.pendingRebuildIntents);
	counted(findings, "proposals_open", "hold", followUps.openProposals);
	counted(findings, "break_adjustment_pending", "hold", followUps.pendingBreakAdjustments);
	return section({ ...followUps }, findings);
}

const VERDICT_ORDER: readonly TimePilotVerdict[] = ["ready", "hold", "blocked"];

export function assessTimePilotReadiness(snapshot: TimePilotSnapshot): TimePilotReadiness {
	const sections = {
		adoption: assessAdoption(snapshot),
		history: assessHistory(snapshot),
		approvals: assessApprovals(snapshot),
		operations: assessOperations(snapshot),
		imports: assessImports(snapshot),
		followUps: assessFollowUps(snapshot),
	};
	const verdict = Object.values(sections).reduce<TimePilotVerdict>(
		(worst, { verdict: next }) =>
			VERDICT_ORDER.indexOf(next) > VERDICT_ORDER.indexOf(worst) ? next : worst,
		"ready",
	);
	return { organizationId: snapshot.organizationId, verdict, ...sections };
}
