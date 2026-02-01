/**
 * Open Shifts Service
 *
 * Handles queries and operations for open (unassigned) shifts
 * and shift pickup requests.
 */

import { and, eq, gte, lte, isNull, sql, desc, inArray } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";
import { DateTime } from "luxon";
import { shift, shiftRequest, shiftTemplate, locationSubarea, location, employee } from "@/db/schema";
import { DatabaseError, NotFoundError, ValidationError } from "../errors";
import { DatabaseService, DatabaseServiceLive } from "./database.service";

// ============================================
// TYPES
// ============================================

export interface OpenShiftWithDetails {
	id: string;
	date: Date;
	startTime: string;
	endTime: string;
	notes: string | null;
	color: string | null;
	subarea: {
		id: string;
		name: string;
		location: {
			id: string;
			name: string;
		};
	};
	template: {
		id: string;
		name: string;
	} | null;
	pendingRequestsCount: number;
}

export interface ShiftPickupRequestResult {
	requestId: string;
	shiftId: string;
	status: "pending";
}

// ============================================
// SERVICE INTERFACE
// ============================================

export class OpenShiftsService extends Context.Tag("OpenShiftsService")<
	OpenShiftsService,
	{
		/**
		 * Get open shifts (unassigned, published) for an organization
		 */
		readonly getOpenShifts: (params: {
			organizationId: string;
			startDate?: Date;
			endDate?: Date;
			subareaId?: string;
			limit?: number;
		}) => Effect.Effect<OpenShiftWithDetails[], DatabaseError>;

		/**
		 * Get count of open shifts for today and tomorrow
		 */
		readonly getOpenShiftsCounts: (params: {
			organizationId: string;
			timezone: string;
		}) => Effect.Effect<{ today: number; tomorrow: number }, DatabaseError>;

		/**
		 * Request to pick up an open shift
		 */
		readonly requestShiftPickup: (params: {
			shiftId: string;
			requesterId: string;
			organizationId: string;
			reason?: string;
		}) => Effect.Effect<ShiftPickupRequestResult, ValidationError | NotFoundError | DatabaseError>;

		/**
		 * Check if a shift is still available for pickup
		 */
		readonly isShiftAvailable: (params: {
			shiftId: string;
			organizationId: string;
		}) => Effect.Effect<boolean, DatabaseError>;
	}
>() {}

// ============================================
// SERVICE IMPLEMENTATION
// ============================================

export const OpenShiftsServiceLive = Layer.effect(
	OpenShiftsService,
	Effect.gen(function* (_) {
		const dbService = yield* _(DatabaseService);

		return OpenShiftsService.of({
			getOpenShifts: (params) =>
				dbService.query("getOpenShifts", async () => {
					const { organizationId, startDate, endDate, subareaId, limit = 20 } = params;

					const conditions = [
						eq(shift.organizationId, organizationId),
						eq(shift.status, "published"),
						isNull(shift.employeeId),
					];

					if (startDate) {
						conditions.push(gte(shift.date, startDate));
					}

					if (endDate) {
						conditions.push(lte(shift.date, endDate));
					}

					if (subareaId) {
						conditions.push(eq(shift.subareaId, subareaId));
					}

					const openShifts = await dbService.db.query.shift.findMany({
						where: and(...conditions),
						with: {
							subarea: {
								columns: { id: true, name: true, locationId: true },
							},
							template: {
								columns: { id: true, name: true },
							},
						},
						orderBy: [shift.date, shift.startTime],
						limit,
					});

					// Get location info for each subarea
					const subareaIds = [...new Set(openShifts.map((s) => s.subareaId))];
					const locations = await dbService.db
						.select({
							subareaId: locationSubarea.id,
							locationId: location.id,
							locationName: location.name,
						})
						.from(locationSubarea)
						.innerJoin(location, eq(locationSubarea.locationId, location.id))
						.where(inArray(locationSubarea.id, subareaIds));

					const locationMap = new Map(locations.map((l) => [l.subareaId, l]));

					// Get pending request counts
					const shiftIds = openShifts.map((s) => s.id);
					const requestCounts =
						shiftIds.length > 0
							? await dbService.db
									.select({
										shiftId: shiftRequest.shiftId,
										count: sql<number>`count(*)`,
									})
									.from(shiftRequest)
									.where(
										and(
											inArray(shiftRequest.shiftId, shiftIds),
											eq(shiftRequest.status, "pending"),
										),
									)
									.groupBy(shiftRequest.shiftId)
							: [];

					const requestCountMap = new Map(requestCounts.map((r) => [r.shiftId, Number(r.count)]));

					return openShifts.map((s) => {
						const loc = locationMap.get(s.subareaId);
						return {
							id: s.id,
							date: s.date,
							startTime: s.startTime,
							endTime: s.endTime,
							notes: s.notes,
							color: s.color,
							subarea: {
								id: s.subarea?.id || s.subareaId,
								name: s.subarea?.name || "Unknown",
								location: {
									id: loc?.locationId || "",
									name: loc?.locationName || "Unknown",
								},
							},
							template: s.template
								? {
										id: s.template.id,
										name: s.template.name,
									}
								: null,
							pendingRequestsCount: requestCountMap.get(s.id) || 0,
						};
					});
				}),

			getOpenShiftsCounts: (params) =>
				dbService.query("getOpenShiftsCounts", async () => {
					const { organizationId, timezone } = params;
					const now = DateTime.now().setZone(timezone);
					const todayStr = now.toISODate();
					const tomorrowStr = now.plus({ days: 1 }).toISODate();

					const baseConditions = [
						eq(shift.organizationId, organizationId),
						eq(shift.status, "published"),
						isNull(shift.employeeId),
					];

					const [todayResult, tomorrowResult] = await Promise.all([
						dbService.db
							.select({ count: sql<number>`count(*)` })
							.from(shift)
							.where(and(...baseConditions, sql`DATE(${shift.date}) = ${todayStr}`)),
						dbService.db
							.select({ count: sql<number>`count(*)` })
							.from(shift)
							.where(and(...baseConditions, sql`DATE(${shift.date}) = ${tomorrowStr}`)),
					]);

					return {
						today: Number(todayResult[0]?.count) || 0,
						tomorrow: Number(tomorrowResult[0]?.count) || 0,
					};
				}),

			requestShiftPickup: (params) =>
				Effect.gen(function* (_) {
					const { shiftId, requesterId, organizationId, reason } = params;

					// Verify shift exists, is open, and belongs to organization
					const targetShift = yield* _(
						dbService.query("verifyShiftForPickup", async () => {
							return await dbService.db.query.shift.findFirst({
								where: and(
									eq(shift.id, shiftId),
									eq(shift.organizationId, organizationId),
									eq(shift.status, "published"),
									isNull(shift.employeeId),
								),
							});
						}),
					);

					if (!targetShift) {
						return yield* _(
							Effect.fail(
								new NotFoundError({
									message: "Shift not found or no longer available",
									entityType: "shift",
									entityId: shiftId,
								}),
							),
						);
					}

					// Verify requester belongs to the same organization (multi-tenant security)
					const requesterEmployee = yield* _(
						dbService.query("verifyRequester", async () => {
							return await dbService.db.query.employee.findFirst({
								where: and(
									eq(employee.id, requesterId),
									eq(employee.organizationId, organizationId),
								),
							});
						}),
					);

					if (!requesterEmployee) {
						return yield* _(
							Effect.fail(
								new ValidationError({
									message: "You are not authorized to request shifts in this organization",
									field: "requesterId",
									value: requesterId,
								}),
							),
						);
					}

					// Check for existing pending request from this employee
					const existingRequest = yield* _(
						dbService.query("checkExistingPickupRequest", async () => {
							return await dbService.db.query.shiftRequest.findFirst({
								where: and(
									eq(shiftRequest.shiftId, shiftId),
									eq(shiftRequest.requesterId, requesterId),
									eq(shiftRequest.status, "pending"),
								),
							});
						}),
					);

					if (existingRequest) {
						return yield* _(
							Effect.fail(
								new ValidationError({
									message: "You already have a pending request for this shift",
									field: "shiftId",
									value: shiftId,
								}),
							),
						);
					}

					// Create pickup request
					const [newRequest] = yield* _(
						dbService.query("createPickupRequest", async () => {
							return await dbService.db
								.insert(shiftRequest)
								.values({
									shiftId,
									requesterId,
									type: "pickup",
									status: "pending",
									reason,
								})
								.returning({ id: shiftRequest.id });
						}),
					);

					return {
						requestId: newRequest.id,
						shiftId,
						status: "pending" as const,
					};
				}),

			isShiftAvailable: (params) =>
				dbService.query("isShiftAvailable", async () => {
					const { shiftId, organizationId } = params;

					const targetShift = await dbService.db.query.shift.findFirst({
						where: and(
							eq(shift.id, shiftId),
							eq(shift.organizationId, organizationId),
							eq(shift.status, "published"),
							isNull(shift.employeeId),
						),
						columns: { id: true },
					});

					return !!targetShift;
				}),
		});
	}),
);

// ============================================
// LAYER DEPENDENCIES
// ============================================

export const OpenShiftsServiceFullLive = OpenShiftsServiceLive.pipe(
	Layer.provide(DatabaseServiceLive),
);
