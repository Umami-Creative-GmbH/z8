import "server-only";

import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { approvalPolicy, approvalPolicyStage } from "@/db/schema";
import type { ApprovalWorkflowTransactionContext } from "@/lib/approvals/domain-adapters/types";
import { routeWorkPeriodApprovalParticipants } from "@/lib/approvals/server/work-period-resource-routing";
import type { StageActivationInput } from "@/lib/approvals/workflow/ports";
import type {
	ApprovalWorkflowDatabase,
	ApprovalWorkflowRepository,
} from "@/lib/approvals/workflow/repository";
import { WorkTransactionScopeChanged } from "./web-clock-out-resources";
import type { WorkTransactionContext } from "./web-clock-out-transaction";
import {
	acquireAdoptionGate,
	acquireEmployeeCoordination,
	acquireOrganizationConfigurationGuard,
	acquireSourceIdentity,
	acquireUserConfigurationAccessGuards,
	readAppendAdmission,
	sealWorkTransactionScope,
	type WorkTransactionClient,
} from "./work-transaction";

/**
 * The manual operation's coordination. `requireApprovalScope` restarts the
 * attempt with approval participants routed when fresh preparation decides that
 * approval is required but the attempt did not protect its participants.
 */
export interface ManualWorkTransactionContext extends WorkTransactionContext {
	requireApprovalScope(): void;
}

export interface ManualWorkTransactionInput {
	organizationId: string;
	/** The authenticated human submitting the entry. */
	actorUserId: string;
	/** Routed before the transaction; the operation revalidates the target. */
	targetEmployeeId: string;
	targetUserId: string;
	submissionId: string;
}

/**
 * The submission identity every manual submission (and legacy manual replay)
 * serializes on; lookup-only recovery (#310) waits on the same key.
 */
export function manualSubmissionIdentity(organizationId: string, submissionId: string) {
	return [organizationId, "manual_time_submission", "time_entry", submissionId] as const;
}

type ApprovalRuntimeFactory = (database: ApprovalWorkflowDatabase) => {
	repository: ApprovalWorkflowRepository;
};

type RoutedScope = {
	employeeIds: string[];
	userIds: string[];
	policyIds: string[];
	stageIds: string[];
};

class ApprovalScopeRequired extends Error {
	constructor() {
		super("Manual entry requires approval participants; restart routing");
		this.name = "ApprovalScopeRequired";
	}
}

/**
 * Outer transaction owner for manual entry (#308). Acquisition follows the
 * amended #258 order:
 *
 * 1. the shared adoption gate, then the append control under it;
 * 2. the `manual_time_submission` approval write gate;
 * 3. shared organization manual-configuration protection;
 * 4. sorted user configuration/access protection: actor, target and, when
 *    routed, approval participants;
 * 5. sorted exclusive employee coordination: target and routed participants;
 * 6. the submission identity (the key legacy manual replay already uses), then
 *    routed approval policy rows and the operation's authoritative rows.
 *
 * The first attempt routes no approval participants. When preparation decides
 * approval is required, the attempt rolls back and restarts with them routed;
 * nothing acquires an earlier-ranked resource late. A routed scope that changes
 * while waiting also restarts.
 */
export async function withManualWorkTransaction<T>(
	input: ManualWorkTransactionInput,
	createApprovalRuntime: ApprovalRuntimeFactory,
	operation: (context: ManualWorkTransactionContext) => Promise<T>,
): Promise<T> {
	let routeApproval = false;
	for (let attempt = 0; ; attempt += 1) {
		try {
			return await runAttempt(input, routeApproval, createApprovalRuntime, operation);
		} catch (error) {
			if (error instanceof ApprovalScopeRequired && !routeApproval) {
				routeApproval = true;
				continue;
			}
			if (!(error instanceof WorkTransactionScopeChanged) || attempt >= 2) throw error;
		}
	}
}

async function routeScope(
	transaction: WorkTransactionClient,
	input: ManualWorkTransactionInput,
	routeApproval: boolean,
): Promise<RoutedScope> {
	if (!routeApproval) {
		return { employeeIds: [input.targetEmployeeId], userIds: [], policyIds: [], stageIds: [] };
	}
	const participants = await routeWorkPeriodApprovalParticipants({
		db: transaction,
		organizationId: input.organizationId,
		requesterEmployeeId: input.targetEmployeeId,
	});
	const policies = await transaction
		.select({ id: approvalPolicy.id })
		.from(approvalPolicy)
		.where(
			and(
				eq(approvalPolicy.organizationId, input.organizationId),
				eq(approvalPolicy.isActive, true),
			),
		);
	const policyIds = policies.map(({ id }) => id).sort();
	const stages =
		policyIds.length === 0
			? []
			: await transaction
					.select({ id: approvalPolicyStage.id })
					.from(approvalPolicyStage)
					.where(inArray(approvalPolicyStage.policyId, policyIds));
	return {
		employeeIds: [...new Set([input.targetEmployeeId, ...participants.employeeIds])].sort(),
		userIds: [...new Set(participants.userIds)].sort(),
		policyIds,
		stageIds: stages.map(({ id }) => id).sort(),
	};
}

function sameScope(left: RoutedScope, right: RoutedScope) {
	return JSON.stringify(left) === JSON.stringify(right);
}

async function runAttempt<T>(
	input: ManualWorkTransactionInput,
	routeApproval: boolean,
	createApprovalRuntime: ApprovalRuntimeFactory,
	operation: (context: ManualWorkTransactionContext) => Promise<T>,
): Promise<T> {
	return db.transaction(async (transaction) => {
		const routed = await routeScope(transaction, input, routeApproval);
		let active = true;
		let restart: "scope" | "approval" | null = null;
		const assertActive = () => {
			if (!active) throw new Error("Work transaction is no longer active");
		};
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
					workflowType: "manual_time_submission",
				});
				await acquireOrganizationConfigurationGuard(transaction, input.organizationId);
				await acquireUserConfigurationAccessGuards(transaction, [
					input.actorUserId,
					input.targetUserId,
					...routed.userIds,
				]);
				await acquireEmployeeCoordination(transaction, routed.employeeIds);
				if (!sameScope(routed, await routeScope(transaction, input, routeApproval))) {
					restart = "scope";
					throw new WorkTransactionScopeChanged();
				}
				await acquireSourceIdentity(
					transaction,
					manualSubmissionIdentity(input.organizationId, input.submissionId),
				);
				if (routed.policyIds.length > 0) {
					await transaction.execute(
						sql`select id from approval_policy where organization_id = ${input.organizationId} and id in (${sql.join(
							routed.policyIds.map((id) => sql`${id}`),
							sql`, `,
						)}) order by id for share`,
					);
				}

				const writeGate: ApprovalWorkflowTransactionContext["writeGate"] = {
					async acquire(scope) {
						assertActive();
						if (
							scope.organizationId !== input.organizationId ||
							scope.workflowType !== "manual_time_submission"
						) {
							throw new Error("Approval scope is outside the work transaction");
						}
						return authority;
					},
				};
				const widen = (): never => {
					restart = routeApproval ? "scope" : "approval";
					throw routeApproval ? new WorkTransactionScopeChanged() : new ApprovalScopeRequired();
				};
				const assertParticipant = (organizationId: string, employeeId: string) => {
					assertActive();
					if (organizationId !== input.organizationId || !routed.employeeIds.includes(employeeId)) {
						widen();
					}
				};
				const assertApprovalPolicy = (
					organizationId: string,
					policyId: string,
					stageIds: readonly string[],
				) => {
					assertActive();
					const routedStageIds = new Set(routed.stageIds);
					if (
						organizationId !== input.organizationId ||
						!routed.policyIds.includes(policyId) ||
						stageIds.some((id) => !routedStageIds.has(id))
					) {
						widen();
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
									const result = await approval.activationResolver.resolve(activation);
									for (const assignment of result.assignments)
										assertParticipant(result.organizationId, assignment.approverEmployeeId);
									return result;
								},
							},
							writeGate,
							compatibilityWriter: approval.compatibilityWriter.withWriteGate(writeGate),
						},
						admission,
						assertParticipant,
						assertApprovalPolicy,
						requireApprovalScope() {
							assertActive();
							if (!routeApproval) widen();
						},
						assertEmployee(organizationId: string, employeeId: string) {
							assertActive();
							if (
								organizationId !== input.organizationId ||
								employeeId !== input.targetEmployeeId
							) {
								throw new Error("Employee scope is outside the work transaction");
							}
						},
					}),
				);
			});
		} catch (error) {
			// Approval/Effect boundaries redact internal errors; keep the restart signal.
			if (restart === "approval") throw new ApprovalScopeRequired();
			if (restart === "scope") throw new WorkTransactionScopeChanged();
			throw error;
		} finally {
			active = false;
		}
	});
}
