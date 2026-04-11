import { SpanStatusCode, trace } from "@opentelemetry/api";
import { and, eq } from "drizzle-orm";
import { Cause, Effect, Exit, Option } from "effect";
import { approvalRequest, employee } from "@/db/schema";
import { currentTimestamp } from "@/lib/datetime/drizzle-adapter";
import { type AnyAppError, AuthorizationError, ConflictError, NotFoundError } from "@/lib/effect/errors";
import { runServerActionSafe, type ServerActionResult } from "@/lib/effect/result";
import { AppLayer } from "@/lib/effect/runtime";
import { AuthService } from "@/lib/effect/services/auth.service";
import { DatabaseService } from "@/lib/effect/services/database.service";
import { createLogger } from "@/lib/logger";
import {
	ApprovalAuditLogger,
	ApprovalAuditLoggerLive,
	createApprovalAuditLogger,
} from "../infrastructure/audit-logger";
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
		approvedAt: currentTimestamp(),
		rejectionReason: action === "reject" ? rejectionReason : undefined,
		updatedAt: currentTimestamp(),
	};
}

function loadCurrentApprover(
	dbService: ApprovalDbService,
	userId: string,
	activeOrganizationId?: string,
): Effect.Effect<CurrentApprover, AnyAppError, never> {
	return dbService.query("getEmployeeByUserId", async () => {
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
	}).pipe(
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
	action: ApprovalAction,
): Effect.Effect<PendingApprovalRequest, AnyAppError, never> {
	return dbService.query("getApprovalRequest", async () => {
		return await dbService.db.query.approvalRequest.findFirst({
			where: and(
				eq(approvalRequest.entityType, entityType),
				eq(approvalRequest.entityId, entityId),
				eq(approvalRequest.approverId, approverId),
				eq(approvalRequest.status, "pending"),
			),
		});
	}).pipe(
		Effect.flatMap((request) =>
			request
				? Effect.succeed(request as PendingApprovalRequest)
				: Effect.fail(
						new AuthorizationError({
							message:
								"Approval request not found, already processed, or you are not the approver",
							userId: approverId,
							resource: entityType,
							action,
						}),
					),
		),
	);
}

function updatePendingApprovalRequest(
	dbService: ApprovalDbService,
	approvalId: string,
	statusUpdate: ApprovalStatusUpdate,
) {
	return dbService.query("updateApprovalStatus", async () => {
		const updateQuery = dbService.db
			.update(approvalRequest)
			.set(statusUpdate)
			.where(and(eq(approvalRequest.id, approvalId), eq(approvalRequest.status, "pending")));

		const updatedRows =
			updateQuery && typeof updateQuery === "object" && "returning" in updateQuery
				? await updateQuery.returning({ id: approvalRequest.id })
				: await updateQuery;

		return updatedRows;
	}).pipe(
		Effect.flatMap((updatedRows) =>
			Array.isArray(updatedRows) && updatedRows.length === 0
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

function executeApprovalWithCurrentEmployee<T>(
	dbService: ApprovalDbService,
	currentEmployee: CurrentApprover,
	entityType: ApprovalEntityType,
	entityId: string,
	action: ApprovalAction,
	rejectionReason?: string,
	updateEntity?: (
		dbService: ApprovalDbService,
		entityId: string,
		currentEmployee: CurrentApprover,
	) => Effect.Effect<T, AnyAppError, unknown>,
	preflightEntity?: (
		dbService: ApprovalDbService,
		entityId: string,
		currentEmployee: CurrentApprover,
	) => Effect.Effect<unknown, AnyAppError, unknown>,
) {
	const statusUpdate = getApprovalStatusUpdate(action, rejectionReason);

	return Effect.gen(function* (_) {
		const auditLogger = yield* _(ApprovalAuditLogger);

		if (preflightEntity) {
			yield* _(preflightEntity(dbService, entityId, currentEmployee));
		}

		const approval = yield* _(
			loadPendingApprovalRequest(
				dbService,
				entityType,
				entityId,
				currentEmployee.id,
				action,
			),
		);

		logger.info(
			{
				approverId: currentEmployee.id,
				entityType,
				entityId,
				action,
			},
			"Processing approval action",
		);

		yield* _(updatePendingApprovalRequest(dbService, approval.id, statusUpdate));

		if (updateEntity) {
			yield* _(updateEntity(dbService, entityId, currentEmployee));
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
	});
}

export function processApprovalWithCurrentEmployee<T>(
	dbService: ApprovalDbService,
	currentEmployee: CurrentApprover,
	entityType: ApprovalEntityType,
	entityId: string,
	action: ApprovalAction,
	rejectionReason?: string,
	updateEntity?: (
		dbService: ApprovalDbService,
		entityId: string,
		currentEmployee: CurrentApprover,
	) => Effect.Effect<T, AnyAppError, unknown>,
	preflightEntity?: (
		dbService: ApprovalDbService,
		entityId: string,
		currentEmployee: CurrentApprover,
	) => Effect.Effect<unknown, AnyAppError, unknown>,
	options?: { transactional?: boolean },
) {
	return Effect.gen(function* (_) {
		const auditLogger = yield* _(ApprovalAuditLogger);

		if (!options?.transactional) {
			return yield* _(
				executeApprovalWithCurrentEmployee(
					dbService,
					currentEmployee,
					entityType,
					entityId,
					action,
					rejectionReason,
					updateEntity,
					preflightEntity,
				).pipe(Effect.provideService(ApprovalAuditLogger, auditLogger)),
			);
		}

		return yield* _(
			Effect.tryPromise({
				try: async () => {
					await dbService.db.transaction(async (tx) => {
						const transactionalDbService: ApprovalDbService = {
							db: tx as ApprovalDbService["db"],
							query: dbService.query,
						};
						const transactionalAuditLogger = createApprovalAuditLogger(transactionalDbService);

						const exit = await Effect.runPromiseExit(
							executeApprovalWithCurrentEmployee(
								transactionalDbService,
								currentEmployee,
								entityType,
								entityId,
								action,
								rejectionReason,
								updateEntity,
								preflightEntity,
							).pipe(
								Effect.provideService(ApprovalAuditLogger, transactionalAuditLogger),
							),
						);

						if (Exit.isFailure(exit)) {
							const failure = Option.getOrNull(Cause.failureOption(exit.cause));
							const defects = [...Cause.defects(exit.cause)];
							throw (failure ?? defects[0] ?? new Error("An error has occurred"));
						}
					});
				},
				catch: (error) => error as AnyAppError,
			}),
		);
	});
}

export async function processApproval<T>(
	entityType: ApprovalEntityType,
	entityId: string,
	action: ApprovalAction,
	rejectionReason?: string,
	updateEntity?: (
		dbService: ApprovalDbService,
		entityId: string,
		currentEmployee: CurrentApprover,
	) => Effect.Effect<T, AnyAppError, unknown>,
	preflightEntity?: (
		dbService: ApprovalDbService,
		entityId: string,
		currentEmployee: CurrentApprover,
	) => Effect.Effect<unknown, AnyAppError, unknown>,
	options?: { transactional?: boolean },
): Promise<ServerActionResult<void>> {
	const tracer = trace.getTracer("approvals");
	const statusUpdate = getApprovalStatusUpdate(action, rejectionReason);

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

				yield* _(
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
					),
				);

				span.setStatus({ code: SpanStatusCode.OK });
			}).pipe(
				Effect.catchAll((error) =>
					Effect.gen(function* (_) {
						span.recordException(error as Error);
						span.setStatus({
							code: SpanStatusCode.ERROR,
							message: String(error),
						});

						logger.error({ error, entityType, entityId, action }, "Failed to process approval");
						return yield* _(Effect.fail(error as AnyAppError));
					}),
				),
				Effect.onExit(() => Effect.sync(() => span.end())),
				Effect.provide(ApprovalAuditLoggerLive),
				Effect.provide(AppLayer),
			);
		},
	);

	return runServerActionSafe(effect as Effect.Effect<void, AnyAppError, never>);
}
