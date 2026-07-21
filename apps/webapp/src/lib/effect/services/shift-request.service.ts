import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";
import type { db } from "@/db";
import {
	auditLog,
	employee,
	type shiftRequest as ShiftRequestTable,
	type shift as ShiftTable,
	shift,
	shiftRequest,
} from "@/db/schema";
import {
	AuthorizationError,
	ConflictError,
	type DatabaseError,
	NotFoundError,
	ValidationError,
} from "../errors";
import { DatabaseService } from "./database.service";

type Shift = typeof ShiftTable.$inferSelect;
type ShiftRequest = typeof ShiftRequestTable.$inferSelect;
type ShiftRequestTransaction = Parameters<
	Parameters<typeof db.transaction>[0]
>[0];
type ShiftRequestDomainError =
	| AuthorizationError
	| ConflictError
	| NotFoundError
	| ValidationError;

const MANAGER_ROLES = new Set(["manager", "admin"]);
const SAFE_EMPLOYEE_RELATION = {
	columns: {
		id: true,
		firstName: true,
		lastName: true,
	},
} as const;

class ShiftRequestTransactionAbort extends Error {
	constructor(readonly domainError: ShiftRequestDomainError) {
		super(domainError.message);
	}
}

function abort(error: ShiftRequestDomainError): never {
	throw new ShiftRequestTransactionAbort(error);
}

function recoverTransactionError(
	error: DatabaseError,
): Effect.Effect<never, ShiftRequestDomainError | DatabaseError> {
	const recovered: ShiftRequestDomainError | DatabaseError =
		error.cause instanceof ShiftRequestTransactionAbort
			? error.cause.domainError
			: error;
	return Effect.fail(recovered);
}

function notFound(entityType: string, entityId: string, message: string) {
	return new NotFoundError({ message, entityType, entityId });
}

function staleRequest(status?: string) {
	return new ConflictError({
		message: status
			? `Request has already been ${status}`
			: "Request status changed",
		conflictType: "invalid_status",
	});
}

function shiftLockKey(organizationId: string, shiftId: string) {
	return `shift-request:${organizationId}:${shiftId}`;
}

async function lockShiftRequestScope(
	tx: ShiftRequestTransaction,
	organizationId: string,
	shiftId: string,
) {
	await tx.execute(
		sql`select pg_advisory_xact_lock(hashtextextended(${shiftLockKey(organizationId, shiftId)}, 0))`,
	);
}

async function getActiveEmployee(
	tx: ShiftRequestTransaction,
	organizationId: string,
	employeeId: string,
) {
	return await tx.query.employee.findFirst({
		where: and(
			eq(employee.id, employeeId),
			eq(employee.organizationId, organizationId),
			eq(employee.isActive, true),
		),
	});
}

async function getScopedRequest(
	tx: ShiftRequestTransaction,
	organizationId: string,
	requestId: string,
) {
	const request = await tx.query.shiftRequest.findFirst({
		where: eq(shiftRequest.id, requestId),
		with: { shift: true },
	});

	return request?.shift.organizationId === organizationId ? request : undefined;
}

function requirePublishedShift(currentShift: Shift) {
	if (currentShift.status !== "published") {
		abort(
			new ValidationError({
				message: "Shift is no longer active",
				field: "status",
			}),
		);
	}
}

async function requireActiveRequestParticipants(
	tx: ShiftRequestTransaction,
	organizationId: string,
	request: ShiftRequest,
) {
	const requester = await getActiveEmployee(
		tx,
		organizationId,
		request.requesterId,
	);
	if (!requester) {
		abort(notFound("employee", request.requesterId, "Requester not found"));
	}

	if (request.targetEmployeeId) {
		const target = await getActiveEmployee(
			tx,
			organizationId,
			request.targetEmployeeId,
		);
		if (!target) {
			abort(
				notFound(
					"employee",
					request.targetEmployeeId,
					"Target employee not found",
				),
			);
		}
	}

	return requester;
}

async function requireApprover(
	tx: ShiftRequestTransaction,
	organizationId: string,
	approverId: string,
	action: "approve" | "reject",
) {
	const approver = await getActiveEmployee(tx, organizationId, approverId);
	if (!approver || !MANAGER_ROLES.has(approver.role)) {
		abort(
			new AuthorizationError({
				message: `Only managers or admins can ${action} shift requests`,
				userId: approverId,
				resource: "shiftRequest",
				action,
			}),
		);
	}
	return approver;
}

export interface SwapRequestInput {
	shiftId: string;
	requesterId: string;
	targetEmployeeId?: string;
	reason?: string;
	reasonCategory?: string;
	notes?: string;
}

export interface PickupRequestInput {
	shiftId: string;
	requesterId: string;
	notes?: string;
}

export interface ShiftRequestWithRelations extends ShiftRequest {
	shift: Shift & {
		employee?: {
			id: string;
			firstName: string | null;
			lastName: string | null;
		} | null;
	};
	requester: {
		id: string;
		firstName: string | null;
		lastName: string | null;
	};
	targetEmployee?: {
		id: string;
		firstName: string | null;
		lastName: string | null;
	} | null;
}

type MutationError = ShiftRequestDomainError | DatabaseError;

export class ShiftRequestService extends Context.Tag("ShiftRequestService")<
	ShiftRequestService,
	{
		readonly requestSwap: (
			organizationId: string,
			input: SwapRequestInput,
		) => Effect.Effect<ShiftRequest, MutationError>;
		readonly requestPickup: (
			organizationId: string,
			input: PickupRequestInput,
		) => Effect.Effect<ShiftRequest, MutationError>;
		readonly approveRequest: (
			organizationId: string,
			requestId: string,
			approverId: string,
		) => Effect.Effect<ShiftRequest, MutationError>;
		readonly rejectRequest: (
			organizationId: string,
			requestId: string,
			approverId: string,
			reason?: string,
		) => Effect.Effect<ShiftRequest, MutationError>;
		readonly cancelRequest: (
			organizationId: string,
			requestId: string,
			requesterId: string,
		) => Effect.Effect<void, MutationError>;
		readonly getPendingRequests: (
			organizationId: string,
			approverId: string,
		) => Effect.Effect<
			ShiftRequestWithRelations[],
			AuthorizationError | DatabaseError
		>;
		readonly getRequestsByShift: (
			organizationId: string,
			shiftId: string,
		) => Effect.Effect<
			ShiftRequestWithRelations[],
			NotFoundError | DatabaseError
		>;
		readonly getRequestById: (
			organizationId: string,
			requestId: string,
		) => Effect.Effect<ShiftRequestWithRelations | null, DatabaseError>;
	}
>() {}

export const ShiftRequestServiceLive = Layer.effect(
	ShiftRequestService,
	Effect.gen(function* () {
		const dbService = yield* DatabaseService;

		const runTransaction = <A>(
			name: string,
			operation: (tx: ShiftRequestTransaction) => Promise<A>,
		) =>
			dbService
				.query(name, () => dbService.db.transaction(operation))
				.pipe(Effect.catchTag("DatabaseError", recoverTransactionError));

		const createRequest = (
			organizationId: string,
			input: SwapRequestInput | PickupRequestInput,
			type: "swap" | "pickup",
		) =>
			runTransaction(
				`create${type === "swap" ? "Swap" : "Pickup"}Request`,
				async (tx) => {
					await lockShiftRequestScope(tx, organizationId, input.shiftId);
					const currentShift = await tx.query.shift.findFirst({
						where: and(
							eq(shift.id, input.shiftId),
							eq(shift.organizationId, organizationId),
						),
					});
					if (!currentShift)
						abort(notFound("shift", input.shiftId, "Shift not found"));
					requirePublishedShift(currentShift);

					const requester = await getActiveEmployee(
						tx,
						organizationId,
						input.requesterId,
					);
					if (!requester) {
						abort(
							notFound("employee", input.requesterId, "Requester not found"),
						);
					}

					if (type === "swap") {
						if (currentShift.employeeId !== input.requesterId) {
							abort(
								new AuthorizationError({
									message: "You can only request swaps for your own shifts",
									userId: input.requesterId,
									resource: "shift",
									action: "swap",
								}),
							);
						}
						const swapInput = input as SwapRequestInput;
						if (swapInput.targetEmployeeId) {
							const target = await getActiveEmployee(
								tx,
								organizationId,
								swapInput.targetEmployeeId,
							);
							if (!target) {
								abort(
									notFound(
										"employee",
										swapInput.targetEmployeeId,
										"Target employee not found",
									),
								);
							}
							if (requester.teamId && target.teamId !== requester.teamId) {
								abort(
									new ValidationError({
										message: "Target employee must be in the same team",
										field: "targetEmployeeId",
									}),
								);
							}
						}
					} else if (currentShift.employeeId !== null) {
						abort(
							new ValidationError({
								message:
									"This shift is already assigned. Use swap request instead.",
								field: "employeeId",
							}),
						);
					}

					const duplicate = await tx.query.shiftRequest.findFirst({
						where: and(
							eq(shiftRequest.shiftId, input.shiftId),
							eq(shiftRequest.requesterId, input.requesterId),
							eq(shiftRequest.type, type),
							eq(shiftRequest.status, "pending"),
						),
					});
					if (duplicate) {
						abort(
							new ConflictError({
								message: "You already have a pending request for this shift",
								conflictType: "duplicate_request",
							}),
						);
					}

					const swapInput =
						type === "swap" ? (input as SwapRequestInput) : undefined;
					const [created] = await tx
						.insert(shiftRequest)
						.values({
							shiftId: input.shiftId,
							type,
							requesterId: input.requesterId,
							targetEmployeeId: swapInput?.targetEmployeeId,
							reason: swapInput?.reason,
							reasonCategory: swapInput?.reasonCategory,
							notes: input.notes,
							status: "pending",
							updatedAt: new Date(),
						})
						.returning();
					return created;
				},
			);

		return ShiftRequestService.of({
			requestSwap: (organizationId, input) =>
				createRequest(organizationId, input, "swap"),
			requestPickup: (organizationId, input) =>
				createRequest(organizationId, input, "pickup"),

			approveRequest: (organizationId, requestId, approverId) =>
				runTransaction("approveShiftRequest", async (tx) => {
					const initial = await getScopedRequest(tx, organizationId, requestId);
					if (!initial) {
						abort(
							notFound("shiftRequest", requestId, "Shift request not found"),
						);
					}
					await lockShiftRequestScope(tx, organizationId, initial.shiftId);

					const current = await getScopedRequest(tx, organizationId, requestId);
					if (!current) {
						abort(
							notFound("shiftRequest", requestId, "Shift request not found"),
						);
					}
					requirePublishedShift(current.shift);
					if (current.status !== "pending") abort(staleRequest(current.status));
					await requireApprover(tx, organizationId, approverId, "approve");
					await requireActiveRequestParticipants(tx, organizationId, current);

					if (current.type === "swap" && !current.targetEmployeeId) {
						abort(
							new ConflictError({
								message:
									"A target employee is required before approving a swap",
								conflictType: "missing_target_employee",
							}),
						);
					}

					const assignedEmployeeId =
						current.type === "pickup"
							? current.requesterId
							: current.targetEmployeeId;
					if (!assignedEmployeeId) {
						abort(
							new ConflictError({
								message:
									"A target employee is required before approving this request",
								conflictType: "missing_target_employee",
							}),
						);
					}

					const expectedAssignment =
						current.type === "pickup"
							? isNull(shift.employeeId)
							: current.type === "swap"
								? eq(shift.employeeId, current.requesterId)
								: current.shift.employeeId === null
									? isNull(shift.employeeId)
									: eq(shift.employeeId, current.shift.employeeId);
					const [updatedShift] = await tx
						.update(shift)
						.set({ employeeId: assignedEmployeeId })
						.where(
							and(
								eq(shift.id, current.shiftId),
								eq(shift.organizationId, organizationId),
								eq(shift.status, "published"),
								expectedAssignment,
							),
						)
						.returning({ id: shift.id });
					if (!updatedShift) abort(staleRequest());

					// shiftId is locked and was verified against organizationId above; shift_request gets
					// its direct organization column in Phase 1.
					const [approved] = await tx
						.update(shiftRequest)
						.set({ status: "approved", approverId, approvedAt: new Date() })
						.where(
							and(
								eq(shiftRequest.id, requestId),
								eq(shiftRequest.shiftId, current.shiftId),
								eq(shiftRequest.status, "pending"),
							),
						)
						.returning();
					if (!approved) abort(staleRequest());

					if (current.type === "pickup") {
						await tx
							.update(shiftRequest)
							.set({
								status: "rejected",
								rejectionReason: "Another pickup request was approved",
							})
							.where(
								and(
									eq(shiftRequest.shiftId, current.shiftId),
									eq(shiftRequest.type, "pickup"),
									eq(shiftRequest.status, "pending"),
								),
							);
					}

					return approved;
				}),

			rejectRequest: (organizationId, requestId, approverId, reason) =>
				runTransaction("rejectShiftRequest", async (tx) => {
					const initial = await getScopedRequest(tx, organizationId, requestId);
					if (!initial) {
						abort(
							notFound("shiftRequest", requestId, "Shift request not found"),
						);
					}
					await lockShiftRequestScope(tx, organizationId, initial.shiftId);
					const current = await getScopedRequest(tx, organizationId, requestId);
					if (!current) {
						abort(
							notFound("shiftRequest", requestId, "Shift request not found"),
						);
					}
					if (current.status !== "pending") abort(staleRequest(current.status));
					await requireApprover(tx, organizationId, approverId, "reject");

					const [rejected] = await tx
						.update(shiftRequest)
						.set({ status: "rejected", approverId, rejectionReason: reason })
						.where(
							and(
								eq(shiftRequest.id, requestId),
								eq(shiftRequest.shiftId, current.shiftId),
								eq(shiftRequest.status, "pending"),
							),
						)
						.returning();
					if (!rejected) abort(staleRequest());
					return rejected;
				}),

			cancelRequest: (organizationId, requestId, requesterId) =>
				runTransaction("cancelShiftRequest", async (tx) => {
					const initial = await getScopedRequest(tx, organizationId, requestId);
					if (!initial) {
						abort(
							notFound("shiftRequest", requestId, "Shift request not found"),
						);
					}
					await lockShiftRequestScope(tx, organizationId, initial.shiftId);
					const current = await getScopedRequest(tx, organizationId, requestId);
					if (!current) {
						abort(
							notFound("shiftRequest", requestId, "Shift request not found"),
						);
					}
					if (current.status !== "pending") abort(staleRequest(current.status));

					const requester = await getActiveEmployee(
						tx,
						organizationId,
						requesterId,
					);
					if (!requester || requester.id !== current.requesterId) {
						abort(
							new AuthorizationError({
								message: "You can only cancel your own requests",
								userId: requesterId,
								resource: "shiftRequest",
								action: "cancel",
							}),
						);
					}

					// Temporary Phase 0 representation: approval_status has no cancelled value. Persist
					// the org-scoped cancellation event in audit_log before deleting the pending source.
					await tx.insert(auditLog).values({
						organizationId,
						entityType: "shift_request",
						entityId: requestId,
						action: "cancel",
						performedBy: requester.userId,
						employeeId: requester.id,
						changes: JSON.stringify({
							status: { from: "pending", to: "cancelled" },
						}),
						metadata: JSON.stringify({
							shiftId: current.shiftId,
							requestType: current.type,
						}),
					});

					const [deleted] = await tx
						.delete(shiftRequest)
						.where(
							and(
								eq(shiftRequest.id, requestId),
								eq(shiftRequest.shiftId, current.shiftId),
								eq(shiftRequest.requesterId, requester.id),
								eq(shiftRequest.status, "pending"),
							),
						)
						.returning({ id: shiftRequest.id });
					if (!deleted) abort(staleRequest());
				}),

			getPendingRequests: (organizationId, approverId) =>
				Effect.gen(function* () {
					const approver = yield* dbService.query(
						"getPendingRequestApprover",
						async () =>
							dbService.db.query.employee.findFirst({
								where: and(
									eq(employee.id, approverId),
									eq(employee.organizationId, organizationId),
									eq(employee.isActive, true),
								),
							}),
					);
					if (!approver || !MANAGER_ROLES.has(approver.role)) {
						return yield* Effect.fail(
							new AuthorizationError({
								message: "Only managers or admins can view pending requests",
								userId: approverId,
								resource: "shiftRequest",
								action: "read",
							}),
						);
					}
					return (yield* dbService.query("getPendingRequests", async () =>
						dbService.db.query.shiftRequest.findMany({
							where: and(
								eq(shiftRequest.status, "pending"),
								inArray(
									shiftRequest.shiftId,
									dbService.db
										.select({ id: shift.id })
										.from(shift)
										.where(eq(shift.organizationId, organizationId)),
								),
							),
							with: {
								shift: { with: { employee: SAFE_EMPLOYEE_RELATION } },
								requester: SAFE_EMPLOYEE_RELATION,
								targetEmployee: SAFE_EMPLOYEE_RELATION,
							},
							orderBy: (request, { desc }) => [desc(request.createdAt)],
						}),
					)) as ShiftRequestWithRelations[];
				}),

			getRequestsByShift: (organizationId, shiftId) =>
				Effect.gen(function* () {
					const scopedShift = yield* dbService.query(
						"getShiftForRequests",
						async () =>
							dbService.db.query.shift.findFirst({
								where: and(
									eq(shift.id, shiftId),
									eq(shift.organizationId, organizationId),
								),
							}),
					);
					if (!scopedShift) {
						return yield* Effect.fail(
							notFound("shift", shiftId, "Shift not found"),
						);
					}
					return (yield* dbService.query("getRequestsByShift", async () =>
						dbService.db.query.shiftRequest.findMany({
							where: eq(shiftRequest.shiftId, scopedShift.id),
							with: {
								shift: { with: { employee: SAFE_EMPLOYEE_RELATION } },
								requester: SAFE_EMPLOYEE_RELATION,
								targetEmployee: SAFE_EMPLOYEE_RELATION,
							},
							orderBy: (request, { desc }) => [desc(request.createdAt)],
						}),
					)) as ShiftRequestWithRelations[];
				}),

			getRequestById: (organizationId, requestId) =>
				dbService
					.query("getRequestById", async () =>
						dbService.db.query.shiftRequest.findFirst({
							where: eq(shiftRequest.id, requestId),
							with: {
								shift: { with: { employee: SAFE_EMPLOYEE_RELATION } },
								requester: SAFE_EMPLOYEE_RELATION,
								targetEmployee: SAFE_EMPLOYEE_RELATION,
							},
						}),
					)
					.pipe(
						Effect.map((request) =>
							request?.shift.organizationId === organizationId
								? (request as ShiftRequestWithRelations)
								: null,
						),
					),
		});
	}),
);
