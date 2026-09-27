import "server-only";

import type { ApprovalWorkflowTransactionContext } from "@/lib/approvals/domain-adapters/types";
import {
	type ApprovalRuntimeFactory,
	approvalWorkTransactionPort,
} from "@/lib/approvals/workflow/work-transaction-port";
import type { Instant } from "@/lib/datetime/temporal-core";
import { lockWebClockOutResources, routeWebClockOutResources } from "./web-clock-out-resources";
import {
	runWorkTransaction,
	type SealedWorkTransactionScope,
	type WorkRoute,
	type WorkTransactionAdmission,
	type WorkTransactionScope,
} from "./work-transaction";

export type { WorkTransactionClient } from "./work-transaction";

/** Trusted server composition only; no transaction/savepoint or adoption upgrade capability. */
export interface WorkTransactionContext extends SealedWorkTransactionScope {
	readonly approval: ApprovalWorkflowTransactionContext;
	/**
	 * Read from the organization's append control under the adoption gate. `append`
	 * is the adopted completed-work contract (#274); `legacy` keeps the prefactor path.
	 */
	readonly admission: WorkTransactionAdmission;
	assertParticipant(organizationId: string, employeeId: string): void;
	assertApprovalPolicy(
		organizationId: string,
		policyId: string,
		stageIds: readonly string[],
	): void;
}

export interface WebClockOutTransactionInput {
	organizationId: string;
	employeeId: string;
	/** The authenticated human acting; their approved membership is protected. */
	userId: string;
	/**
	 * The user of the employee who owns the work, when another human acts on their
	 * behalf (#276). Defaults to the acting user.
	 */
	ownerUserId?: string;
	submissionId: string;
	workPeriodId?: string;
	endTime?: Instant;
	projectId?: string | null;
	workCategoryId?: string | null;
}

/**
 * Live clock-outs never route approval (#361): no approval policy, stage or
 * participant is routed or locked, so activating one would act on unprotected rows.
 */
function refuseApprovalRouting(): never {
	throw new Error("Live clock-out does not route approval");
}

/**
 * Web clock-out as a work transaction. The routed resources decide the
 * coordinated users and employees, the source identities (the terminal-break
 * ownership key and each routed source period's submission keys) and the row
 * locks; the policy clock-out write gate stays pinned, because replay of a
 * committed clock-out that carries historical approval evidence reads through it.
 */
export function withWebClockOutTransaction<T>(
	input: WebClockOutTransactionInput,
	createApprovalRuntime: ApprovalRuntimeFactory,
	operation: (context: WorkTransactionContext) => Promise<T>,
): Promise<T> {
	return runWorkTransaction(
		{
			organizationId: input.organizationId,
			approval: approvalWorkTransactionPort(createApprovalRuntime),
			route: async (db) => {
				const resources = await routeWebClockOutResources(db, input);
				const ids = (table: string) =>
					resources.filter((row) => row.table === table).map((row) => row.id);
				return {
					users: ids("user"),
					employees: ids("employee"),
					writeTargets: [input.employeeId],
					approvalGate: "policy_clock_out",
					// The existing terminal-break/work-balance ownership key, then each
					// source period's submission keys; not a second employee key.
					sourceIdentities: [
						[input.organizationId, input.employeeId],
						...resources
							.filter((row) => row.table === "work_period" && row.source)
							.flatMap((row) =>
								["manual_time_submission", "policy_clock_out"].map((kind) => [
									input.organizationId,
									kind,
									"time_entry",
									row.id,
								]),
							),
					],
					snapshot: resources,
				};
			},
			lockRows: (db, route) => lockWebClockOutResources(db, input, route.snapshot),
		},
		(scope) =>
			operation(
				sealWorkTransactionContext(scope, {
					approval: {
						...scope.approval,
						activationResolver: {
							async resolve() {
								return refuseApprovalRouting();
							},
						},
					},
					assertParticipant: refuseApprovalRouting,
					assertApprovalPolicy: refuseApprovalRouting,
				}),
			),
	);
}

/**
 * The operation's context over a coordinator scope with approval checks. The
 * scope's restart, savepoint and route stay with the coordinator writer.
 */
export function sealWorkTransactionContext<C extends WorkTransactionContext>(
	scope: WorkTransactionScope<WorkRoute, ApprovalWorkflowTransactionContext>,
	context: Omit<C, keyof SealedWorkTransactionScope>,
): C {
	const { restart: _restart, savepoint: _savepoint, route: _route, ...sealed } = scope;
	return Object.freeze({ ...sealed, ...context }) as C;
}
