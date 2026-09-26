import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
	approvalRequest,
	employee,
	timeEntry,
	timeEntryAppendControl,
	workPeriod,
} from "@/db/schema";
import { readApprovalEvidenceMode } from "@/lib/approvals/evidence/store";
import { prepareTimeReviewEvidence } from "@/lib/approvals/presentation/time-review";
import {
	TIME_APPROVAL_WORKFLOW_TYPES,
	type TimeApprovalWorkflowType,
} from "@/lib/approvals/time-approval-kinds";
import { classifyTimeApprovalRequest } from "@/lib/approvals/time-request-kind";
import { parseInstant } from "@/lib/datetime/temporal-core";
import { readAppendAssurance } from "../append-assurance-reader";
import { assessHistoricalWork } from "../historical-work-diagnostics";
import { readHistoricalWorkEvidence } from "../historical-work-diagnostics-reader";
import {
	assessTimePilotReadiness,
	type TimePilotApprovalKindEvidence,
	type TimePilotEmployeeEvidence,
	type TimePilotPendingEvidence,
	type TimePilotReadiness,
	type TimePilotSnapshot,
} from "./readiness";

type Database = typeof db;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

/** Every retained instant: the report covers the whole history, not a period. */
const WHOLE_HISTORY = {
	start: parseInstant("0001-01-01T00:00:00Z"),
	endExclusive: parseInstant("9999-12-31T00:00:00Z"),
};

function rows(result: unknown): Array<Record<string, unknown>> {
	if (!result || typeof result !== "object" || !("rows" in result)) return [];
	return Array.isArray(result.rows) ? (result.rows as Array<Record<string, unknown>>) : [];
}

async function count(transaction: Transaction, query: ReturnType<typeof sql>): Promise<number> {
	const [row] = rows(await transaction.execute(query));
	return Number(row?.count ?? 0);
}

async function readAppend(transaction: Transaction, organizationId: string) {
	const [control] = await transaction
		.select({ mode: timeEntryAppendControl.mode, updatedAt: timeEntryAppendControl.updatedAt })
		.from(timeEntryAppendControl)
		.where(eq(timeEntryAppendControl.organizationId, organizationId))
		.limit(1);
	const active = control?.mode === "active";
	return {
		mode: active ? ("active" as const) : ("inactive" as const),
		// The control has no application setter, so its last update is the activation.
		activatedAt: active ? control.updatedAt : null,
	};
}

async function readEmployees(
	transaction: Transaction,
	organizationId: string,
	employeeIds: string[],
): Promise<TimePilotEmployeeEvidence[]> {
	const assurance = await readAppendAssurance(transaction, organizationId, employeeIds);
	return employeeIds.map((employeeId) => {
		const report = assurance.get(employeeId);
		if (!report) throw new Error("Append assurance was not assessed for an employee");
		const { continuity } = report;
		return {
			employeeId,
			admission: continuity.status === "not_adopted" ? null : continuity.provenance.admission,
			lineage: report.lineage.status,
			continuity: continuity.status,
		};
	});
}

/**
 * Correction entries that replace one of the period's endpoints: the relational
 * evidence the classifier needs before it accepts a time correction marker.
 */
async function readCorrectionEvidence(
	transaction: Transaction,
	organizationId: string,
	period: { clockInId: string; clockOutId: string | null },
) {
	const endpoints = [period.clockInId, period.clockOutId].filter((id): id is string => !!id);
	const corrections = await transaction
		.select({ id: timeEntry.id, replacesEntryId: timeEntry.replacesEntryId })
		.from(timeEntry)
		.where(
			and(
				eq(timeEntry.organizationId, organizationId),
				inArray(timeEntry.replacesEntryId, endpoints),
			),
		);
	return {
		verifiedRelationalCorrectionIds: corrections.map((entry) => entry.id),
		verifiedRelationalCorrectionIdsByEndpoint: {
			clockIn: corrections
				.filter((entry) => entry.replacesEntryId === period.clockInId)
				.map((entry) => entry.id),
			clockOut: corrections
				.filter((entry) => entry.replacesEntryId === period.clockOutId)
				.map((entry) => entry.id),
		},
	};
}

/**
 * Every pending time approval request, classified by kind and by its submitted
 * evidence through the same review preparation the inbox and decision owners
 * use, so a held request here is one a decision would refuse.
 */
async function readApprovals(
	transaction: Transaction,
	organizationId: string,
): Promise<{ kinds: TimePilotApprovalKindEvidence[]; unclassifiedPending: number }> {
	const pending = new Map<TimeApprovalWorkflowType, TimePilotPendingEvidence>(
		TIME_APPROVAL_WORKFLOW_TYPES.map((kind) => [
			kind,
			{ current: 0, notCaptured: 0, materialChange: 0, multiStage: 0 },
		]),
	);
	let unclassifiedPending = 0;
	const requests = await transaction
		.select({
			id: approvalRequest.id,
			metadata: approvalRequest.metadata,
			reason: approvalRequest.reason,
			workPeriodId: workPeriod.id,
			pendingChanges: workPeriod.pendingChanges,
			clockInId: workPeriod.clockInId,
			clockOutId: workPeriod.clockOutId,
		})
		.from(approvalRequest)
		.leftJoin(
			workPeriod,
			and(
				eq(workPeriod.id, approvalRequest.entityId),
				eq(workPeriod.organizationId, approvalRequest.organizationId),
			),
		)
		.where(
			and(
				eq(approvalRequest.organizationId, organizationId),
				eq(approvalRequest.entityType, "time_entry"),
				eq(approvalRequest.status, "pending"),
			),
		)
		.orderBy(approvalRequest.id);
	const multiStage = new Set(
		rows(
			await transaction.execute(sql`
				select stage.approval_request_id as id from approval_chain_stage_instance stage
				where stage.organization_id = ${organizationId}
					and stage.approval_request_id is not null
					and (select count(*) from approval_chain_stage_instance other
						where other.organization_id = stage.organization_id
							and other.chain_instance_id = stage.chain_instance_id) > 1
			`),
		).map((row) => String(row.id)),
	);
	for (const request of requests) {
		if (!request.workPeriodId || !request.clockInId) {
			// The request names no work period of this organization.
			unclassifiedPending += 1;
			continue;
		}
		const kind = classifyTimeApprovalRequest({
			metadata: request.metadata,
			reason: request.reason,
			pendingChanges: request.pendingChanges,
			...(await readCorrectionEvidence(transaction, organizationId, {
				clockInId: request.clockInId,
				clockOutId: request.clockOutId,
			})),
		});
		const counts = kind === "unclassified" ? undefined : pending.get(kind);
		if (kind === "unclassified" || !counts) {
			unclassifiedPending += 1;
			continue;
		}
		const evidence = await prepareTimeReviewEvidence(
			{
				organizationId,
				approvalRequestId: request.id,
				workPeriodId: request.workPeriodId,
				requestPending: true,
				kind,
			},
			transaction,
		);
		if (evidence.status === "not_captured") counts.notCaptured += 1;
		else if (evidence.comparison?.kind === "material_change") counts.materialChange += 1;
		else counts.current += 1;
		if (multiStage.has(request.id)) counts.multiStage += 1;
	}

	const modes = new Map(
		rows(
			await transaction.execute(sql`
				select workflow_type, lifecycle_mode from approval_workflow_rollout
				where organization_id = ${organizationId}
			`),
		).map((row) => [String(row.workflow_type), String(row.lifecycle_mode)]),
	);
	const kinds: TimePilotApprovalKindEvidence[] = [];
	for (const workflowType of TIME_APPROVAL_WORKFLOW_TYPES) {
		kinds.push({
			workflowType,
			lifecycleMode: modes.get(workflowType) ?? null,
			evidenceMode: await readApprovalEvidenceMode(transaction, { organizationId, workflowType }),
			pending: pending.get(workflowType) as TimePilotPendingEvidence,
		});
	}
	return { kinds, unclassifiedPending };
}

async function readOperations(
	transaction: Transaction,
	organizationId: string,
	active: boolean,
): Promise<TimePilotSnapshot["operations"]> {
	if (!active) {
		return { sinceActivation: {}, legacyAdmissionSinceActivation: 0, serverIdentityOnBehalf: 0 };
	}
	// Compared with the activation in SQL: a JavaScript Date would drop its microseconds.
	const receipts = rows(
		await transaction.execute(sql`
			select writer, count(*)::int as count,
				count(*) filter (where append_admission = 'legacy')::int as legacy,
				count(*) filter (
					where writer = 'manager_on_behalf' and command->>'identity' = 'server'
				)::int as server_identity
			from completed_work_operation
			where organization_id = ${organizationId}
				and created_at >= (
					select updated_at from time_entry_append_control
					where organization_id = ${organizationId} and mode = 'active'
				)
			group by writer order by writer
		`),
	);
	const sum = (column: string) => receipts.reduce((total, row) => total + Number(row[column]), 0);
	return {
		sinceActivation: Object.fromEntries(receipts.map((row) => [row.writer, Number(row.count)])),
		legacyAdmissionSinceActivation: sum("legacy"),
		serverIdentityOnBehalf: sum("server_identity"),
	};
}

async function readImports(
	transaction: Transaction,
	organizationId: string,
): Promise<TimePilotSnapshot["imports"]> {
	const [batches] = rows(
		await transaction.execute(sql`
			select
				count(*) filter (where status = 'commit_failed')::int as failed,
				count(*) filter (where status in ('scanning', 'committing'))::int as in_progress
			from import_batch where organization_id = ${organizationId}
		`),
	);
	return {
		heldRows: await count(
			transaction,
			sql`select count(*)::int as count from import_staged_row
				where organization_id = ${organizationId}
					and row_status = 'blocked' and commit_hold is not null`,
		),
		failedBatches: Number(batches?.failed ?? 0),
		inProgressBatches: Number(batches?.in_progress ?? 0),
	};
}

async function readFollowUps(
	transaction: Transaction,
	organizationId: string,
): Promise<TimePilotSnapshot["followUps"]> {
	const [controls] = rows(
		await transaction.execute(sql`
			select
				(select mode from payroll_work_collection_control
					where organization_id = ${organizationId}) as payroll,
				(select mode from historical_work_repair_control
					where organization_id = ${organizationId}) as repair,
				(select count(*)::int from work_balance_rebuild_intent
					where organization_id = ${organizationId}) as rebuilds,
				(select count(*)::int from historical_work_proposal
					where organization_id = ${organizationId}
						and status in ('proposed', 'approved')) as proposals,
				(select count(*)::int from work_break_adjustment_intent
					where organization_id = ${organizationId}) as break_adjustments
		`),
	);
	return {
		payrollCollection: controls?.payroll === "active" ? "active" : "inactive",
		historicalRepair: controls?.repair === "active" ? "active" : "inactive",
		pendingRebuildIntents: Number(controls?.rebuilds ?? 0),
		openProposals: Number(controls?.proposals ?? 0),
		pendingBreakAdjustments: Number(controls?.break_adjustments ?? 0),
	};
}

/** Collects the organization's pilot evidence inside one snapshot transaction. */
export async function readTimePilotSnapshot(
	transaction: Transaction,
	organizationId: string,
): Promise<TimePilotSnapshot> {
	const [known] = rows(
		await transaction.execute(sql`select 1 from organization where id = ${organizationId}`),
	);
	// An unknown ID would otherwise read as an organization with nothing outstanding.
	if (!known) throw new Error(`Unknown organization ${organizationId}`);
	const append = await readAppend(transaction, organizationId);
	// Every employee, inactive ones included: departed history is still history.
	const employeeIds = (
		await transaction
			.select({ id: employee.id })
			.from(employee)
			.where(eq(employee.organizationId, organizationId))
			.orderBy(employee.id)
	).map((row) => row.id);
	const employees = await readEmployees(transaction, organizationId, employeeIds);
	const evidence = await readHistoricalWorkEvidence(transaction, organizationId, employeeIds);
	const history = assessHistoricalWork(evidence, { employeeIds, range: WHOLE_HISTORY });
	const openWork = await count(
		transaction,
		sql`select count(*)::int as count from work_period
			where organization_id = ${organizationId} and end_time is null and deleted_at is null`,
	);
	const approvals = await readApprovals(transaction, organizationId);
	return {
		organizationId,
		append: { mode: append.mode, activatedAt: append.activatedAt?.toISOString() ?? null },
		employees,
		openWork,
		historyFindings: history.findings.map(({ kind, treatment, blocking }) => ({
			kind,
			treatment,
			blocking,
		})),
		approvalKinds: approvals.kinds,
		unclassifiedPending: approvals.unclassifiedPending,
		operations: await readOperations(transaction, organizationId, append.mode === "active"),
		imports: await readImports(transaction, organizationId),
		followUps: await readFollowUps(transaction, organizationId),
	};
}

/**
 * The time pilot readiness of one organization, from one read-only
 * repeatable-read snapshot. Its history read is O(history) for every employee.
 */
export async function assessOrganizationTimePilotReadiness(input: {
	organizationId: string;
}): Promise<TimePilotReadiness> {
	if (!input.organizationId) throw new Error("Pilot readiness requires organization scope");
	const snapshot = await db.transaction(
		(transaction) => readTimePilotSnapshot(transaction, input.organizationId),
		{ isolationLevel: "repeatable read", accessMode: "read only" },
	);
	return assessTimePilotReadiness(snapshot);
}
