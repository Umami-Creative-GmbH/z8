import { sql } from "drizzle-orm";
import { db } from "@/db";
import type {
	ApprovalDeliveryEffect,
	ApprovalDeliveryProvider,
} from "@/db/schema/approval-delivery";
import type { ApprovalPresentationMode } from "@/db/schema/approval-evidence";
import {
	TIME_ENTRY_APPEND_ADMISSIONS,
	type TimeEntryAppendAdmission,
} from "@/db/schema/time-entry-append";
import { TIME_APPROVAL_WORKFLOW_TYPES } from "@/lib/approvals/time-approval-kinds";
import {
	assessRollbackReadiness,
	type RollbackReadiness,
	type RollbackSnapshot,
} from "./readiness";

type Database = typeof db;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

/**
 * Kinds whose transferred approvals older decision owners cannot decide safely:
 * time kinds (#326 canonical, #439 legacy) and expenses (#326). Absence
 * transfers predate them and keep deciding under older releases.
 */
const TRANSFER_SENSITIVE_KINDS = [...TIME_APPROVAL_WORKFLOW_TYPES, "travel_expense"];

function rows(result: unknown): Array<Record<string, unknown>> {
	if (!result || typeof result !== "object" || !("rows" in result)) return [];
	return Array.isArray(result.rows) ? (result.rows as Array<Record<string, unknown>>) : [];
}

async function select(transaction: Transaction, query: ReturnType<typeof sql>) {
	return rows(await transaction.execute(query));
}

/** `{ key: count }` from grouped rows, in key order. */
function grouped<T extends string>(
	result: Array<Record<string, unknown>>,
	key: string,
): Partial<Record<T, number>> {
	return Object.fromEntries(result.map((row) => [String(row[key]), Number(row.count)])) as Partial<
		Record<T, number>
	>;
}

async function readAppend(
	transaction: Transaction,
	organizationId: string,
): Promise<RollbackSnapshot["append"]> {
	const [control] = await select(
		transaction,
		sql`select mode, updated_at from time_entry_append_control
			where organization_id = ${organizationId}`,
	);
	const active = control?.mode === "active";
	const counts = grouped<TimeEntryAppendAdmission>(
		await select(
			transaction,
			sql`select admission, count(*)::int as count from time_entry_append_position
				where organization_id = ${organizationId} group by admission order by admission`,
		),
		"admission",
	);
	return {
		mode: active ? "active" : "inactive",
		// The control has no application setter, so its last update is the activation.
		activatedAt: active
			? (control.updated_at instanceof Date
					? control.updated_at
					: new Date(String(control.updated_at))
				).toISOString()
			: null,
		positions: Object.fromEntries(
			TIME_ENTRY_APPEND_ADMISSIONS.map((admission) => [admission, counts[admission] ?? 0]),
		) as Record<TimeEntryAppendAdmission, number>,
	};
}

async function readReceipts(
	transaction: Transaction,
	organizationId: string,
): Promise<RollbackSnapshot["receipts"]> {
	return {
		kinds: grouped(
			await select(
				transaction,
				sql`select kind, count(*)::int as count from completed_work_operation
					where organization_id = ${organizationId} group by kind order by kind`,
			),
			"kind",
		),
		writers: grouped(
			await select(
				transaction,
				sql`select writer, count(*)::int as count from completed_work_operation
					where organization_id = ${organizationId} group by writer order by writer`,
			),
			"writer",
		),
	};
}

async function readCards(
	transaction: Transaction,
	organizationId: string,
): Promise<RollbackSnapshot["cards"]> {
	const deliveryControls = await select(
		transaction,
		sql`select workflow_type, provider from approval_delivery_control
			where organization_id = ${organizationId} order by workflow_type, provider`,
	);
	const presentationControls = await select(
		transaction,
		sql`select workflow_type, provider, mode from approval_presentation_control
			where organization_id = ${organizationId} order by workflow_type, provider`,
	);
	const openWork = await select(
		transaction,
		sql`select provider, effect, count(*)::int as count from approval_delivery_work
			where organization_id = ${organizationId} and status in ('pending', 'processing')
			group by provider, effect order by provider, effect`,
	);
	const [lineage] = await select(
		transaction,
		sql`select
			(select count(*)::int from approval_delivery_work
				where organization_id = ${organizationId} and lifecycle = 'legacy')
			+ (select count(*)::int from approval_delivery_message
				where organization_id = ${organizationId} and lifecycle = 'legacy')
			+ (select count(*)::int from approval_delivery_intent
				where organization_id = ${organizationId})
			+ (select count(*)::int from approval_review_binding
				where organization_id = ${organizationId} and authority = 'legacy')
			+ (select count(*)::int from approval_invocation
				where organization_id = ${organizationId} and authority = 'legacy') as legacy,
			(select count(*)::int from approval_delivery_work
				where organization_id = ${organizationId} and legacy_cycle_id is not null)
			+ (select count(*)::int from approval_delivery_message
				where organization_id = ${organizationId} and legacy_cycle_id is not null)
			+ (select count(*)::int from approval_delivery_intent
				where organization_id = ${organizationId}
					and (legacy_cycle_id is not null or event = 'withdrawn')) as cycles,
			(select count(*)::int from approval_delivery_work
				where organization_id = ${organizationId} and effect = 'replacement') as replacements`,
	);
	return {
		deliveryControls: deliveryControls.map((row) => ({
			workflowType: String(row.workflow_type),
			provider: String(row.provider) as ApprovalDeliveryProvider,
		})),
		presentationControls: presentationControls.map((row) => ({
			workflowType: String(row.workflow_type),
			provider: String(row.provider),
			mode: String(row.mode) as ApprovalPresentationMode,
		})),
		openWork: openWork.map((row) => ({
			provider: String(row.provider) as ApprovalDeliveryProvider,
			effect: String(row.effect) as ApprovalDeliveryEffect,
			count: Number(row.count),
		})),
		messages: grouped(
			await select(
				transaction,
				sql`select provider, count(*)::int as count from approval_delivery_message
					where organization_id = ${organizationId} group by provider order by provider`,
			),
			"provider",
		),
		invocations: grouped(
			await select(
				transaction,
				sql`select scheme, count(*)::int as count from approval_invocation
					where organization_id = ${organizationId} group by scheme order by scheme`,
			),
			"scheme",
		),
		legacyLifecycleRows: Number(lineage?.legacy ?? 0),
		cycleRows: Number(lineage?.cycles ?? 0),
		replacementRows: Number(lineage?.replacements ?? 0),
	};
}

async function readEscalation(
	transaction: Transaction,
	organizationId: string,
): Promise<RollbackSnapshot["escalation"]> {
	const [control] = await select(
		transaction,
		sql`select owner, automation_paused from approval_escalation_control
			where organization_id = ${organizationId}`,
	);
	const kinds = sql.join(
		TRANSFER_SENSITIVE_KINDS.map((kind) => sql`${kind}`),
		sql`, `,
	);
	// One approval can carry several transfers: count the approvals.
	const pending = await select(
		transaction,
		sql`select transfer.authority_mode, transfer.workflow_type::text as workflow_type,
				count(distinct coalesce(transfer.workflow_id, transfer.legacy_approval_request_id))::int as count
			from approval_escalation_transfer transfer
			left join approval_workflow workflow
				on workflow.id = transfer.workflow_id
					and workflow.organization_id = transfer.organization_id
			left join approval_request request
				on request.id = transfer.legacy_approval_request_id
					and request.organization_id = transfer.organization_id
			where transfer.organization_id = ${organizationId}
				and transfer.workflow_type::text in (${kinds})
				and (
					(transfer.authority_mode = 'canonical' and workflow.status = 'pending')
					or (transfer.authority_mode = 'legacy' and request.status = 'pending')
				)
			group by transfer.authority_mode, transfer.workflow_type
			order by transfer.authority_mode, transfer.workflow_type`,
	);
	return {
		owner: control ? (control.owner === "escalation" ? "escalation" : "legacy") : null,
		automationPaused: control?.automation_paused === true,
		pendingTransferred: pending.map((row) => ({
			authorityMode: row.authority_mode === "canonical" ? "canonical" : "legacy",
			workflowType: String(row.workflow_type),
			count: Number(row.count),
		})),
	};
}

async function readDurable(
	transaction: Transaction,
	organizationId: string,
): Promise<RollbackSnapshot["durable"]> {
	const [row] = await select(
		transaction,
		sql`select
			(select count(*)::int from work_balance_rebuild_intent
				where organization_id = ${organizationId} and reason = 'organization_timezone') as organization_rebuilds,
			(select count(*)::int from work_balance_rebuild_intent
				where organization_id = ${organizationId} and reason = 'user_timezone') as user_rebuilds,
			(select count(*)::int from work_break_adjustment_intent
				where organization_id = ${organizationId}) as break_adjustments,
			(select count(*)::int from payroll_export_job job
				where job.organization_id = ${organizationId}
					and job.status in ('pending', 'processing')
					and exists (select 1 from payroll_export_work_input input
						where input.job_id = job.id)) as payroll_jobs,
			(select count(*)::int from payroll_export_work_input
				where organization_id = ${organizationId}) as payroll_inputs,
			exists (select 1 from payroll_work_collection_control
				where organization_id = ${organizationId}) as payroll_control,
			(select count(*)::int from import_staged_row
				where organization_id = ${organizationId}
					and row_status = 'blocked' and commit_hold is not null) as held_rows,
			(select count(*)::int from historical_work_proposal
				where organization_id = ${organizationId}) as proposals,
			exists (select 1 from historical_work_repair_control
				where organization_id = ${organizationId}) as repair_control`,
	);
	return {
		rebuildIntents: {
			organization: Number(row?.organization_rebuilds ?? 0),
			user: Number(row?.user_rebuilds ?? 0),
		},
		breakAdjustments: Number(row?.break_adjustments ?? 0),
		payrollJobsInFlight: Number(row?.payroll_jobs ?? 0),
		payrollStoredInputs: Number(row?.payroll_inputs ?? 0),
		payrollControl: row?.payroll_control === true,
		heldImportRows: Number(row?.held_rows ?? 0),
		proposals: Number(row?.proposals ?? 0),
		repairControl: row?.repair_control === true,
	};
}

/** Collects the organization's rollback evidence inside one snapshot transaction. */
export async function readRollbackSnapshot(
	transaction: Transaction,
	organizationId: string,
): Promise<RollbackSnapshot> {
	const [known] = await select(
		transaction,
		sql`select 1 from organization where id = ${organizationId}`,
	);
	// An unknown ID would otherwise read as an organization with nothing to protect.
	if (!known) throw new Error(`Unknown organization ${organizationId}`);
	return {
		organizationId,
		append: await readAppend(transaction, organizationId),
		receipts: await readReceipts(transaction, organizationId),
		cards: await readCards(transaction, organizationId),
		escalation: await readEscalation(transaction, organizationId),
		durable: await readDurable(transaction, organizationId),
	};
}

/** The rollback readiness of one organization, from one read-only repeatable-read snapshot. */
export async function assessOrganizationRollbackReadiness(input: {
	organizationId: string;
}): Promise<RollbackReadiness> {
	if (!input.organizationId) throw new Error("Rollback readiness requires organization scope");
	const snapshot = await db.transaction(
		(transaction) => readRollbackSnapshot(transaction, input.organizationId),
		{ isolationLevel: "repeatable read", accessMode: "read only" },
	);
	return assessRollbackReadiness(snapshot);
}
