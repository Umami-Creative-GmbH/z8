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
	team,
	teamMembership,
} from "@/db/schema";
import { currentTimestamp } from "@/lib/datetime/drizzle-adapter";
import {
	type AnyAppError,
	ConflictError,
	ValidationError,
} from "@/lib/effect/errors";
import { logApprovalPolicyEvent } from "../infrastructure/audit-logger";
import type { ApprovalDbService } from "../server/types";
import { resolveApproverFromDirectory } from "./approver-resolution";
import { findMatchingPolicy } from "./matcher";
import {
	classifyLegacyStage,
	type LegacyStageDisposition,
} from "./requester-auto-approval";
import type {
	ApprovalPolicyDraft,
	ApprovalPolicyEvaluationContext,
} from "./types";

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

export const APPROVAL_POLICY_CHAIN_NOT_CONFIGURED =
	"approval_policy_chain_not_configured";

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
	| { kind: "chain_auto_completed"; completed: true }
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
	defaultApproverId: string | null;
	transactionBehavior?: "open" | "existing";
	reason?: string;
	metadata?: Record<string, unknown>;
	metadataForResultKind?: (
		kind: ResolvePolicyAndCreateApprovalResult["kind"],
	) => Record<string, unknown> | undefined;
}

export type ResolvePolicyAndCreateApprovalResult =
	| { kind: "default_created"; approvalRequestId: string }
	| {
			kind: "chain_created";
			chainInstanceId: string;
			approvalRequestId: string;
	  }
	| {
			kind: "auto_completed";
			chainInstanceId: string | null;
			approvalRequestId: string;
			reason: "requester_is_approver";
	  };

type DbPolicyRecord = ApprovalPolicyDraft & {
	description?: string | null;
};

function jsonString(value: unknown) {
	return typeof value === "string" ? value : undefined;
}

function jsonStringArray(value: unknown) {
	return Array.isArray(value)
		? value.filter((item): item is string => typeof item === "string")
		: undefined;
}

function jsonObjectValue(value: unknown) {
	return value &&
		typeof value === "object" &&
		!Array.isArray(value) &&
		typeof (value as { value?: unknown }).value === "string"
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
					(condition as { absenceCategoryId?: string | null })
						.absenceCategoryId ??
					(condition as { employeeGroupId?: string | null }).employeeGroupId ??
					undefined,
				values:
					condition.values ??
					jsonStringArray(valueJson) ??
					jsonObjectValues(valueJson),
				amountMin: nullableNumber(
					(condition as { amountMin?: unknown }).amountMin,
				),
				amountMax: nullableNumber(
					(condition as { amountMax?: unknown }).amountMax,
				),
			};
		}),
		stages: record.stages.map((stage) => ({
			id: stage.id,
			stepOrder: stage.stepOrder,
			label: stage.label,
			approverType: stage.approverType,
			approverEmployeeId: stage.approverEmployeeId ?? undefined,
			fallbackBehavior: stage.fallbackBehavior,
		})),
	};
}

function insertedId(rows: unknown, fallback: string) {
	if (
		Array.isArray(rows) &&
		rows[0] &&
		typeof rows[0] === "object" &&
		"id" in rows[0]
	) {
		return String((rows[0] as { id: unknown }).id);
	}

	return fallback;
}

async function insertApprovalRequest(
	dbService: ApprovalDbService,
	input: ResolvePolicyAndCreateApprovalInput,
	approverId: string,
	disposition: LegacyStageDisposition = {
		kind: "human",
		approverEmployeeId: approverId,
	},
) {
	const autoApproved = disposition.kind === "auto_approve";
	const rows = await dbService.db
		.insert(approvalRequest)
		.values({
			organizationId: input.context.organizationId,
			entityType: input.context.entityType,
			entityId: input.context.entityId,
			requestedBy: input.context.requesterEmployeeId,
			approverId,
			status: autoApproved ? "approved" : "pending",
			reason: input.reason,
			metadata: autoApproved
				? {
						...(input.metadata ?? {}),
						autoApproval: { reason: disposition.reason },
					}
				: input.metadata,
			approvedAt: autoApproved ? currentTimestamp() : undefined,
		})
		.returning({ id: approvalRequest.id });

	return insertedId(rows, input.context.entityId);
}

function approvalInputForChain(
	chain: ChainInstanceRecord,
	metadata?: Record<string, unknown>,
): ResolvePolicyAndCreateApprovalInput {
	return {
		context: {
			organizationId: chain.organizationId,
			approvalType:
				chain.entityType as ApprovalPolicyEvaluationContext["approvalType"],
			requesterEmployeeId: chain.requesterEmployeeId,
			teamId: null,
			locationId: null,
			absenceCategoryId: null,
			travelExpenseAmount: null,
			overtimeRisk: null,
			employeeGroupIds: [],
			entityType: chain.entityType,
			entityId: chain.entityId,
		},
		defaultApproverId: chain.requesterEmployeeId,
		metadata,
	};
}

function supportsTransactions(
	dbService: ApprovalDbService,
): dbService is ApprovalDbService & {
	db: ApprovalDbService["db"] & {
		transaction<T>(
			operation: (transaction: ApprovalDbService["db"]) => Promise<T>,
		): Promise<T>;
	};
} {
	return (
		typeof (dbService.db as { transaction?: unknown }).transaction ===
		"function"
	);
}

async function updateRows(
	dbService: ApprovalDbService,
	table: unknown,
	values: Record<string, unknown>,
	where: unknown,
) {
	const updateQuery = dbService.db
		.update(table as never)
		.set(values as never)
		.where(where as never);
	if (
		updateQuery &&
		typeof updateQuery === "object" &&
		"returning" in updateQuery
	) {
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

async function loadPolicyContext(
	dbService: ApprovalDbService,
	context: ApprovalPolicyEvaluationContext,
) {
	const policies = await dbService.db.query.approvalPolicy.findMany({
		where: eq(approvalPolicy.organizationId, context.organizationId),
		orderBy: [asc(approvalPolicy.priority)],
		with: { conditions: true, stages: true },
	});
	const groupRows =
		context.employeeGroupIds.length === 0
			? await dbService.db.query.employeeGroupMember.findMany({
					where: and(
						eq(employeeGroupMember.organizationId, context.organizationId),
						eq(employeeGroupMember.employeeId, context.requesterEmployeeId),
					),
				})
			: [];
	const activeGroups = await dbService.db.query.employeeGroup.findMany({
		where: and(
			eq(employeeGroup.organizationId, context.organizationId),
			eq(employeeGroup.isActive, true),
		),
	});
	const employees = await dbService.db.query.employee.findMany({
		where: eq(employee.organizationId, context.organizationId),
	});
	const managerLinks = await dbService.db.query.employeeManagers.findMany();
	const teamMemberships = await dbService.db.query.teamMembership.findMany({
		where: and(
			eq(teamMembership.organizationId, context.organizationId),
			eq(teamMembership.employeeId, context.requesterEmployeeId),
		),
	});
	const teams = await dbService.db.query.team.findMany({
		where: eq(team.organizationId, context.organizationId),
	});
	const activeGroupIds = new Set(
		(activeGroups as Array<{ id: string }>).map((group) => group.id),
	);

	return {
		policies: (policies as unknown as DbPolicyRecord[]).map(policyFromDbRecord),
		context: {
			...context,
			employeeGroupIds:
				context.employeeGroupIds.length > 0
					? context.employeeGroupIds.filter((groupId) =>
							activeGroupIds.has(groupId),
						)
					: (
							groupRows as Array<{ groupId: string; organizationId: string }>
						).flatMap((row) =>
							row.organizationId === context.organizationId &&
							activeGroupIds.has(row.groupId)
								? [row.groupId]
								: [],
						),
		},
		employees: employees as Parameters<
			typeof resolveApproverFromDirectory
		>[0]["employees"],
		managerLinks: managerLinks as Parameters<
			typeof resolveApproverFromDirectory
		>[0]["managerLinks"],
		teamMemberships: teamMemberships as NonNullable<
			Parameters<typeof resolveApproverFromDirectory>[0]["teamMemberships"]
		>,
		teams: teams as NonNullable<
			Parameters<typeof resolveApproverFromDirectory>[0]["teams"]
		>,
	};
}

function userIdForEmployee(
	employees: Array<{ id: string; userId?: string }>,
	employeeId: string,
) {
	const userId = employees.find(
		(employee) => employee.id === employeeId,
	)?.userId;
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

export function createChainInMemory(
	input: CreateChainInMemoryInput,
): ChainInMemory {
	const firstStageOrder = Math.min(
		...input.policy.stages.map((stage) => stage.stepOrder),
	);

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
					stage.stepOrder === firstStageOrder
						? requestIdForStage(stage.stepOrder)
						: null,
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
	const nextStage = stages.find(
		(stage) => stage.stepOrder > chain.currentStageOrder,
	);

	if (!nextStage) {
		return { ...chain, status: "approved", stages };
	}

	return {
		...chain,
		currentStageOrder: nextStage.stepOrder,
		stages: stages.map((stage) =>
			stage.stepOrder === nextStage.stepOrder
				? {
						...stage,
						status: "pending",
						approvalRequestId: requestIdForStage(stage.stepOrder),
					}
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
					where: eq(
						approvalChainStageInstance.approvalRequestId,
						input.approvalRequestId,
					),
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
							eq(
								approvalChainStageInstance.organizationId,
								stage.organizationId,
							),
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
						{
							status: "rejected",
							completedAt: currentTimestamp(),
							updatedAt: currentTimestamp(),
						},
						and(
							eq(approvalChainInstance.id, chainRecord.id),
							eq(
								approvalChainInstance.organizationId,
								chainRecord.organizationId,
							),
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

		const currentApproval = yield* _(
			dbService.query("getCurrentApprovalRequest", async () => {
				return await dbService.db.query.approvalRequest.findFirst({
					where: and(
						eq(approvalRequest.id, input.approvalRequestId),
						eq(approvalRequest.organizationId, chainRecord.organizationId),
					),
				});
			}),
		);
		const approvalMetadata = (
			currentApproval as { metadata?: Record<string, unknown> } | null
		)?.metadata;
		let cursor = stage;
		let completionActorUserId = input.actorUserId;
		let completionActorEmployeeId = input.actorEmployeeId;
		let requesterUserId: string | undefined;
		let drainedRequesterStage = false;

		while (true) {
			const nextStage = yield* _(
				dbService.query("getNextApprovalChainStage", async () => {
					return await dbService.db.query.approvalChainStageInstance.findFirst({
						where: and(
							eq(
								approvalChainStageInstance.organizationId,
								cursor.organizationId,
							),
							eq(
								approvalChainStageInstance.chainInstanceId,
								cursor.chainInstanceId,
							),
							gt(approvalChainStageInstance.stepOrder, cursor.stepOrder),
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
							{
								status: "approved",
								currentStageOrder: cursor.stepOrder,
								completedAt: currentTimestamp(),
								updatedAt: currentTimestamp(),
							},
							and(
								eq(approvalChainInstance.id, chainRecord.id),
								eq(
									approvalChainInstance.organizationId,
									chainRecord.organizationId,
								),
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
						actorUserId: completionActorUserId,
						actorEmployeeId: completionActorEmployeeId,
						previousStatus: "pending",
						newStatus: "approved",
						createdAt: new Date(),
					}),
				);

				return drainedRequesterStage
					? ({ kind: "chain_auto_completed", completed: true } as const)
					: ({ kind: "chain_completed", completed: true } as const);
			}

			const next = nextStage as ChainStageInstanceRecord;
			const disposition = classifyLegacyStage({
				requesterEmployeeId: chainRecord.requesterEmployeeId,
				approverEmployeeId: next.resolvedApproverEmployeeId,
			});

			if (disposition.kind === "auto_approve") {
				if (!requesterUserId) {
					const requester = yield* _(
						dbService.query("getApprovalChainRequester", async () => {
							return await dbService.db.query.employee.findFirst({
								where: and(
									eq(employee.id, chainRecord.requesterEmployeeId),
									eq(employee.organizationId, chainRecord.organizationId),
								),
								columns: { userId: true },
							});
						}),
					);
					requesterUserId = (requester as { userId?: string } | null)?.userId;
					if (!requesterUserId) {
						return yield* _(
							Effect.fail(
								new ValidationError({
									message:
										"Requester has no user account in this organization.",
									field: "approvalChain.requesterEmployeeId",
									value: chainRecord.requesterEmployeeId,
								}),
							),
						);
					}
				}
				const autoApprovalRequestId = yield* _(
					dbService.query("createAutoApprovedApprovalRequest", () =>
						insertApprovalRequest(
							dbService,
							approvalInputForChain(chainRecord, approvalMetadata),
							next.resolvedApproverEmployeeId,
							disposition,
						),
					),
				);
				yield* _(
					dbService.query("autoApproveApprovalChainStage", () =>
						updateRows(
							dbService,
							approvalChainStageInstance,
							{
								status: "approved",
								approvalRequestId: autoApprovalRequestId,
								decidedBy: chainRecord.requesterEmployeeId,
								decidedAt: currentTimestamp(),
								updatedAt: currentTimestamp(),
							},
							and(
								eq(approvalChainStageInstance.id, next.id),
								eq(
									approvalChainStageInstance.organizationId,
									next.organizationId,
								),
							),
						),
					),
				);
				yield* _(
					logApprovalPolicyEvent(dbService, {
						organizationId: next.organizationId,
						eventName: "approval_chain.stage_auto_approved",
						chainId: next.chainInstanceId,
						stageId: next.id,
						entityType: chainRecord.entityType,
						entityId: chainRecord.entityId,
						actorUserId: requesterUserId,
						actorEmployeeId: chainRecord.requesterEmployeeId,
						previousStatus: "cancelled",
						newStatus: "approved",
						reason: disposition.reason,
						createdAt: new Date(),
					}),
				);
				cursor = next;
				drainedRequesterStage = true;
				completionActorUserId = requesterUserId;
				completionActorEmployeeId = chainRecord.requesterEmployeeId;
				continue;
			}

			const nextApprovalRequestId = yield* _(
				dbService.query("createNextApprovalRequest", () =>
					insertApprovalRequest(
						dbService,
						approvalInputForChain(chainRecord, approvalMetadata),
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
							eq(
								approvalChainStageInstance.organizationId,
								next.organizationId,
							),
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
						{
							currentStageOrder: next.stepOrder,
							updatedAt: currentTimestamp(),
						},
						and(
							eq(approvalChainInstance.id, chainRecord.id),
							eq(
								approvalChainInstance.organizationId,
								chainRecord.organizationId,
							),
						),
					),
				),
			);

			return { kind: "chain_pending" } as const;
		}
	});
}

export function resolvePolicyAndCreateApproval(
	dbService: ApprovalDbService,
	input: ResolvePolicyAndCreateApprovalInput,
): Effect.Effect<ResolvePolicyAndCreateApprovalResult, AnyAppError, never> {
	return Effect.gen(function* (_) {
		const loaded = yield* _(
			dbService.query("loadApprovalPolicyContext", () =>
				loadPolicyContext(dbService, input.context),
			),
		);
		const matchedPolicy = findMatchingPolicy(loaded.context, loaded.policies);
		const requesterUserId = userIdForEmployee(
			loaded.employees,
			loaded.context.requesterEmployeeId,
		);

		if (!matchedPolicy) {
			const defaultApproverId = input.defaultApproverId;
			if (!defaultApproverId) {
				return yield* _(
					Effect.fail(
						new ValidationError({
							message: "No manager assigned to approve time changes",
							field: "managerId",
						}),
					),
				);
			}
			const disposition = classifyLegacyStage({
				requesterEmployeeId: loaded.context.requesterEmployeeId,
				approverEmployeeId: defaultApproverId,
			});
			const resultKind =
				disposition.kind === "auto_approve"
					? ("auto_completed" as const)
					: ("default_created" as const);
			const approvalRequestId = yield* _(
				dbService.query("createDefaultApprovalRequest", () =>
					insertApprovalRequest(
						dbService,
						{
							...input,
							context: loaded.context,
							metadata:
								input.metadataForResultKind?.(resultKind) ?? input.metadata,
						},
						defaultApproverId,
						disposition,
					),
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
					newStatus:
						disposition.kind === "auto_approve" ? "approved" : "pending",
					createdAt: new Date(),
				}),
			);

			if (disposition.kind === "auto_approve") {
				return {
					kind: "auto_completed",
					chainInstanceId: null,
					approvalRequestId,
					reason: disposition.reason,
				} as const;
			}

			return { kind: "default_created", approvalRequestId } as const;
		}

		const resolvedStages: Array<{
			stage: (typeof matchedPolicy.stages)[number];
			approverEmployeeId: string;
			disposition: LegacyStageDisposition;
		}> = [];
		for (const stage of matchedPolicy.stages
			.slice()
			.sort((left, right) => left.stepOrder - right.stepOrder)) {
			const resolved = resolveApproverFromDirectory({
				organizationId: loaded.context.organizationId,
				requesterEmployeeId: loaded.context.requesterEmployeeId,
				stage,
				employees: loaded.employees,
				managerLinks: loaded.managerLinks,
				teamMemberships: loaded.teamMemberships,
				teams: loaded.teams,
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

			resolvedStages.push({
				stage,
				approverEmployeeId: resolved.approverEmployeeId,
				disposition: classifyLegacyStage({
					requesterEmployeeId: loaded.context.requesterEmployeeId,
					approverEmployeeId: resolved.approverEmployeeId,
				}),
			});
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

		const firstHumanStage = resolvedStages.find(
			(resolvedStage) => resolvedStage.disposition.kind === "human",
		);
		const currentStage = firstHumanStage ?? resolvedStages.at(-1) ?? firstStage;
		const chainAutoCompleted = !firstHumanStage;
		const resultKind = chainAutoCompleted
			? ("auto_completed" as const)
			: ("chain_created" as const);
		const resultMetadata =
			input.metadataForResultKind?.(resultKind) ?? input.metadata;

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
					currentStageOrder: currentStage.stage.stepOrder,
					status: chainAutoCompleted ? "approved" : "pending",
					completedAt: chainAutoCompleted ? currentTimestamp() : undefined,
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
					newStatus: chainAutoCompleted ? "approved" : "pending",
					createdAt: new Date(),
				}),
			);
			let approvalRequestId: string | undefined;
			let reachedHumanStage = false;
			const { organizationId, requesterEmployeeId } = loaded.context;

			for (const resolvedStage of resolvedStages) {
				const shouldAutoApprove =
					!reachedHumanStage &&
					resolvedStage.disposition.kind === "auto_approve";
				const isCurrentHumanStage =
					!reachedHumanStage && resolvedStage.disposition.kind === "human";
				const stageApprovalRequestId =
					shouldAutoApprove || isCurrentHumanStage
						? await insertApprovalRequest(
								writeDbService,
								{
									...input,
									context: loaded.context,
									metadata: resultMetadata,
								},
								resolvedStage.approverEmployeeId,
								resolvedStage.disposition,
							)
						: null;
				if (stageApprovalRequestId) {
					approvalRequestId = stageApprovalRequestId;
				}
				const stageRows = await writeDbService.db
					.insert(approvalChainStageInstance)
					.values({
						organizationId,
						chainInstanceId,
						policyStageId: resolvedStage.stage.id,
						stepOrder: resolvedStage.stage.stepOrder,
						labelSnapshot: resolvedStage.stage.label,
						approverTypeSnapshot: resolvedStage.stage.approverType,
						resolvedApproverEmployeeId: resolvedStage.approverEmployeeId,
						approvalRequestId: stageApprovalRequestId,
						status: shouldAutoApprove
							? "approved"
							: isCurrentHumanStage
								? "pending"
								: "cancelled",
						decidedBy: shouldAutoApprove ? requesterEmployeeId : undefined,
						decidedAt: shouldAutoApprove ? currentTimestamp() : undefined,
						updatedAt: currentTimestamp(),
					})
					.returning({ id: approvalChainStageInstance.id });
				const stageInstanceId = insertedId(stageRows, resolvedStage.stage.id);

				if (shouldAutoApprove) {
					await Effect.runPromise(
						logApprovalPolicyEvent(writeDbService, {
							organizationId,
							eventName: "approval_chain.stage_auto_approved",
							policyId: matchedPolicy.id,
							chainId: chainInstanceId,
							stageId: stageInstanceId,
							entityType: loaded.context.entityType,
							entityId: loaded.context.entityId,
							actorUserId: requesterUserId,
							actorEmployeeId: requesterEmployeeId,
							previousStatus: "cancelled",
							newStatus: "approved",
							reason: "requester_is_approver",
							createdAt: new Date(),
						}),
					);
				}

				if (isCurrentHumanStage) {
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
					reachedHumanStage = true;
				}
			}

			if (chainAutoCompleted) {
				await Effect.runPromise(
					logApprovalPolicyEvent(writeDbService, {
						organizationId: loaded.context.organizationId,
						eventName: "approval_chain.approved",
						policyId: matchedPolicy.id,
						chainId: chainInstanceId,
						entityType: loaded.context.entityType,
						entityId: loaded.context.entityId,
						actorUserId: requesterUserId,
						actorEmployeeId: loaded.context.requesterEmployeeId,
						previousStatus: "pending",
						newStatus: "approved",
						createdAt: new Date(),
					}),
				);
			}

			if (!approvalRequestId) {
				throw new Error("Approval chain did not create an approval request");
			}

			return { chainInstanceId, approvalRequestId };
		};

		const result = yield* _(
			dbService.query("createApprovalChain", async () => {
				if (
					(input.transactionBehavior ?? "open") === "open" &&
					supportsTransactions(dbService)
				) {
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

		return chainAutoCompleted
			? ({
					kind: "auto_completed",
					...result,
					reason: "requester_is_approver",
				} as const)
			: ({ kind: "chain_created", ...result } as const);
	});
}
