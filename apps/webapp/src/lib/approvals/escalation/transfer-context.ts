import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { user } from "@/db/auth-schema";
import {
	approvalEscalationControl,
	approvalEscalationPolicy,
	approvalWorkflowRollout,
	employee,
} from "@/db/schema";
import { type Instant, instantFromDate, systemClock } from "@/lib/datetime/temporal-core";
import type { ApprovalWorkflowTransactionContext } from "../domain-adapters/types";
import { getCutoverBehavior } from "../workflow/cutover";
import type { ApprovalWorkflowType, ApprovalWriteGateResult } from "../workflow/ports";
import { createProductionApprovalWorkflowRuntime } from "../workflow/runtime";
import { ApprovalStateMachineError } from "../workflow/state-machine";
import { ApprovalTransitionEngineError } from "../workflow/transition-engine";
import type { EscalationPolicySnapshot } from "./deadline";

/**
 * Shared machinery of the canonical and legacy escalation transfer paths:
 * fresh ownership and policy reads, discovery-time authority, the escalation
 * workflow runtime and transaction gate, and race classification.
 */

export type DatabaseTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type EscalationOwnership =
	| { kind: "owned"; paused: boolean; ownedSince: Instant | null }
	| { kind: "not_owner" | "unrecognized_owner" };

/**
 * Fresh ownership read. Inside a transaction it takes a share lock so an
 * exclusive ownership switch cannot interleave with a transfer. It never
 * substitutes for the transition's own conditional writes.
 */
export async function readEscalationOwnership(
	executor: typeof db | DatabaseTransaction,
	organizationId: string,
	lock: boolean,
): Promise<EscalationOwnership> {
	const query = executor
		.select({
			owner: approvalEscalationControl.owner,
			automationPaused: approvalEscalationControl.automationPaused,
			escalationOwnedSince: approvalEscalationControl.escalationOwnedSince,
		})
		.from(approvalEscalationControl)
		.where(eq(approvalEscalationControl.organizationId, organizationId))
		.limit(1);
	const [control] = lock ? await query.for("share") : await query;
	if (!control || control.owner === "legacy") return { kind: "not_owner" };
	if (control.owner !== "escalation") return { kind: "unrecognized_owner" };
	return {
		kind: "owned",
		paused: control.automationPaused,
		ownedSince: control.escalationOwnedSince ? instantFromDate(control.escalationOwnedSince) : null,
	};
}

export async function readEscalationPolicy(
	executor: typeof db | DatabaseTransaction,
	organizationId: string,
): Promise<EscalationPolicySnapshot | null> {
	const [policy] = await executor
		.select({
			enabled: approvalEscalationPolicy.enabled,
			responseWindowHours: approvalEscalationPolicy.responseWindowHours,
			revision: approvalEscalationPolicy.revision,
		})
		.from(approvalEscalationPolicy)
		.where(eq(approvalEscalationPolicy.organizationId, organizationId))
		.limit(1);
	return policy ?? null;
}

function refuseFinalization(): never {
	throw new Error("Approval escalation never finalizes an approval");
}

/**
 * Workflow runtime for escalation commands. Escalation replaces an
 * assignment and never reaches terminal finalization, so every finalizer
 * refuses. Management authority is explicit, never eligible-manager fallback.
 */
export function createEscalationRuntime(
	management: {
		organizationId: string;
		actorEmployeeId: string;
	} | null,
) {
	return createProductionApprovalWorkflowRuntime({
		db,
		adapters: {
			absence: {
				clock: systemClock,
				finalizeAbsenceTerminal: async () => refuseFinalization(),
				deleteCancelledAbsence: async () => refuseFinalization(),
			},
			timeCorrection: {
				clock: systemClock,
				finalizeTimeCorrectionTerminal: async () => refuseFinalization(),
				deleteCancelledCorrections: async () => refuseFinalization(),
			},
			ordinaryWorkPeriod: {
				finalizeTerminal: async () => refuseFinalization(),
			},
		},
		canManageApproval: async (input) =>
			management !== null &&
			input.command.type === "escalate" &&
			input.organizationId === management.organizationId &&
			input.workflow.organizationId === management.organizationId &&
			input.actorEmployeeId === management.actorEmployeeId,
		clock: systemClock,
	});
}

export type EscalationRuntime = ReturnType<typeof createEscalationRuntime>;

/**
 * Discovery-time authority of each kind: whether its rollout decides
 * canonically. The mode is re-read under the write gate inside every
 * transfer transaction, which is what actually decides. A missing row is
 * created as `legacy` by the write gate.
 */
export async function readDecisionAuthorityForDiscovery(
	executor: DatabaseTransaction | typeof db,
	organizationId: string,
	workflowTypes: readonly ApprovalWorkflowType[],
): Promise<Map<ApprovalWorkflowType, "canonical" | "legacy">> {
	const rows = await executor
		.select({
			workflowType: approvalWorkflowRollout.workflowType,
			mode: approvalWorkflowRollout.lifecycleMode,
		})
		.from(approvalWorkflowRollout)
		.where(
			and(
				eq(approvalWorkflowRollout.organizationId, organizationId),
				inArray(approvalWorkflowRollout.workflowType, [...workflowTypes]),
			),
		);
	const modes = new Map(rows.map((row) => [row.workflowType, row.mode]));
	return new Map(
		workflowTypes.map((workflowType) => [
			workflowType,
			getCutoverBehavior(modes.get(workflowType) ?? "legacy").decideCanonical
				? "canonical"
				: "legacy",
		]),
	);
}

/** Pins the gate this transaction already acquired for one kind. */
export function fixedGateContext(
	context: ApprovalWorkflowTransactionContext,
	organizationId: string,
	gate: ApprovalWriteGateResult,
	workflowType: ApprovalWorkflowType,
): ApprovalWorkflowTransactionContext {
	return {
		...context,
		writeGate: {
			acquire: async (scope) => {
				if (scope.organizationId !== organizationId || scope.workflowType !== workflowType) {
					throw new Error("Escalation gate scope mismatch");
				}
				return gate;
			},
		},
	};
}

export function isTransitionRace(error: unknown): boolean {
	return (
		(error instanceof ApprovalTransitionEngineError && error.code === "version_conflict") ||
		(error instanceof ApprovalStateMachineError &&
			(error.code === "REASSIGNMENT_CONFLICT" ||
				error.code === "STALE_STAGE" ||
				error.code === "TERMINAL_TRANSITION"))
	);
}

export async function employeeNames(
	executor: typeof db | DatabaseTransaction,
	organizationId: string,
	employeeIds: string[],
): Promise<Map<string, string>> {
	if (employeeIds.length === 0) return new Map();
	const rows = await executor
		.select({ id: employee.id, name: user.name })
		.from(employee)
		.innerJoin(user, eq(user.id, employee.userId))
		.where(and(eq(employee.organizationId, organizationId), inArray(employee.id, employeeIds)));
	return new Map(rows.map((row) => [row.id, row.name]));
}
