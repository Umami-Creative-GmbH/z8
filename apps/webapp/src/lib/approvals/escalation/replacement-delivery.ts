import { sql } from "drizzle-orm";
import { db } from "@/db";
import type { ApprovalDeliveryProvider } from "@/db/schema";
import { type Instant, systemClock } from "@/lib/datetime/temporal-core";
import {
	type ApprovalDeliveryOutcome,
	executeApprovalDeliveryWork,
	loadApprovalDeliveryAdapter,
} from "../delivery/owner";
import { resolveRecordedLegacyDeliveryCycle } from "../delivery/intents";
import {
	cancelObsoleteReplacementDeliveryWork,
	claimApprovalDeliveryWork,
	type LegacyDeliveryLifecycle,
	planApprovalMessageRefreshes,
	planLegacyEscalationTransferDelivery,
	planReplacementDeliveryWork,
	type UntrackedApprovalCard,
} from "../delivery/store";
import type { ApprovalWorkflowType } from "../workflow/ports";

// ============================================
// ESCALATION REPLACEMENT DELIVERY (#300)
// ============================================
// Escalation owns the delivery lifecycle of its transfers: it expands each
// committed transfer event into the replacement card per intended channel and
// the retirement of the former assignment's tracked cards, then leases and
// executes that work. Transport, message tracking, leases, retries and
// attention are the delivery owner's shared mechanics (#291); a refresh has
// one row and one executor whichever owner planned it first.

export const DEFAULT_REPLACEMENT_DELIVERY_BATCH_LIMIT = 50;

function rows(result: unknown): Record<string, unknown>[] {
	if (!result || typeof result !== "object" || !("rows" in result)) return [];
	const value = (result as { rows?: unknown }).rows;
	return Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
}

function text(value: unknown, field: string): string {
	if (typeof value !== "string") {
		throw new Error(`Escalation transfer event has no ${field}`);
	}
	return value;
}

export interface EscalationTransferExpansionSummary {
	expanded: number;
	planned: number;
}

/**
 * Expands committed transfer events, each exactly once. The intended channels
 * are frozen at this first successful expansion: providers whose delivery
 * control for the kind was active when the transfer committed and whose
 * escalation delivery is enabled now. Later configuration changes never add
 * channels; disablement is rechecked before every send. The former holder's
 * tracked cards are retired whatever the channels. Events stay locked until
 * their work has committed, so a crash re-expands them and expansion can never
 * repeat the authority transfer.
 *
 * Legacy-authoritative transfers (#408) of absences and travel expenses are
 * expanded into their legacy lifecycle while the kind has legacy authority; an
 * event waits (pending) while it does not, so it never acts under canonical
 * authority. Legacy time transfers (#439) have no legacy delivery lifecycle
 * yet (#432) and wait too.
 */
export async function expandEscalationTransferEvents(input: {
	organizationId: string;
	limit: number;
	workflowId?: string;
}): Promise<EscalationTransferExpansionSummary> {
	return db.transaction(async (transaction) => {
		const events = rows(
			await transaction.execute(sql`
				select e.id, t.id as transfer_id, t.authority_mode, t.workflow_type, t.workflow_id,
					t.source_assignment_id, t.replacement_assignment_id,
					t.replacement_approver_employee_id, t.source_approver_employee_id,
					t.legacy_approval_request_id,
					e.payload->>'sourceType' as source_type, e.payload->>'sourceId' as source_id,
					former.user_id as former_user_id,
					array(
						select c.provider from approval_delivery_control c
						where c.organization_id = t.organization_id
							and c.workflow_type = t.workflow_type
						order by c.provider
					) as owned_providers,
					array(
						select c.provider from approval_delivery_control c
						where c.organization_id = t.organization_id
							and c.workflow_type = t.workflow_type
							and c.activated_at <= t.created_at
						order by c.provider
					) as providers
				from approval_escalation_transfer_event e
				join approval_escalation_transfer t
					on t.id = e.transfer_id and t.organization_id = e.organization_id
				join employee former
					on former.id = t.source_approver_employee_id
					and former.organization_id = t.organization_id
				left join approval_workflow_rollout r
					on r.organization_id = t.organization_id and r.workflow_type = t.workflow_type
				where e.organization_id = ${input.organizationId}
					and e.expansion_status = 'pending'
					and (
						t.authority_mode = 'canonical'
						or (
							t.authority_mode = 'legacy'
							and (r.lifecycle_mode is null or r.lifecycle_mode not in ('canonical', 'complete'))
							and (
								(t.workflow_type = 'absence' and e.payload->>'sourceType' = 'absence_entry')
								or (t.workflow_type = 'travel_expense'
									and e.payload->>'sourceType' = 'travel_expense_claim')
							)
						)
					)
					${input.workflowId ? sql`and t.workflow_id = ${input.workflowId}::uuid` : sql``}
				order by e.created_at, e.id
				limit ${input.limit}
				for update of e skip locked
			`),
		);
		if (events.length === 0) return { expanded: 0, planned: 0 };
		const accepts = new Map<ApprovalDeliveryProvider, boolean>();
		const acceptsEscalations = async (provider: ApprovalDeliveryProvider) => {
			let accepted = accepts.get(provider);
			if (accepted === undefined) {
				const adapter = await loadApprovalDeliveryAdapter(provider);
				accepted = await adapter.acceptsEscalationDelivery(input.organizationId);
				accepts.set(provider, accepted);
			}
			return accepted;
		};
		let planned = 0;
		for (const event of events) {
			const transferId = text(event.transfer_id, "transfer");
			const controlled = Array.isArray(event.providers)
				? (event.providers as ApprovalDeliveryProvider[])
				: [];
			const providers: ApprovalDeliveryProvider[] = [];
			for (const provider of controlled) {
				if (await acceptsEscalations(provider)) providers.push(provider);
			}
			if (event.authority_mode === "legacy") {
				planned += await planLegacyTransfer(transaction, {
					organizationId: input.organizationId,
					transferId,
					event,
					providers,
				});
				continue;
			}
			const workflowId = text(event.workflow_id, "workflow");
			planned += await planReplacementDeliveryWork(transaction, {
				organizationId: input.organizationId,
				workflowId,
				escalationTransferId: transferId,
				replacementAssignmentId: text(event.replacement_assignment_id, "replacement assignment"),
				recipientEmployeeId: text(event.replacement_approver_employee_id, "replacement approver"),
				providers,
			});
			planned += await planApprovalMessageRefreshes(transaction, {
				organizationId: input.organizationId,
				workflowId,
				outboxId: null,
				assignmentId: text(event.source_assignment_id, "source assignment"),
				escalationTransferId: transferId,
			});
		}
		const ids = events.map((event) => text(event.id, "event"));
		await transaction.execute(sql`
			update approval_escalation_transfer_event
			set expansion_status = 'expanded', expanded_at = now()
			where organization_id = ${input.organizationId}
				and id = any(${sql.param(ids)}::uuid[])
		`);
		return { expanded: events.length, planned };
	});
}

type DatabaseTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * One legacy transfer (#408) into its legacy lifecycle: absences deliver per
 * submission cycle (#384), expense claims per claim (#296). The former
 * holder's cards that the old notification path sent are adopted from every
 * provider that has a delivery control for the kind now (only those can be
 * claimed), so they are retired with the owner's own.
 */
async function planLegacyTransfer(
	transaction: DatabaseTransaction,
	input: {
		organizationId: string;
		transferId: string;
		event: Record<string, unknown>;
		providers: readonly ApprovalDeliveryProvider[];
	},
): Promise<number> {
	const { event } = input;
	const owned = Array.isArray(event.owned_providers)
		? (event.owned_providers as ApprovalDeliveryProvider[])
		: [];
	// Without a delivery control for the kind no card of it is owned and
	// nothing could be claimed: the event expands to nothing.
	if (owned.length === 0) return 0;
	const workflowType = text(event.workflow_type, "workflow type") as ApprovalWorkflowType;
	const approvalRequestId = text(event.legacy_approval_request_id, "legacy request");
	const formerUserId = text(event.former_user_id, "former approver user");
	const lifecycle: LegacyDeliveryLifecycle = {
		workflowType,
		sourceType: text(event.source_type, "source type"),
		sourceId: text(event.source_id, "source"),
		cycleId:
			workflowType === "absence"
				? await resolveRecordedLegacyDeliveryCycle(transaction, {
						organizationId: input.organizationId,
						approvalRequestId,
					})
				: null,
	};
	const untrackedFormerCards: UntrackedApprovalCard[] = [];
	for (const provider of owned) {
		const adapter = await loadApprovalDeliveryAdapter(provider);
		if (!adapter.listUntrackedLegacyCards) continue;
		untrackedFormerCards.push(
			...(await adapter.listUntrackedLegacyCards({
				organizationId: input.organizationId,
				approvalRequestId,
				recipientUserId: formerUserId,
			})),
		);
	}
	return planLegacyEscalationTransferDelivery(transaction, {
		organizationId: input.organizationId,
		escalationTransferId: input.transferId,
		lifecycle,
		approvalRequestId,
		formerApproverEmployeeId: text(event.source_approver_employee_id, "former approver"),
		replacementApproverEmployeeId: text(
			event.replacement_approver_employee_id,
			"replacement approver",
		),
		providers: input.providers,
		untrackedFormerCards,
	});
}

export interface EscalationReplacementDeliverySummary {
	organizationId: string;
	expanded: number;
	planned: number;
	cancelled: number;
	claimed: number;
	outcomes: Partial<Record<ApprovalDeliveryOutcome, number>>;
}

/**
 * The escalation module's "process due delivery work" operation (#255 §1):
 * one bounded, organization-scoped pass that expands committed transfer
 * events, cancels replacement work whose assignment is no longer current,
 * and leases and executes due escalation work (replacement cards and the
 * retirements it planned). It runs whether or not escalation automation is
 * paused: committed transfers keep their delivery recovery. Callers supply
 * scope and limits only.
 */
export async function processEscalationReplacementDeliveries(input: {
	organizationId: string;
	limit?: number;
	workflowId?: string;
	now?: Instant;
}): Promise<EscalationReplacementDeliverySummary> {
	if (!input.organizationId) {
		throw new Error("Escalation replacement delivery requires organization scope");
	}
	const limit = input.limit ?? DEFAULT_REPLACEMENT_DELIVERY_BATCH_LIMIT;
	const scope = input.workflowId ? { workflowId: input.workflowId } : {};
	const expansion = await expandEscalationTransferEvents({
		organizationId: input.organizationId,
		limit,
		...scope,
	});
	const cancelled = await cancelObsoleteReplacementDeliveryWork({
		organizationId: input.organizationId,
		...scope,
	});
	const claimed = await claimApprovalDeliveryWork({
		organizationId: input.organizationId,
		owner: "escalation",
		limit,
		now: input.now ?? systemClock.nowInstant(),
		...scope,
	});
	const outcomes = await executeApprovalDeliveryWork(claimed, input.now);
	return {
		organizationId: input.organizationId,
		expanded: expansion.expanded,
		planned: expansion.planned,
		cancelled,
		claimed: claimed.length,
		outcomes,
	};
}
