/**
 * Open Shifts Service
 *
 * Handles queries and operations for open (unassigned) shifts
 * and shift pickup requests.
 */

import { and, eq, gte, inArray, isNull, lt, lte, sql } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";
import { location, locationSubarea, shift, shiftRequest } from "@/db/schema";
import {
	type Instant,
	type PlainDate,
	plainDateAt,
	systemClock,
} from "@/lib/datetime/temporal-core";
import type { DatabaseError } from "@/lib/effect/errors";
import { shiftDateBounds } from "@/lib/scheduling/shift-date";
import { DatabaseService } from "./database.service";

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

// ============================================
// SERVICE INTERFACE
// ============================================

export class OpenShiftsService extends Context.Service<
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
		 * Get count of open shifts for the organization's today and tomorrow
		 */
		readonly getOpenShiftsCounts: (params: {
			organizationId: string;
			/** The organization's timezone, which `shift.date` is keyed in. */
			timezone: string;
			now?: Instant;
		}) => Effect.Effect<{ today: number; tomorrow: number }, DatabaseError>;

		/**
		 * Check if a shift is still available for pickup
		 */
		readonly isShiftAvailable: (params: {
			shiftId: string;
			organizationId: string;
		}) => Effect.Effect<boolean, DatabaseError>;
	}
>()("OpenShiftsService") {}

// ============================================
// SERVICE IMPLEMENTATION
// ============================================

export const OpenShiftsServiceLive = Layer.effect(
	OpenShiftsService,
	Effect.gen(function* () {
		const dbService = yield* DatabaseService;

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
					const { organizationId, timezone, now = systemClock.nowInstant() } = params;
					const today = plainDateAt(now, timezone);

					const countOpenShifts = (date: PlainDate) => {
						const bounds = shiftDateBounds(date.toString(), timezone);
						return dbService.db
							.select({ count: sql<number>`count(*)` })
							.from(shift)
							.where(
								and(
									eq(shift.organizationId, organizationId),
									eq(shift.status, "published"),
									isNull(shift.employeeId),
									gte(shift.date, bounds.start),
									lt(shift.date, bounds.endExclusive),
								),
							);
					};

					const [todayResult, tomorrowResult] = await Promise.all([
						countOpenShifts(today),
						countOpenShifts(today.add({ days: 1 })),
					]);

					return {
						today: Number(todayResult[0]?.count) || 0,
						tomorrow: Number(tomorrowResult[0]?.count) || 0,
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
