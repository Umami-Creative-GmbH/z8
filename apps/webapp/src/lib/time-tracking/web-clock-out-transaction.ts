import "server-only";

import { db } from "@/db";
import type { ApprovalWorkflowTransactionContext } from "@/lib/approvals/domain-adapters/types";
import type {
	ApprovalWorkflowDatabase,
	ApprovalWorkflowRepository,
} from "@/lib/approvals/workflow/repository";
import type { Instant } from "@/lib/datetime/temporal-core";
import {
	assertSameWebClockOutResources,
	lockWebClockOutResources,
	routeWebClockOutResources,
	WorkTransactionScopeChanged,
} from "./web-clock-out-resources";
import {
	acquireAdoptionGate,
	acquireEmployeeCoordination,
	acquireOrganizationConfigurationGuard,
	acquireUserConfigurationAccessGuards,
	readAppendAdmission,
	sealWorkTransactionScope,
	type WorkTransactionAdmission,
	type WorkTransactionScope,
} from "./work-transaction";

export type { WorkTransactionClient } from "./work-transaction";

/** Trusted server composition only; no transaction/savepoint or adoption upgrade capability. */
export interface WorkTransactionContext extends WorkTransactionScope {
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

type ApprovalRuntimeFactory = (database: ApprovalWorkflowDatabase) => {
	repository: ApprovalWorkflowRepository;
};

export async function withWebClockOutTransaction<T>(
	input: WebClockOutTransactionInput,
	createApprovalRuntime: ApprovalRuntimeFactory,
	operation: (context: WorkTransactionContext) => Promise<T>,
): Promise<T> {
	for (let attempt = 0; ; attempt += 1) {
		try {
			return await runAttempt(input, createApprovalRuntime, operation);
		} catch (error) {
			if (!(error instanceof WorkTransactionScopeChanged) || attempt >= 2)
				throw error;
		}
	}
}

async function runAttempt<T>(
	input: WebClockOutTransactionInput,
	createApprovalRuntime: ApprovalRuntimeFactory,
	operation: (context: WorkTransactionContext) => Promise<T>,
): Promise<T> {
	return db.transaction(async (transaction) => {
		const routed = await routeWebClockOutResources(transaction, input);
		let active = true;
		const assertActive = () => {
			if (!active) throw new Error("Work transaction is no longer active");
		};
		// The approval repository constructs its usual collaborators and checks its
		// reservation/CAS invariants, borrowing this transaction rather than nesting one.
		const runtime = createApprovalRuntime({
			transaction: async (callback) => {
				assertActive();
				return callback(transaction);
			},
		});
		try {
			return await runtime.repository.withTransaction(async (approval) => {
				await acquireAdoptionGate(transaction, input.organizationId);
				const admission = await readAppendAdmission(transaction, input.organizationId);
				const authority = await approval.writeGate.acquire({
					organizationId: input.organizationId,
					workflowType: "policy_clock_out",
				});
				await acquireOrganizationConfigurationGuard(
					transaction,
					input.organizationId,
				);
				await acquireUserConfigurationAccessGuards(
					transaction,
					routed.filter((row) => row.table === "user").map((row) => row.id),
				);
				await acquireEmployeeCoordination(
					transaction,
					routed
						.filter((row) => row.table === "employee")
						.map((row) => row.id),
				);
				assertSameWebClockOutResources(
					routed,
					await routeWebClockOutResources(transaction, input),
				);
				await lockWebClockOutResources(transaction, input, routed);
				assertSameWebClockOutResources(
					routed,
					await routeWebClockOutResources(transaction, input),
				);
				// The policy clock-out write gate stays: replay of a committed clock-out
				// that carries historical approval evidence reads through it.
				const writeGate: ApprovalWorkflowTransactionContext["writeGate"] = {
					async acquire(scope) {
						assertActive();
						if (
							scope.organizationId !== input.organizationId ||
							scope.workflowType !== "policy_clock_out"
						) {
							throw new Error("Approval scope is outside the work transaction");
						}
						return authority;
					},
				};
				return operation(
					sealWorkTransactionScope({
						db: transaction,
						approval: {
							...approval,
							activationResolver: {
								async resolve() {
									return refuseApprovalRouting();
								},
							},
							writeGate,
							compatibilityWriter:
								approval.compatibilityWriter.withWriteGate(writeGate),
						},
						admission,
						assertParticipant: refuseApprovalRouting,
						assertApprovalPolicy: refuseApprovalRouting,
						assertEmployee(organizationId: string, employeeId: string) {
							assertActive();
							if (
								organizationId !== input.organizationId ||
								employeeId !== input.employeeId
							) {
								throw new Error(
									"Employee scope is outside the work transaction",
								);
							}
						},
					}),
				);
			});
		} finally {
			active = false;
		}
	});
}
