import { and, eq } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";
import {
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

// Type definitions
type Shift = typeof ShiftTable.$inferSelect;
type ShiftRequest = typeof ShiftRequestTable.$inferSelect;
type ShiftRequestType = "swap" | "assignment" | "pickup";
type ApprovalStatus = "pending" | "approved" | "rejected";

export interface SwapRequestInput {
	shiftId: string;
	requesterId: string;
	targetEmployeeId?: string; // Optional - if null, swap with anyone
	reason?: string;
	reasonCategory?: string; // "sick", "emergency", "childcare", "other"
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

export class ShiftRequestService extends Context.Tag("ShiftRequestService")<
	ShiftRequestService,
	{
		readonly requestSwap: (
			input: SwapRequestInput,
		) => Effect.Effect<
			ShiftRequest,
			ValidationError | NotFoundError | ConflictError | AuthorizationError | DatabaseError
		>;

		readonly requestPickup: (
			input: PickupRequestInput,
		) => Effect.Effect<
			ShiftRequest,
			ValidationError | NotFoundError | ConflictError | AuthorizationError | DatabaseError
		>;

		readonly approveRequest: (
			requestId: string,
			approverId: string,
		) => Effect.Effect<
			ShiftRequest,
			NotFoundError | AuthorizationError | ConflictError | DatabaseError
		>;

		readonly rejectRequest: (
			requestId: string,
			approverId: string,
			reason?: string,
		) => Effect.Effect<ShiftRequest, NotFoundError | AuthorizationError | DatabaseError>;

		readonly cancelRequest: (
			requestId: string,
			userId: string,
		) => Effect.Effect<void, NotFoundError | AuthorizationError | DatabaseError>;

		readonly getPendingRequests: (
			approverId: string,
		) => Effect.Effect<ShiftRequestWithRelations[], DatabaseError>;

		readonly getRequestsByShift: (
			shiftId: string,
		) => Effect.Effect<ShiftRequestWithRelations[], DatabaseError>;

		readonly getRequestById: (
			requestId: string,
		) => Effect.Effect<ShiftRequestWithRelations | null, DatabaseError>;
	}
>() {}

export const ShiftRequestServiceLive = Layer.effect(
	ShiftRequestService,
	Effect.gen(function* (_) {
		const dbService = yield* _(DatabaseService);

		return ShiftRequestService.of({
			requestSwap: (input) =>
				Effect.gen(function* (_) {
					// Verify shift exists and is published
					const shiftRecord = yield* _(
						dbService.query("getShiftForSwap", async () => {
							return await dbService.db.query.shift.findFirst({
								where: eq(shift.id, input.shiftId),
								with: {
									employee: true,
								},
							});
						}),
					);

					if (!shiftRecord) {
						return yield* _(
							Effect.fail(
								new NotFoundError({
									message: "Shift not found",
									entityType: "shift",
									entityId: input.shiftId,
								}),
							),
						);
					}

					// Verify shift is published
					if (shiftRecord.status !== "published") {
						return yield* _(
							Effect.fail(
								new ValidationError({
									message: "Can only request swaps for published shifts",
									field: "status",
								}),
							),
						);
					}

					// Verify requester owns the shift
					if (shiftRecord.employeeId !== input.requesterId) {
						return yield* _(
							Effect.fail(
								new AuthorizationError({
									message: "You can only request swaps for your own shifts",
									userId: input.requesterId,
									resource: "shift",
									action: "swap",
								}),
							),
						);
					}

					// Verify requester exists
					const requester = yield* _(
						dbService.query("getRequester", async () => {
							return await dbService.db.query.employee.findFirst({
								where: eq(employee.id, input.requesterId),
							});
						}),
					);

					if (!requester) {
						return yield* _(
							Effect.fail(
								new NotFoundError({
									message: "Requester not found",
									entityType: "employee",
									entityId: input.requesterId,
								}),
							),
						);
					}

					// If target employee specified, verify they exist and are in the same team
					if (input.targetEmployeeId) {
						const targetEmployeeId = input.targetEmployeeId;
						const targetEmployee = yield* _(
							dbService.query("getTargetEmployee", async () => {
								return await dbService.db.query.employee.findFirst({
									where: eq(employee.id, targetEmployeeId),
								});
							}),
						);

						if (!targetEmployee) {
							return yield* _(
								Effect.fail(
									new NotFoundError({
										message: "Target employee not found",
										entityType: "employee",
										entityId: input.targetEmployeeId,
									}),
								),
							);
						}

						// Check same team
						if (requester.teamId && targetEmployee?.teamId !== requester.teamId) {
							return yield* _(
								Effect.fail(
									new ValidationError({
										message: "Target employee must be in the same team",
										field: "targetEmployeeId",
									}),
								),
							);
						}
					}

					// Check for existing pending request
					const existingRequest = yield* _(
						dbService.query("checkExistingRequest", async () => {
							return await dbService.db.query.shiftRequest.findFirst({
								where: and(
									eq(shiftRequest.shiftId, input.shiftId),
									eq(shiftRequest.requesterId, input.requesterId),
									eq(shiftRequest.status, "pending"),
								),
							});
						}),
					);

					if (existingRequest) {
						return yield* _(
							Effect.fail(
								new ConflictError({
									message: "You already have a pending request for this shift",
									conflictType: "duplicate_request",
								}),
							),
						);
					}

					// Create the swap request
					const request = yield* _(
						dbService.query("createSwapRequest", async () => {
							const [req] = await dbService.db
								.insert(shiftRequest)
								.values({
									shiftId: input.shiftId,
									type: "swap" as ShiftRequestType,
									requesterId: input.requesterId,
									targetEmployeeId: input.targetEmployeeId,
									reason: input.reason,
									reasonCategory: input.reasonCategory,
									notes: input.notes,
									status: "pending" as ApprovalStatus,
									updatedAt: new Date(),
								})
								.returning();
							return req;
						}),
					);

					return request;
				}),

			requestPickup: (input) =>
				Effect.gen(function* (_) {
					// Verify shift exists and is an open shift
					const shiftRecord = yield* _(
						dbService.query("getShiftForPickup", async () => {
							return await dbService.db.query.shift.findFirst({
								where: eq(shift.id, input.shiftId),
							});
						}),
					);

					if (!shiftRecord) {
						return yield* _(
							Effect.fail(
								new NotFoundError({
									message: "Shift not found",
									entityType: "shift",
									entityId: input.shiftId,
								}),
							),
						);
					}

					// Verify it's an open shift
					if (shiftRecord.employeeId !== null) {
						return yield* _(
							Effect.fail(
								new ValidationError({
									message: "This shift is already assigned. Use swap request instead.",
									field: "employeeId",
								}),
							),
						);
					}

					// Verify shift is published
					if (shiftRecord.status !== "published") {
						return yield* _(
							Effect.fail(
								new ValidationError({
									message: "Can only pick up published shifts",
									field: "status",
								}),
							),
						);
					}

					// Verify requester exists
					const requester = yield* _(
						dbService.query("getRequester", async () => {
							return await dbService.db.query.employee.findFirst({
								where: eq(employee.id, input.requesterId),
							});
						}),
					);

					if (!requester) {
						return yield* _(
							Effect.fail(
								new NotFoundError({
									message: "Requester not found",
									entityType: "employee",
									entityId: input.requesterId,
								}),
							),
						);
					}

					// Check for existing pending pickup request
					const existingRequest = yield* _(
						dbService.query("checkExistingPickupRequest", async () => {
							return await dbService.db.query.shiftRequest.findFirst({
								where: and(
									eq(shiftRequest.shiftId, input.shiftId),
									eq(shiftRequest.requesterId, input.requesterId),
									eq(shiftRequest.type, "pickup"),
									eq(shiftRequest.status, "pending"),
								),
							});
						}),
					);

					if (existingRequest) {
						return yield* _(
							Effect.fail(
								new ConflictError({
									message: "You already have a pending pickup request for this shift",
									conflictType: "duplicate_request",
								}),
							),
						);
					}

					// Create the pickup request
					const request = yield* _(
						dbService.query("createPickupRequest", async () => {
							const [req] = await dbService.db
								.insert(shiftRequest)
								.values({
									shiftId: input.shiftId,
									type: "pickup" as ShiftRequestType,
									requesterId: input.requesterId,
									notes: input.notes,
									status: "pending" as ApprovalStatus,
									updatedAt: new Date(),
								})
								.returning();
							return req;
						}),
					);

					return request;
				}),

			approveRequest: (requestId, approverId) =>
				Effect.gen(function* (_) {
					// Get the request with related data
					const request = yield* _(
						dbService.query("getRequestForApproval", async () => {
							return await dbService.db.query.shiftRequest.findFirst({
								where: eq(shiftRequest.id, requestId),
								with: {
									shift: true,
								},
							});
						}),
					);

					if (!request) {
						return yield* _(
							Effect.fail(
								new NotFoundError({
									message: "Shift request not found",
									entityType: "shiftRequest",
									entityId: requestId,
								}),
							),
						);
					}

					// Verify request is pending
					if (request.status !== "pending") {
						return yield* _(
							Effect.fail(
								new ConflictError({
									message: `Request has already been ${request.status}`,
									conflictType: "invalid_status",
								}),
							),
						);
					}

					// Verify approver has permission (must be manager/admin)
					const approver = yield* _(
						dbService.query("getApprover", async () => {
							return await dbService.db.query.employee.findFirst({
								where: eq(employee.id, approverId),
							});
						}),
					);

					if (!approver || (approver.role !== "manager" && approver.role !== "admin")) {
						return yield* _(
							Effect.fail(
								new AuthorizationError({
									message: "Only managers or admins can approve shift requests",
									userId: approverId,
									resource: "shiftRequest",
									action: "approve",
								}),
							),
						);
					}

					// Handle based on request type
					if (request.type === "swap") {
						// For swaps, we need to update the shift's employee
						if (request.targetEmployeeId) {
							// Swap with specific employee
							yield* _(
								dbService.query("performSwap", async () => {
									await dbService.db
										.update(shift)
										.set({
											employeeId: request.targetEmployeeId,
										})
										.where(eq(shift.id, request.shiftId));
								}),
							);
						}
						// If no target, the shift becomes open or manager assigns manually
					} else if (request.type === "pickup") {
						// Assign the shift to the requester
						yield* _(
							dbService.query("assignShiftToRequester", async () => {
								await dbService.db
									.update(shift)
									.set({
										employeeId: request.requesterId,
									})
									.where(eq(shift.id, request.shiftId));
							}),
						);
					}

					// Update the request status
					const updatedRequest = yield* _(
						dbService.query("approveRequest", async () => {
							const [req] = await dbService.db
								.update(shiftRequest)
								.set({
									status: "approved" as ApprovalStatus,
									approverId,
									approvedAt: new Date(),
								})
								.where(eq(shiftRequest.id, requestId))
								.returning();
							return req;
						}),
					);

					// Reject other pending requests for the same shift (if pickup)
					if (request.type === "pickup") {
						yield* _(
							dbService.query("rejectOtherPickupRequests", async () => {
								await dbService.db
									.update(shiftRequest)
									.set({
										status: "rejected" as ApprovalStatus,
										rejectionReason: "Another pickup request was approved",
									})
									.where(
										and(
											eq(shiftRequest.shiftId, request.shiftId),
											eq(shiftRequest.type, "pickup"),
											eq(shiftRequest.status, "pending"),
										),
									);
							}),
						);
					}

					return updatedRequest;
				}),

			rejectRequest: (requestId, approverId, reason) =>
				Effect.gen(function* (_) {
					// Get the request
					const request = yield* _(
						dbService.query("getRequestForRejection", async () => {
							return await dbService.db.query.shiftRequest.findFirst({
								where: eq(shiftRequest.id, requestId),
							});
						}),
					);

					if (!request) {
						return yield* _(
							Effect.fail(
								new NotFoundError({
									message: "Shift request not found",
									entityType: "shiftRequest",
									entityId: requestId,
								}),
							),
						);
					}

					// Verify request is pending
					if (request.status !== "pending") {
						return yield* _(
							Effect.fail(
								new AuthorizationError({
									message: `Request has already been ${request.status}`,
									userId: approverId,
									resource: "shiftRequest",
									action: "reject",
								}),
							),
						);
					}

					// Verify approver has permission
					const approver = yield* _(
						dbService.query("getApprover", async () => {
							return await dbService.db.query.employee.findFirst({
								where: eq(employee.id, approverId),
							});
						}),
					);

					if (!approver || (approver.role !== "manager" && approver.role !== "admin")) {
						return yield* _(
							Effect.fail(
								new AuthorizationError({
									message: "Only managers or admins can reject shift requests",
									userId: approverId,
									resource: "shiftRequest",
									action: "reject",
								}),
							),
						);
					}

					// Update the request status
					const updatedRequest = yield* _(
						dbService.query("rejectRequest", async () => {
							const [req] = await dbService.db
								.update(shiftRequest)
								.set({
									status: "rejected" as ApprovalStatus,
									approverId,
									rejectionReason: reason,
								})
								.where(eq(shiftRequest.id, requestId))
								.returning();
							return req;
						}),
					);

					return updatedRequest;
				}),

			cancelRequest: (requestId, userId) =>
				Effect.gen(function* (_) {
					// Get the request
					const request = yield* _(
						dbService.query("getRequestForCancellation", async () => {
							return await dbService.db.query.shiftRequest.findFirst({
								where: eq(shiftRequest.id, requestId),
							});
						}),
					);

					if (!request) {
						return yield* _(
							Effect.fail(
								new NotFoundError({
									message: "Shift request not found",
									entityType: "shiftRequest",
									entityId: requestId,
								}),
							),
						);
					}

					// Verify request is pending
					if (request.status !== "pending") {
						return yield* _(
							Effect.fail(
								new AuthorizationError({
									message: `Cannot cancel a request that has been ${request.status}`,
									userId,
									resource: "shiftRequest",
									action: "cancel",
								}),
							),
						);
					}

					// Verify the user is the requester
					const requesterEmployee = yield* _(
						dbService.query("getRequesterEmployee", async () => {
							return await dbService.db.query.employee.findFirst({
								where: eq(employee.userId, userId),
							});
						}),
					);

					if (!requesterEmployee || requesterEmployee.id !== request.requesterId) {
						return yield* _(
							Effect.fail(
								new AuthorizationError({
									message: "You can only cancel your own requests",
									userId,
									resource: "shiftRequest",
									action: "cancel",
								}),
							),
						);
					}

					// Delete the request
					yield* _(
						dbService.query("deleteRequest", async () => {
							await dbService.db.delete(shiftRequest).where(eq(shiftRequest.id, requestId));
						}),
					);
				}),

			getPendingRequests: (approverId) =>
				Effect.gen(function* (_) {
					// Get the approver's organization
					const approver = yield* _(
						dbService.query("getApproverOrg", async () => {
							return await dbService.db.query.employee.findFirst({
								where: eq(employee.id, approverId),
							});
						}),
					);

					if (!approver) {
						return [];
					}

					const requests = yield* _(
						dbService.query("getPendingRequests", async () => {
							// Get all pending requests for shifts in the approver's organization
							return await dbService.db.query.shiftRequest.findMany({
								where: eq(shiftRequest.status, "pending"),
								with: {
									shift: {
										with: {
											employee: {
												columns: {
													id: true,
													firstName: true,
													lastName: true,
												},
											},
										},
									},
									requester: {
										columns: {
											id: true,
											firstName: true,
											lastName: true,
										},
									},
									targetEmployee: {
										columns: {
											id: true,
											firstName: true,
											lastName: true,
										},
									},
								},
								orderBy: (shiftRequest, { desc }) => [desc(shiftRequest.createdAt)],
							});
						}),
					);

					// Filter to only include requests for shifts in the approver's organization
					const filteredRequests = requests.filter(
						(r) => r.shift.organizationId === approver.organizationId,
					);

					return filteredRequests as unknown as ShiftRequestWithRelations[];
				}),

			getRequestsByShift: (shiftId) =>
				Effect.gen(function* (_) {
					const requests = yield* _(
						dbService.query("getRequestsByShift", async () => {
							return await dbService.db.query.shiftRequest.findMany({
								where: eq(shiftRequest.shiftId, shiftId),
								with: {
									shift: {
										with: {
											employee: {
												columns: {
													id: true,
													firstName: true,
													lastName: true,
												},
											},
										},
									},
									requester: {
										columns: {
											id: true,
											firstName: true,
											lastName: true,
										},
									},
									targetEmployee: {
										columns: {
											id: true,
											firstName: true,
											lastName: true,
										},
									},
								},
								orderBy: (shiftRequest, { desc }) => [desc(shiftRequest.createdAt)],
							});
						}),
					);

					return requests as unknown as ShiftRequestWithRelations[];
				}),

			getRequestById: (requestId) =>
				Effect.gen(function* (_) {
					const request = yield* _(
						dbService.query("getRequestById", async () => {
							return await dbService.db.query.shiftRequest.findFirst({
								where: eq(shiftRequest.id, requestId),
								with: {
									shift: {
										with: {
											employee: {
												columns: {
													id: true,
													firstName: true,
													lastName: true,
												},
											},
										},
									},
									requester: {
										columns: {
											id: true,
											firstName: true,
											lastName: true,
										},
									},
									targetEmployee: {
										columns: {
											id: true,
											firstName: true,
											lastName: true,
										},
									},
								},
							});
						}),
					);

					return request as unknown as ShiftRequestWithRelations | null;
				}),
		});
	}),
);
