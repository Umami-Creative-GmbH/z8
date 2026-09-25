import "server-only";

import { db } from "@/db";
import type { ApprovalWorkflowTransactionContext } from "@/lib/approvals/domain-adapters/types";
import type { StageActivationInput } from "@/lib/approvals/workflow/ports";
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
	/** The routed policy clock-out approval decision the participants were scoped for. */
	readonly requiresApproval: boolean;
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
	requiresApproval?: boolean;
	projectId?: string | null;
	workCategoryId?: string | null;
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
		let scopeChanged = false;
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
				const assertParticipant = (
					organizationId: string,
					employeeId: string,
				) => {
					assertActive();
					if (
						organizationId !== input.organizationId ||
						!routed.some(
							(row) => row.table === "employee" && row.id === employeeId,
						)
					) {
						scopeChanged = true;
						throw new WorkTransactionScopeChanged();
					}
				};
				const assertApprovalPolicy = (
					organizationId: string,
					policyId: string,
					stageIds: readonly string[],
				) => {
					assertActive();
					if (
						organizationId !== input.organizationId ||
						!routed.some(
							(row) => row.table === "approval_policy" && row.id === policyId,
						) ||
						stageIds.some(
							(id) =>
								!routed.some(
									(row) =>
										row.table === "approval_policy_stage" && row.id === id,
								),
						)
					) {
						scopeChanged = true;
						throw new WorkTransactionScopeChanged();
					}
				};
				return operation(
					sealWorkTransactionScope({
						db: transaction,
						approval: {
							...approval,
							activationResolver: {
								async resolve(activation: StageActivationInput) {
									const policy = activation.workflow.policySnapshot;
									if (typeof policy.id === "string") {
										assertApprovalPolicy(
											activation.organizationId,
											policy.id,
											Array.isArray(policy.stages)
												? policy.stages.flatMap((stage) =>
														stage &&
														typeof stage === "object" &&
														!Array.isArray(stage) &&
														typeof stage.id === "string"
															? [stage.id]
															: [],
													)
												: [],
										);
									}
									const result =
										await approval.activationResolver.resolve(activation);
									for (const assignment of result.assignments)
										assertParticipant(
											result.organizationId,
											assignment.approverEmployeeId,
										);
									return result;
								},
							},
							writeGate,
							compatibilityWriter:
								approval.compatibilityWriter.withWriteGate(writeGate),
						},
						admission,
						requiresApproval: input.requiresApproval === true,
						assertParticipant,
						assertApprovalPolicy,
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
		} catch (error) {
			// Approval/Effect boundaries redact internal errors. Keep the restart
			// signal even when one of those boundaries wraps the original cause.
			if (scopeChanged) throw new WorkTransactionScopeChanged();
			throw error;
		} finally {
			active = false;
		}
	});
}
