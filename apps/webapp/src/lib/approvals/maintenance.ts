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
		union all
		-- Legacy evidence stays addressable after cancellation deletes its request.
		select 'legacy_evidence' as storage_type, id, organization_id, 'captured',
			source_type, source_id,
			to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as created_at_utc
		from approval_submitted_revision
		where organization_id = ${organizationId} and authority = 'legacy'
		union all
		-- Legacy escalation transfers likewise outlive a cancelled request.
		select 'legacy_transfer' as storage_type, id, organization_id, 'transferred',
			'approval_request', legacy_approval_request_id,
			to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as created_at_utc
		from approval_escalation_transfer
		where organization_id = ${organizationId} and authority_mode = 'legacy'
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
			-- Legacy evidence records the lifecycle rows it was captured for; these
			-- are verified links, not a shared source ID.
			union all
			select 'legacy_evidence', id, 'legacy', legacy_approval_request_id
			from approval_submitted_revision
			where organization_id = ${organizationId} and authority = 'legacy'
			union all
			select 'legacy_evidence', id, 'chain', legacy_chain_instance_id
			from approval_submitted_revision
			where organization_id = ${organizationId} and authority = 'legacy'
				and legacy_chain_instance_id is not null
			union all
			select 'legacy_evidence', id, 'workflow', observed_workflow_id
			from approval_submitted_revision
			where organization_id = ${organizationId} and authority = 'legacy'
				and observed_workflow_id is not null
			-- Legacy escalation transfers record the request they moved and the
			-- shadow observation they mirrored into.
			union all
			select 'legacy_transfer', id, 'legacy', legacy_approval_request_id from approval_escalation_transfer
			where organization_id = ${organizationId} and authority_mode = 'legacy'
			union all
			select 'legacy_transfer', id, 'workflow', observed_workflow_id from approval_escalation_transfer
			where organization_id = ${organizationId} and authority_mode = 'legacy'
				and observed_workflow_id is not null
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

export interface DeletedApprovalEvidenceRecords {
	submittedRevisions: string[];
	decisionEvidence: string[];
	reviewBindings: string[];
	/** Provider invocation associations of the lifecycle's decisions (#290). */
	invocations: string[];
}

export interface DeletedApprovalRecords {
	legacyRequests: string[];
	workflows: string[];
	chains: string[];
	evidence: DeletedApprovalEvidenceRecords;
	/** Escalation transfer journal entries; their delivery events cascade. */
	escalationTransfers: string[];
	/**
	 * Approval-card delivery (#291): outstanding and past work, every tracked
	 * remote message, and the lifecycle intents of legacy lifecycles (#296).
	 */
	delivery: { work: string[]; messages: string[]; intents: string[] };
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
			approval_workflow, approval_workflow_stage, approval_submitted_revision,
			approval_review_binding, approval_decision_evidence, approval_escalation_transfer,
			approval_invocation, approval_delivery_work, approval_delivery_message,
			approval_delivery_intent
			in share row exclusive mode
	`);

	const matches = rows(
		await transaction.execute(sql`
			select 'legacy' as storage_type, id from approval_request
			where organization_id = ${organizationId} and id = ${id}::uuid
			union all
			select 'workflow' as storage_type, id from approval_workflow
			where organization_id = ${organizationId} and id = ${id}::uuid
			union all
			select 'legacy_evidence' as storage_type, id from approval_submitted_revision
			where organization_id = ${organizationId} and id = ${id}::uuid
				and authority = 'legacy'
			union all
			select 'legacy_transfer' as storage_type, id from approval_escalation_transfer
			where organization_id = ${organizationId} and id = ${id}::uuid
				and authority_mode = 'legacy'
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
	if (
		kind !== "legacy" &&
		kind !== "workflow" &&
		kind !== "legacy_evidence" &&
		kind !== "legacy_transfer"
	) {
		throw new Error("Unexpected approval storage type");
	}

	const lifecycle = await resolveLifecycle(transaction, organizationId, kind, id);
	const legacyIds: string[] = [];
	const workflowIds: string[] = [];
	const chainIds: string[] = [];
	const legacyRevisionIds: string[] = [];
	const legacyTransferIds: string[] = [];
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
			case "legacy_evidence":
				legacyRevisionIds.push(rowId(row));
				break;
			case "legacy_transfer":
				legacyTransferIds.push(rowId(row));
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
	// Delivery of legacy lifecycles (#296) follows the lifecycle's legacy requests.
	// Delete it before the requests (whose FKs would cascade it unreported); a
	// late send completing afterwards cannot record a message (its FK fails).
	const legacyDeliveryScope = sql`organization_id = ${organizationId} and legacy_approval_request_id = any(${sql.param(legacyIds)}::uuid[])`;
	const legacyDeliveryWork = legacyIds.length === 0 ? [] : await deletedIds(sql`
			delete from approval_delivery_work where lifecycle = 'legacy' and ${legacyDeliveryScope} returning id
		`);
	const legacyDeliveryMessages = legacyIds.length === 0 ? [] : await deletedIds(sql`
			delete from approval_delivery_message where lifecycle = 'legacy' and ${legacyDeliveryScope} returning id
		`);
	const deliveryIntents = legacyIds.length === 0 ? [] : await deletedIds(sql`
			delete from approval_delivery_intent where ${legacyDeliveryScope} returning id
		`);
	const legacyRequests = legacyIds.length === 0 ? [] : await deletedIds(sql`
			delete from approval_request
			where organization_id = ${organizationId} and id = any(${sql.param(legacyIds)}::uuid[])
			returning id
		`);
	// Evidence follows only the verified workflow links of this lifecycle. Delete it
	// explicitly (dependants first) so the audit records its identities; the workflow
	// FKs also prevent a late capture from recreating purged evidence.
	const evidenceScope = sql`organization_id = ${organizationId}
		and workflow_id = any(${sql.param(workflowIds)}::uuid[])`;
	// Delivery work and tracked messages follow the same workflow links. Delete
	// them explicitly, before the escalation journal their replacement delivery
	// work cascades from, so the audit records the work and the remote message
	// identities; a late send completing afterwards cannot record a message (its
	// FKs fail).
	const deliveryWork = workflowIds.length === 0 ? [] : await deletedIds(sql`
			delete from approval_delivery_work where ${evidenceScope} returning id
		`);
	const deliveryMessages = workflowIds.length === 0 ? [] : await deletedIds(sql`
			delete from approval_delivery_message where ${evidenceScope} returning id
		`);
	// Escalation journals follow the same verified workflow links; their FKs to the
	// workflow, its assignments and events likewise prevent late recreation.
	const escalationTransfers = workflowIds.length === 0 ? [] : await deletedIds(sql`
			delete from approval_escalation_transfer where ${evidenceScope} returning id
		`);
	// Legacy transfers have no workflow; they follow the links they recorded.
	// Their delivery events cascade.
	if (legacyTransferIds.length > 0) {
		escalationTransfers.push(
			...(await deletedIds(sql`
				delete from approval_escalation_transfer
				where organization_id = ${organizationId} and authority_mode = 'legacy'
					and id = any(${sql.param(legacyTransferIds)}::uuid[])
				returning id
			`)),
		);
	}
	// Invocation associations reference their decision and binding; delete them
	// first so the audit records them and a late redelivery cannot replay.
	const invocations: string[] = workflowIds.length === 0 ? [] : await deletedIds(sql`
			delete from approval_invocation where ${evidenceScope} returning id
		`);
	const decisionEvidence: string[] = workflowIds.length === 0 ? [] : await deletedIds(sql`
			delete from approval_decision_evidence where ${evidenceScope} returning id
		`);
	const reviewBindings: string[] = workflowIds.length === 0 ? [] : await deletedIds(sql`
			delete from approval_review_binding where ${evidenceScope} returning id
		`);
	const submittedRevisions: string[] = workflowIds.length === 0 ? [] : await deletedIds(sql`
			delete from approval_submitted_revision where ${evidenceScope} returning id
		`);
	// Legacy evidence has no workflow; it follows the lifecycle rows it recorded.
	const legacyScope = sql`organization_id = ${organizationId} and authority = 'legacy'
		and submitted_revision_id = any(${sql.param(legacyRevisionIds)}::uuid[])`;
	if (legacyRevisionIds.length > 0) {
		// Invocations and bindings of legacy card decisions (#296): dependants
		// first, so the audit records them and a late redelivery cannot replay.
		invocations.push(
			...(await deletedIds(sql`
				delete from approval_invocation
				where organization_id = ${organizationId} and authority = 'legacy'
					and decision_evidence_id in (
						select id from approval_decision_evidence where ${legacyScope}
					)
				returning id
			`)),
		);
		decisionEvidence.push(
			...(await deletedIds(sql`
				delete from approval_decision_evidence where ${legacyScope} returning id
			`)),
		);
		reviewBindings.push(
			...(await deletedIds(sql`
				delete from approval_review_binding where ${legacyScope} returning id
			`)),
		);
		submittedRevisions.push(
			...(await deletedIds(sql`
				delete from approval_submitted_revision
				where organization_id = ${organizationId} and authority = 'legacy'
					and id = any(${sql.param(legacyRevisionIds)}::uuid[])
				returning id
			`)),
		);
	}
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
		evidence: {
			submittedRevisions: submittedRevisions.sort(),
			decisionEvidence: decisionEvidence.sort(),
			reviewBindings: reviewBindings.sort(),
			invocations: invocations.sort(),
		},
		escalationTransfers: escalationTransfers.sort(),
		delivery: {
			work: [...deliveryWork, ...legacyDeliveryWork].sort(),
			messages: [...deliveryMessages, ...legacyDeliveryMessages].sort(),
			intents: deliveryIntents.sort(),
		},
	};
}

/**
 * Whole-history cleanup participation for manual time submission, policy
 * clock-out (#302) and time correction (#301) evidence. Paths that delete an organization's (or some
 * employees') work history remove the lifecycle evidence describing it before
 * the history and the employees, dependants first, so employee FKs never block
 * the delete. It runs in the caller's transaction when the caller has one; the
 * demo cleanup paths call it per employee inside its coordinated history
 * transaction (#285). Other kinds are untouched.
 */
export async function deleteWorkPeriodApprovalEvidence(
	transaction: ApprovalTransactionClient,
	input: { organizationId: string; employeeIds: readonly string[] | "all" },
): Promise<DeletedApprovalEvidenceRecords> {
	const none: DeletedApprovalEvidenceRecords = {
		submittedRevisions: [],
		decisionEvidence: [],
		reviewBindings: [],
		invocations: [],
	};
	if (input.employeeIds !== "all" && input.employeeIds.length === 0) return none;
	// Any lifecycle naming a deleted employee as subject, requester, submitter or
	// deciding actor goes: those references are FKs without cascade.
	const employees = input.employeeIds === "all" ? null : sql.param([...input.employeeIds]);
	const subjects =
		employees === null
			? sql`true`
			: sql`(subject_employee_id = any(${employees}::uuid[])
				or requester_employee_id = any(${employees}::uuid[])
				or submitter_employee_id = any(${employees}::uuid[])
				or id in (
					select submitted_revision_id from approval_decision_evidence
					where organization_id = ${input.organizationId}
						and actor_employee_id = any(${employees}::uuid[])
				))`;
	const revisionIds = rows(
		await transaction.execute(sql`
			select id from approval_submitted_revision
			where organization_id = ${input.organizationId}
				and workflow_type in ('manual_time_submission', 'policy_clock_out', 'time_correction')
				and source_type = 'time_entry'
				and ${subjects}
			for update
		`),
	).map(rowId);
	if (revisionIds.length === 0) return none;
	const deletedIds = async (query: SQL) => rows(await transaction.execute(query)).map(rowId);
	const scope = sql`organization_id = ${input.organizationId}`;
	const revisions = sql`${sql.param(revisionIds)}::uuid[]`;
	const invocations = await deletedIds(sql`
		delete from approval_invocation
		where ${scope} and decision_evidence_id in (
			select id from approval_decision_evidence
			where ${scope} and submitted_revision_id = any(${revisions})
		)
		returning id
	`);
	const decisionEvidence = await deletedIds(sql`
		delete from approval_decision_evidence
		where ${scope} and submitted_revision_id = any(${revisions})
		returning id
	`);
	const reviewBindings = await deletedIds(sql`
		delete from approval_review_binding
		where ${scope} and submitted_revision_id = any(${revisions})
		returning id
	`);
	const submittedRevisions = await deletedIds(sql`
		delete from approval_submitted_revision
		where ${scope} and id = any(${revisions})
		returning id
	`);
	return {
		submittedRevisions: submittedRevisions.sort(),
		decisionEvidence: decisionEvidence.sort(),
		reviewBindings: reviewBindings.sort(),
		invocations: invocations.sort(),
	};
}
