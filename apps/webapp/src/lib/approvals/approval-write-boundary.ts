import {
	closeSync,
	constants,
	fstatSync,
	lstatSync,
	openSync,
	readdirSync,
	readSync,
} from "node:fs";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import type {
	ApprovalSourceMutationSemantic,
	ApprovalSourceMutationUncertainty,
	ApprovalWriteOperation,
	ProtectedApprovalTable,
	ProtectedWriteTable,
	TargetedApprovalSourceTable,
} from "./approval-write-boundary-sql";
import {
	PROTECTED_APPROVAL_TABLES,
	TARGETED_APPROVAL_SOURCE_TABLES,
} from "./approval-write-boundary-sql";
import {
	analyzeApprovalWriteMutationSources,
	isApprovalWriteSchemaModuleSpecifier,
	isApprovalWriteTrustedProvenanceModuleSpecifier,
} from "./approval-write-boundary-typescript";

type ApprovalWriteOwners = Readonly<
	Record<
		string,
		Partial<
			Readonly<
				Record<ProtectedApprovalTable, readonly ApprovalWriteOperation[]>
			>
		>
	>
>;

interface ApprovalSourceWriteCapability {
	readonly columns: readonly string[];
	readonly functionName?: string;
	readonly operation: ApprovalWriteOperation;
	readonly semantic?: ApprovalSourceMutationSemantic;
	readonly table: TargetedApprovalSourceTable;
	readonly uncertainty?: ApprovalSourceMutationUncertainty;
}

type ApprovalSourceWriteOwners = Readonly<
	Record<string, readonly ApprovalSourceWriteCapability[]>
>;

interface CanonicalApprovalSourceWriteCapability
	extends ApprovalSourceWriteCapability {
	readonly uncertainty?: never;
}

type CanonicalApprovalSourceWriteOwners = Readonly<
	Record<string, readonly CanonicalApprovalSourceWriteCapability[]>
>;

export const CANONICAL_WRITE_OWNERS = {
	// Shared by the operator CLI and authenticated platform-admin maintenance action.
	"src/lib/approvals/maintenance.ts": {
		approval_chain_instance: ["delete"],
		approval_decision_evidence: ["delete"],
		approval_delivery_intent: ["delete"],
		approval_delivery_message: ["delete"],
		approval_delivery_work: ["delete"],
		approval_invocation: ["delete"],
		approval_request: ["delete"],
		approval_review_binding: ["delete"],
		approval_submitted_revision: ["delete"],
		approval_workflow: ["delete"],
	},
	// The approval delivery owner (#291): expands lifecycle intents, leases and
	// completes delivery work, and records every delivered remote message.
	"src/lib/approvals/delivery/store.ts": {
		approval_delivery_intent: ["update"],
		approval_delivery_message: ["insert", "update"],
		approval_delivery_work: ["insert", "update"],
		approval_outbox: ["update"],
	},
	// Legacy lifecycle intents (#296), written by the legacy expense, (#384)
	// absence and (#432) time submission, decision and cancellation owners in
	// their transactions, and (#408) by escalation's replacement pass for a
	// legacy transfer.
	"src/lib/approvals/delivery/intents.ts": {
		approval_delivery_intent: ["insert"],
	},
	// The gated authority read inserts a missing rollout row as `legacy` (#474).
	"src/lib/approvals/authority/gate.ts": {
		approval_workflow_rollout: ["insert"],
	},
	// Immutable invocation association, inserted by the bound decision owner.
	"src/lib/approvals/evidence/invocation.ts": {
		approval_invocation: ["insert"],
	},
	// Immutable evidence: submission/decision owners call these inserts only.
	"src/lib/approvals/evidence/store.ts": {
		approval_decision_evidence: ["insert"],
		approval_review_binding: ["insert"],
		approval_submitted_revision: ["insert"],
	},
	"scripts/approval-workflow-rollout.ts": {
		approval_workflow_rollout: ["insert", "update"],
	},
	"src/lib/approvals/outbox/writer.ts": {
		approval_outbox: ["insert"],
	},
	"src/lib/approvals/projection/writer.ts": {
		approval_inbox_projection: ["insert", "update", "delete"],
		approval_requester_projection: ["insert", "update"],
	},
	"src/lib/approvals/workflow/compatibility-writer.ts": {
		approval_chain_instance: ["insert", "update"],
		approval_chain_stage_instance: ["insert", "update"],
		approval_request: ["insert", "update", "delete"],
		approval_workflow_stage: ["update"],
	},
	// Pre-creates a new organization's legacy rollout rows in its creation
	// transaction (#359), called from the coordinated organization hooks.
	"src/lib/approvals/workflow/organization-rollout.ts": {
		approval_workflow_rollout: ["insert"],
	},
	"src/lib/approvals/workflow/repository.ts": {
		approval_stage_assignment: ["insert", "update"],
		approval_workflow: ["insert", "update"],
		approval_workflow_command: ["insert", "update"],
		approval_workflow_event: ["insert"],
		approval_workflow_stage: ["insert", "update"],
	},
} as const satisfies ApprovalWriteOwners;

// Remove each exact exception when its domain adapter migrates to canonical writes.
export const TEMPORARY_LEGACY_WRITE_EXCEPTIONS = {
	// Retain all three writes until legacy/shadow cancellation is retired.
	"src/app/[locale]/(app)/absences/mutations.ts": {
		approval_chain_instance: ["update"],
		approval_chain_stage_instance: ["update"],
		approval_request: ["delete"],
	},
	"src/lib/absences/sick-vacation-override.ts": {
		approval_request: ["insert", "update"],
	},
	// Legacy-authoritative escalation transfer (#299, #326): moves a pending
	// legacy absence or travel expense request to its replacement until legacy
	// authority of those kinds retires.
	"src/lib/approvals/escalation/legacy-transfer.ts": {
		approval_request: ["update"],
	},
	// The design's chain/stage exceptions map to these persisted instance tables.
	"src/lib/approvals/policies/chain-service.ts": {
		approval_chain_instance: ["insert", "update"],
		approval_chain_stage_instance: ["insert", "update"],
		approval_request: ["insert"],
	},
	// The policy-resolution fallback still inserts a legacy request directly.
	"src/lib/approvals/server/absence-approvals.ts": {
		approval_request: ["insert"],
	},
	"src/lib/approvals/server/shared.ts": {
		approval_request: ["update"],
	},
	// Employee withdrawal of a pending legacy travel expense report (#603):
	// retires the cycle's request and cancels its chain without a decision.
	"src/lib/approvals/server/travel-expense-report-withdrawal.ts": {
		approval_chain_instance: ["update"],
		approval_chain_stage_instance: ["update"],
		approval_request: ["update"],
	},
	"src/lib/demo/demo-data.service.ts": {
		approval_request: ["insert"],
	},
	"src/lib/teams/jobs/escalation-checker.ts": {
		approval_request: ["update"],
	},
	"src/lib/time-record/migration/backfill.ts": {
		approval_request: ["update"],
	},
	// A work period's legacy approval requests link to its attached record (#1224).
	"src/lib/time-tracking/work-records/repair.ts": {
		approval_request: ["update"],
	},
} as const satisfies ApprovalWriteOwners;

export const CANONICAL_SOURCE_WRITE_OWNERS = {
	// Absence records (`ABSENCE_RECORD_WRITERS`): the base record of an absence, never work.
	"src/app/[locale]/(app)/absences/actions.canonical.ts": [
		{
			columns: ["duration_minutes", "end_at", "start_at"],
			functionName: "updateCanonicalAbsenceRangeInTransaction",
			operation: "update",
			semantic: "ordinary_finalization",
			table: "time_record",
		},
		{
			columns: ["approval_state"],
			functionName: "syncCanonicalAbsenceApprovalStateInTransaction",
			operation: "update",
			semantic: "ordinary_finalization",
			table: "time_record",
		},
		{
			columns: [],
			functionName: "removeCanonicalAbsenceRecord",
			operation: "delete",
			table: "time_record",
		},
		{
			columns: [],
			functionName: "removeCanonicalAbsenceRecordInTransaction",
			operation: "delete",
			table: "time_record",
		},
	],
	"src/lib/absences/sick-vacation-override.ts": [
		{
			columns: ["approval_state"],
			functionName: "rejectCanonicalAbsenceInTransaction",
			operation: "update",
			semantic: "ordinary_finalization",
			table: "time_record",
		},
		{
			columns: [
				"approval_state",
				"created_by",
				"duration_minutes",
				"employee_id",
				"end_at",
				"organization_id",
				"origin",
				"record_kind",
				"start_at",
			],
			functionName: "createCanonicalAbsenceInTransaction",
			operation: "insert",
			semantic: "policy_clock_out_terminal_break",
			table: "time_record",
		},
		{
			columns: ["duration_minutes", "end_at", "start_at"],
			functionName: "updateCanonicalAbsenceRangeInTransaction",
			operation: "update",
			semantic: "ordinary_finalization",
			table: "time_record",
		},
	],
	// Approval references (`APPROVAL_REFERENCE_WRITERS`): detaching a purged workflow or legacy request.
	"src/lib/approvals/maintenance.ts": [
		{
			columns: ["approval_workflow_id"],
			functionName: "clearWorkflowSourceReferences",
			operation: "update",
			table: "work_period",
		},
		{
			columns: ["deletion_approval_request_id"],
			functionName: "deleteApprovalInTransaction",
			operation: "update",
			table: "work_period",
		},
	],
	"src/lib/approvals/server/absence-approvals.ts": [
		{
			columns: ["approval_state"],
			functionName: "syncCanonicalAbsenceApprovalStateAt",
			operation: "update",
			semantic: "ordinary_finalization",
			table: "time_record",
		},
	],
	// A correction's workflow reference, its pending correction entries, and an approved
	// correction of live work (`LIVE_WORK_WRITERS`, `PENDING_CORRECTION_WRITERS`). Completed
	// work is decided through work records (#1227).
	"src/lib/approvals/server/time-correction-approvals.ts": [
		{
			columns: ["is_superseded", "replaces_entry_id", "superseded_by_id", "type"],
			functionName: "deleteCancelledTimeCorrectionsInTransaction",
			operation: "delete",
			semantic: "inactive_correction",
			table: "time_entry",
		},
		{
			columns: ["is_superseded", "superseded_by_id"],
			functionName: "restoreHistoricalRejectedCorrection",
			operation: "update",
			semantic: "correction_lifecycle",
			table: "time_entry",
		},
		{
			columns: ["is_superseded", "superseded_by_id"],
			functionName: "applyLiveWorkCorrection",
			operation: "update",
			semantic: "correction_lifecycle",
			table: "time_entry",
		},
		{
			columns: [
				"clock_in_id",
				"driven_distance_km",
				"graph_revision",
				"odometer_end_km",
				"odometer_start_km",
				"start_time",
				"vehicle_id",
				"vehicle_kind",
				"work_category_id",
				"work_location_type",
			],
			functionName: "applyLiveWorkCorrection",
			operation: "update",
			semantic: "live_work",
			table: "work_period",
		},
		{
			columns: ["approval_workflow_id"],
			functionName: "bindTimeCorrectionWorkflowToWorkPeriod",
			operation: "update",
			table: "work_period",
		},
		{
			columns: [
				"created_by",
				"device_info",
				"employee_id",
				"hash",
				"id",
				"ip_address",
				"is_superseded",
				"location",
				"organization_id",
				"previous_entry_id",
				"previous_hash",
				"replaces_entry_id",
				"superseded_by_id",
				"timestamp",
				"timezone",
				"timezone_source",
				"type",
				"utc_offset_minutes",
			],
			functionName: "insertTimeCorrectionSourceEntry",
			operation: "insert",
			semantic: "correction",
			table: "time_entry",
		},
	],
	// A resubmission replaces the employee's inactive pending correction entries.
	"src/lib/approvals/server/time-correction-submission.ts": [
		{
			columns: ["is_superseded", "replaces_entry_id", "superseded_by_id", "type"],
			functionName: "submitCorrectionInTransaction",
			operation: "delete",
			semantic: "inactive_correction",
			table: "time_entry",
		},
	],
	"src/lib/approvals/server/work-period-approvals.ts": [
		{
			columns: ["approval_workflow_id"],
			functionName: "bindPreCanonicalOrdinaryWorkflow",
			operation: "update",
			table: "work_period",
		},
	],
	"src/lib/approvals/server/work-period-submission.ts": [
		{
			columns: ["approval_workflow_id"],
			functionName: "bindSourceWorkflow",
			operation: "update",
			table: "work_period",
		},
	],
	// Demo pending corrections replace their inactive entries.
	"src/lib/demo/demo-data.service.ts": [
		{
			columns: ["is_superseded", "replaces_entry_id", "superseded_by_id", "type"],
			functionName: "generateDemoPendingTimeCorrectionApprovals",
			operation: "delete",
			semantic: "inactive_correction",
			table: "time_entry",
		},
	],
	// Live work's attribution (`LIVE_WORK_WRITERS`); completed work amends through work records.
	"src/lib/time-tracking/amend-completed-work.ts": [
		{
			columns: [
				"driven_distance_km",
				"graph_revision",
				"is_billable",
				"odometer_end_km",
				"odometer_start_km",
				"project_id",
				"task_id",
				"vehicle_id",
				"vehicle_kind",
				"work_category_id",
				"work_location_type",
			],
			functionName: "amendActiveAttribution",
			operation: "update",
			semantic: "live_work",
			table: "work_period",
		},
	],
	// Clocking's store starts live work (ADR 0002): clock-in, the legacy break's resume, open imports.
	"src/lib/time-tracking/clocking-core.ts": [
		{
			columns: [
				"created_by",
				"device_info",
				"employee_id",
				"hash",
				"id",
				"ip_address",
				"location",
				"organization_id",
				"previous_entry_id",
				"previous_hash",
				"timestamp",
				"timezone",
				"timezone_source",
				"type",
				"utc_offset_minutes",
			],
			functionName: "insertEntry",
			operation: "insert",
			table: "time_entry",
		},
		{
			columns: [
				"approval_status",
				"clock_in_id",
				"employee_id",
				"graph_revision",
				"is_active",
				"is_billable",
				"organization_id",
				"project_id",
				"start_time",
				"task_id",
				"work_category_id",
				"work_location_type",
			],
			functionName: "insertActivePeriod",
			operation: "insert",
			table: "work_period",
		},
	],
	// A break in progress on live work (#861); work records clears it when the work completes.
	"src/lib/time-tracking/clocking/break-in-progress.ts": [
		{
			columns: ["break_started_at", "break_started_operation_id", "break_started_zone"],
			functionName: "recordBreakInProgress",
			operation: "update",
			semantic: "live_work",
			table: "work_period",
		},
	],
	// Vehicle use of live work at its start (#1122).
	"src/lib/time-tracking/clocking/vehicle-use.ts": [
		{
			columns: [
				"driven_distance_km",
				"odometer_end_km",
				"odometer_start_km",
				"vehicle_id",
				"vehicle_kind",
			],
			functionName: "writeLive",
			operation: "update",
			semantic: "live_work",
			table: "work_period",
		},
	],
	// The employee's change of live work's vehicle use, legacy admission (#1122).
	"src/lib/time-tracking/vehicle-use/live-vehicle-use.ts": [
		{
			columns: [
				"driven_distance_km",
				"odometer_end_km",
				"odometer_start_km",
				"vehicle_id",
				"vehicle_kind",
			],
			functionName: "changeLiveWorkVehicleUse",
			operation: "update",
			semantic: "live_work",
			table: "work_period",
		},
	],
	// Work records (ADR 0010, #1225-#1227) amends times, work attribution and approval state of
	// one completed pair together, compare-and-set against the locked pair; an endpoint already
	// recorded as a pending correction is adopted.
	"src/lib/time-tracking/work-records/amend.ts": [
		{
			columns: ["is_superseded", "superseded_by_id"],
			functionName: "adoptRecordedEntry",
			operation: "update",
			semantic: "correction_lifecycle",
			table: "time_entry",
		},
		{
			columns: [
				"approval_status",
				"clock_in_id",
				"clock_out_id",
				"driven_distance_km",
				"duration_minutes",
				"end_time",
				"graph_revision",
				"is_billable",
				"missing_task",
				"odometer_end_km",
				"odometer_start_km",
				"pending_changes",
				"project_id",
				"start_time",
				"task_id",
				"vehicle_id",
				"vehicle_kind",
				"work_category_id",
				"work_location_type",
			],
			functionName: "writeAmendedPair",
			operation: "update",
			table: "work_period",
		},
		{
			columns: ["approval_state", "duration_minutes", "end_at", "start_at"],
			functionName: "writeAmendedPair",
			operation: "update",
			semantic: "ordinary_finalization",
			table: "time_record",
		},
	],
	// Work records (ADR 0010, #1223) creates new completed work: manual, imported and demo work.
	"src/lib/time-tracking/work-records/create-new.ts": [
		{
			columns: [
				"approval_status",
				"canonical_record_id",
				"clock_in_id",
				"clock_out_id",
				"driven_distance_km",
				"duration_minutes",
				"employee_id",
				"end_time",
				"graph_revision",
				"id",
				"is_active",
				"is_billable",
				"odometer_end_km",
				"odometer_start_km",
				"organization_id",
				"pending_changes",
				"project_id",
				"start_time",
				"task_id",
				"vehicle_id",
				"vehicle_kind",
				"work_category_id",
				"work_location_type",
			],
			functionName: "insertNewWorkPeriod",
			operation: "insert",
			table: "work_period",
		},
	],
	// Work records (ADR 0010, #1222) creates completed work from live work at every closure,
	// clearing a break in progress, and writes the canonical work record of every creation.
	"src/lib/time-tracking/work-records/create.ts": [
		{
			columns: [
				"approval_state",
				"created_by",
				"duration_minutes",
				"employee_id",
				"end_at",
				"organization_id",
				"origin",
				"record_kind",
				"start_at",
			],
			functionName: "insertCanonicalRecord",
			operation: "insert",
			semantic: "policy_clock_out_terminal_break",
			table: "time_record",
		},
		{
			columns: [
				"computation_metadata",
				"driven_distance_km",
				"odometer_end_km",
				"odometer_start_km",
				"organization_id",
				"record_id",
				"record_kind",
				"vehicle_id",
				"vehicle_kind",
				"work_category_id",
				"work_location_type",
			],
			functionName: "insertCanonicalRecord",
			operation: "insert",
			semantic: "policy_clock_out_terminal_break",
			table: "time_record_work",
		},
		{
			columns: [
				"approval_status",
				"break_started_at",
				"break_started_zone",
				"canonical_record_id",
				"clock_out_id",
				"driven_distance_km",
				"duration_minutes",
				"end_time",
				"graph_revision",
				"is_active",
				"is_billable",
				"missing_task",
				"odometer_end_km",
				"odometer_start_km",
				"pending_changes",
				"project_id",
				"task_id",
				"vehicle_id",
				"vehicle_kind",
				"work_category_id",
				"work_location_type",
			],
			functionName: "closeLiveWorkPeriod",
			operation: "update",
			semantic: "live_work",
			table: "work_period",
		},
	],
	// Work records (ADR 0010, #1227) soft-deletes completed work for an approved business deletion.
	"src/lib/time-tracking/work-records/delete.ts": [
		{
			columns: [
				"clock_in_id",
				"clock_out_id",
				"deleted_at",
				"deleted_by",
				"deletion_approval_request_id",
				"deletion_reason",
				"duration_minutes",
				"end_time",
				"graph_revision",
				"start_time",
			],
			functionName: "deleteWorkRecord",
			operation: "update",
			table: "work_period",
		},
		{
			columns: ["duration_minutes", "end_at", "start_at"],
			functionName: "deleteWorkRecord",
			operation: "update",
			semantic: "ordinary_finalization",
			table: "time_record",
		},
	],
	// Work records (ADR 0010, #1218-#1221) divides one completed pair: calendar splits and owed breaks.
	"src/lib/time-tracking/work-records/divide.ts": [
		{
			columns: [
				"auto_adjusted_at",
				"auto_adjustment_reason",
				"clock_out_id",
				"driven_distance_km",
				"duration_minutes",
				"end_time",
				"graph_revision",
				"is_billable",
				"missing_task",
				"odometer_end_km",
				"odometer_start_km",
				"original_duration_minutes",
				"original_end_time",
				"project_id",
				"task_id",
				"vehicle_id",
				"vehicle_kind",
				"was_auto_adjusted",
				"work_category_id",
				"work_location_type",
			],
			functionName: "writeRetainedHalf",
			operation: "update",
			table: "work_period",
		},
		{
			columns: ["duration_minutes", "end_at"],
			functionName: "writeRetainedHalf",
			operation: "update",
			semantic: "ordinary_finalization",
			table: "time_record",
		},
		{
			columns: [
				"approval_state",
				"created_by",
				"duration_minutes",
				"employee_id",
				"end_at",
				"id",
				"organization_id",
				"origin",
				"record_kind",
				"start_at",
			],
			functionName: "writeGeneratedHalf",
			operation: "insert",
			semantic: "policy_clock_out_terminal_break",
			table: "time_record",
		},
		{
			columns: [
				"computation_metadata",
				"driven_distance_km",
				"odometer_end_km",
				"odometer_start_km",
				"organization_id",
				"record_id",
				"record_kind",
				"vehicle_id",
				"vehicle_kind",
				"work_category_id",
				"work_location_type",
			],
			functionName: "writeGeneratedHalf",
			operation: "insert",
			semantic: "policy_clock_out_terminal_break",
			table: "time_record_work",
		},
		{
			columns: [
				"approval_status",
				"auto_adjusted_at",
				"auto_adjustment_reason",
				"canonical_record_id",
				"clock_in_id",
				"clock_out_id",
				"driven_distance_km",
				"duration_minutes",
				"employee_id",
				"end_time",
				"graph_revision",
				"is_active",
				"is_billable",
				"missing_task",
				"odometer_end_km",
				"odometer_start_km",
				"organization_id",
				"project_id",
				"start_time",
				"task_id",
				"vehicle_id",
				"vehicle_kind",
				"was_auto_adjusted",
				"work_category_id",
				"work_location_type",
			],
			functionName: "writeGeneratedHalf",
			operation: "insert",
			table: "work_period",
		},
	],
	// Work records' entry writers append a change's entries in either admission (#1219, #1225).
	"src/lib/time-tracking/work-records/entry-writer.ts": [
		{
			columns: [
				"created_at",
				"created_by",
				"device_info",
				"employee_id",
				"hash",
				"id",
				"ip_address",
				"organization_id",
				"previous_entry_id",
				"previous_hash",
				"replaces_entry_id",
				"timestamp",
				"timezone",
				"timezone_source",
				"type",
				"utc_offset_minutes",
			],
			functionName: "insertAppendedEntry",
			operation: "insert",
			semantic: "correction_lifecycle",
			table: "time_entry",
		},
		{
			columns: ["is_superseded", "superseded_by_id"],
			functionName: "supersedeEndpoint",
			operation: "update",
			semantic: "correction_lifecycle",
			table: "time_entry",
		},
	],
	// Work records erases an employee's whole work history (demo cleanup, #1223).
	"src/lib/time-tracking/work-records/erase-history.ts": [
		{
			columns: [],
			functionName: "eraseEmployeeWorkHistory",
			operation: "delete",
			table: "time_entry",
		},
		{
			columns: [],
			functionName: "eraseEmployeeWorkHistory",
			operation: "delete",
			table: "work_period",
		},
		{
			columns: [],
			functionName: "eraseEmployeeWorkHistory",
			operation: "delete",
			table: "time_record",
		},
	],
	// Work records corrects the open canonical work record some history gave live work (#1230).
	"src/lib/time-tracking/work-records/open-record.ts": [
		{
			columns: ["start_at"],
			functionName: "correctOpenWorkRecord",
			operation: "update",
			semantic: "ordinary_finalization",
			table: "time_record",
		},
		{
			columns: [
				"driven_distance_km",
				"odometer_end_km",
				"odometer_start_km",
				"vehicle_id",
				"vehicle_kind",
				"work_category_id",
				"work_location_type",
			],
			functionName: "correctOpenWorkRecord",
			operation: "update",
			table: "time_record_work",
		},
	],
	// Work records' one pair writer (ADR 0010): the canonical detail and project allocation
	// every operation writes as planned.
	"src/lib/time-tracking/work-records/pair-writer.ts": [
		{
			columns: [
				"allocation_kind",
				"cost_center_id",
				"is_billable",
				"missing_task",
				"organization_id",
				"project_id",
				"record_id",
				"task_id",
				"weight_percent",
			],
			functionName: "insertAllocations",
			operation: "insert",
			semantic: "policy_clock_out_terminal_break",
			table: "time_record_allocation",
		},
		{
			columns: [
				"driven_distance_km",
				"odometer_end_km",
				"odometer_start_km",
				"vehicle_id",
				"vehicle_kind",
				"work_category_id",
				"work_location_type",
			],
			functionName: "writeCanonicalDetail",
			operation: "update",
			table: "time_record_work",
		},
		{
			columns: [],
			functionName: "replaceProjectAllocation",
			operation: "delete",
			table: "time_record_allocation",
		},
	],
	// Work records (ADR 0010, #1224, #1226) attaches a missing canonical work record and repairs a pair.
	"src/lib/time-tracking/work-records/repair.ts": [
		{
			columns: [
				"approval_state",
				"created_by",
				"duration_minutes",
				"employee_id",
				"end_at",
				"id",
				"organization_id",
				"origin",
				"record_kind",
				"start_at",
			],
			functionName: "attachWorkRecord",
			operation: "insert",
			semantic: "policy_clock_out_terminal_break",
			table: "time_record",
		},
		{
			columns: [
				"computation_metadata",
				"driven_distance_km",
				"odometer_end_km",
				"odometer_start_km",
				"organization_id",
				"record_id",
				"record_kind",
				"vehicle_id",
				"vehicle_kind",
				"work_category_id",
				"work_location_type",
			],
			functionName: "attachWorkRecord",
			operation: "insert",
			semantic: "policy_clock_out_terminal_break",
			table: "time_record_work",
		},
		{
			columns: ["duration_minutes", "end_at", "start_at"],
			functionName: "repairWorkRecord",
			operation: "update",
			semantic: "ordinary_finalization",
			table: "time_record",
		},
		{
			columns: [
				"computation_metadata",
				"driven_distance_km",
				"odometer_end_km",
				"odometer_start_km",
				"organization_id",
				"record_id",
				"record_kind",
				"vehicle_id",
				"vehicle_kind",
				"work_category_id",
				"work_location_type",
			],
			functionName: "insertDetail",
			operation: "insert",
			semantic: "policy_clock_out_terminal_break",
			table: "time_record_work",
		},
		{
			columns: [
				"canonical_record_id",
				"driven_distance_km",
				"duration_minutes",
				"end_time",
				"graph_revision",
				"is_billable",
				"missing_task",
				"odometer_end_km",
				"odometer_start_km",
				"project_id",
				"task_id",
				"vehicle_id",
				"vehicle_kind",
				"work_category_id",
				"work_location_type",
			],
			functionName: "writeRepairedPeriod",
			operation: "update",
			table: "work_period",
		},
	],
	// Work records advances a period's revision for a pending correction's transition (#1230).
	"src/lib/time-tracking/work-records/revision.ts": [
		{
			columns: ["graph_revision"],
			functionName: "advanceWorkRevision",
			operation: "update",
			table: "work_period",
		},
	],
} as const satisfies CanonicalApprovalSourceWriteOwners;

// Writes whose payload the analyzer cannot resolve, scoped to their named function.
export const SOURCE_WRITE_EXCEPTIONS = {
	// Absence records (`ABSENCE_RECORD_WRITERS`): the base record of an absence, never work.
	"src/app/[locale]/(app)/absences/actions.canonical.ts": [
		{
			columns: [],
			functionName: "create",
			operation: "insert",
			semantic: "policy_clock_out_terminal_break",
			table: "time_record",
			uncertainty: "dynamic_payload",
		},
	],
	"src/app/[locale]/(app)/absences/request-absence-effect.ts": [
		{
			columns: [],
			functionName: "createRecords",
			operation: "insert",
			semantic: "policy_clock_out_terminal_break",
			table: "time_record",
			uncertainty: "dynamic_payload",
		},
	],
	"src/app/[locale]/(app)/team/absences/actions.ts": [
		{
			columns: [],
			functionName: "createManagerAbsenceRecords",
			operation: "insert",
			semantic: "policy_clock_out_terminal_break",
			table: "time_record",
			uncertainty: "dynamic_payload",
		},
	],
	"src/lib/time-record/migration/backfill.ts": [
		{
			columns: [],
			functionName: "upsertCanonicalAbsenceRecords",
			operation: "insert",
			semantic: "policy_clock_out_terminal_break",
			table: "time_record",
			uncertainty: "dynamic_payload",
		},
	],
} as const satisfies ApprovalSourceWriteOwners;

/**
 * The work records seam (Time Tracking ADR 0010). Only work records writes the
 * canonical work record and completed work; besides it only Clocking's live-work
 * functions write work periods and time entries (ADR 0002), and they never write a
 * work period that has ended. SQL migrations are the only exemption (they are not
 * scanned). The few other writers of these tables are named below by what they
 * write, none of it completed work.
 */
export const WORK_RECORDS_MODULE = "src/lib/time-tracking/work-records/";

type NamedSourceWriters = Readonly<Record<string, readonly string[]>>;

/**
 * Live work (ADR 0002): starting it, its clock-in entry, a break in progress, live
 * vehicle use and attribution, and an approved correction of it. Each writes only
 * work that has not ended: an update names the live work in its own `where`, and
 * nothing here sets an end. Work records takes the work over at its closure (#1222).
 */
export const LIVE_WORK_WRITERS = {
	// Clocking's store: every live start (clock-in, the legacy break's resume, open imports).
	"src/lib/time-tracking/clocking-core.ts": ["insertActivePeriod", "insertEntry"],
	"src/lib/time-tracking/clocking/break-in-progress.ts": ["recordBreakInProgress"],
	"src/lib/time-tracking/clocking/vehicle-use.ts": ["writeLive"],
	"src/lib/time-tracking/vehicle-use/live-vehicle-use.ts": ["changeLiveWorkVehicleUse"],
	"src/lib/time-tracking/amend-completed-work.ts": ["amendActiveAttribution"],
	"src/lib/approvals/server/time-correction-approvals.ts": ["applyLiveWorkCorrection"],
} as const satisfies NamedSourceWriters;

/**
 * Pending corrections are not completed work: an employee's submitted correction
 * entries wait inactive until a decision. These functions write only correction
 * entries and their lineage: submitting, replacing, cancelling and rejecting them,
 * and activating one on live work. An approved correction of completed work is
 * adopted by work records (#1226, #1227).
 */
export const PENDING_CORRECTION_WRITERS = {
	"src/lib/approvals/server/time-correction-approvals.ts": [
		"applyLiveWorkCorrection",
		"deleteCancelledTimeCorrectionsInTransaction",
		"insertTimeCorrectionSourceEntry",
		"restoreHistoricalRejectedCorrection",
	],
	"src/lib/approvals/server/time-correction-submission.ts": [
		"submitCorrectionInTransaction",
	],
	"src/lib/demo/demo-data.service.ts": ["generateDemoPendingTimeCorrectionApprovals"],
} as const satisfies NamedSourceWriters;

/**
 * Approvals' references on a work period: the workflow deciding it and a legacy
 * deletion request. They link the work to a decision and change none of it.
 */
export const APPROVAL_REFERENCE_WRITERS = {
	"src/lib/approvals/maintenance.ts": [
		"clearWorkflowSourceReferences",
		"deleteApprovalInTransaction",
	],
	"src/lib/approvals/server/time-correction-approvals.ts": [
		"bindTimeCorrectionWorkflowToWorkPeriod",
	],
	"src/lib/approvals/server/work-period-approvals.ts": ["bindPreCanonicalOrdinaryWorkflow"],
	"src/lib/approvals/server/work-period-submission.ts": ["bindSourceWorkflow"],
} as const satisfies NamedSourceWriters;
const APPROVAL_REFERENCE_COLUMNS = new Set([
	"approval_workflow_id",
	"deletion_approval_request_id",
]);

/**
 * Absences share the base `time_record` table with work, as their own record kind;
 * they never write its work detail or allocations, nor work periods.
 */
export const ABSENCE_RECORD_WRITERS = {
	"src/app/[locale]/(app)/absences/actions.canonical.ts": [
		"create",
		"removeCanonicalAbsenceRecord",
		"removeCanonicalAbsenceRecordInTransaction",
		"syncCanonicalAbsenceApprovalStateInTransaction",
		"updateCanonicalAbsenceRangeInTransaction",
	],
	"src/app/[locale]/(app)/absences/request-absence-effect.ts": ["createRecords"],
	"src/app/[locale]/(app)/team/absences/actions.ts": ["createManagerAbsenceRecords"],
	"src/lib/absences/sick-vacation-override.ts": [
		"createCanonicalAbsenceInTransaction",
		"rejectCanonicalAbsenceInTransaction",
		"updateCanonicalAbsenceRangeInTransaction",
	],
	"src/lib/approvals/server/absence-approvals.ts": ["syncCanonicalAbsenceApprovalStateAt"],
	"src/lib/time-record/migration/backfill.ts": ["upsertCanonicalAbsenceRecords"],
} as const satisfies NamedSourceWriters;

/** The base record columns an absence's range or decision changes. */
const ABSENCE_RECORD_UPDATE_COLUMNS = new Set([
	"approval_state",
	"duration_minutes",
	"end_at",
	"start_at",
]);

/**
 * A named absence writer is allowed by what it writes, not by its name alone
 * (spec-3 L2): an insert names its record kind (or is a dynamic absence
 * payload), an update changes only an absence's range or approval state, a
 * delete removes its record. Anything else could change a work record.
 */
function absenceRecordViolation(
	path: string,
	writer: string,
	write: {
		columns?: readonly string[];
		operation: ApprovalWriteOperation;
		uncertainty?: ApprovalSourceMutationUncertainty;
	},
): string | null {
	const columns = write.columns ?? [];
	if (write.operation === "delete") return null;
	if (write.operation === "insert") {
		return write.uncertainty !== undefined || columns.includes("record_kind")
			? null
			: `${SEAM}: absence writer ${writer} in ${path} must name the record_kind it inserts.`;
	}
	return write.uncertainty === undefined &&
		columns.length > 0 &&
		columns.every((column) => ABSENCE_RECORD_UPDATE_COLUMNS.has(column))
		? null
		: `${SEAM}: absence writer ${writer} in ${path} may change only an absence record's range and approval state.`;
}

/** Columns that end a work period, which live work never sets. */
const WORK_PERIOD_END_COLUMNS = new Set([
	"clock_out_id",
	"duration_minutes",
	"end_time",
	"is_active",
]);
const PENDING_CORRECTION_SEMANTICS = new Set<ApprovalSourceMutationSemantic | undefined>([
	"correction",
	"correction_lifecycle",
	"inactive_correction",
]);

function namedIn(
	writers: NamedSourceWriters,
	path: string,
	functionName: string | undefined,
): boolean {
	return functionName !== undefined && Boolean(writers[path]?.includes(functionName));
}

const SEAM = "Time Tracking ADR 0010 (work records)";

/**
 * Why a write of the work tables breaks the work records seam, or null when the
 * seam allows it. Applies to every source-table write the scanner finds and to
 * every capability the inventory declares; a declared write must also pass it.
 */
export function workRecordsSeamViolation(
	path: string,
	write: {
		columns?: readonly string[];
		functionName?: string;
		operation: ApprovalWriteOperation;
		semantic?: ApprovalSourceMutationSemantic;
		table: ProtectedWriteTable;
		uncertainty?: ApprovalSourceMutationUncertainty;
	},
): string | null {
	const { functionName, table } = write;
	if (
		!TARGETED_APPROVAL_SOURCE_TABLES.includes(table as TargetedApprovalSourceTable)
	) {
		return null;
	}
	if (path.startsWith(WORK_RECORDS_MODULE)) return null;
	const writer = functionName ?? "<anonymous>";
	if (table === "time_record_work" || table === "time_record_allocation") {
		return `${SEAM}: only work records may write ${table}; ${writer} in ${path} must go through work records.`;
	}
	if (table === "time_record") {
		return namedIn(ABSENCE_RECORD_WRITERS, path, functionName)
			? absenceRecordViolation(path, writer, write)
			: `${SEAM}: only work records may write the canonical work record (time_record); ${writer} in ${path} must go through work records.`;
	}
	const columns = write.columns ?? [];
	const live = namedIn(LIVE_WORK_WRITERS, path, functionName);
	if (table === "time_entry") {
		const pendingCorrection =
			namedIn(PENDING_CORRECTION_WRITERS, path, functionName) &&
			PENDING_CORRECTION_SEMANTICS.has(write.semantic) &&
			write.uncertainty === undefined;
		const liveEntry =
			live &&
			write.operation === "insert" &&
			write.semantic === undefined &&
			write.uncertainty === undefined;
		return pendingCorrection || liveEntry
			? null
			: `${SEAM}: only work records and Clocking's named live-work functions may write time_entry (pending correction entries aside); ${writer} in ${path} is neither.`;
	}
	// work_period
	if (
		namedIn(APPROVAL_REFERENCE_WRITERS, path, functionName) &&
		write.operation === "update" &&
		write.uncertainty === undefined &&
		columns.length > 0 &&
		columns.every((column) => APPROVAL_REFERENCE_COLUMNS.has(column))
	) {
		return null;
	}
	if (!live) {
		return `${SEAM}: only work records and Clocking's named live-work functions may write work_period; ${writer} in ${path} is neither.`;
	}
	const ended = (reason: string) =>
		`${SEAM}: live-work function ${writer} in ${path} must never write a work period that has ended (${reason}).`;
	if (write.uncertainty !== undefined) return ended("its payload is not static");
	if (write.operation === "delete") return ended("it deletes work periods");
	const ending = columns.filter((column) =>
		write.operation === "insert"
			? column !== "is_active" && WORK_PERIOD_END_COLUMNS.has(column)
			: WORK_PERIOD_END_COLUMNS.has(column),
	);
	if (ending.length > 0) return ended(`it sets ${ending.join(", ")}`);
	if (write.operation === "update" && write.semantic !== "live_work") {
		return ended("its update's own where does not limit it to live work");
	}
	return null;
}

export interface ApprovalWriteBoundaryMutationViolation {
	column: number;
	columns?: readonly string[];
	functionName?: string;
	kind: "mutation";
	line: number;
	operation: ApprovalWriteOperation;
	path: string;
	semantic?: ApprovalSourceMutationSemantic;
	table: ProtectedWriteTable;
	uncertainty?: ApprovalSourceMutationUncertainty;
	/** Why the write breaks the work records seam (Time Tracking ADR 0010). */
	violation?: string;
}

export interface ApprovalWriteBoundaryError {
	column: number;
	detail: string;
	error: "analysis" | "read" | "root" | "traversal";
	kind: "error";
	line: number;
	path: string;
}

export type ApprovalWriteBoundaryFinding =
	| ApprovalWriteBoundaryError
	| ApprovalWriteBoundaryMutationViolation;

export interface ScanApprovalWriteBoundaryOptions {
	readonly roots: readonly string[];
	readonly workspaceRoot: string;
}

const PRODUCTION_SOURCE = /\.[cm]?[jt]sx?$/;
const TEST_SOURCE = /\.(?:test|spec)\.[cm]?[jt]sx?$/;
const MAX_PRODUCTION_FILES = 4_096;
const MAX_SOURCE_BYTES = 2 * 1024 * 1024;
const MAX_TOTAL_SOURCE_BYTES = 32 * 1024 * 1024;
const APPROVAL_TABLE_PREFILTER =
	/approval_(?:assignment|chain|command|decision|delivery|event|evidence|inbox|invocation|migration|outbox|presentation|projection|request|requester|review|rollout|stage|submitted|workflow)/i;
const APPROVAL_TABLE_SYMBOL_PREFILTER =
	/approval(?:Chain|Decision|Delivery|Evidence|Inbox|Invocation|Outbox|Presentation|Request|Requester|Review|Stage|Submitted|Workflow)/;
const COMPOSED_APPROVAL_TABLE_PREFILTER =
	/approval_?["'`+\s]+(?:assignment|chain|command|decision|delivery|event|evidence|inbox|invocation|migration|outbox|presentation|projection|request|review|rollout|stage|submitted|workflow)/i;
const SOURCE_TABLE_PREFILTER = /time_entry|work_period|time_record/i;
const SOURCE_TABLE_SYMBOL_PREFILTER = /timeEntry|workPeriod|timeRecord/;
const RAW_SQL_SURFACE_PREFILTER =
	/\.(?:execute|query)\s*\(|\[\s*["'`](?:execute|query|raw)["'`]\s*\]|\.raw\b|\b(?:execute|query|raw)\s*\(/i;
const TAGGED_TEMPLATE_SURFACE_PREFILTER = /(?:\b[A-Za-z_$][\w$]*|\]|\))\s*`/;
const DRIZZLE_WRITE_PREFILTER =
	/\.(?:delete|insert|update)\b|\[\s*["'`](?:delete|insert|update)["'`]\s*\]/i;
const TRUSTED_MUTATION_VOCABULARY_PREFILTER =
	/\b(?:delete|execute|insert|query|raw|sql|update)\b/i;
const IDENTIFIER_UNICODE_ESCAPE = /\\u(?:[0-9A-Fa-f]{4}|\{[0-9A-Fa-f]{1,6}\})/;
const INCOMPLETE_SOURCE_PREFILTER = /(?:[([{=,:?+*/-]|=>)\s*$/;
const RAW_SQL_OPERATIONS = ["insert", "update", "delete"] as const;
const PROTECTED_SQL_TABLES = [
	...PROTECTED_APPROVAL_TABLES,
	...TARGETED_APPROVAL_SOURCE_TABLES,
] as const;

interface SourceCandidate {
	dev: number;
	fileName: string;
	ino: number;
}

function compareAscii(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

function normalizePath(path: string): string {
	return path.replaceAll("\\", "/");
}

interface LiteralExtraction {
	fragments: string[];
	uncertain: boolean;
}

function extractLiteralFragments(source: string): LiteralExtraction {
	const fragments: string[] = [];
	let index = 0;
	let uncertain = false;

	const readEscape = (): string | null => {
		index += 1;
		if (index >= source.length) return null;
		const escaped = source[index];
		index += 1;
		if (escaped === "\n") return "";
		if (escaped === "\r") {
			if (source[index] === "\n") index += 1;
			return "";
		}
		if (escaped && /[^A-Za-z0-9]/.test(escaped)) return escaped;
		if (escaped === "b") return "\b";
		if (escaped === "f") return "\f";
		if (escaped === "n") return "\n";
		if (escaped === "r") return "\r";
		if (escaped === "t") return "\t";
		if (escaped === "v") return "\v";
		if (escaped === "0" && !/[0-9]/.test(source[index] ?? "")) return "\0";
		if (escaped === "x") {
			const digits = source.slice(index, index + 2);
			if (!/^[0-9A-Fa-f]{2}$/.test(digits)) return null;
			index += 2;
			return String.fromCodePoint(Number.parseInt(digits, 16));
		}
		if (escaped === "u") {
			if (source[index] === "{") {
				const close = source.indexOf("}", index + 1);
				if (close === -1) return null;
				const digits = source.slice(index + 1, close);
				if (!/^[0-9A-Fa-f]{1,6}$/.test(digits)) return null;
				const codePoint = Number.parseInt(digits, 16);
				if (codePoint > 0x10ffff) return null;
				index = close + 1;
				return String.fromCodePoint(codePoint);
			}
			const digits = source.slice(index, index + 4);
			if (!/^[0-9A-Fa-f]{4}$/.test(digits)) return null;
			index += 4;
			return String.fromCharCode(Number.parseInt(digits, 16));
		}
		return null;
	};

	const readQuoted = (quote: "'" | '"'): boolean => {
		index += 1;
		let text = "";
		while (index < source.length) {
			const character = source[index];
			if (character === quote) {
				index += 1;
				fragments.push(text);
				return true;
			}
			if (character === "\\") {
				const decoded = readEscape();
				if (decoded === null) {
					uncertain = true;
					continue;
				}
				text += decoded;
				continue;
			}
			if (character === "\n" || character === "\r") return false;
			text += character;
			index += 1;
		}
		return false;
	};

	let scanCode: (templateExpression?: boolean) => boolean;
	const readTemplate = (): boolean => {
		index += 1;
		let text = "";
		while (index < source.length) {
			const character = source[index];
			if (character === "`") {
				index += 1;
				fragments.push(text);
				return true;
			}
			if (character === "\\") {
				const decoded = readEscape();
				if (decoded === null) {
					uncertain = true;
					continue;
				}
				text += decoded;
				continue;
			}
			if (character === "$" && source[index + 1] === "{") {
				fragments.push(text);
				text = "";
				index += 2;
				if (!scanCode(true)) return false;
				continue;
			}
			text += character;
			index += 1;
		}
		return false;
	};

	scanCode = (templateExpression = false): boolean => {
		let braceDepth = 0;
		while (index < source.length) {
			const character = source[index];
			if (templateExpression && character === "}" && braceDepth === 0) {
				index += 1;
				return true;
			}
			if (character === "'") {
				if (!readQuoted("'")) return false;
				continue;
			}
			if (character === '"') {
				if (!readQuoted('"')) return false;
				continue;
			}
			if (character === "`") {
				if (!readTemplate()) return false;
				continue;
			}
			if (character === "/" && source[index + 1] === "/") {
				index += 2;
				while (index < source.length && !/[\r\n]/.test(source[index] ?? "")) {
					index += 1;
				}
				continue;
			}
			if (character === "/" && source[index + 1] === "*") {
				const close = source.indexOf("*/", index + 2);
				if (close === -1) return false;
				index = close + 2;
				continue;
			}
			if (character === "/") {
				uncertain = true;
				index += 1;
				continue;
			}
			if (templateExpression && character === "{") braceDepth += 1;
			else if (templateExpression && character === "}") braceDepth -= 1;
			index += 1;
		}
		return !templateExpression;
	};

	if (!scanCode()) uncertain = true;
	return { fragments, uncertain };
}

function fragmentsCanCompose(
	target: string,
	fragments: readonly string[],
): boolean {
	const normalizedTarget = target.toLowerCase();
	const pieces = new Set<string>();
	for (const value of fragments) {
		const fragment = value.toLowerCase().trim();
		if (!fragment) continue;
		if (fragment.includes(normalizedTarget)) return true;
		for (let start = 0; start < fragment.length; start += 1) {
			for (let end = start + 1; end <= fragment.length; end += 1) {
				if (start !== 0 && end !== fragment.length) continue;
				const piece = fragment.slice(start, end);
				if (normalizedTarget.includes(piece)) pieces.add(piece);
			}
		}
	}
	const reachable = new Set([0]);
	for (let position = 0; position < normalizedTarget.length; position += 1) {
		if (!reachable.has(position)) continue;
		for (const piece of pieces) {
			if (normalizedTarget.startsWith(piece, position)) {
				reachable.add(position + piece.length);
			}
		}
	}
	return reachable.has(normalizedTarget.length);
}

function hasComposableProtectedSql(
	source: string,
	hasProtectedTableSymbol: boolean,
	extraction = extractLiteralFragments(source),
): boolean {
	if (extraction.uncertain) return true;
	const { fragments } = extraction;
	const hasOperation = RAW_SQL_OPERATIONS.some((operation) =>
		fragmentsCanCompose(operation, fragments),
	);
	const hasTable =
		hasProtectedTableSymbol ||
		PROTECTED_SQL_TABLES.some((table) => fragmentsCanCompose(table, fragments));
	return hasOperation && hasTable;
}

function hasAnalysisCandidate(source: string, fileName: string): boolean {
	const extraction = extractLiteralFragments(source);
	const hasTrustedModule = extraction.fragments.some((moduleName) =>
		isApprovalWriteTrustedProvenanceModuleSpecifier(moduleName, fileName),
	);
	const hasSchemaModule = extraction.fragments.some((moduleName) =>
		isApprovalWriteSchemaModuleSpecifier(moduleName, fileName),
	);
	if (hasTrustedModule && IDENTIFIER_UNICODE_ESCAPE.test(source)) return true;
	const hasRawSqlSurface =
		hasTrustedModule &&
		(RAW_SQL_SURFACE_PREFILTER.test(source) ||
			TAGGED_TEMPLATE_SURFACE_PREFILTER.test(source));
	const hasProtectedTableText =
		APPROVAL_TABLE_PREFILTER.test(source) ||
		COMPOSED_APPROVAL_TABLE_PREFILTER.test(source) ||
		SOURCE_TABLE_PREFILTER.test(source);
	const hasProtectedTableSymbol =
		hasSchemaModule &&
		(APPROVAL_TABLE_SYMBOL_PREFILTER.test(source) ||
			SOURCE_TABLE_SYMBOL_PREFILTER.test(source));
	const hasBroadTrustedMutationSurface =
		hasTrustedModule &&
		TRUSTED_MUTATION_VOCABULARY_PREFILTER.test(source) &&
		(hasProtectedTableSymbol ||
			hasComposableProtectedSql(source, hasProtectedTableSymbol, extraction));
	return (
		hasBroadTrustedMutationSurface ||
		(hasProtectedTableSymbol && DRIZZLE_WRITE_PREFILTER.test(source)) ||
		((hasProtectedTableText || hasProtectedTableSymbol) &&
			INCOMPLETE_SOURCE_PREFILTER.test(source)) ||
		(hasRawSqlSurface &&
			hasComposableProtectedSql(source, hasProtectedTableSymbol, extraction))
	);
}

function hasMutationCandidate(source: string, fileName: string): boolean {
	const extraction = extractLiteralFragments(source);
	const hasTrustedModule = extraction.fragments.some((moduleName) =>
		isApprovalWriteTrustedProvenanceModuleSpecifier(moduleName, fileName),
	);
	const hasSchemaModule = extraction.fragments.some((moduleName) =>
		isApprovalWriteSchemaModuleSpecifier(moduleName, fileName),
	);
	if (hasTrustedModule && IDENTIFIER_UNICODE_ESCAPE.test(source)) return true;
	const hasProtectedTableSymbol =
		hasSchemaModule &&
		(APPROVAL_TABLE_SYMBOL_PREFILTER.test(source) ||
			SOURCE_TABLE_SYMBOL_PREFILTER.test(source));
	const hasRawSqlSurface =
		hasTrustedModule &&
		(RAW_SQL_SURFACE_PREFILTER.test(source) ||
			TAGGED_TEMPLATE_SURFACE_PREFILTER.test(source));
	const hasBroadTrustedMutationSurface =
		hasTrustedModule &&
		TRUSTED_MUTATION_VOCABULARY_PREFILTER.test(source) &&
		(hasProtectedTableSymbol ||
			hasComposableProtectedSql(source, hasProtectedTableSymbol, extraction));
	return (
		hasBroadTrustedMutationSurface ||
		(hasProtectedTableSymbol && DRIZZLE_WRITE_PREFILTER.test(source)) ||
		(hasRawSqlSurface &&
			hasComposableProtectedSql(source, hasProtectedTableSymbol, extraction))
	);
}

function isContainedPath(workspaceRoot: string, candidate: string): boolean {
	const pathFromWorkspace = relative(workspaceRoot, candidate);
	return (
		pathFromWorkspace === "" ||
		(!isAbsolute(pathFromWorkspace) &&
			pathFromWorkspace !== ".." &&
			!pathFromWorkspace.startsWith(`..${sep}`))
	);
}

function isExcludedPath(path: string): boolean {
	const normalized = normalizePath(path);
	const segments = normalized.split("/");
	return (
		segments.includes("__tests__") ||
		segments.includes("__specs__") ||
		TEST_SOURCE.test(basename(normalized)) ||
		segments[0] === "drizzle" ||
		(normalized.startsWith("src/db/migrations/") && segments.length > 3) ||
		normalized === "src/db/auth-schema.ts"
	);
}

function errorLocation(detail: string): { column: number; line: number } {
	const location = detail.match(/:(\d+):(\d+)(?:\D|$)/);
	return {
		column: location ? Number(location[2]) : 0,
		line: location ? Number(location[1]) : 0,
	};
}

function safeErrorDetail(error: unknown, workspaceRoot: string): string {
	const detail = error instanceof Error ? error.message : String(error);
	return normalizePath(detail).replaceAll(normalizePath(workspaceRoot), ".");
}

function sourceReadErrorDetail(error: unknown): string {
	if (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		typeof error.code === "string"
	) {
		return `Approval write boundary source read failed: ${error.code}.`;
	}
	return error instanceof Error
		? error.message
		: "Approval write boundary source read failed.";
}

function makeError(
	path: string,
	error: ApprovalWriteBoundaryError["error"],
	detail: string,
): ApprovalWriteBoundaryError {
	return { ...errorLocation(detail), detail, error, kind: "error", path };
}

function isAllowed(
	path: string,
	mutation: {
		columns?: readonly string[];
		functionName?: string;
		operation: ApprovalWriteOperation;
		semantic?: ApprovalSourceMutationSemantic;
		table: ProtectedWriteTable;
		uncertainty?: ApprovalSourceMutationUncertainty;
	},
): boolean {
	const canonical = CANONICAL_WRITE_OWNERS as ApprovalWriteOwners;
	const temporary = TEMPORARY_LEGACY_WRITE_EXCEPTIONS as ApprovalWriteOwners;
	if (
		!TARGETED_APPROVAL_SOURCE_TABLES.includes(
			mutation.table as TargetedApprovalSourceTable,
		)
	) {
		const table = mutation.table as ProtectedApprovalTable;
		return Boolean(
			canonical[path]?.[table]?.includes(mutation.operation) ||
				temporary[path]?.[table]?.includes(mutation.operation),
		);
	}
	if (workRecordsSeamViolation(path, mutation) !== null) return false;
	const owners = CANONICAL_SOURCE_WRITE_OWNERS as ApprovalSourceWriteOwners;
	const exceptions = SOURCE_WRITE_EXCEPTIONS as ApprovalSourceWriteOwners;
	const columns = mutation.columns ?? [];
	return [...(owners[path] ?? []), ...(exceptions[path] ?? [])].some(
		(capability) =>
			capability.table === mutation.table &&
			capability.operation === mutation.operation &&
			capability.functionName === mutation.functionName &&
			capability.semantic === mutation.semantic &&
			capability.uncertainty === mutation.uncertainty &&
			capability.columns.length === columns.length &&
			capability.columns.every((column, index) => column === columns[index]),
	);
}

function findingKey(finding: ApprovalWriteBoundaryFinding): string {
	return finding.kind === "mutation"
		? `${finding.path}\0${finding.line}\0${finding.column}\0mutation\0${finding.functionName ?? ""}\0${finding.table}\0${finding.operation}\0${finding.columns?.join(",") ?? ""}\0${finding.semantic ?? ""}\0${finding.uncertainty ?? ""}`
		: `${finding.path}\0${finding.line}\0${finding.column}\0error\0${finding.error}\0${finding.detail}`;
}

function readSource(
	candidate: SourceCandidate,
): { bytes: number; source: string } | null {
	const descriptor = openSync(
		candidate.fileName,
		constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
	);
	try {
		const stat = fstatSync(descriptor);
		if (
			!stat.isFile() ||
			stat.dev !== candidate.dev ||
			stat.ino !== candidate.ino
		) {
			throw new Error("Source changed during approval write boundary scan.");
		}
		if (stat.size > MAX_SOURCE_BYTES) return null;

		const chunks: Buffer[] = [];
		let bytes = 0;
		while (bytes <= MAX_SOURCE_BYTES) {
			const chunk = Buffer.allocUnsafe(
				Math.min(64 * 1024, MAX_SOURCE_BYTES + 1 - bytes),
			);
			const bytesRead = readSync(descriptor, chunk, 0, chunk.length, null);
			if (bytesRead === 0) break;
			bytes += bytesRead;
			if (bytes > MAX_SOURCE_BYTES) return null;
			chunks.push(chunk.subarray(0, bytesRead));
		}
		return { bytes, source: Buffer.concat(chunks, bytes).toString("utf8") };
	} finally {
		closeSync(descriptor);
	}
}

function scanApprovalWrites(
	{ roots, workspaceRoot }: ScanApprovalWriteBoundaryOptions,
	includeAllowed: boolean,
): ApprovalWriteBoundaryFinding[] {
	const resolvedWorkspaceRoot = resolve(workspaceRoot);
	const files = new Map<string, SourceCandidate>();
	const findings: ApprovalWriteBoundaryFinding[] = [];
	let fileCountExceeded = false;

	const walk = (path: string): void => {
		if (fileCountExceeded) return;
		const relativePath = normalizePath(relative(resolvedWorkspaceRoot, path));
		let stat: ReturnType<typeof lstatSync>;
		try {
			stat = lstatSync(path);
		} catch (error) {
			findings.push(
				makeError(
					relativePath,
					"traversal",
					safeErrorDetail(error, resolvedWorkspaceRoot),
				),
			);
			return;
		}
		if (stat.isSymbolicLink() || isExcludedPath(relativePath)) return;
		if (stat.isDirectory()) {
			let entries: string[];
			try {
				entries = readdirSync(path).sort(compareAscii);
			} catch (error) {
				findings.push(
					makeError(
						relativePath,
						"traversal",
						safeErrorDetail(error, resolvedWorkspaceRoot),
					),
				);
				return;
			}
			for (const entry of entries) {
				walk(join(path, entry));
				if (fileCountExceeded) break;
			}
			return;
		}
		if (stat.isFile() && PRODUCTION_SOURCE.test(relativePath)) {
			if (!files.has(path) && files.size >= MAX_PRODUCTION_FILES) {
				fileCountExceeded = true;
				return;
			}
			files.set(path, { dev: stat.dev, fileName: path, ino: stat.ino });
		}
	};

	for (const root of [...new Set(roots)].sort(compareAscii)) {
		const resolvedRoot = resolve(resolvedWorkspaceRoot, root);
		const normalizedRoot = normalizePath(root);
		if (!isContainedPath(resolvedWorkspaceRoot, resolvedRoot)) {
			findings.push(
				makeError(
					normalizedRoot,
					"root",
					"Root escapes the approval write boundary workspace.",
				),
			);
			continue;
		}
		let rootStat: ReturnType<typeof lstatSync>;
		try {
			rootStat = lstatSync(resolvedRoot);
		} catch {
			findings.push(
				makeError(
					normalizedRoot,
					"root",
					"Approval write boundary root is unavailable.",
				),
			);
			continue;
		}
		if (rootStat.isSymbolicLink()) {
			findings.push(
				makeError(
					normalizedRoot,
					"root",
					"Configured approval write boundary root is a symbolic link.",
				),
			);
			continue;
		}
		walk(resolvedRoot);
		if (fileCountExceeded) break;
	}

	if (fileCountExceeded) {
		findings.push(
			makeError(
				".",
				"traversal",
				`Approval write boundary production file-count limit exceeded: ${MAX_PRODUCTION_FILES}.`,
			),
		);
	}

	const sources: Array<{
		fileName: string;
		path: string;
		source: string;
		syntaxOnly: boolean;
	}> = [];
	let totalSourceBytes = 0;
	let totalSourceBytesExceeded = false;
	for (const candidate of [...files.values()].sort((left, right) =>
		compareAscii(left.fileName, right.fileName),
	)) {
		if (fileCountExceeded) break;
		const path = normalizePath(
			relative(resolvedWorkspaceRoot, candidate.fileName),
		);
		let result: { bytes: number; source: string } | null;
		try {
			result = readSource(candidate);
		} catch (error) {
			findings.push(makeError(path, "read", sourceReadErrorDetail(error)));
			continue;
		}
		if (result === null) {
			findings.push(
				makeError(
					path,
					"analysis",
					`Approval write boundary per-file byte limit exceeded: ${MAX_SOURCE_BYTES}.`,
				),
			);
			continue;
		}
		totalSourceBytes += result.bytes;
		if (totalSourceBytes > MAX_TOTAL_SOURCE_BYTES) {
			totalSourceBytesExceeded = true;
			findings.push(
				makeError(
					".",
					"traversal",
					`Approval write boundary total source byte limit exceeded: ${MAX_TOTAL_SOURCE_BYTES}.`,
				),
			);
			break;
		}
		if (!hasAnalysisCandidate(result.source, candidate.fileName)) continue;
		sources.push({
			fileName: candidate.fileName,
			path,
			source: result.source,
			syntaxOnly: !hasMutationCandidate(result.source, candidate.fileName),
		});
	}

	if (!fileCountExceeded && !totalSourceBytesExceeded) {
		const pathsByFileName = new Map(
			sources.map(({ fileName, path }) => [fileName, path]),
		);
		for (const result of analyzeApprovalWriteMutationSources(sources)) {
			const path = pathsByFileName.get(result.fileName);
			if (!path) continue;
			if (!result.ok) {
				findings.push(
					makeError(
						path,
						"analysis",
						safeErrorDetail(result.error, resolvedWorkspaceRoot),
					),
				);
				continue;
			}
			for (const mutation of result.mutations) {
				if (includeAllowed || !isAllowed(path, mutation)) {
					const violation = workRecordsSeamViolation(path, mutation);
					findings.push({
						...(violation === null ? {} : { violation }),
						column: mutation.column,
						...(mutation.columns ? { columns: mutation.columns } : {}),
						...(mutation.functionName
							? { functionName: mutation.functionName }
							: {}),
						kind: "mutation",
						line: mutation.line,
						operation: mutation.operation,
						path,
						...(mutation.semantic ? { semantic: mutation.semantic } : {}),
						table: mutation.table,
						...(mutation.uncertainty
							? { uncertainty: mutation.uncertainty }
							: {}),
					});
				}
			}
		}
	}

	const unique = new Map<string, ApprovalWriteBoundaryFinding>();
	for (const finding of findings) unique.set(findingKey(finding), finding);
	return [...unique.values()].sort((left, right) =>
		compareAscii(findingKey(left), findingKey(right)),
	);
}

export function scanApprovalWriteBoundary(
	options: ScanApprovalWriteBoundaryOptions,
): ApprovalWriteBoundaryFinding[] {
	return scanApprovalWrites(options, false);
}

export function scanApprovalWriteInventory(
	options: ScanApprovalWriteBoundaryOptions,
): ApprovalWriteBoundaryFinding[] {
	return scanApprovalWrites(options, true);
}
