import { sql } from "drizzle-orm";
import { db } from "@/db";
import type { ApprovalDeliveryProvider } from "@/db/schema";
import { type Instant, systemClock } from "@/lib/datetime/temporal-core";
import {
	type ApprovalDeliveryOutcome,
	executeApprovalDeliveryWork,
	loadApprovalDeliveryAdapter,
} from "../delivery/owner";
import {
	cancelObsoleteReplacementDeliveryWork,
	claimApprovalDeliveryWork,
	planApprovalMessageRefreshes,
	planReplacementDeliveryWork,
} from "../delivery/store";

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
 * Expands committed canonical transfer events, each exactly once. The
 * intended channels are frozen at this first successful expansion: providers
 * whose delivery control for the kind was active when the transfer committed
 * and whose escalation delivery is enabled now. Later configuration changes
 * never add channels; disablement is rechecked before every send. The former
 * assignment's tracked cards are retired whatever the channels. Events stay
 * locked until their work has committed, so a crash re-expands them and
 * expansion can never repeat the authority transfer.
 *
 * Legacy-authoritative transfers (#299) have no workflow the shared delivery
 * tables can name; their events stay pending until legacy delivery exists.
 */
export async function expandEscalationTransferEvents(input: {
	organizationId: string;
	limit: number;
	workflowId?: string;
}): Promise<EscalationTransferExpansionSummary> {
	return db.transaction(async (transaction) => {
		const events = rows(
			await transaction.execute(sql`
				select e.id, t.id as transfer_id, t.workflow_id, t.source_assignment_id,
					t.replacement_assignment_id, t.replacement_approver_employee_id,
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
				where e.organization_id = ${input.organizationId}
					and e.expansion_status = 'pending'
					and t.authority_mode = 'canonical'
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
			const workflowId = text(event.workflow_id, "workflow");
			const controlled = Array.isArray(event.providers)
				? (event.providers as ApprovalDeliveryProvider[])
				: [];
			const providers: ApprovalDeliveryProvider[] = [];
			for (const provider of controlled) {
				if (await acceptsEscalations(provider)) providers.push(provider);
			}
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
