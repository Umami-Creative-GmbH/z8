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
	"src/lib/demo/delete-non-admin.ts": {
		approval_request: ["delete"],
	},
	"src/lib/demo/demo-data.service.ts": {
		approval_request: ["insert"],
	},
	"src/lib/jobs/organization-cleanup.ts": {
		approval_request: ["delete"],
	},
	"src/lib/teams/jobs/escalation-checker.ts": {
		approval_request: ["update"],
	},
	"src/lib/time-record/migration/backfill.ts": {
		approval_request: ["update"],
	},
} as const satisfies ApprovalWriteOwners;

export const CANONICAL_SOURCE_WRITE_OWNERS = {
	"src/app/[locale]/(app)/time-tracking/actions.canonical.ts": [
		{
			columns: [
				"approval_state",
				"duration_minutes",
				"employee_id",
				"end_at",
				"organization_id",
				"start_at",
			],
			functionName: "createForCompletedPeriodInTransaction",
			operation: "insert",
			semantic: "policy_clock_out_terminal_break",
			table: "time_record",
		},
		{
			columns: [
				"computation_metadata",
				"organization_id",
				"record_id",
				"record_kind",
				"work_category_id",
				"work_location_type",
			],
			functionName: "createForCompletedPeriodInTransaction",
			operation: "insert",
			semantic: "policy_clock_out_terminal_break",
			table: "time_record_work",
		},
		{
			columns: [
				"allocation_kind",
				"organization_id",
				"project_id",
				"record_id",
				"weight_percent",
			],
			functionName: "createForCompletedPeriodInTransaction",
			operation: "insert",
			semantic: "policy_clock_out_terminal_break",
			table: "time_record_allocation",
		},
	],
	"src/lib/approvals/server/time-correction-approvals.ts": [
		{
			columns: ["approval_workflow_id"],
			functionName: "bindTimeCorrectionWorkflowToWorkPeriod",
			operation: "update",
			table: "work_period",
		},
		{
			columns: ["is_superseded", "superseded_by_id"],
			functionName: "finalizeTimeCorrectionTerminalDetailedInTransaction",
			operation: "update",
			semantic: "correction_lifecycle",
			table: "time_entry",
		},
		{
			columns: [
				"is_superseded",
				"replaces_entry_id",
				"superseded_by_id",
				"type",
			],
			functionName: "insertTimeCorrectionSourceEntry",
			operation: "insert",
			semantic: "correction",
			table: "time_entry",
		},
		{
			columns: [
				"is_superseded",
				"replaces_entry_id",
				"superseded_by_id",
				"type",
			],
			functionName: "deleteCancelledTimeCorrectionsInTransaction",
			operation: "delete",
			semantic: "inactive_correction",
			table: "time_entry",
		},
		{
			columns: ["duration_minutes", "end_at", "start_at"],
			functionName: "finalizeTimeCorrectionTerminalDetailedInTransaction",
			operation: "update",
			semantic: "ordinary_finalization",
			table: "time_record",
		},
		{
			columns: ["duration_minutes", "end_at", "start_at"],
			functionName: "syncCanonicalWorkCorrection",
			operation: "update",
			semantic: "ordinary_finalization",
			table: "time_record",
		},
	],
	"src/lib/absences/sick-vacation-override.ts": [
		{
			columns: [
				"approval_state",
				"duration_minutes",
				"employee_id",
				"end_at",
				"organization_id",
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
		{
			columns: ["approval_state"],
			functionName: "rejectCanonicalAbsenceInTransaction",
			operation: "update",
			semantic: "ordinary_finalization",
			table: "time_record",
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
	"src/lib/approvals/server/time-correction-submission.ts": [
		{
			columns: [
				"is_superseded",
				"replaces_entry_id",
				"superseded_by_id",
				"type",
			],
			functionName: "submitCorrection",
			operation: "delete",
			semantic: "inactive_correction",
			table: "time_entry",
		},
	],
	"src/lib/approvals/server/work-period-submission.ts": [
		{
			columns: [
				"approval_status",
				"canonical_record_id",
				"clock_in_id",
				"clock_out_id",
				"duration_minutes",
				"end_time",
				"pending_changes",
				"start_time",
			],
			functionName: "insertOrdinaryWorkPeriodSourceInTransaction",
			operation: "insert",
			table: "work_period",
		},
		{
			columns: ["approval_workflow_id"],
			functionName: "bindSourceWorkflow",
			operation: "update",
			table: "work_period",
		},
	],
	"src/lib/approvals/server/work-period-approvals.ts": [
		{
			columns: ["approval_workflow_id"],
			functionName: "bindPreCanonicalOrdinaryWorkflow",
			operation: "update",
			table: "work_period",
		},
		{
			columns: ["approval_status", "pending_changes"],
			functionName: "finalizeOrdinaryWorkPeriodTerminal",
			operation: "update",
			table: "work_period",
		},
		{
			columns: ["approval_state"],
			functionName: "finalizeOrdinaryWorkPeriodTerminal",
			operation: "update",
			semantic: "ordinary_finalization",
			table: "time_record",
		},
	],
	"src/lib/time-tracking/policy-clock-out-terminal-break.ts": [
		{
			columns: ["type"],
			functionName: "applyPolicyClockOutTerminalBreakInTransaction",
			operation: "insert",
			semantic: "synthetic_time_entry",
			table: "time_entry",
		},
		{
			columns: ["clock_out_id", "duration_minutes", "end_time"],
			functionName: "applyPolicyClockOutTerminalBreakInTransaction",
			operation: "update",
			semantic: "policy_clock_out_terminal_break",
			table: "work_period",
		},
		{
			columns: ["duration_minutes", "end_at"],
			functionName: "applyPolicyClockOutTerminalBreakInTransaction",
			operation: "update",
			semantic: "policy_clock_out_terminal_break",
			table: "time_record",
		},
		{
			columns: [
				"approval_state",
				"duration_minutes",
				"employee_id",
				"end_at",
				"organization_id",
				"start_at",
			],
			functionName: "applyPolicyClockOutTerminalBreakInTransaction",
			operation: "insert",
			semantic: "policy_clock_out_terminal_break",
			table: "time_record",
		},
		{
			columns: [
				"computation_metadata",
				"organization_id",
				"record_id",
				"record_kind",
				"work_category_id",
				"work_location_type",
			],
			functionName: "applyPolicyClockOutTerminalBreakInTransaction",
			operation: "insert",
			semantic: "policy_clock_out_terminal_break",
			table: "time_record_work",
		},
		{
			columns: [
				"allocation_kind",
				"cost_center_id",
				"created_at",
				"id",
				"organization_id",
				"project_id",
				"record_id",
				"weight_percent",
			],
			functionName: "applyPolicyClockOutTerminalBreakInTransaction",
			operation: "insert",
			semantic: "policy_clock_out_terminal_break",
			table: "time_record_allocation",
		},
		{
			columns: [
				"approval_status",
				"approval_workflow_id",
				"canonical_record_id",
				"clock_in_id",
				"clock_out_id",
				"duration_minutes",
				"end_time",
				"pending_changes",
				"start_time",
			],
			functionName: "applyPolicyClockOutTerminalBreakInTransaction",
			operation: "insert",
			semantic: "policy_clock_out_terminal_break",
			table: "work_period",
		},
	],
	"src/lib/effect/services/time-entry.service.ts": [
		{
			columns: ["is_superseded", "replaces_entry_id", "type"],
			functionName: "applyCorrectionWritesInTransaction",
			operation: "insert",
			semantic: "correction",
			table: "time_entry",
		},
		{
			columns: ["is_superseded", "superseded_by_id"],
			functionName: "applyCorrectionWritesInTransaction",
			operation: "update",
			semantic: "correction_lifecycle",
			table: "time_entry",
		},
		{
			columns: ["clock_in_id", "duration_minutes", "start_time"],
			functionName: "applyCorrectionWritesInTransaction",
			operation: "update",
			table: "work_period",
		},
		{
			columns: ["clock_out_id", "duration_minutes", "end_time"],
			functionName: "applyCorrectionWritesInTransaction",
			operation: "update",
			table: "work_period",
		},
		{
			columns: ["duration_minutes"],
			functionName: "applyCorrectionWritesInTransaction",
			operation: "update",
			table: "work_period",
		},
		{
			columns: ["duration_minutes", "end_at", "start_at"],
			functionName: "applyCorrectionWritesInTransaction",
			operation: "update",
			semantic: "ordinary_finalization",
			table: "time_record",
		},
	],
	"src/lib/effect/services/time-record.service.ts": [
		{
			columns: [
				"approval_state",
				"duration_minutes",
				"employee_id",
				"end_at",
				"organization_id",
				"start_at",
			],
			functionName: "createTimeRecord",
			operation: "insert",
			semantic: "policy_clock_out_terminal_break",
			table: "time_record",
		},
	],
} as const satisfies CanonicalApprovalSourceWriteOwners;

export const SOURCE_WRITE_EXCEPTIONS = {
	"src/app/[locale]/(app)/absences/actions.canonical.ts": [
		{
			columns: [],
			functionName: "create",
			operation: "insert",
			semantic: "policy_clock_out_terminal_break",
			table: "time_record",
			uncertainty: "dynamic_payload",
		},
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
			functionName: "recordAbsenceForEmployee",
			operation: "insert",
			semantic: "policy_clock_out_terminal_break",
			table: "time_record",
			uncertainty: "dynamic_payload",
		},
	],
	"src/app/[locale]/(app)/time-tracking/actions.ts": [
		{
			columns: ["is_superseded", "superseded_by_id"],
			functionName: "splitWorkPeriod",
			operation: "update",
			semantic: "correction_lifecycle",
			table: "time_entry",
		},
		{
			columns: ["clock_out_id", "duration_minutes", "end_time"],
			functionName: "splitWorkPeriod",
			operation: "update",
			table: "work_period",
		},
		{
			columns: [
				"clock_in_id",
				"clock_out_id",
				"duration_minutes",
				"end_time",
				"start_time",
			],
			functionName: "splitWorkPeriod",
			operation: "insert",
			table: "work_period",
		},
	],
	"src/app/[locale]/(app)/time-tracking/actions/clocking.ts": [
		{
			columns: [
				"approval_status",
				"clock_out_id",
				"duration_minutes",
				"end_time",
				"pending_changes",
			],
			functionName: "addBreakToActiveSession",
			operation: "update",
			table: "work_period",
		},
		{
			columns: ["clock_in_id", "start_time"],
			functionName: "addBreakToActiveSession",
			operation: "insert",
			table: "work_period",
		},
	],
	"src/app/[locale]/(app)/time-tracking/actions/entry-helpers.ts": [
		{
			columns: ["is_superseded", "replaces_entry_id", "type"],
			functionName: "createTimeEntry",
			operation: "insert",
			semantic: "correction_lifecycle",
			table: "time_entry",
		},
		{
			columns: ["is_superseded", "superseded_by_id"],
			functionName: "markTimeEntrySuperseded",
			operation: "update",
			semantic: "correction_lifecycle",
			table: "time_entry",
		},
	],
	"src/app/[locale]/(app)/time-tracking/actions/mutations.ts": [
		{
			columns: ["is_superseded", "superseded_by_id"],
			functionName: "splitWorkPeriod",
			operation: "update",
			semantic: "correction_lifecycle",
			table: "time_entry",
		},
		{
			columns: ["clock_out_id", "duration_minutes", "end_time"],
			functionName: "splitWorkPeriod",
			operation: "update",
			table: "work_period",
		},
		{
			columns: [
				"clock_in_id",
				"clock_out_id",
				"duration_minutes",
				"end_time",
				"start_time",
			],
			functionName: "splitWorkPeriod",
			operation: "insert",
			table: "work_period",
		},
	],
	"src/lib/clockin/import-orchestrator.ts": [
		{
			columns: [],
			functionName: "insertTimeEntry",
			operation: "insert",
			table: "time_entry",
			uncertainty: "dynamic_payload",
		},
		{
			columns: [],
			functionName: "insertWorkPeriod",
			operation: "insert",
			table: "work_period",
			uncertainty: "dynamic_payload",
		},
	],
	"src/lib/clockodo/import-orchestrator.ts": [
		{
			columns: [],
			functionName: "importClockodoData",
			operation: "insert",
			table: "time_entry",
			uncertainty: "dynamic_payload",
		},
		{
			columns: [],
			functionName: "importClockodoData",
			operation: "insert",
			table: "work_period",
			uncertainty: "dynamic_payload",
		},
	],
	"src/lib/demo/demo-data.service.ts": [
		{
			columns: [
				"is_superseded",
				"replaces_entry_id",
				"superseded_by_id",
				"type",
			],
			functionName: "generateDemoPendingTimeCorrectionApprovals",
			operation: "delete",
			semantic: "inactive_correction",
			table: "time_entry",
		},
		{
			columns: ["type"],
			functionName: "generateDemoTimeEntries",
			operation: "insert",
			table: "time_entry",
			uncertainty: "dynamic_payload",
		},
		{
			columns: [
				"clock_in_id",
				"clock_out_id",
				"duration_minutes",
				"end_time",
				"start_time",
			],
			functionName: "generateDemoTimeEntries",
			operation: "insert",
			table: "work_period",
		},
	],
	"src/lib/effect/services/break-enforcement.service.ts": [
		{
			columns: ["type"],
			functionName: "createBreakTimeEntry",
			operation: "insert",
			table: "time_entry",
			uncertainty: "dynamic_payload",
		},
		{
			columns: ["clock_out_id", "duration_minutes", "end_time"],
			functionName: "enforceBreaksAfterClockOutInternal",
			operation: "update",
			table: "work_period",
		},
		{
			columns: [
				"clock_in_id",
				"clock_out_id",
				"duration_minutes",
				"end_time",
				"start_time",
			],
			functionName: "enforceBreaksAfterClockOutInternal",
			operation: "insert",
			table: "work_period",
		},
	],
	"src/lib/import-review/committers.ts": [
		{
			columns: ["type"],
			functionName: "commitWorkPeriod",
			operation: "insert",
			table: "time_entry",
			uncertainty: "dynamic_payload",
		},
		{
			columns: [
				"clock_in_id",
				"clock_out_id",
				"duration_minutes",
				"end_time",
				"start_time",
			],
			functionName: "commitWorkPeriod",
			operation: "insert",
			table: "work_period",
		},
	],
	"src/lib/time-record/migration/backfill.ts": [
		{
			columns: ["canonical_record_id"],
			functionName: "runCanonicalBackfill",
			operation: "update",
			table: "work_period",
		},
		{
			columns: [],
			functionName: "upsertCanonicalTimeRecords",
			operation: "insert",
			semantic: "policy_clock_out_terminal_break",
			table: "time_record",
			uncertainty: "dynamic_payload",
		},
		{
			columns: [],
			functionName: "insertIfPresent",
			operation: "insert",
			semantic: "policy_clock_out_terminal_break",
			table: "time_record_work",
			uncertainty: "dynamic_payload",
		},
		{
			columns: [],
			functionName: "runCanonicalBackfill",
			operation: "insert",
			semantic: "policy_clock_out_terminal_break",
			table: "time_record_allocation",
			uncertainty: "dynamic_payload",
		},
	],
	"src/lib/approvals/server/time-correction-approvals.ts": [
		{
			columns: [
				"clock_in_id",
				"clock_out_id",
				"duration_minutes",
				"end_time",
				"start_time",
			],
			functionName: "finalizeTimeCorrectionTerminalDetailedInTransaction",
			operation: "update",
			table: "work_period",
		},
	],
	"src/lib/time-tracking/clocking-service.ts": [
		{
			columns: [],
			functionName: "insertEntry",
			operation: "insert",
			table: "time_entry",
			uncertainty: "dynamic_payload",
		},
		{
			columns: [],
			functionName: "insertActivePeriod",
			operation: "insert",
			table: "work_period",
			uncertainty: "dynamic_payload",
		},
		{
			columns: [],
			functionName: "closeActivePeriod",
			operation: "update",
			table: "work_period",
			uncertainty: "dynamic_payload",
		},
	],
} as const satisfies ApprovalSourceWriteOwners;

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
	/approval_(?:assignment|chain|command|delivery|event|inbox|migration|outbox|projection|request|requester|rollout|stage|workflow)/i;
const APPROVAL_TABLE_SYMBOL_PREFILTER =
	/approval(?:Chain|Inbox|Outbox|Request|Requester|Stage|Workflow)/;
const COMPOSED_APPROVAL_TABLE_PREFILTER =
	/approval_?["'`+\s]+(?:assignment|chain|command|delivery|event|inbox|migration|outbox|projection|request|rollout|stage|workflow)/i;
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
					findings.push({
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
