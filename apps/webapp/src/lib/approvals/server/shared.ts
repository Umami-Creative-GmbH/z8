import { SpanStatusCode, trace } from "@opentelemetry/api";
import { and, eq } from "drizzle-orm";
import { Cause, Effect, Exit, Option } from "effect";
import { approvalRequest, employee } from "@/db/schema";
import { currentTimestamp } from "@/lib/datetime/drizzle-adapter";
import {
	type AnyAppError,
	AuthorizationError,
	ConflictError,
	NotFoundError,
} from "@/lib/effect/errors";
import {
	runServerActionSafe,
	type ServerActionResult,
} from "@/lib/effect/result";
import { AppLayer } from "@/lib/effect/runtime";
import { AuthService } from "@/lib/effect/services/auth.service";
import { DatabaseService } from "@/lib/effect/services/database.service";
import { createLogger } from "@/lib/logger";
import type { ApprovalActionOptions } from "../domain/types";
import {
	ApprovalAuditLogger,
	ApprovalAuditLoggerLive,
	createApprovalAuditLogger,
} from "../infrastructure/audit-logger";
import { progressApprovalChainIfLinked } from "../policies/chain-service";
import { isEligibleManagerForApprovalRequest } from "../policies/manager-eligibility-db";
import type {
	ApprovalAction,
	ApprovalDbService,
	ApprovalEntityType,
	ApprovalStatusUpdate,
	CurrentApprover,
	PendingApprovalRequest,
} from "./types";

const logger = createLogger("ApprovalsActionsEffect");

export function getApprovalStatusUpdate(
	action: ApprovalAction,
	rejectionReason?: string,
): ApprovalStatusUpdate {
	return {
		status: action === "approve" ? "approved" : "rejected",
		approvedAt: action === "approve" ? currentTimestamp() : null,
		rejectionReason: action === "reject" ? rejectionReason : undefined,
		updatedAt: currentTimestamp(),
	};
}

function loadCurrentApprover(
	dbService: ApprovalDbService,
	userId: string,
	activeOrganizationId?: string,
): Effect.Effect<CurrentApprover, AnyAppError, never> {
	return dbService
		.query("getEmployeeByUserId", async () => {
			return await dbService.db.query.employee.findFirst({
				where: activeOrganizationId
					? and(
							eq(employee.userId, userId),
							eq(employee.organizationId, activeOrganizationId),
							eq(employee.isActive, true),
						)
					: and(eq(employee.userId, userId), eq(employee.isActive, true)),
				with: { user: true },
			});
		})
		.pipe(
			Effect.flatMap((approver) =>
				approver
					? Effect.succeed(approver as CurrentApprover)
					: Effect.fail(
							new NotFoundError({
								message: "Employee profile not found",
								entityType: "employee",
							}),
						),
			),
		);
}

function loadPendingApprovalRequest(
	dbService: ApprovalDbService,
	entityType: ApprovalEntityType,
	entityId: string,
	approverId: string,
	actorOrganizationId: string,
	action: ApprovalAction,
	options?: ApprovalActionOptions,
): Effect.Effect<PendingApprovalRequest, AnyAppError, never> {
	return dbService
		.query("getApprovalRequest", async () => {
			const approvalRequestId = options?.approvalRequestId;

			return await dbService.db.query.approvalRequest.findFirst({
				where: approvalRequestId
					? and(
							eq(approvalRequest.id, approvalRequestId),
							eq(approvalRequest.organizationId, actorOrganizationId),
							eq(approvalRequest.entityType, entityType),
							eq(approvalRequest.entityId, entityId),
						)
					: and(
							eq(approvalRequest.organizationId, actorOrganizationId),
							eq(approvalRequest.entityType, entityType),
							eq(approvalRequest.entityId, entityId),
							eq(approvalRequest.approverId, approverId),
							eq(approvalRequest.status, "pending"),
						),
			});
		})
		.pipe(
			Effect.flatMap(
				(
					request,
				): Effect.Effect<PendingApprovalRequest, AnyAppError, never> => {
					if (!request) {
						if (options?.approvalRequestId) {
							return Effect.fail(
								new NotFoundError({
									message: "Approval request not found",
									entityType: "approval_request",
									entityId: options.approvalRequestId,
								}),
							);
						}
						return Effect.fail(
							new AuthorizationError({
								message:
									"Approval request not found, already processed, or you are not the approver",
								userId: approverId,
								resource: entityType,
								action,
							}),
						);
					}

					const pendingRequest = request as PendingApprovalRequest;
					if (pendingRequest.status !== "pending") {
						return Effect.fail(
							new ConflictError({
								message: `Approval request is already ${pendingRequest.status}`,
								conflictType: "approval_status",
							}),
						);
					}
					if (
						!options?.allowAnyApprover &&
						!options?.allowOrganizationWideApprover &&
						pendingRequest.approverId !== approverId
					) {
						return Effect.fail(
							new AuthorizationError({
								message: "You are not authorized to decide this request",
								userId: approverId,
								resource: entityType,
								action,
							}),
						);
					}
					if (
						(options?.allowAnyApprover ||
							options?.allowOrganizationWideApprover) &&
						pendingRequest.organizationId !== actorOrganizationId
					) {
						return Effect.fail(
							new AuthorizationError({
								message:
									"Approval request not found, already processed, or you are not the approver",
								userId: approverId,
								resource: entityType,
								action,
							}),
						);
					}

					return Effect.succeed(pendingRequest);
				},
			),
		);
}

function updatePendingApprovalRequest(
	dbService: ApprovalDbService,
	approval: PendingApprovalRequest,
	statusUpdate: ApprovalStatusUpdate,
) {
	return dbService
		.query("updateApprovalStatus", async () => {
			const updateQuery = dbService.db
				.update(approvalRequest)
				.set(statusUpdate)
				.where(
					and(
						eq(approvalRequest.id, approval.id),
						eq(approvalRequest.organizationId, approval.organizationId),
						eq(approvalRequest.status, "pending"),
						eq(approvalRequest.approverId, approval.approverId),
						eq(approvalRequest.entityType, approval.entityType),
						eq(approvalRequest.entityId, approval.entityId),
					),
				);

			const updatedRows =
				updateQuery &&
				typeof updateQuery === "object" &&
				"returning" in updateQuery
					? await updateQuery.returning({ id: approvalRequest.id })
					: await updateQuery;

			return updatedRows;
		})
		.pipe(
			Effect.flatMap((updatedRows) =>
				!Array.isArray(updatedRows) ||
				updatedRows.length !== 1 ||
				updatedRows[0]?.id !== approval.id
					? Effect.fail(
							new ConflictError({
								message: "Approval request is no longer pending",
								conflictType: "approval_status",
							}),
						)
					: Effect.succeed(updatedRows),
			),
		);
}

type ApprovalEntityUpdater<T> = (
	dbService: ApprovalDbService,
	entityId: string,
	currentEmployee: CurrentApprover,
	approval: PendingApprovalRequest,
) => Effect.Effect<T, AnyAppError, unknown>;

interface ApprovalPostCommitHandlers<T> {
	updateEntity: ApprovalEntityUpdater<T>;
	afterCommit: (
		result: T,
		dbService: ApprovalDbService,
		entityId: string,
		currentEmployee: CurrentApprover,
	) => Effect.Effect<void, AnyAppError, unknown>;
}

interface ApprovalExecutionResult<T> {
	domainResult: T | undefined;
	didRunDomainUpdate: boolean;
}

function runAfterCommitBestEffort<T>(
	handlers: ApprovalPostCommitHandlers<T>,
	result: T,
	dbService: ApprovalDbService,
	entityType: ApprovalEntityType,
	entityId: string,
	currentEmployee: CurrentApprover,
) {
	return handlers
		.afterCommit(result, dbService, entityId, currentEmployee)
		.pipe(
			Effect.catchAllCause((cause) => {
				const error =
					Option.getOrNull(Cause.failureOption(cause)) ??
					[...Cause.defects(cause)][0] ??
					Cause.pretty(cause);
				return Effect.sync(() =>
					logger.error(
						{
							error,
							entityType,
							entityId,
							organizationId: currentEmployee.organizationId,
						},
						"Approval after-commit work failed",
					),
				);
			}),
		);
}

function executeApprovalWithCurrentEmployee<T>(
	dbService: ApprovalDbService,
	currentEmployee: CurrentApprover,
	entityType: ApprovalEntityType,
	entityId: string,
	action: ApprovalAction,
	rejectionReason?: string,
	updateEntity?: ApprovalEntityUpdater<T>,
	preflightEntity?: (
		dbService: ApprovalDbService,
		entityId: string,
		currentEmployee: CurrentApprover,
		options?: ApprovalActionOptions,
	) => Effect.Effect<unknown, AnyAppError, unknown>,
	options?: ApprovalActionOptions,
	postCommitHandlers?: ApprovalPostCommitHandlers<T>,
) {
	const statusUpdate = getApprovalStatusUpdate(action, rejectionReason);

	return Effect.gen(function* (_) {
		const auditLogger = yield* _(ApprovalAuditLogger);

		if (preflightEntity) {
			yield* _(preflightEntity(dbService, entityId, currentEmployee, options));
		}

		const approval = yield* _(
			loadPendingApprovalRequest(
				dbService,
				entityType,
				entityId,
				currentEmployee.id,
				currentEmployee.organizationId,
				action,
				options,
			),
		);
		if (
			options?.allowAnyApprover &&
			!options.allowOrganizationWideApprover &&
			approval.approverId !== currentEmployee.id
		) {
			const eligible = yield* _(
				Effect.tryPromise({
					try: () =>
						isEligibleManagerForApprovalRequest({
							db: dbService.db,
							approvalRequestId: approval.id,
							managerEmployeeId: currentEmployee.id,
							organizationId: currentEmployee.organizationId,
						}),
					catch: (error) => error as AnyAppError,
				}),
			);
			if (!eligible) {
				return yield* _(
					Effect.fail(
						new AuthorizationError({
							message: "You are not authorized to decide this request",
							userId: currentEmployee.id,
							resource: entityType,
							action,
						}),
					),
				);
			}
		}

		logger.info(
			{
				approverId: currentEmployee.id,
				entityType,
				entityId,
				action,
			},
			"Processing approval action",
		);

		yield* _(updatePendingApprovalRequest(dbService, approval, statusUpdate));

		const chainResult = yield* _(
			progressApprovalChainIfLinked(dbService, {
				approvalRequestId: approval.id,
				actorEmployeeId: currentEmployee.id,
				actorUserId: currentEmployee.user.id,
				action,
			}),
		);

		const shouldRunDomainSideEffect =
			chainResult.kind === "not_linked" ||
			chainResult.kind === "chain_completed" ||
			chainResult.kind === "chain_auto_completed" ||
			chainResult.kind === "chain_rejected";
		const selectedUpdateEntity =
			postCommitHandlers?.updateEntity ?? updateEntity;

		let domainResult: T | undefined;
		let didRunDomainUpdate = false;
		if (selectedUpdateEntity && shouldRunDomainSideEffect) {
			domainResult = yield* _(
				selectedUpdateEntity(dbService, entityId, currentEmployee, approval),
			);
			didRunDomainUpdate = true;
		}

		yield* _(
			auditLogger.log({
				organizationId: currentEmployee.organizationId,
				approvalId: approval.id,
				approvalType: entityType,
				entityId,
				action,
				performedBy: currentEmployee.user.id,
				previousStatus: approval.status,
				newStatus: statusUpdate.status,
				reason: rejectionReason,
			}),
		);

		logger.info(
			{
				approvalId: approval.id,
				entityType,
				entityId,
				action,
			},
			`Successfully ${action === "approve" ? "approved" : "rejected"} ${entityType}`,
		);

		return {
			domainResult,
			didRunDomainUpdate,
		} satisfies ApprovalExecutionResult<T>;
	});
}

export function processApprovalWithCurrentEmployee<T>(
	dbService: ApprovalDbService,
	currentEmployee: CurrentApprover,
	entityType: ApprovalEntityType,
	entityId: string,
	action: ApprovalAction,
	rejectionReason?: string,
	updateEntity?: ApprovalEntityUpdater<T>,
	preflightEntity?: (
		dbService: ApprovalDbService,
		entityId: string,
		currentEmployee: CurrentApprover,
		options?: ApprovalActionOptions,
	) => Effect.Effect<unknown, AnyAppError, unknown>,
	options?: ApprovalActionOptions,
	postCommitHandlers?: ApprovalPostCommitHandlers<T>,
	transactionBehavior: "open" | "existing" = "open",
) {
	return Effect.gen(function* (_) {
		const auditLogger = yield* _(ApprovalAuditLogger);
		const callerContext = yield* _(Effect.context<never>());

		if (!options?.transactional || transactionBehavior === "existing") {
			const execution = yield* _(
				executeApprovalWithCurrentEmployee(
					dbService,
					currentEmployee,
					entityType,
					entityId,
					action,
					rejectionReason,
					updateEntity,
					preflightEntity,
					options,
					postCommitHandlers,
				).pipe(Effect.provideService(ApprovalAuditLogger, auditLogger)),
			);
			if (execution.didRunDomainUpdate && postCommitHandlers) {
				yield* _(
					runAfterCommitBestEffort(
						postCommitHandlers,
						execution.domainResult as T,
						dbService,
						entityType,
						entityId,
						currentEmployee,
					),
				);
			}
			return execution.domainResult;
		}

		const execution = yield* _(
			Effect.tryPromise({
				try: async () => {
					let result: ApprovalExecutionResult<T> | undefined;
					await dbService.db.transaction(async (tx) => {
						const transactionalDbService: ApprovalDbService = {
							db: tx,
							query: dbService.query,
						};
						const transactionalAuditLogger = createApprovalAuditLogger(
							transactionalDbService,
						);

						const exit = await Effect.runPromiseExit(
							// Transactional approvals currently run only self-contained handlers.
							executeApprovalWithCurrentEmployee(
								transactionalDbService,
								currentEmployee,
								entityType,
								entityId,
								action,
								rejectionReason,
								updateEntity,
								preflightEntity,
								options,
								postCommitHandlers,
							).pipe(
								Effect.provideService(
									ApprovalAuditLogger,
									transactionalAuditLogger,
								),
								Effect.provide(callerContext),
							) as Effect.Effect<
								ApprovalExecutionResult<T>,
								AnyAppError,
								never
							>,
						);

						if (Exit.isFailure(exit)) {
							const failure = Option.getOrNull(Cause.failureOption(exit.cause));
							const defects = [...Cause.defects(exit.cause)];
							throw failure ?? defects[0] ?? new Error("An error has occurred");
						}

						result = exit.value;
					});
					if (!result) {
						throw new Error("Approval transaction did not execute");
					}
					return result;
				},
				catch: (error) => error as AnyAppError,
			}),
		);
		if (execution.didRunDomainUpdate && postCommitHandlers) {
			yield* _(
				runAfterCommitBestEffort(
					postCommitHandlers,
					execution.domainResult as T,
					dbService,
					entityType,
					entityId,
					currentEmployee,
				),
			);
		}
		return execution.domainResult;
	});
}

export async function processApproval<T>(
	entityType: ApprovalEntityType,
	entityId: string,
	action: ApprovalAction,
	rejectionReason?: string,
	updateEntity?: ApprovalEntityUpdater<T>,
	preflightEntity?: (
		dbService: ApprovalDbService,
		entityId: string,
		currentEmployee: CurrentApprover,
		options?: ApprovalActionOptions,
	) => Effect.Effect<unknown, AnyAppError, unknown>,
	options?: ApprovalActionOptions,
	postCommitHandlers?: ApprovalPostCommitHandlers<T>,
): Promise<ServerActionResult<T | undefined>> {
	const tracer = trace.getTracer("approvals");

	const effect = tracer.startActiveSpan(
		`${action}Entity`,
		{
			attributes: {
				"approval.entity_type": entityType,
				"approval.entity_id": entityId,
				"approval.action": action,
			},
		},
		(span) => {
			return Effect.gen(function* (_) {
				const authService = yield* _(AuthService);
				const session = yield* _(authService.getSession());
				const dbService = yield* _(DatabaseService);

				const currentEmployee = yield* _(
					loadCurrentApprover(
						dbService,
						session.user.id,
						session.session.activeOrganizationId ?? undefined,
					),
				);

				span.setAttribute("user.id", session.user.id);
				span.setAttribute("approver.id", currentEmployee.id);

				const result = yield* _(
					processApprovalWithCurrentEmployee(
						dbService,
						currentEmployee,
						entityType,
						entityId,
						action,
						rejectionReason,
						updateEntity,
						preflightEntity,
						options,
						postCommitHandlers,
					),
				);

				span.setStatus({ code: SpanStatusCode.OK });
				return result;
			}).pipe(
				Effect.catchAll((error) =>
					Effect.gen(function* (_) {
						span.recordException(error as Error);
						span.setStatus({
							code: SpanStatusCode.ERROR,
							message: String(error),
						});

						logger.error(
							{ error, entityType, entityId, action },
							"Failed to process approval",
						);
						return yield* _(Effect.fail(error as AnyAppError));
					}),
				),
				Effect.onExit(() => Effect.sync(() => span.end())),
				Effect.provide(ApprovalAuditLoggerLive),
				Effect.provide(AppLayer),
			);
		},
	);

	return runServerActionSafe(
		effect as Effect.Effect<T | undefined, AnyAppError, never>,
	);
}
