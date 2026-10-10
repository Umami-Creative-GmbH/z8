import { SpanStatusCode, trace } from "@opentelemetry/api";
import { and, eq } from "drizzle-orm";
import { Cause, Effect, Exit } from "effect";
import { approvalRequest, employee } from "@/db/schema";
import { currentTimestamp } from "@/lib/datetime/drizzle-adapter";
import { failureOfCause, isInterruptOnly } from "@/lib/effect/cause-failure";
import {
	type AnyAppError,
	AuthorizationError,
	ConflictError,
	NotFoundError,
} from "@/lib/effect/errors";
import {
	type AppServices,
	runServerActionSafe,
	type ServerActionResult,
} from "@/lib/effect/result";
import { AuthService } from "@/lib/effect/services/auth.service";
import { DatabaseService } from "@/lib/effect/services/database.service";
import { createLogger } from "@/lib/logger";
import { systemClock } from "@/lib/datetime/temporal-core";
import type { ActingFor } from "../deputy/deputy-decision";
import {
	authorizeLegacyDeputyDecision,
	type DeputyDecisionEntityType,
	deputyDecisionAuditMetadata,
	recordDeputyDecision,
} from "../deputy/deputy-decision-store";
import type { ApprovalActionOptions } from "../domain/types";
import {
	ApprovalAssignmentReassignedError,
	approvalReassignedConflict,
} from "../escalation/decision-authority";
import { wasLegacyRequestTransferred } from "../escalation/legacy-transfer-store";
import {
	ApprovalAuditLogger,
	ApprovalAuditLoggerLive,
	createApprovalAuditLogger,
} from "../infrastructure/audit-logger";
import { progressApprovalChainIfLinked } from "../policies/chain-service";
import { isEligibleManagerForApprovalRequest } from "../policies/manager-eligibility-db";
import {
	isOwnRequestDecision,
	ownRequestDecisionError,
} from "../policies/self-decision";
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

					// Whatever ApprovalActionOptions grant, a requester never decides their own request.
					if (
						isOwnRequestDecision({
							requesterEmployeeId: request.requestedBy,
							actorEmployeeId: approverId,
						})
					) {
						return Effect.fail(
							ownRequestDecisionError({
								actorEmployeeId: approverId,
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
					// A non-approver without an own-right option is judged as a possible
					// covering deputy by the caller (#1016); the request was addressed by ID.
					if (
						pendingRequest.approverId !== approverId &&
						!options?.allowAnyApprover &&
						!options?.allowOrganizationWideApprover &&
						!options?.approvalRequestId
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
							options?.allowOrganizationWideApprover ||
							pendingRequest.approverId !== approverId) &&
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

/**
 * Entity callbacks declare the services they require (`R`); the decision
 * effect requires them too, so a runner cannot leave one unprovided.
 */
type ApprovalEntityUpdater<T, R = never> = (
	dbService: ApprovalDbService,
	entityId: string,
	currentEmployee: CurrentApprover,
	approval: PendingApprovalRequest,
) => Effect.Effect<T, AnyAppError, R>;

type ApprovalEntityPreflight<R = never> = (
	dbService: ApprovalDbService,
	entityId: string,
	currentEmployee: CurrentApprover,
	options?: ApprovalActionOptions,
) => Effect.Effect<unknown, AnyAppError, R>;

/** How the committed legacy decision was made, for after-commit work. */
export interface LegacyDecisionContext {
	/** Set when a covering deputy decided for the absent approver (#1016). */
	actingFor: ActingFor | null;
}

interface ApprovalPostCommitHandlers<T, R = never> {
	updateEntity: ApprovalEntityUpdater<T, R>;
	afterCommit: (
		result: T,
		dbService: ApprovalDbService,
		entityId: string,
		currentEmployee: CurrentApprover,
		decision: LegacyDecisionContext,
	) => Effect.Effect<void, AnyAppError, R>;
}

interface ApprovalExecutionResult<T> {
	domainResult: T | undefined;
	didRunDomainUpdate: boolean;
	decision: LegacyDecisionContext;
}

function runAfterCommitBestEffort<T, R>(
	handlers: ApprovalPostCommitHandlers<T, R>,
	result: T,
	dbService: ApprovalDbService,
	entityType: ApprovalEntityType,
	entityId: string,
	currentEmployee: CurrentApprover,
	decision: LegacyDecisionContext,
) {
	return handlers
		.afterCommit(result, dbService, entityId, currentEmployee, decision)
		.pipe(
			Effect.catchCause((cause) => {
				const error = isInterruptOnly(cause) ? Cause.pretty(cause) : failureOfCause(cause);
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

function executeApprovalWithCurrentEmployee<T, R = never>(
	dbService: ApprovalDbService,
	currentEmployee: CurrentApprover,
	entityType: ApprovalEntityType,
	entityId: string,
	action: ApprovalAction,
	rejectionReason?: string,
	updateEntity?: ApprovalEntityUpdater<T, R>,
	preflightEntity?: ApprovalEntityPreflight<R>,
	options?: ApprovalActionOptions,
	postCommitHandlers?: ApprovalPostCommitHandlers<T, R>,
) {
	const statusUpdate = getApprovalStatusUpdate(action, rejectionReason);

	return Effect.gen(function* () {
		const auditLogger = yield* ApprovalAuditLogger;

		if (preflightEntity) {
			yield* preflightEntity(dbService, entityId, currentEmployee, options);
		}

		const approval = yield* loadPendingApprovalRequest(
			dbService,
			entityType,
			entityId,
			currentEmployee.id,
			currentEmployee.organizationId,
			action,
			options,
		);
		let actingFor: ActingFor | null = null;
		if (
			!options?.allowOrganizationWideApprover &&
			approval.approverId !== currentEmployee.id
		) {
			// Own rights win (#1016 default 8): an eligible manager decides as
			// themselves; only someone without one may decide as a covering deputy.
			const eligible = options?.allowAnyApprover
				? yield* Effect.tryPromise({
						try: () =>
							isEligibleManagerForApprovalRequest({
								db: dbService.db,
								approvalRequestId: approval.id,
								managerEmployeeId: currentEmployee.id,
								organizationId: currentEmployee.organizationId,
							}),
						catch: (error) => error as AnyAppError,
					})
				: false;
			if (eligible) {
				// Eligible-manager status never bypasses an escalation replacement
				// (#255 §4, #439): the owners refuse it first; this keeps the fallback
				// itself closed for every legacy kind.
				const transferred = yield* Effect.tryPromise({
					try: () =>
						wasLegacyRequestTransferred(dbService.db, {
							organizationId: currentEmployee.organizationId,
							approvalRequestId: approval.id,
						}),
					catch: (error) => error as AnyAppError,
				});
				if (transferred) {
					return yield* Effect.fail(
						approvalReassignedConflict(new ApprovalAssignmentReassignedError()),
					);
				}
			} else {
				// The deputy right follows the request's current approver, so a
				// transfer away from the absent approver ends it by itself.
				// A refusal keeps its type; a database failure stays a DatabaseError.
				actingFor = yield* dbService
					.query("approvals.authorizeLegacyDeputyDecision", () =>
						authorizeLegacyDeputyDecision(dbService.db, {
							organizationId: currentEmployee.organizationId,
							approvalRequestId: approval.id,
							entityType,
							approverEmployeeId: approval.approverId,
							actorEmployeeId: currentEmployee.id,
							action,
							at: systemClock.nowInstant(),
						}),
					)
					.pipe(
						Effect.mapError((error) =>
							error._tag === "DatabaseError" && error.cause instanceof AuthorizationError
								? error.cause
								: error,
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

		yield* updatePendingApprovalRequest(dbService, approval, statusUpdate);

		const chainResult = yield* progressApprovalChainIfLinked(dbService, {
			approvalRequestId: approval.id,
			actorEmployeeId: currentEmployee.id,
			actorUserId: currentEmployee.user.id,
			action,
		});

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
			domainResult = yield* selectedUpdateEntity(dbService, entityId, currentEmployee, approval);
			didRunDomainUpdate = true;
		}

		if (actingFor) {
			const recordedFor = actingFor;
			yield* dbService.query("approvals.recordLegacyDeputyDecision", () =>
				recordDeputyDecision(dbService.db, {
					organizationId: currentEmployee.organizationId,
					deputyEmployeeId: currentEmployee.id,
					actingFor: recordedFor,
					authority: "legacy",
					entityType: entityType as DeputyDecisionEntityType,
					entityId,
					approvalRequestId: approval.id,
					decision: statusUpdate.status,
				}),
			);
		}

		yield* auditLogger.log({
			organizationId: currentEmployee.organizationId,
			approvalId: approval.id,
			approvalType: entityType,
			entityId,
			action,
			performedBy: currentEmployee.user.id,
			previousStatus: approval.status,
			newStatus: statusUpdate.status,
			reason: rejectionReason,
			...(actingFor ? { metadata: deputyDecisionAuditMetadata(actingFor) } : {}),
		});

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
			decision: { actingFor },
		} satisfies ApprovalExecutionResult<T>;
	});
}

export function processApprovalWithCurrentEmployee<T, R = never>(
	dbService: ApprovalDbService,
	currentEmployee: CurrentApprover,
	entityType: ApprovalEntityType,
	entityId: string,
	action: ApprovalAction,
	rejectionReason?: string,
	updateEntity?: ApprovalEntityUpdater<T, R>,
	preflightEntity?: ApprovalEntityPreflight<R>,
	options?: ApprovalActionOptions,
	postCommitHandlers?: ApprovalPostCommitHandlers<T, R>,
	transactionBehavior: "open" | "existing" = "open",
) {
	return Effect.gen(function* () {
		const auditLogger = yield* ApprovalAuditLogger;
		const callerContext = yield* Effect.context<R>();

		if (!options?.transactional || transactionBehavior === "existing") {
			const execution = yield* executeApprovalWithCurrentEmployee(
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
			).pipe(Effect.provideService(ApprovalAuditLogger, auditLogger));
			if (execution.didRunDomainUpdate && postCommitHandlers) {
				yield* runAfterCommitBestEffort(
					postCommitHandlers,
					execution.domainResult as T,
					dbService,
					entityType,
					entityId,
					currentEmployee,
					execution.decision,
				);
			}
			return execution.domainResult;
		}

		const execution = yield* Effect.tryPromise({
			try: async () => {
				let result: ApprovalExecutionResult<T> | undefined;
				await dbService.db.transaction(async (tx) => {
					// Keeps the caller's query instead of makeDatabaseService(tx): callers that pass
					// the Effect.promise shape rely on domain errors thrown inside a query reaching
					// them unwrapped (docs/refs/effect.md, Database Access).
					const transactionalDbService: ApprovalDbService = {
						db: tx,
						query: dbService.query,
					};
					const transactionalAuditLogger = createApprovalAuditLogger(
						transactionalDbService,
					);

					const exit = await Effect.runPromiseExit(
						// The transaction callback is a Promise boundary: the caller's services
						// carry over, the audit logger is bound to the transaction.
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
						),
					);

					if (Exit.isFailure(exit)) {
						throw failureOfCause(exit.cause);
					}

					result = exit.value;
				});
				if (!result) {
					throw new Error("Approval transaction did not execute");
				}
				return result;
			},
			catch: (error) => error as AnyAppError,
		});
		if (execution.didRunDomainUpdate && postCommitHandlers) {
			yield* runAfterCommitBestEffort(
				postCommitHandlers,
				execution.domainResult as T,
				dbService,
				entityType,
				entityId,
				currentEmployee,
				execution.decision,
			);
		}
		return execution.domainResult;
	});
}

export async function processApproval<T, R extends AppServices | ApprovalAuditLogger = never>(
	entityType: ApprovalEntityType,
	entityId: string,
	action: ApprovalAction,
	rejectionReason?: string,
	updateEntity?: ApprovalEntityUpdater<T, R>,
	preflightEntity?: ApprovalEntityPreflight<R>,
	options?: ApprovalActionOptions,
	postCommitHandlers?: ApprovalPostCommitHandlers<T, R>,
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
			return Effect.gen(function* () {
				const authService = yield* AuthService;
				const session = yield* authService.getSession();
				const dbService = yield* DatabaseService;

				const currentEmployee = yield* loadCurrentApprover(
					dbService,
					session.user.id,
					session.session.activeOrganizationId ?? undefined,
				);

				span.setAttribute("user.id", session.user.id);
				span.setAttribute("approver.id", currentEmployee.id);

				const result = yield* processApprovalWithCurrentEmployee(
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
				);

				span.setStatus({ code: SpanStatusCode.OK });
				return result;
			}).pipe(
				Effect.catch((error) =>
					Effect.gen(function* () {
						span.recordException(error as Error);
						span.setStatus({
							code: SpanStatusCode.ERROR,
							message: String(error),
						});

						logger.error(
							{ error, entityType, entityId, action },
							"Failed to process approval",
						);
						return yield* Effect.fail(error as AnyAppError);
					}),
				),
				Effect.onExit(() => Effect.sync(() => span.end())),
				Effect.provide(ApprovalAuditLoggerLive),
			);
		},
	);

	return runServerActionSafe(effect);
}
