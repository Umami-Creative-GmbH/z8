import "server-only";

import { sql } from "drizzle-orm";
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

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type WorkTransactionClient = Pick<
	Transaction,
	"execute" | "query" | "select" | "insert" | "update" | "delete"
>;

const protectedTransaction = Symbol("protected work transaction");

/** Trusted server composition only; no transaction/savepoint or adoption upgrade capability. */
export interface WorkTransactionContext {
	readonly [protectedTransaction]: true;
	readonly db: WorkTransactionClient;
	readonly approval: ApprovalWorkflowTransactionContext;
	readonly admission: "legacy";
	assertEmployee(organizationId: string, employeeId: string): void;
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
	userId: string;
	submissionId: string;
	workPeriodId?: string;
	endTime?: Instant;
	requiresApproval?: boolean;
	projectId?: string;
	workCategoryId?: string;
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
				await transaction.execute(
					sql`select pg_advisory_xact_lock_shared(hashtextextended(${JSON.stringify(["completed-work-adoption", input.organizationId])}, 0))`,
				);
				// T08 is a legacy-only prefactor. There is deliberately no activation
				// setter or new receipt/evidence capture before the parent gates pass.
				const authority = await approval.writeGate.acquire({
					organizationId: input.organizationId,
					workflowType: "policy_clock_out",
				});
				await transaction.execute(
					sql`select pg_advisory_xact_lock_shared(hashtextextended(${JSON.stringify(["work-organization-configuration", input.organizationId])}, 0))`,
				);
				for (const userId of routed
					.filter((row) => row.table === "user")
					.map((row) => row.id)
					.sort()) {
					await transaction.execute(
						sql`select pg_advisory_xact_lock_shared(hashtextextended(${JSON.stringify(["work-user-configuration-access", userId])}, 0))`,
					);
				}
				for (const employeeId of routed
					.filter((row) => row.table === "employee")
					.map((row) => row.id)
					.sort()) {
					await transaction.execute(
						sql`select pg_advisory_xact_lock(hashtextextended(${employeeId}, 0))`,
					);
				}
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
					Object.freeze({
						[protectedTransaction]: true as const,
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
						admission: "legacy" as const,
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
