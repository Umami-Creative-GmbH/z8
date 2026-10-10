import "server-only";

import { aliasedTable, and, eq, inArray, lt } from "drizzle-orm";
import type { db } from "@/db";
import { user } from "@/db/auth-schema";
import {
	approvalChainStageInstance,
	approvalDeputyDecision,
	auditLog,
	employee,
} from "@/db/schema";
import { dateFromInstant, type Instant, systemClock } from "@/lib/datetime/temporal-core";
import { deriveCommandDecisionOutcome } from "../evidence/decision-outcome";
import type { ApprovalCommandResult } from "../workflow/ports";
import type { ApprovalWorkflowCommand } from "../workflow/state-machine";
import { loadCover } from "./covering-store";
import {
	type ActingFor,
	decideDeputyRight,
	deputyActorLabel,
	deputyDecisionRefusalError,
} from "./deputy-decision";

/**
 * Deputy decisions (#1016) against the database: the legacy authorization
 * check, the acting-for record and its reads. Everything is
 * organization-scoped, uses the caller's executor (a decision transaction
 * when deciding) and never takes an approval gate.
 */

type Database = typeof db;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
export type DeputyDecisionExecutor = Pick<Database | Transaction, "select" | "insert">;
export type DeputyDecisionReader = Pick<Database | Transaction, "select">;

export type DeputyDecisionEntityType = "absence_entry" | "time_entry" | "travel_expense_report";

/** The approval kinds a covering deputy may decide (spec #802). */
export const DEPUTY_DECISION_ENTITY_TYPES: readonly DeputyDecisionEntityType[] = [
	"absence_entry",
	"time_entry",
	"travel_expense_report",
];

export function isDeputyDecisionEntityType(value: string): value is DeputyDecisionEntityType {
	return (DEPUTY_DECISION_ENTITY_TYPES as readonly string[]).includes(value);
}

/**
 * Whether the actor approved or rejected an earlier step of the legacy chain
 * this request is a stage of. Single-stage requests have no earlier step.
 */
export async function legacyDecidedEarlierStage(
	executor: DeputyDecisionReader,
	input: { organizationId: string; approvalRequestId: string; actorEmployeeId: string },
): Promise<boolean> {
	const [current] = await executor
		.select({
			chainInstanceId: approvalChainStageInstance.chainInstanceId,
			stepOrder: approvalChainStageInstance.stepOrder,
		})
		.from(approvalChainStageInstance)
		.where(
			and(
				eq(approvalChainStageInstance.organizationId, input.organizationId),
				eq(approvalChainStageInstance.approvalRequestId, input.approvalRequestId),
			),
		)
		.limit(1);
	if (!current) return false;
	const [earlier] = await executor
		.select({ id: approvalChainStageInstance.id })
		.from(approvalChainStageInstance)
		.where(
			and(
				eq(approvalChainStageInstance.organizationId, input.organizationId),
				eq(approvalChainStageInstance.chainInstanceId, current.chainInstanceId),
				lt(approvalChainStageInstance.stepOrder, current.stepOrder),
				eq(approvalChainStageInstance.decidedBy, input.actorEmployeeId),
				inArray(approvalChainStageInstance.status, ["approved", "rejected"]),
			),
		)
		.limit(1);
	return earlier !== undefined;
}

/**
 * The legacy deputy right on a pending request whose approver is not the
 * actor and who has no own right: the acting-for approver, or a typed refusal
 * ("not authorized", or the four-eyes message).
 */
export async function authorizeLegacyDeputyDecision(
	executor: DeputyDecisionReader,
	input: {
		organizationId: string;
		approvalRequestId: string;
		entityType: string;
		approverEmployeeId: string;
		actorEmployeeId: string;
		action: string;
		at: Instant;
	},
): Promise<ActingFor> {
	const refuse = (reason: "not_covering" | "four_eyes") =>
		deputyDecisionRefusalError(reason, {
			actorEmployeeId: input.actorEmployeeId,
			resource: input.entityType,
			action: input.action,
		});
	if (!isDeputyDecisionEntityType(input.entityType)) throw refuse("not_covering");
	const cover = await loadCover(executor, {
		organizationId: input.organizationId,
		approverId: input.approverEmployeeId,
		deputyId: input.actorEmployeeId,
		at: input.at,
	});
	const right = decideDeputyRight({
		actorEmployeeId: input.actorEmployeeId,
		approverEmployeeId: input.approverEmployeeId,
		cover,
		actorDecidedEarlierStage: cover
			? await legacyDecidedEarlierStage(executor, input)
			: false,
	});
	if (right.kind === "refused") throw refuse(right.reason);
	return right.actingFor;
}

/**
 * Whether the actor covers for the request's current approver right now. A
 * request escalation transferred *to* that approver is theirs, so their
 * covering deputy may decide it (default 9); the full right, with four-eyes,
 * is judged later by the legacy decision path.
 */
export async function coversCurrentApprover(
	executor: DeputyDecisionReader,
	input: { organizationId: string; approverEmployeeId: string; actorEmployeeId: string },
): Promise<boolean> {
	if (input.approverEmployeeId === input.actorEmployeeId) return false;
	return (
		(await loadCover(executor, {
			organizationId: input.organizationId,
			approverId: input.approverEmployeeId,
			deputyId: input.actorEmployeeId,
			at: systemClock.nowInstant(),
		})) !== null
	);
}

export interface DeputyDecisionRecordInput {
	organizationId: string;
	deputyEmployeeId: string;
	actingFor: ActingFor;
	authority: "legacy" | "canonical";
	entityType: DeputyDecisionEntityType;
	entityId: string;
	approvalRequestId: string | null;
	workflowId?: string | null;
	assignmentId?: string | null;
	decision: "approved" | "rejected";
	decidedAt?: Date;
}

/** Inserts the acting-for record, in the decision's transaction. */
export async function recordDeputyDecision(
	executor: Pick<Database | Transaction, "insert">,
	input: DeputyDecisionRecordInput,
): Promise<void> {
	await executor.insert(approvalDeputyDecision).values({
		organizationId: input.organizationId,
		deputyEmployeeId: input.deputyEmployeeId,
		actingForEmployeeId: input.actingFor.approverEmployeeId,
		absenceId: input.actingFor.absenceId,
		authority: input.authority,
		entityType: input.entityType,
		entityId: input.entityId,
		approvalRequestId: input.approvalRequestId,
		workflowId: input.workflowId ?? null,
		assignmentId: input.assignmentId ?? null,
		decision: input.decision,
		...(input.decidedAt ? { decidedAt: input.decidedAt } : {}),
	});
}

/** The approval audit entry's metadata for a deputy decision. */
export function deputyDecisionAuditMetadata(actingFor: ActingFor) {
	return {
		deputyDecision: true,
		actingForEmployeeId: actingFor.approverEmployeeId,
		actingForAbsenceId: actingFor.absenceId,
	};
}

/**
 * A canonical deputy decision writes no legacy audit entry, so its owner
 * records the acting-for record and one approval audit entry here, in the
 * decision's transaction.
 */
export async function recordCanonicalDeputyDecision(
	executor: Pick<Database | Transaction, "insert">,
	input: Omit<DeputyDecisionRecordInput, "authority" | "decidedAt"> & {
		workflowId: string;
		assignmentId: string;
		performedByUserId: string;
		decidedAt: Date;
		reason?: string | null;
	},
): Promise<void> {
	// An exact receipt replay returns the committed result again; its record
	// and audit entry already exist (one per assignment).
	const inserted = await executor
		.insert(approvalDeputyDecision)
		.values({
			organizationId: input.organizationId,
			deputyEmployeeId: input.deputyEmployeeId,
			actingForEmployeeId: input.actingFor.approverEmployeeId,
			absenceId: input.actingFor.absenceId,
			authority: "canonical",
			entityType: input.entityType,
			entityId: input.entityId,
			approvalRequestId: input.approvalRequestId,
			workflowId: input.workflowId,
			assignmentId: input.assignmentId,
			decision: input.decision,
			decidedAt: input.decidedAt,
		})
		.onConflictDoNothing()
		.returning({ id: approvalDeputyDecision.id });
	if (inserted.length === 0) return;
	await executor.insert(auditLog).values({
		organizationId: input.organizationId,
		entityType: "approval_request",
		// The audit entity is a uuid; the compatibility row when there is one.
		entityId: input.approvalRequestId ?? input.assignmentId,
		action: input.decision === "approved" ? "approve" : "reject",
		performedBy: input.performedByUserId,
		changes: JSON.stringify({
			from: "pending",
			to: input.decision,
			approvalType: input.entityType,
			targetEntityId: input.entityId,
			...(input.reason ? { reason: input.reason } : {}),
		}),
		metadata: JSON.stringify({
			...deputyDecisionAuditMetadata(input.actingFor),
			authority: "canonical",
			workflowId: input.workflowId,
			assignmentId: input.assignmentId,
		}),
		ipAddress: null,
		userAgent: null,
		timestamp: input.decidedAt,
	});
}

/**
 * After a canonical approve/reject in an owner's transaction: when the
 * committed decision event says a covering deputy acted, records it. Returns
 * whom it acted for, or null for an ordinary decision.
 */
export async function recordCanonicalDeputyDecisionOf(
	executor: Pick<Database | Transaction, "insert">,
	input: {
		organizationId: string;
		command: Extract<ApprovalWorkflowCommand, { type: "approve" | "reject" }>;
		result: ApprovalCommandResult;
		entityType: DeputyDecisionEntityType;
		entityId: string;
		performedByUserId: string;
	},
): Promise<ActingFor | null> {
	// Ordinary decisions carry no acting-for on their decision event.
	const actedFor = input.result.events?.some(
		(event) =>
			(event.eventType === "assignment.approved" || event.eventType === "assignment.rejected") &&
			typeof (event.metadata as Record<string, unknown> | null)?.actingForEmployeeId === "string",
	);
	if (!actedFor) return null;
	const outcome = deriveCommandDecisionOutcome({ command: input.command, result: input.result });
	if (!outcome.actingFor) return null;
	const stage = input.result.snapshot.stages.find((item) => item.id === outcome.stageId);
	await recordCanonicalDeputyDecision(executor, {
		organizationId: input.organizationId,
		deputyEmployeeId: outcome.actor.employeeId,
		actingFor: outcome.actingFor,
		entityType: input.entityType,
		entityId: input.entityId,
		approvalRequestId: stage?.legacyApprovalRequestId ?? null,
		workflowId: input.result.snapshot.id,
		assignmentId: outcome.assignmentId,
		decision: outcome.assignmentOutcome,
		decidedAt: dateFromInstant(outcome.decidedAt),
		performedByUserId: input.performedByUserId,
		reason: input.command.reason ?? null,
	});
	return outcome.actingFor;
}

/** A stored deputy decision with both names, for history and notifications. */
export interface DeputyDecisionView {
	approvalRequestId: string | null;
	entityType: string;
	entityId: string;
	decision: "approved" | "rejected";
	decidedAt: Date;
	absenceId: string | null;
	deputy: { employeeId: string; name: string };
	actingFor: { employeeId: string; name: string };
}

const deputyEmployee = aliasedTable(employee, "deputy_employee");
const deputyUser = aliasedTable(user, "deputy_user");
const actingForEmployee = aliasedTable(employee, "acting_for_employee");
const actingForUser = aliasedTable(user, "acting_for_user");

/** Deputy decisions on these subjects (entity ids), oldest first. */
export async function loadDeputyDecisionsForEntities(
	executor: DeputyDecisionReader,
	input: { organizationId: string; entityIds: readonly string[] },
): Promise<DeputyDecisionView[]> {
	if (input.entityIds.length === 0) return [];
	const rows = await executor
		.select({
			approvalRequestId: approvalDeputyDecision.approvalRequestId,
			entityType: approvalDeputyDecision.entityType,
			entityId: approvalDeputyDecision.entityId,
			decision: approvalDeputyDecision.decision,
			decidedAt: approvalDeputyDecision.decidedAt,
			absenceId: approvalDeputyDecision.absenceId,
			deputyEmployeeId: approvalDeputyDecision.deputyEmployeeId,
			deputyName: deputyUser.name,
			actingForEmployeeId: approvalDeputyDecision.actingForEmployeeId,
			actingForName: actingForUser.name,
		})
		.from(approvalDeputyDecision)
		.innerJoin(
			deputyEmployee,
			and(
				eq(deputyEmployee.id, approvalDeputyDecision.deputyEmployeeId),
				eq(deputyEmployee.organizationId, input.organizationId),
			),
		)
		.innerJoin(deputyUser, eq(deputyUser.id, deputyEmployee.userId))
		.innerJoin(
			actingForEmployee,
			and(
				eq(actingForEmployee.id, approvalDeputyDecision.actingForEmployeeId),
				eq(actingForEmployee.organizationId, input.organizationId),
			),
		)
		.innerJoin(actingForUser, eq(actingForUser.id, actingForEmployee.userId))
		.where(
			and(
				eq(approvalDeputyDecision.organizationId, input.organizationId),
				inArray(approvalDeputyDecision.entityId, [...input.entityIds]),
			),
		)
		.orderBy(approvalDeputyDecision.decidedAt, approvalDeputyDecision.id);
	return rows.map((row) => ({
		approvalRequestId: row.approvalRequestId,
		entityType: row.entityType,
		entityId: row.entityId,
		decision: row.decision,
		decidedAt: row.decidedAt,
		absenceId: row.absenceId,
		deputy: { employeeId: row.deputyEmployeeId, name: row.deputyName },
		actingFor: { employeeId: row.actingForEmployeeId, name: row.actingForName },
	}));
}

/** Whom the legacy decision of this request was made for, from its acting-for record. */
export async function loadLegacyActingFor(
	executor: DeputyDecisionReader,
	input: { organizationId: string; approvalRequestId: string },
): Promise<ActingFor | null> {
	const [row] = await executor
		.select({
			approverEmployeeId: approvalDeputyDecision.actingForEmployeeId,
			absenceId: approvalDeputyDecision.absenceId,
		})
		.from(approvalDeputyDecision)
		.where(
			and(
				eq(approvalDeputyDecision.organizationId, input.organizationId),
				eq(approvalDeputyDecision.authority, "legacy"),
				eq(approvalDeputyDecision.approvalRequestId, input.approvalRequestId),
			),
		)
		.limit(1);
	return row ? { approverEmployeeId: row.approverEmployeeId, absenceId: row.absenceId ?? "" } : null;
}

/**
 * The decider as requester-facing English text names them (notification
 * messages, emails): "Y (deputy for X)" for a deputy decision, else Y. Reads
 * only names after the commit; never re-judges covering.
 */
export async function asDeputyDecider<T extends { organizationId: string; user: { name: string } }>(
	executor: DeputyDecisionReader,
	decider: T,
	actingFor: ActingFor | null | undefined,
): Promise<T> {
	if (!actingFor) return decider;
	const actingForName = await loadEmployeeName(executor, {
		organizationId: decider.organizationId,
		employeeId: actingFor.approverEmployeeId,
	});
	return {
		...decider,
		user: { ...decider.user, name: deputyActorLabel(decider.user.name, actingForName) },
	};
}

/** The approver's display name, org-scoped; null when unknown. */
export async function loadEmployeeName(
	executor: DeputyDecisionReader,
	input: { organizationId: string; employeeId: string },
): Promise<string | null> {
	const [row] = await executor
		.select({ name: user.name })
		.from(employee)
		.innerJoin(user, eq(user.id, employee.userId))
		.where(and(eq(employee.id, input.employeeId), eq(employee.organizationId, input.organizationId)))
		.limit(1);
	return row?.name ?? null;
}
