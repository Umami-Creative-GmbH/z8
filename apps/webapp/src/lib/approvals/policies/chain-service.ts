import { and, asc, eq } from "drizzle-orm";
import { Effect } from "effect";
import {
	approvalChainInstance,
	approvalChainStageInstance,
	approvalPolicy,
	approvalRequest,
	employee,
	employeeGroupMember,
	employeeManagers,
} from "@/db/schema";
import { currentTimestamp } from "@/lib/datetime/drizzle-adapter";
import { type AnyAppError, ValidationError } from "@/lib/effect/errors";
import type { ApprovalDbService } from "../server/types";
import { resolveApproverFromDirectory } from "./approver-resolution";
import { findMatchingPolicy } from "./matcher";
import type { ApprovalPolicyDraft, ApprovalPolicyEvaluationContext } from "./types";

type ChainStatus = "pending" | "approved" | "rejected" | "cancelled";

interface CreateChainInMemoryInput {
	context: ApprovalPolicyEvaluationContext;
	policy: ApprovalPolicyDraft;
}

export interface ChainStageInMemory {
	id: string;
	policyStageId: string;
	stepOrder: number;
	labelSnapshot: string;
	resolvedApproverEmployeeId: string;
	approvalRequestId: string | null;
	status: ChainStatus;
	decidedBy: string | null;
}

export interface ChainInMemory {
	id: string;
	organizationId: string;
	policyId: string;
	entityType: string;
	entityId: string;
	requesterEmployeeId: string;
	currentStageOrder: number;
	status: ChainStatus;
	stages: ChainStageInMemory[];
}

export const APPROVAL_POLICY_CHAIN_NOT_CONFIGURED = "approval_policy_chain_not_configured";

export interface CreateChainForPolicyInput {
	organizationId: string;
	entityType: string;
	entityId: string;
	requesterEmployeeId: string;
	policy: ApprovalPolicyDraft;
	resolvedStages: Array<{
		policyStageId: string;
		stepOrder: number;
		label: string;
		approverEmployeeId: string;
	}>;
}

export interface ChainProgressionInput {
	approvalRequestId: string;
	actorEmployeeId: string;
	action: "approve" | "reject";
}

export type ChainProgressionResult =
	| { kind: "not_linked" }
	| { kind: "chain_pending" }
	| { kind: "chain_completed"; completed: true }
	| { kind: "chain_rejected"; rejected: true };

export interface ResolvePolicyAndCreateApprovalInput {
	context: ApprovalPolicyEvaluationContext;
	defaultApproverId: string;
	reason?: string;
}

export type ResolvePolicyAndCreateApprovalResult =
	| { kind: "default_created"; approvalRequestId: string }
	| { kind: "chain_created"; chainInstanceId: string; approvalRequestId: string };

type DbPolicyRecord = ApprovalPolicyDraft & {
	description?: string | null;
};

function jsonString(value: unknown) {
	return typeof value === "string" ? value : undefined;
}

function jsonStringArray(value: unknown) {
	return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : undefined;
}

function nullableNumber(value: unknown) {
	if (typeof value === "number") {
		return value;
	}

	if (typeof value === "string" && value.trim() !== "") {
		const parsed = Number(value);
		return Number.isFinite(parsed) ? parsed : undefined;
	}

	return undefined;
}

function policyFromDbRecord(record: DbPolicyRecord): ApprovalPolicyDraft {
	return {
		id: record.id,
		organizationId: record.organizationId,
		name: record.name,
		isActive: record.isActive,
		priority: record.priority,
		conditions: record.conditions.map((condition) => ({
			conditionType: condition.conditionType,
			operator: condition.operator,
			value:
				condition.value ??
				jsonString((condition as { valueJson?: unknown }).valueJson) ??
				(condition as { overtimeRisk?: string | null }).overtimeRisk ??
				(condition as { teamId?: string | null }).teamId ??
				(condition as { locationId?: string | null }).locationId ??
				(condition as { absenceCategoryId?: string | null }).absenceCategoryId ??
				(condition as { employeeGroupId?: string | null }).employeeGroupId ??
				undefined,
			values: condition.values ?? jsonStringArray((condition as { valueJson?: unknown }).valueJson),
			amountMin: nullableNumber((condition as { amountMin?: unknown }).amountMin),
			amountMax: nullableNumber((condition as { amountMax?: unknown }).amountMax),
		})),
		stages: record.stages.map((stage) => ({
			id: stage.id,
			stepOrder: stage.stepOrder,
			label: stage.label,
			approverType: stage.approverType,
			approverEmployeeId: stage.approverEmployeeId ?? undefined,
		})),
	};
}

function insertedId(rows: unknown, fallback: string) {
	if (Array.isArray(rows) && rows[0] && typeof rows[0] === "object" && "id" in rows[0]) {
		return String((rows[0] as { id: unknown }).id);
	}

	return fallback;
}

async function insertApprovalRequest(
	dbService: ApprovalDbService,
	input: ResolvePolicyAndCreateApprovalInput,
	approverId: string,
) {
	const rows = await dbService.db
		.insert(approvalRequest)
		.values({
			organizationId: input.context.organizationId,
			entityType: input.context.entityType,
			entityId: input.context.entityId,
			requestedBy: input.context.requesterEmployeeId,
			approverId,
			status: "pending",
			reason: input.reason,
		})
		.returning({ id: approvalRequest.id });

	return insertedId(rows, input.context.entityId);
}

async function loadPolicyContext(dbService: ApprovalDbService, context: ApprovalPolicyEvaluationContext) {
	const [policies, groupRows, employees, managerLinks] = await Promise.all([
		dbService.db.query.approvalPolicy.findMany({
			where: eq(approvalPolicy.organizationId, context.organizationId),
			orderBy: [asc(approvalPolicy.priority)],
			with: { conditions: true, stages: true },
		}),
		context.employeeGroupIds.length === 0
			? dbService.db.query.employeeGroupMember.findMany({
					where: and(
						eq(employeeGroupMember.organizationId, context.organizationId),
						eq(employeeGroupMember.employeeId, context.requesterEmployeeId),
					),
				})
			: Promise.resolve([]),
		dbService.db.query.employee.findMany({
			where: eq(employee.organizationId, context.organizationId),
		}),
		dbService.db.query.employeeManagers.findMany(),
	]);

	return {
		policies: (policies as unknown as DbPolicyRecord[]).map(policyFromDbRecord),
		context: {
			...context,
			employeeGroupIds:
				context.employeeGroupIds.length > 0
					? context.employeeGroupIds
					: (groupRows as Array<{ groupId: string; organizationId: string }>).flatMap((row) =>
						row.organizationId === context.organizationId ? [row.groupId] : [],
					),
		},
		employees: employees as Parameters<typeof resolveApproverFromDirectory>[0]["employees"],
		managerLinks: managerLinks as Parameters<typeof resolveApproverFromDirectory>[0]["managerLinks"],
	};
}

function requestIdForStage(stepOrder: number) {
	return `request_stage_${stepOrder}`;
}

export function createChainInMemory(input: CreateChainInMemoryInput): ChainInMemory {
	const firstStageOrder = Math.min(...input.policy.stages.map((stage) => stage.stepOrder));

	return {
		id: "chain_1",
		organizationId: input.context.organizationId,
		policyId: input.policy.id,
		entityType: input.context.entityType,
		entityId: input.context.entityId,
		requesterEmployeeId: input.context.requesterEmployeeId,
		currentStageOrder: firstStageOrder,
		status: "pending",
		stages: input.policy.stages
			.slice()
			.sort((a, b) => a.stepOrder - b.stepOrder)
			.map((stage) => ({
				id: `stage_instance_${stage.stepOrder}`,
				policyStageId: stage.id,
				stepOrder: stage.stepOrder,
				labelSnapshot: stage.label,
				resolvedApproverEmployeeId: stage.approverEmployeeId ?? "",
				approvalRequestId:
					stage.stepOrder === firstStageOrder ? requestIdForStage(stage.stepOrder) : null,
				status: stage.stepOrder === firstStageOrder ? "pending" : "cancelled",
				decidedBy: null,
			})),
	};
}

export function approveCurrentStageInMemory(
	chain: ChainInMemory,
	decidedBy: string,
): ChainInMemory {
	const stages = chain.stages.map((stage) =>
		stage.stepOrder === chain.currentStageOrder
			? { ...stage, status: "approved" as const, decidedBy }
			: stage,
	);
	const nextStage = stages.find((stage) => stage.stepOrder > chain.currentStageOrder);

	if (!nextStage) {
		return { ...chain, status: "approved", stages };
	}

	return {
		...chain,
		currentStageOrder: nextStage.stepOrder,
		stages: stages.map((stage) =>
			stage.stepOrder === nextStage.stepOrder
				? { ...stage, status: "pending", approvalRequestId: requestIdForStage(stage.stepOrder) }
				: stage,
		),
	};
}

export function rejectCurrentStageInMemory(
	chain: ChainInMemory,
	decidedBy: string,
): ChainInMemory {
	return {
		...chain,
		status: "rejected",
		stages: chain.stages.map((stage) =>
			stage.stepOrder === chain.currentStageOrder
				? { ...stage, status: "rejected", decidedBy }
				: stage,
		),
	};
}

export function progressApprovalChainIfLinked(
	_dbService: ApprovalDbService,
	_input: ChainProgressionInput,
): Effect.Effect<ChainProgressionResult, AnyAppError, never> {
	return Effect.succeed({ kind: "not_linked" });
}

export function resolvePolicyAndCreateApproval(
	dbService: ApprovalDbService,
	input: ResolvePolicyAndCreateApprovalInput,
): Effect.Effect<ResolvePolicyAndCreateApprovalResult, AnyAppError, never> {
	return Effect.gen(function* (_) {
		const loaded = yield* _(dbService.query("loadApprovalPolicyContext", () => loadPolicyContext(dbService, input.context)));
		const matchedPolicy = findMatchingPolicy(loaded.context, loaded.policies);

		if (!matchedPolicy) {
			const approvalRequestId = yield* _(
				dbService.query("createDefaultApprovalRequest", () =>
					insertApprovalRequest(dbService, { ...input, context: loaded.context }, input.defaultApproverId),
				),
			);

			return { kind: "default_created", approvalRequestId } as const;
		}

		const resolvedStages = matchedPolicy.stages
			.slice()
			.sort((left, right) => left.stepOrder - right.stepOrder)
			.map((stage) => {
				const resolved = resolveApproverFromDirectory({
					organizationId: loaded.context.organizationId,
					requesterEmployeeId: loaded.context.requesterEmployeeId,
					stage,
					employees: loaded.employees,
					managerLinks: loaded.managerLinks,
				});

				if (!resolved.ok) {
					throw new ValidationError({
						message: resolved.reason,
						field: "approvalPolicyStage.approverType",
						value: stage.approverType,
					});
				}

				return { stage, approverEmployeeId: resolved.approverEmployeeId };
			});

		const firstStage = resolvedStages[0];
		if (!firstStage) {
			return yield* _(
				Effect.fail(
					new ValidationError({
						message: "Matched approval policy has no stages.",
						field: "approvalPolicy.stages",
						value: matchedPolicy.id,
					}),
				),
			);
		}

		const result = yield* _(
			dbService.query("createApprovalChain", async () => {
				const chainRows = await dbService.db
					.insert(approvalChainInstance)
					.values({
						organizationId: loaded.context.organizationId,
						policyId: matchedPolicy.id,
						policyNameSnapshot: matchedPolicy.name,
						entityType: loaded.context.entityType,
						entityId: loaded.context.entityId,
						requesterEmployeeId: loaded.context.requesterEmployeeId,
						currentStageOrder: firstStage.stage.stepOrder,
						status: "pending",
					})
					.returning({ id: approvalChainInstance.id });
				const chainInstanceId = insertedId(chainRows, loaded.context.entityId);
				const approvalRequestId = await insertApprovalRequest(
					dbService,
					{ ...input, context: loaded.context },
					firstStage.approverEmployeeId,
				);

				for (const resolvedStage of resolvedStages) {
					const isCurrentStage = resolvedStage.stage.stepOrder === firstStage.stage.stepOrder;
					await dbService.db.insert(approvalChainStageInstance).values({
						organizationId: loaded.context.organizationId,
						chainInstanceId,
						policyStageId: resolvedStage.stage.id,
						stepOrder: resolvedStage.stage.stepOrder,
						labelSnapshot: resolvedStage.stage.label,
						approverTypeSnapshot: resolvedStage.stage.approverType,
						resolvedApproverEmployeeId: resolvedStage.approverEmployeeId,
						approvalRequestId: isCurrentStage ? approvalRequestId : null,
						status: isCurrentStage ? "pending" : "cancelled",
						updatedAt: currentTimestamp(),
					});
				}

				return { chainInstanceId, approvalRequestId };
			}),
		);

		return { kind: "chain_created", ...result } as const;
	});
}
