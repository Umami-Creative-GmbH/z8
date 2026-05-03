import { and, asc, eq, gt } from "drizzle-orm";
import { Effect } from "effect";
import {
	approvalChainInstance,
	approvalChainStageInstance,
	approvalPolicy,
	approvalRequest,
	employee,
	employeeGroup,
	employeeGroupMember,
	employeeManagers,
} from "@/db/schema";
import { currentTimestamp } from "@/lib/datetime/drizzle-adapter";
import { type AnyAppError, ConflictError, ValidationError } from "@/lib/effect/errors";
import { logApprovalPolicyEvent } from "../infrastructure/audit-logger";
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
	actorUserId: string;
	action: "approve" | "reject";
}

export type ChainProgressionResult =
	| { kind: "not_linked" }
	| { kind: "chain_pending" }
	| { kind: "chain_completed"; completed: true }
	| { kind: "chain_rejected"; rejected: true };

type ChainStageInstanceRecord = {
	id: string;
	organizationId: string;
	chainInstanceId: string;
	stepOrder: number;
	status: ChainStatus;
	resolvedApproverEmployeeId: string;
};

type ChainInstanceRecord = {
	id: string;
	organizationId: string;
	entityType: string;
	entityId: string;
	requesterEmployeeId: string;
};

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

function jsonObjectValue(value: unknown) {
	return value && typeof value === "object" && !Array.isArray(value) && typeof (value as { value?: unknown }).value === "string"
		? (value as { value: string }).value
		: undefined;
}

function jsonObjectValues(value: unknown) {
	return value && typeof value === "object" && !Array.isArray(value)
		? jsonStringArray((value as { values?: unknown }).values)
		: undefined;
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
		conditions: record.conditions.map((condition) => {
			const valueJson = (condition as { valueJson?: unknown }).valueJson;

			return {
				conditionType: condition.conditionType,
				operator: condition.operator,
				value:
					condition.value ??
					jsonString(valueJson) ??
					jsonObjectValue(valueJson) ??
					(condition as { overtimeRisk?: string | null }).overtimeRisk ??
					(condition as { teamId?: string | null }).teamId ??
					(condition as { locationId?: string | null }).locationId ??
					(condition as { absenceCategoryId?: string | null }).absenceCategoryId ??
					(condition as { employeeGroupId?: string | null }).employeeGroupId ??
					undefined,
				values: condition.values ?? jsonStringArray(valueJson) ?? jsonObjectValues(valueJson),
				amountMin: nullableNumber((condition as { amountMin?: unknown }).amountMin),
				amountMax: nullableNumber((condition as { amountMax?: unknown }).amountMax),
			};
		}),
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

function supportsTransactions(
	dbService: ApprovalDbService,
): dbService is ApprovalDbService & { db: ApprovalDbService["db"] & { transaction: Function } } {
	return typeof (dbService.db as { transaction?: unknown }).transaction === "function";
}

async function updateRows(
	dbService: ApprovalDbService,
	table: unknown,
	values: Record<string, unknown>,
	where: unknown,
) {
	const updateQuery = dbService.db.update(table as never).set(values as never).where(where as never);
	if (updateQuery && typeof updateQuery === "object" && "returning" in updateQuery) {
		const rows = (await updateQuery.returning()) as unknown;
		if (Array.isArray(rows) && rows.length === 0) {
			throw new ConflictError({
				message: "Approval chain stage is no longer pending",
				conflictType: "approval_chain_stage_status",
			});
		}
		return rows;
	}

	return updateQuery;
}

async function loadPolicyContext(dbService: ApprovalDbService, context: ApprovalPolicyEvaluationContext) {
	const [policies, groupRows, activeGroups, employees, managerLinks] = await Promise.all([
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
		dbService.db.query.employeeGroup.findMany({
			where: and(eq(employeeGroup.organizationId, context.organizationId), eq(employeeGroup.isActive, true)),
		}),
		dbService.db.query.employee.findMany({
			where: eq(employee.organizationId, context.organizationId),
		}),
		dbService.db.query.employeeManagers.findMany(),
	]);
	const activeGroupIds = new Set((activeGroups as Array<{ id: string }>).map((group) => group.id));

	return {
		policies: (policies as unknown as DbPolicyRecord[]).map(policyFromDbRecord),
		context: {
			...context,
			employeeGroupIds:
				context.employeeGroupIds.length > 0
					? context.employeeGroupIds.filter((groupId) => activeGroupIds.has(groupId))
					: (groupRows as Array<{ groupId: string; organizationId: string }>).flatMap((row) =>
						row.organizationId === context.organizationId && activeGroupIds.has(row.groupId) ? [row.groupId] : [],
					),
		},
		employees: employees as Parameters<typeof resolveApproverFromDirectory>[0]["employees"],
		managerLinks: managerLinks as Parameters<typeof resolveApproverFromDirectory>[0]["managerLinks"],
	};
}

function userIdForEmployee(employees: Array<{ id: string; userId?: string }>, employeeId: string) {
	const userId = employees.find((employee) => employee.id === employeeId)?.userId;
	if (!userId) {
		throw new ValidationError({
			message: "Requester has no user account in this organization.",
			field: "approvalPolicy.requesterEmployeeId",
			value: employeeId,
		});
	}

	return userId;
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
	dbService: ApprovalDbService,
	input: ChainProgressionInput,
): Effect.Effect<ChainProgressionResult, AnyAppError, never> {
	return Effect.gen(function* (_) {
		const linkedStage = yield* _(
			dbService.query("getApprovalChainStageForRequest", async () => {
				return await dbService.db.query.approvalChainStageInstance.findFirst({
					where: eq(approvalChainStageInstance.approvalRequestId, input.approvalRequestId),
				});
			}),
		);

		if (!linkedStage) {
			return { kind: "not_linked" } as const;
		}

		const stage = linkedStage as ChainStageInstanceRecord;
		if (stage.status !== "pending") {
			return yield* _(
				Effect.fail(
					new ConflictError({
						message: "Approval chain stage is no longer pending",
						conflictType: "approval_chain_stage_status",
					}),
				),
			);
		}

		const chain = yield* _(
			dbService.query("getApprovalChainInstance", async () => {
				return await dbService.db.query.approvalChainInstance.findFirst({
					where: and(
						eq(approvalChainInstance.id, stage.chainInstanceId),
						eq(approvalChainInstance.organizationId, stage.organizationId),
					),
				});
			}),
		);

		if (!chain) {
			return yield* _(
				Effect.fail(
					new ConflictError({
						message: "Approval chain instance not found",
						conflictType: "approval_chain_missing",
					}),
				),
			);
		}

		const chainRecord = chain as ChainInstanceRecord;
		if (input.action === "reject") {
			yield* _(
				dbService.query("rejectApprovalChainStage", () =>
					updateRows(
						dbService,
						approvalChainStageInstance,
						{
							status: "rejected",
							decidedBy: input.actorEmployeeId,
							decidedAt: currentTimestamp(),
							updatedAt: currentTimestamp(),
						},
						and(
							eq(approvalChainStageInstance.id, stage.id),
							eq(approvalChainStageInstance.organizationId, stage.organizationId),
							eq(approvalChainStageInstance.status, "pending"),
						),
					),
				),
			);
			yield* _(
				logApprovalPolicyEvent(dbService, {
					organizationId: stage.organizationId,
					eventName: "approval_chain.stage_rejected",
					chainId: stage.chainInstanceId,
					stageId: stage.id,
					entityType: chainRecord.entityType,
					entityId: chainRecord.entityId,
					actorUserId: input.actorUserId,
					actorEmployeeId: input.actorEmployeeId,
					previousStatus: "pending",
					newStatus: "rejected",
					createdAt: new Date(),
				}),
			);
			yield* _(
				dbService.query("rejectApprovalChain", () =>
					updateRows(
						dbService,
						approvalChainInstance,
						{ status: "rejected", completedAt: currentTimestamp(), updatedAt: currentTimestamp() },
						and(
							eq(approvalChainInstance.id, chainRecord.id),
							eq(approvalChainInstance.organizationId, chainRecord.organizationId),
						),
					),
				),
			);
			yield* _(
				logApprovalPolicyEvent(dbService, {
					organizationId: chainRecord.organizationId,
					eventName: "approval_chain.rejected",
					chainId: chainRecord.id,
					entityType: chainRecord.entityType,
					entityId: chainRecord.entityId,
					actorUserId: input.actorUserId,
					actorEmployeeId: input.actorEmployeeId,
					previousStatus: "pending",
					newStatus: "rejected",
					createdAt: new Date(),
				}),
			);

			return { kind: "chain_rejected", rejected: true } as const;
		}

		yield* _(
			dbService.query("approveApprovalChainStage", () =>
				updateRows(
					dbService,
					approvalChainStageInstance,
					{
						status: "approved",
						decidedBy: input.actorEmployeeId,
						decidedAt: currentTimestamp(),
						updatedAt: currentTimestamp(),
					},
					and(
						eq(approvalChainStageInstance.id, stage.id),
						eq(approvalChainStageInstance.organizationId, stage.organizationId),
						eq(approvalChainStageInstance.status, "pending"),
					),
				),
			),
		);
		yield* _(
			logApprovalPolicyEvent(dbService, {
				organizationId: stage.organizationId,
				eventName: "approval_chain.stage_approved",
				chainId: stage.chainInstanceId,
				stageId: stage.id,
				entityType: chainRecord.entityType,
				entityId: chainRecord.entityId,
				actorUserId: input.actorUserId,
				actorEmployeeId: input.actorEmployeeId,
				previousStatus: "pending",
				newStatus: "approved",
				createdAt: new Date(),
			}),
		);

		const nextStage = yield* _(
			dbService.query("getNextApprovalChainStage", async () => {
				return await dbService.db.query.approvalChainStageInstance.findFirst({
					where: and(
						eq(approvalChainStageInstance.organizationId, stage.organizationId),
						eq(approvalChainStageInstance.chainInstanceId, stage.chainInstanceId),
						gt(approvalChainStageInstance.stepOrder, stage.stepOrder),
					),
					orderBy: [asc(approvalChainStageInstance.stepOrder)],
				});
			}),
		);

		if (!nextStage) {
			yield* _(
				dbService.query("completeApprovalChain", () =>
					updateRows(
						dbService,
						approvalChainInstance,
						{ status: "approved", completedAt: currentTimestamp(), updatedAt: currentTimestamp() },
						and(
							eq(approvalChainInstance.id, chainRecord.id),
							eq(approvalChainInstance.organizationId, chainRecord.organizationId),
						),
					),
				),
			);
			yield* _(
				logApprovalPolicyEvent(dbService, {
					organizationId: chainRecord.organizationId,
					eventName: "approval_chain.approved",
					chainId: chainRecord.id,
					entityType: chainRecord.entityType,
					entityId: chainRecord.entityId,
					actorUserId: input.actorUserId,
					actorEmployeeId: input.actorEmployeeId,
					previousStatus: "pending",
					newStatus: "approved",
					createdAt: new Date(),
				}),
			);

			return { kind: "chain_completed", completed: true } as const;
		}

		const next = nextStage as ChainStageInstanceRecord;
		const nextApprovalRequestId = yield* _(
			dbService.query("createNextApprovalRequest", () =>
				insertApprovalRequest(
					dbService,
					{
						context: {
							organizationId: chainRecord.organizationId,
							approvalType: chainRecord.entityType as ApprovalPolicyEvaluationContext["approvalType"],
							requesterEmployeeId: chainRecord.requesterEmployeeId,
							teamId: null,
							locationId: null,
							absenceCategoryId: null,
							travelExpenseAmount: null,
							overtimeRisk: null,
							employeeGroupIds: [],
							entityType: chainRecord.entityType,
							entityId: chainRecord.entityId,
						},
						defaultApproverId: next.resolvedApproverEmployeeId,
					},
					next.resolvedApproverEmployeeId,
				),
			),
		);

		yield* _(
			dbService.query("activateNextApprovalChainStage", () =>
				updateRows(
					dbService,
					approvalChainStageInstance,
					{
						status: "pending",
						approvalRequestId: nextApprovalRequestId,
						updatedAt: currentTimestamp(),
					},
					and(
						eq(approvalChainStageInstance.id, next.id),
						eq(approvalChainStageInstance.organizationId, next.organizationId),
					),
				),
			),
		);
		yield* _(
			logApprovalPolicyEvent(dbService, {
				organizationId: next.organizationId,
				eventName: "approval_chain.stage_request_created",
				chainId: next.chainInstanceId,
				stageId: next.id,
				entityType: chainRecord.entityType,
				entityId: chainRecord.entityId,
				actorUserId: input.actorUserId,
				actorEmployeeId: input.actorEmployeeId,
				previousStatus: "cancelled",
				newStatus: "pending",
				createdAt: new Date(),
			}),
		);
		yield* _(
			dbService.query("advanceApprovalChain", () =>
				updateRows(
					dbService,
					approvalChainInstance,
					{ currentStageOrder: next.stepOrder, updatedAt: currentTimestamp() },
					and(
						eq(approvalChainInstance.id, chainRecord.id),
						eq(approvalChainInstance.organizationId, chainRecord.organizationId),
					),
				),
			),
		);

		return { kind: "chain_pending" } as const;
	});
}

export function resolvePolicyAndCreateApproval(
	dbService: ApprovalDbService,
	input: ResolvePolicyAndCreateApprovalInput,
): Effect.Effect<ResolvePolicyAndCreateApprovalResult, AnyAppError, never> {
	return Effect.gen(function* (_) {
		const loaded = yield* _(dbService.query("loadApprovalPolicyContext", () => loadPolicyContext(dbService, input.context)));
		const matchedPolicy = findMatchingPolicy(loaded.context, loaded.policies);
		const requesterUserId = userIdForEmployee(loaded.employees, loaded.context.requesterEmployeeId);

		if (!matchedPolicy) {
			const approvalRequestId = yield* _(
				dbService.query("createDefaultApprovalRequest", () =>
					insertApprovalRequest(dbService, { ...input, context: loaded.context }, input.defaultApproverId),
				),
			);
			yield* _(
				logApprovalPolicyEvent(dbService, {
					organizationId: loaded.context.organizationId,
					eventName: "approval_policy.no_match_fallback",
					entityType: loaded.context.entityType,
					entityId: loaded.context.entityId,
					actorUserId: requesterUserId,
					actorEmployeeId: loaded.context.requesterEmployeeId,
					newStatus: "pending",
					createdAt: new Date(),
				}),
			);

			return { kind: "default_created", approvalRequestId } as const;
		}

		const resolvedStages: Array<{
			stage: typeof matchedPolicy.stages[number];
			approverEmployeeId: string;
		}> = [];
		for (const stage of matchedPolicy.stages.slice().sort((left, right) => left.stepOrder - right.stepOrder)) {
			const resolved = resolveApproverFromDirectory({
				organizationId: loaded.context.organizationId,
				requesterEmployeeId: loaded.context.requesterEmployeeId,
				stage,
				employees: loaded.employees,
				managerLinks: loaded.managerLinks,
			});

			if (!resolved.ok) {
				return yield* _(
					Effect.fail(
						new ValidationError({
							message: resolved.reason,
							field: "approvalPolicyStage.approverType",
							value: stage.approverType,
						}),
					),
				);
			}

			resolvedStages.push({ stage, approverEmployeeId: resolved.approverEmployeeId });
		}

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

		const createChainRows = async (writeDbService: ApprovalDbService) => {
			const chainRows = await writeDbService.db
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
			await Effect.runPromise(
				logApprovalPolicyEvent(writeDbService, {
					organizationId: loaded.context.organizationId,
					eventName: "approval_policy.matched",
					policyId: matchedPolicy.id,
					chainId: chainInstanceId,
					entityType: loaded.context.entityType,
					entityId: loaded.context.entityId,
					actorUserId: requesterUserId,
					actorEmployeeId: loaded.context.requesterEmployeeId,
					createdAt: new Date(),
				}),
			);
			await Effect.runPromise(
				logApprovalPolicyEvent(writeDbService, {
					organizationId: loaded.context.organizationId,
					eventName: "approval_chain.created",
					policyId: matchedPolicy.id,
					chainId: chainInstanceId,
					entityType: loaded.context.entityType,
					entityId: loaded.context.entityId,
					actorUserId: requesterUserId,
					actorEmployeeId: loaded.context.requesterEmployeeId,
					newStatus: "pending",
					createdAt: new Date(),
				}),
			);
			const approvalRequestId = await insertApprovalRequest(
				writeDbService,
				{ ...input, context: loaded.context },
				firstStage.approverEmployeeId,
			);

			for (const resolvedStage of resolvedStages) {
				const isCurrentStage = resolvedStage.stage.stepOrder === firstStage.stage.stepOrder;
				const stageRows = await writeDbService.db
					.insert(approvalChainStageInstance)
					.values({
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
					})
					.returning({ id: approvalChainStageInstance.id });
				const stageInstanceId = insertedId(stageRows, resolvedStage.stage.id);

				if (isCurrentStage) {
					await Effect.runPromise(
						logApprovalPolicyEvent(writeDbService, {
							organizationId: loaded.context.organizationId,
							eventName: "approval_chain.stage_request_created",
							policyId: matchedPolicy.id,
							chainId: chainInstanceId,
							stageId: stageInstanceId,
							entityType: loaded.context.entityType,
							entityId: loaded.context.entityId,
							actorUserId: requesterUserId,
							actorEmployeeId: loaded.context.requesterEmployeeId,
							newStatus: "pending",
							createdAt: new Date(),
						}),
					);
				}
			}

			return { chainInstanceId, approvalRequestId };
		};

		const result = yield* _(
				dbService.query("createApprovalChain", async () => {
				if (supportsTransactions(dbService)) {
					return await dbService.db.transaction(async (tx) => {
						const transactionalDb = Object.assign(Object.create(tx as object), {
							query: dbService.db.query,
						}) as ApprovalDbService["db"];

						return await createChainRows({
							db: transactionalDb,
							query: dbService.query,
						});
					});
				}

				return await createChainRows(dbService);
			}),
		);

		return { kind: "chain_created", ...result } as const;
	});
}
