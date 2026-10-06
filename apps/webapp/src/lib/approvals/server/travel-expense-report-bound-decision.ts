import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import { member } from "@/db/auth-schema";
import { approvalRequest, employee } from "@/db/schema";
import { createLogger } from "@/lib/logger";
import {
	findCommittedInvocationDecision,
	requireLegacyInvocationDecision,
} from "../evidence/invocation";
import { loadLegacyReviewBinding, loadLegacySubmittedRevisionSource } from "../evidence/store";
import { TRAVEL_EXPENSE_REPORT_SOURCE_TYPE } from "../evidence/travel-expense-report-store";
import {
	type BoundTravelExpenseInvocationResult,
	classifyBoundTravelExpenseError,
	decideBoundTravelExpenseInvocation,
} from "./travel-expense-approvals";
import {
	afterTravelExpenseReportDecision,
	executeTravelExpenseReportDecisionInTransaction,
	type TravelExpenseReportDecisionInput,
	type TravelExpenseReportDecisionOutcome,
} from "./travel-expense-report-approvals";
import {
	boundReportInvocationCommand,
	type TravelExpenseReportBoundInvocation,
} from "./travel-expense-report-bound-invocation";
import type { ApprovalAction, ApprovalDatabase, ApprovalDbService, CurrentApprover } from "./types";

const logger = createLogger("TravelExpenseReportBoundDecision");

type BoundLegacyTravelExpenseInput = Parameters<typeof decideBoundTravelExpenseInvocation>[0];

/**
 * A reviewed-binding expense report decision from an authenticated bot
 * invocation (#623), like an expense claim's (#296). The actor comes from
 * verified provider linkage. An exact committed invocation replays first,
 * before any current state is read. Otherwise the authority is the exact
 * bound legacy request only; neither eligible-manager fallback nor
 * organization management is reachable from a card, so a stale, superseded or
 * transferred card needs authenticated review. Infrastructure errors propagate.
 */
export async function decideBoundTravelExpenseReportInvocation(input: {
	database: ApprovalDatabase;
	organizationId: string;
	actorEmployeeId: string;
	actorUserId: string;
	bindingId: string;
	action: ApprovalAction;
	reason?: string;
	invocation: Omit<TravelExpenseReportBoundInvocation, "bindingId">;
}): Promise<BoundTravelExpenseInvocationResult> {
	const { database } = input;
	try {
		const committed = await findCommittedInvocationDecision(database, {
			identity: input.invocation.identity,
			command: boundReportInvocationCommand({
				actor: { id: input.actorEmployeeId, userId: input.actorUserId },
				action: input.action,
				reason: input.reason,
				bound: { bindingId: input.bindingId, providerActorId: input.invocation.providerActorId },
			}),
		});
		if (committed) {
			return {
				status: "decided",
				replayed: true,
				evidence: requireLegacyInvocationDecision(committed),
			};
		}
	} catch (error) {
		return classifyBoundTravelExpenseError(error);
	}
	const [memberships, binding, actors] = await Promise.all([
		database
			.select({ id: member.id })
			.from(member)
			.where(
				and(
					eq(member.organizationId, input.organizationId),
					eq(member.userId, input.actorUserId),
					eq(member.status, "approved"),
				),
			)
			.limit(1),
		loadLegacyReviewBinding(database, {
			organizationId: input.organizationId,
			bindingId: input.bindingId,
		}),
		database.query.employee.findMany({
			where: and(
				eq(employee.id, input.actorEmployeeId),
				eq(employee.organizationId, input.organizationId),
				eq(employee.isActive, true),
			),
			with: { user: true },
			limit: 2,
		}),
	]);
	const actor = actors[0];
	if (
		memberships.length !== 1 ||
		!binding ||
		binding.recipientEmployeeId !== input.actorEmployeeId ||
		actors.length !== 1 ||
		!actor ||
		actor.userId !== input.actorUserId
	) {
		return { status: "not_found" };
	}
	const [request] = await database
		.select({ reportId: approvalRequest.entityId })
		.from(approvalRequest)
		.where(
			and(
				eq(approvalRequest.id, binding.legacyApprovalRequestId),
				eq(approvalRequest.organizationId, input.organizationId),
				eq(approvalRequest.entityType, TRAVEL_EXPENSE_REPORT_SOURCE_TYPE),
			),
		)
		.limit(1);
	if (!request) return { status: "not_found" };
	const query: ApprovalDbService["query"] = <T>(_name: string, operation: () => Promise<T>) =>
		Effect.promise(operation);
	const decision: TravelExpenseReportDecisionInput = {
		organizationId: input.organizationId,
		reportId: request.reportId,
		actor: actor as CurrentApprover,
		action: input.action,
		...(input.reason === undefined ? {} : { reason: input.reason }),
		bound: { ...input.invocation, bindingId: binding.id },
	};
	let outcome: TravelExpenseReportDecisionOutcome;
	try {
		outcome = await database.transaction((transaction) =>
			executeTravelExpenseReportDecisionInTransaction(transaction, query, decision),
		);
	} catch (error) {
		return classifyBoundTravelExpenseError(error);
	}
	await afterTravelExpenseReportDecision(database, decision, outcome).catch((error) =>
		logger.error({ error, reportId: request.reportId }, "Report decision follow-up failed"),
	);
	return { status: "decided", replayed: outcome.kind === "replayed", evidence: outcome.evidence };
}

/**
 * Routes a legacy `travel_expense` binding to its subject's owner (#623).
 * Claims and reports share the workflow kind, so the binding's immutable
 * submitted revision names the subject; bindings and revisions outlive their
 * committed invocations, so exact replays keep reaching the same owner.
 */
export async function decideBoundLegacyTravelExpenseInvocation(
	input: BoundLegacyTravelExpenseInput,
): Promise<BoundTravelExpenseInvocationResult> {
	const binding = await loadLegacyReviewBinding(input.database, {
		organizationId: input.organizationId,
		bindingId: input.bindingId,
	});
	const source = binding
		? await loadLegacySubmittedRevisionSource(input.database, {
				organizationId: input.organizationId,
				submittedRevisionId: binding.submittedRevisionId,
			})
		: null;
	return source?.sourceType === TRAVEL_EXPENSE_REPORT_SOURCE_TYPE
		? decideBoundTravelExpenseReportInvocation(input)
		: decideBoundTravelExpenseInvocation(input);
}
