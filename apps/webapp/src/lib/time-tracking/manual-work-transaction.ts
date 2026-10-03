import "server-only";

import { and, eq, inArray, sql } from "drizzle-orm";
import { approvalPolicy, approvalPolicyStage } from "@/db/schema";
import { routeWorkPeriodApprovalParticipants } from "@/lib/approvals/server/work-period-resource-routing";
import type { StageActivationInput } from "@/lib/approvals/workflow/ports";
import {
	type ApprovalRuntimeFactory,
	approvalWorkTransactionPort,
} from "@/lib/approvals/workflow/work-transaction-port";
import {
	sealWorkTransactionContext,
	type WorkTransactionContext,
} from "./web-clock-out-transaction";
import { runWorkTransaction, type WorkRoute, type WorkTransactionClient } from "./work-transaction";

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

/** What the operation decides on beyond the coordinated scope; compared on re-route. */
type ManualSnapshot = {
	/** Whether approval participants are routed (the attempt is widened). */
	approvalRouted: boolean;
	/** The approval policies and stages the operation may activate. */
	policyIds: string[];
	stageIds: string[];
};

/**
 * Manual entry (#308) as a work transaction. The coordinator takes the
 * acquisition protocol in rank order: the adoption gate, the
 * `manual_time_submission` write gate, shared organization configuration, the
 * actor, target and routed approval participants' user configuration/access,
 * their employee coordination, the submission identity (the key legacy manual
 * replay already uses), then the routed approval policy rows.
 *
 * The first attempt routes no approval participants. When preparation decides
 * approval is required, the attempt restarts widened, with them routed; nothing
 * acquires an earlier-ranked resource late.
 */
export function withManualWorkTransaction<T>(
	input: ManualWorkTransactionInput,
	createApprovalRuntime: ApprovalRuntimeFactory,
	operation: (context: ManualWorkTransactionContext) => Promise<T>,
): Promise<T> {
	return runWorkTransaction(
		{
			organizationId: input.organizationId,
			approval: approvalWorkTransactionPort(createApprovalRuntime),
			route: (db, attempt) => routeManualWork(db, input, attempt.widened),
			lockRows: async (db, route) => {
				const { policyIds } = route.snapshot;
				if (policyIds.length === 0) return;
				await db.execute(
					sql`select id from approval_policy where organization_id = ${input.organizationId} and id in (${sql.join(
						policyIds.map((id) => sql`${id}`),
						sql`, `,
					)}) order by id for share`,
				);
			},
		},
		(scope) => {
			const employees = new Set(scope.route.employees);
			const { approvalRouted } = scope.route.snapshot;
			const policyIds = new Set(scope.route.snapshot.policyIds);
			const stageIds = new Set(scope.route.snapshot.stageIds);
			// The target is always a write target, so this refuses only a settled scope.
			const assertActive = () => scope.assertEmployee(input.organizationId, input.targetEmployeeId);
			// Anything outside the routed scope needs the approval participants routed.
			const widen = () => scope.restart({ widen: true });
			const assertParticipant = (organizationId: string, employeeId: string) => {
				assertActive();
				if (organizationId !== input.organizationId || !employees.has(employeeId)) widen();
			};
			const assertApprovalPolicy = (
				organizationId: string,
				policyId: string,
				policyStageIds: readonly string[],
			) => {
				assertActive();
				if (
					organizationId !== input.organizationId ||
					!policyIds.has(policyId) ||
					policyStageIds.some((id) => !stageIds.has(id))
				) {
					widen();
				}
			};
			const { activationResolver } = scope.approval;
			return operation(
				sealWorkTransactionContext<ManualWorkTransactionContext>(scope, {
					approval: {
						...scope.approval,
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
								const result = await activationResolver.resolve(activation);
								for (const assignment of result.assignments)
									assertParticipant(result.organizationId, assignment.approverEmployeeId);
								return result;
							},
						},
					},
					assertParticipant,
					assertApprovalPolicy,
					requireApprovalScope() {
						assertActive();
						if (!approvalRouted) widen();
					},
				}),
			);
		},
	);
}

async function routeManualWork(
	transaction: WorkTransactionClient,
	input: ManualWorkTransactionInput,
	approvalRouted: boolean,
): Promise<WorkRoute<ManualSnapshot> & { snapshot: ManualSnapshot }> {
	const route = {
		users: [input.actorUserId, input.targetUserId],
		writeTargets: [input.targetEmployeeId],
		approvalGate: "manual_time_submission",
		sourceIdentities: [manualSubmissionIdentity(input.organizationId, input.submissionId)],
	};
	if (!approvalRouted) {
		return {
			...route,
			employees: [input.targetEmployeeId],
			snapshot: { approvalRouted, policyIds: [], stageIds: [] },
		};
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
		...route,
		users: [...route.users, ...participants.userIds],
		employees: [input.targetEmployeeId, ...participants.employeeIds],
		snapshot: { approvalRouted, policyIds, stageIds: stages.map(({ id }) => id).sort() },
	};
}
