import { SpanStatusCode, trace } from "@opentelemetry/api";
import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import { approvalRequest, employee } from "@/db/schema";
import { currentTimestamp } from "@/lib/datetime/drizzle-adapter";
import { type AnyAppError, AuthorizationError, NotFoundError } from "@/lib/effect/errors";
import { runServerActionSafe, type ServerActionResult } from "@/lib/effect/result";
import { AppLayer } from "@/lib/effect/runtime";
import { AuthService } from "@/lib/effect/services/auth.service";
import { DatabaseService } from "@/lib/effect/services/database.service";
import { createLogger } from "@/lib/logger";
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
		approvedAt: action === "approve" ? currentTimestamp() : undefined,
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
		return await dbService.db
			.update(approvalRequest)
			.set(statusUpdate)
			.where(eq(approvalRequest.id, approvalId));
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
					loadCurrentApprover(dbService, session.user.id, session.session.activeOrganizationId),
				);

				span.setAttribute("user.id", session.user.id);
				span.setAttribute("approver.id", currentEmployee.id);

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

				logger.info(
					{
						approvalId: approval.id,
						entityType,
						entityId,
						action,
					},
					`Successfully ${action === "approve" ? "approved" : "rejected"} ${entityType}`,
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
				Effect.provide(AppLayer),
			);
		},
	);

	return runServerActionSafe(effect as Effect.Effect<void, AnyAppError, never>);
}
