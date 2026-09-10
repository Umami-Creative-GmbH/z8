import { type SQL, sql } from "drizzle-orm";
import type { ApprovalTransactionClient } from "@/lib/approvals/workflow/ports";

export interface ApprovalMaintenanceDatabase extends ApprovalTransactionClient {
	transaction<T>(
		callback: (transaction: ApprovalTransactionClient) => Promise<T>,
	): Promise<T>;
}

export class ApprovalMaintenanceError extends Error {
	constructor(
		readonly code: "APPROVAL_NOT_FOUND" | "APPROVAL_AMBIGUOUS",
		message: string,
	) {
		super(message);
		this.name = "ApprovalMaintenanceError";
	}
}

function rows(result: unknown): Record<string, unknown>[] {
	if (
		!result ||
		typeof result !== "object" ||
		!("rows" in result) ||
		!Array.isArray(result.rows) ||
		!result.rows.every((row) => row !== null && typeof row === "object")
	) {
		throw new Error("Unexpected approval maintenance database result");
	}
	return result.rows;
}

function rowId(row: Record<string, unknown>): string {
	if (typeof row.id !== "string") {
		throw new Error("Unexpected approval maintenance record ID");
	}
	return row.id;
}

export async function listApprovals(
	database: ApprovalTransactionClient,
	organizationId: string,
): Promise<Record<string, unknown>[]> {
	// Read the approval stores directly: broken source/requester links must not hide rows.
	return rows(
		await database.execute(sql`
		select 'legacy' as storage_type, id, organization_id, status::text,
			entity_type as source_type, entity_id as source_id,
			to_char(created_at, 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as created_at_utc
		from approval_request
		where organization_id = ${organizationId}
		union all
		select 'workflow' as storage_type, id, organization_id, status::text,
			source_type, source_id,
			to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as created_at_utc
		from approval_workflow
		where organization_id = ${organizationId}
		order by created_at_utc, storage_type, id
		`),
	);
}

async function resolveLifecycle(
	transaction: ApprovalTransactionClient,
	organizationId: string,
	kind: string,
	id: string,
) {
	// Only explicit links connect approval cycles. Matching source IDs alone is unsafe:
	// a source can have several independent historical submissions.
	return rows(
		await transaction.execute(sql`
		with recursive edges as (
			select 'workflow'::text as from_kind, workflow_id as from_id,
				'legacy'::text as to_kind, legacy_approval_request_id as to_id
			from approval_workflow_stage
			where organization_id = ${organizationId}
				and legacy_approval_request_id is not null
			union all
			select 'chain', chain_instance_id, 'legacy', approval_request_id
			from approval_chain_stage_instance
			where organization_id = ${organizationId}
				and approval_request_id is not null
		), links as (
			select from_kind, from_id, to_kind, to_id from edges
			union all
			select to_kind, to_id, from_kind, from_id from edges
		), lifecycle(kind, id) as (
			select ${kind}::text, ${id}::uuid
			union
			select links.to_kind, links.to_id
			from lifecycle
			join links on links.from_kind = lifecycle.kind and links.from_id = lifecycle.id
		)
		select kind, id from lifecycle order by kind, id
		`),
	);
}

async function clearWorkflowSourceReferences(
	transaction: ApprovalTransactionClient,
	organizationId: string,
	workflowIds: string[],
): Promise<void> {
	if (workflowIds.length === 0) return;
	// Preserve the sources and their business statuses; only detach the deleted workflow.
	await transaction.execute(sql`
		update absence_entry set approval_workflow_id = null
		where organization_id = ${organizationId}
			and approval_workflow_id = any(${sql.param(workflowIds)}::uuid[])
	`);
	await transaction.execute(sql`
		update work_period set approval_workflow_id = null
		where organization_id = ${organizationId}
			and approval_workflow_id = any(${sql.param(workflowIds)}::uuid[])
	`);
	await transaction.execute(sql`
		update shift_request set approval_workflow_id = null
		where organization_id = ${organizationId}
			and approval_workflow_id = any(${sql.param(workflowIds)}::uuid[])
	`);
	await transaction.execute(sql`
		update travel_expense_claim set approval_workflow_id = null
		where organization_id = ${organizationId}
			and approval_workflow_id = any(${sql.param(workflowIds)}::uuid[])
	`);
	await transaction.execute(sql`
		update compliance_exception set approval_workflow_id = null
		where organization_id = ${organizationId}
			and approval_workflow_id = any(${sql.param(workflowIds)}::uuid[])
	`);
}

export interface DeletedApprovalRecords {
	legacyRequests: string[];
	workflows: string[];
	chains: string[];
}

export async function deleteApproval(
	database: ApprovalMaintenanceDatabase,
	organizationId: string,
	id: string,
): Promise<DeletedApprovalRecords> {
	return database.transaction((transaction) =>
		deleteApprovalInTransaction(transaction, organizationId, id),
	);
}

// The caller owns the transaction so platform-admin audit logging can be atomic
// with deletion. Authorization is enforced at the CLI/server-action boundary.
export async function deleteApprovalInTransaction(
	transaction: ApprovalTransactionClient,
	organizationId: string,
	id: string,
): Promise<DeletedApprovalRecords> {
	// Privileged maintenance only: do not race submissions or stage linking.
	// Keep FK checks enabled so an unexpected dependency rolls everything back.
	await transaction.execute(sql`set local lock_timeout = '10s'`);
	await transaction.execute(sql`set local statement_timeout = '30s'`);
	await transaction.execute(sql`
		lock table approval_request, approval_chain_instance, approval_chain_stage_instance,
			approval_workflow, approval_workflow_stage in share row exclusive mode
	`);

	const matches = rows(
		await transaction.execute(sql`
			select 'legacy' as storage_type, id from approval_request
			where organization_id = ${organizationId} and id = ${id}::uuid
			union all
			select 'workflow' as storage_type, id from approval_workflow
			where organization_id = ${organizationId} and id = ${id}::uuid
		`),
	);
	if (matches.length === 0) {
		throw new ApprovalMaintenanceError(
			"APPROVAL_NOT_FOUND",
			`Approval ${id} not found in organization ${organizationId}`,
		);
	}
	if (matches.length !== 1) {
		throw new ApprovalMaintenanceError(
			"APPROVAL_AMBIGUOUS",
			`Approval ${id} is ambiguous: it exists in both approval stores`,
		);
	}
	const kind = matches[0].storage_type;
	if (kind !== "legacy" && kind !== "workflow") {
		throw new Error("Unexpected approval storage type");
	}

	const lifecycle = await resolveLifecycle(transaction, organizationId, kind, id);
	const legacyIds: string[] = [];
	const workflowIds: string[] = [];
	const chainIds: string[] = [];
	for (const row of lifecycle) {
		switch (row.kind) {
			case "legacy":
				legacyIds.push(rowId(row));
				break;
			case "workflow":
				workflowIds.push(rowId(row));
				break;
			case "chain":
				chainIds.push(rowId(row));
				break;
		}
	}

	await clearWorkflowSourceReferences(transaction, organizationId, workflowIds);
	if (legacyIds.length > 0) {
		await transaction.execute(sql`
			update work_period set deletion_approval_request_id = null
			where organization_id = ${organizationId}
				and deletion_approval_request_id = any(${sql.param(legacyIds)}::uuid[])
		`);
	}

	const deletedIds = async (query: SQL) => rows(await transaction.execute(query)).map(rowId);
	// Chains cascade to their stages, removing the non-cascading legacy request FK.
	const chains = chainIds.length === 0 ? [] : await deletedIds(sql`
			delete from approval_chain_instance
			where organization_id = ${organizationId} and id = any(${sql.param(chainIds)}::uuid[])
			returning id
		`);
	const legacyRequests = legacyIds.length === 0 ? [] : await deletedIds(sql`
			delete from approval_request
			where organization_id = ${organizationId} and id = any(${sql.param(legacyIds)}::uuid[])
			returning id
		`);
	// Workflow FKs cascade through stages, assignments, events, commands, projections,
	// outbox/deliveries and migration issues. No decision handlers are invoked.
	const workflows = workflowIds.length === 0 ? [] : await deletedIds(sql`
			delete from approval_workflow
			where organization_id = ${organizationId} and id = any(${sql.param(workflowIds)}::uuid[])
			returning id
		`);

	return {
		legacyRequests: legacyRequests.sort(),
		workflows: workflows.sort(),
		chains: chains.sort(),
	};
}
