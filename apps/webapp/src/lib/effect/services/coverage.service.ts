/**
 * Coverage Service
 *
 * Calculates staffing coverage for shifts by comparing
 * scheduled shifts vs actual clocked-in employees.
 */

import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";
import { DateTime } from "luxon";
import {
	coverageRule,
	coverageSettings,
	employeeManagers,
	location,
	locationSubarea,
	shift,
	workPeriod,
} from "@/db/schema";
import {
	type CoverageCalculationResult,
	calculateCoverage,
	extractGaps,
	type ShiftForCoverage,
} from "@/lib/coverage/application/calculators/coverage-calculator";
import {
	type CoverageRuleEntity,
	type DayOfWeek,
	toCoverageRuleEntity,
} from "@/lib/coverage/domain/entities/coverage-rule";
import type { HeatmapDataPoint } from "@/lib/coverage/domain/entities/coverage-snapshot";
import { snapshotToHeatmapDataPoint } from "@/lib/coverage/domain/entities/coverage-snapshot";
import type { DatabaseError, NotFoundError, ValidationError } from "../errors";
import { DatabaseService, DatabaseServiceLive } from "./database.service";

// ============================================
// TYPES
// ============================================

export interface CoverageSnapshot {
	subareaId: string;
	subareaName: string;
	locationId: string;
	locationName: string;
	timeSlot: string; // "09:00-10:00"
	scheduled: number;
	clockedIn: number;
	variance: number; // negative = understaffed
	status: "understaffed" | "adequate" | "overstaffed";
	employees: Array<{
		id: string;
		name: string;
		status: "scheduled" | "clocked_in" | "absent";
	}>;
}

export interface CoverageGap {
	subareaId: string;
	subareaName: string;
	locationName: string;
	timeSlot: string;
	shortage: number;
	date: Date;
}

export interface CoverageSummary {
	date: Date;
	timezone: string;
	totalScheduled: number;
	totalClockedIn: number;
	totalVariance: number;
	snapshots: CoverageSnapshot[];
}

// ============================================
// COVERAGE TARGETS TYPES
// ============================================

export interface CreateCoverageRuleInput {
	organizationId: string;
	subareaId: string;
	dayOfWeek: DayOfWeek;
	startTime: string;
	endTime: string;
	minimumStaffCount: number;
	priority?: number;
	createdBy: string;
}

export interface UpdateCoverageRuleInput {
	subareaId?: string;
	dayOfWeek?: DayOfWeek;
	startTime?: string;
	endTime?: string;
	minimumStaffCount?: number;
	priority?: number;
	updatedBy: string;
}

export interface CoverageRuleWithRelations {
	id: string;
	organizationId: string;
	subareaId: string;
	dayOfWeek: DayOfWeek;
	startTime: string;
	endTime: string;
	minimumStaffCount: number;
	priority: number;
	createdAt: Date;
	subarea?: {
		id: string;
		name: string;
		location?: {
			id: string;
			name: string;
		};
	};
}

export interface TargetCoverageGap {
	date: Date;
	subareaId: string;
	subareaName?: string;
	locationName?: string;
	timeRange: { startTime: string; endTime: string };
	required: number;
	actual: number;
	shortfall: number;
	ruleIds: string[];
}

export interface CoverageSettingsData {
	id: string;
	organizationId: string;
	allowPublishWithGaps: boolean;
	createdAt: Date;
	updatedAt: Date;
}

// ============================================
// SERVICE INTERFACE
// ============================================

export class CoverageService extends Context.Tag("CoverageService")<
	CoverageService,
	{
		/**
		 * Get staffing coverage for a specific date
		 * Returns coverage snapshots grouped by subarea and time slot
		 */
		readonly getCoverageForDate: (params: {
			organizationId: string;
			date: Date;
			timezone: string;
			managerId?: string;
		}) => Effect.Effect<CoverageSummary, DatabaseError>;

		/**
		 * Get coverage gaps for a date range
		 * Returns areas where actual staffing is below scheduled
		 */
		readonly getCoverageGaps: (params: {
			organizationId: string;
			startDate: Date;
			endDate: Date;
			timezone: string;
			threshold?: number; // minimum shortage to report (default: 1)
			managerId?: string;
		}) => Effect.Effect<CoverageGap[], DatabaseError>;

		// ============================================
		// COVERAGE TARGETS METHODS
		// ============================================

		/** Create a coverage rule */
		readonly createCoverageRule: (
			input: CreateCoverageRuleInput,
		) => Effect.Effect<
			CoverageRuleWithRelations,
			ValidationError | DatabaseError
		>;

		/** Update a coverage rule */
		readonly updateCoverageRule: (
			id: string,
			input: UpdateCoverageRuleInput,
		) => Effect.Effect<
			CoverageRuleWithRelations,
			NotFoundError | ValidationError | DatabaseError
		>;

		/** Delete a coverage rule */
		readonly deleteCoverageRule: (
			id: string,
		) => Effect.Effect<void, NotFoundError | DatabaseError>;

		/** Get all coverage rules for an organization */
		readonly getCoverageRules: (
			organizationId: string,
			subareaId?: string,
		) => Effect.Effect<CoverageRuleWithRelations[], DatabaseError>;

		/** Get a coverage rule by ID */
		readonly getCoverageRuleById: (
			id: string,
		) => Effect.Effect<CoverageRuleWithRelations | null, DatabaseError>;

		/** Get heatmap data for coverage targets visualization */
		readonly getTargetHeatmapData: (params: {
			organizationId: string;
			startDate: Date;
			endDate: Date;
			subareaIds?: string[];
		}) => Effect.Effect<HeatmapDataPoint[], DatabaseError>;

		/** Validate if a schedule can be published (no coverage gaps) */
		readonly validateScheduleCanPublish: (params: {
			organizationId: string;
			startDate: Date;
			endDate: Date;
		}) => Effect.Effect<
			{ canPublish: boolean; gaps: TargetCoverageGap[] },
			DatabaseError
		>;

		// ============================================
		// COVERAGE SETTINGS METHODS
		// ============================================

		/** Get coverage settings for an organization */
		readonly getCoverageSettings: (
			organizationId: string,
		) => Effect.Effect<CoverageSettingsData, DatabaseError>;

		/** Update coverage settings for an organization */
		readonly updateCoverageSettings: (
			organizationId: string,
			settings: { allowPublishWithGaps: boolean; updatedBy: string },
		) => Effect.Effect<CoverageSettingsData, DatabaseError>;
	}
>() {}

// ============================================
// HELPER FUNCTIONS
// ============================================

function calculateStatus(
	scheduled: number,
	actual: number,
): "understaffed" | "adequate" | "overstaffed" {
	const variance = actual - scheduled;
	if (variance < 0) return "understaffed";
	if (variance > 0) return "overstaffed";
	return "adequate";
}

function timeToMinutes(time: string): number {
	const [hours, minutes] = time.split(":").map(Number);
	return hours * 60 + minutes;
}

function minutesToTime(minutes: number): string {
	const hours = Math.floor(minutes / 60);
	const mins = minutes % 60;
	return `${hours.toString().padStart(2, "0")}:${mins.toString().padStart(2, "0")}`;
}

function generateTimeSlots(
	startTime: string,
	endTime: string,
	intervalMinutes = 60,
): string[] {
	const slots: string[] = [];
	let current = timeToMinutes(startTime);
	const end = timeToMinutes(endTime);

	while (current < end) {
		const slotEnd = Math.min(current + intervalMinutes, end);
		slots.push(`${minutesToTime(current)}-${minutesToTime(slotEnd)}`);
		current += intervalMinutes;
	}

	return slots;
}

/**
 * Get all dates in a range (inclusive).
 */
function getDatesInRange(startDate: Date, endDate: Date): Date[] {
	const dates: Date[] = [];
	const current = new Date(startDate);
	current.setHours(0, 0, 0, 0);
	const end = new Date(endDate);
	end.setHours(23, 59, 59, 999);

	while (current <= end) {
		dates.push(new Date(current));
		current.setDate(current.getDate() + 1);
	}

	return dates;
}

// ============================================
// SERVICE IMPLEMENTATION
// ============================================

export const CoverageServiceLive = Layer.effect(
	CoverageService,
	Effect.gen(function* (_) {
		const dbService = yield* _(DatabaseService);

		/**
		 * Get managed employee IDs for filtering (if manager ID provided)
		 */
		const getManagedEmployeeIds = (
			managerId: string,
			organizationId: string,
		): Effect.Effect<string[], DatabaseError> =>
			dbService.query("getManagedEmployeeIds", async () => {
				const managed = await dbService.db.query.employeeManagers.findMany({
					where: eq(employeeManagers.managerId, managerId),
					with: {
						employee: {
							columns: { id: true, organizationId: true },
						},
					},
				});

				return managed
					.filter((m) => m.employee.organizationId === organizationId)
					.map((m) => m.employeeId);
			});

		/**
		 * Get subareas for organization (optionally filtered by managed employees' shifts)
		 */
		const getSubareas = (
			organizationId: string,
		): Effect.Effect<
			Array<{
				id: string;
				name: string;
				locationId: string;
				locationName: string;
			}>,
			DatabaseError
		> =>
			dbService.query("getSubareas", async () => {
				const subareas = await dbService.db
					.select({
						id: locationSubarea.id,
						name: locationSubarea.name,
						locationId: location.id,
						locationName: location.name,
					})
					.from(locationSubarea)
					.innerJoin(location, eq(locationSubarea.locationId, location.id))
					.where(eq(location.organizationId, organizationId));

				return subareas;
			});

		return CoverageService.of({
			getCoverageForDate: (params) =>
				Effect.gen(function* (_) {
					const { organizationId, date, timezone, managerId } = params;
					const dt = DateTime.fromJSDate(date).setZone(timezone);
					const dateStr = dt.toISODate();

					// Get managed employee IDs if manager filter provided
					let managedEmployeeIds: string[] | undefined;
					if (managerId) {
						managedEmployeeIds = yield* _(
							getManagedEmployeeIds(managerId, organizationId),
						);
						if (managedEmployeeIds.length === 0) {
							return {
								date,
								timezone,
								totalScheduled: 0,
								totalClockedIn: 0,
								totalVariance: 0,
								snapshots: [],
							};
						}
					}

					// Get all subareas
					const subareas = yield* _(getSubareas(organizationId));

					// Get scheduled shifts for the date
					const scheduledShifts = yield* _(
						dbService.query("getScheduledShifts", async () => {
							const conditions = [
								eq(shift.organizationId, organizationId),
								eq(shift.status, "published"),
								sql`DATE(${shift.date}) = ${dateStr}`,
							];

							if (managedEmployeeIds && managedEmployeeIds.length > 0) {
								conditions.push(inArray(shift.employeeId, managedEmployeeIds));
							}

							return await dbService.db.query.shift.findMany({
								where: and(...conditions),
								with: {
									employee: {
										columns: { id: true },
										with: {
											user: { columns: { name: true } },
										},
									},
								},
							});
						}),
					);

					// Get clocked-in employees for the date
					const clockedInPeriods = yield* _(
						dbService.query("getClockedInPeriods", async () => {
							const dayStart = dt.startOf("day").toJSDate();
							const dayEnd = dt.endOf("day").toJSDate();

							const conditions = [
								eq(workPeriod.organizationId, organizationId),
								gte(workPeriod.startTime, dayStart),
								lte(workPeriod.startTime, dayEnd),
							];

							if (managedEmployeeIds) {
								conditions.push(
									inArray(workPeriod.employeeId, managedEmployeeIds),
								);
							}

							return await dbService.db.query.workPeriod.findMany({
								where: and(...conditions),
								with: {
									employee: {
										columns: { id: true },
										with: {
											user: { columns: { name: true } },
										},
									},
								},
							});
						}),
					);

					// Build coverage snapshots by subarea
					const snapshots: CoverageSnapshot[] = [];
					let totalScheduled = 0;
					let totalClockedIn = 0;

					for (const subarea of subareas) {
						// Get shifts for this subarea
						const subareaShifts = scheduledShifts.filter(
							(s) => s.subareaId === subarea.id,
						);
						if (subareaShifts.length === 0) continue;

						// Find time range for this subarea
						const allStartTimes = subareaShifts.map((s) => s.startTime);
						const allEndTimes = subareaShifts.map((s) => s.endTime);
						const earliestStart = allStartTimes.sort()[0];
						const latestEnd = allEndTimes.sort().reverse()[0];

						// Generate time slots
						const timeSlots = generateTimeSlots(earliestStart, latestEnd, 60);

						for (const slot of timeSlots) {
							const [slotStart, slotEnd] = slot.split("-");
							const slotStartMins = timeToMinutes(slotStart);
							const slotEndMins = timeToMinutes(slotEnd);

							// Count scheduled employees for this slot
							const scheduledInSlot = subareaShifts.filter((s) => {
								const shiftStart = timeToMinutes(s.startTime);
								const shiftEnd = timeToMinutes(s.endTime);
								// Shift overlaps with slot
								return (
									shiftStart < slotEndMins &&
									shiftEnd > slotStartMins &&
									s.employeeId !== null
								);
							});

							// Count clocked-in employees for this slot
							// For simplicity, check if their clock-in time falls within this slot
							const clockedInSlot = clockedInPeriods.filter((wp) => {
								const clockInTime = DateTime.fromJSDate(wp.startTime).setZone(
									timezone,
								);
								const clockInMins = clockInTime.hour * 60 + clockInTime.minute;
								// Consider clocked in if they started before slot end
								return clockInMins < slotEndMins;
							});

							const scheduled = scheduledInSlot.length;
							const clockedIn = clockedInSlot.length;
							const variance = clockedIn - scheduled;

							totalScheduled += scheduled;
							totalClockedIn += clockedIn;

							// Build employee list
							const employees: CoverageSnapshot["employees"] = [];

							// Add scheduled employees
							for (const s of scheduledInSlot) {
								const isClockedIn = clockedInSlot.some(
									(wp) => wp.employeeId === s.employeeId,
								);
								employees.push({
									id: s.employeeId!,
									name: s.employee?.user?.name || "Unknown",
									status: isClockedIn ? "clocked_in" : "absent",
								});
							}

							// Add clocked-in employees not scheduled
							for (const wp of clockedInSlot) {
								if (!employees.find((e) => e.id === wp.employeeId)) {
									employees.push({
										id: wp.employeeId,
										name: wp.employee?.user?.name || "Unknown",
										status: "clocked_in",
									});
								}
							}

							snapshots.push({
								subareaId: subarea.id,
								subareaName: subarea.name,
								locationId: subarea.locationId,
								locationName: subarea.locationName,
								timeSlot: slot,
								scheduled,
								clockedIn,
								variance,
								status: calculateStatus(scheduled, clockedIn),
								employees,
							});
						}
					}

					return {
						date,
						timezone,
						totalScheduled,
						totalClockedIn,
						totalVariance: totalClockedIn - totalScheduled,
						snapshots,
					};
				}),

			getCoverageGaps: (params) =>
				Effect.gen(function* (_) {
					const {
						organizationId,
						startDate,
						endDate,
						timezone,
						threshold = 1,
						managerId,
					} = params;

					// Get managed employee IDs if manager filter provided
					let managedEmployeeIds: string[] | undefined;
					if (managerId) {
						managedEmployeeIds = yield* _(
							getManagedEmployeeIds(managerId, organizationId),
						);
						if (managedEmployeeIds.length === 0) {
							return [];
						}
					}

					// Get subareas
					const subareas = yield* _(getSubareas(organizationId));
					const subareaMap = new Map(subareas.map((s) => [s.id, s]));

					// Get scheduled shifts in range
					const scheduledShifts = yield* _(
						dbService.query("getScheduledShiftsRange", async () => {
							const conditions = [
								eq(shift.organizationId, organizationId),
								eq(shift.status, "published"),
								gte(shift.date, startDate),
								lte(shift.date, endDate),
								sql`${shift.employeeId} IS NOT NULL`,
							];

							if (managedEmployeeIds) {
								conditions.push(inArray(shift.employeeId, managedEmployeeIds));
							}

							return await dbService.db.query.shift.findMany({
								where: and(...conditions),
							});
						}),
					);

					// Get clocked-in periods in range
					const clockedInPeriods = yield* _(
						dbService.query("getClockedInPeriodsRange", async () => {
							const conditions = [
								eq(workPeriod.organizationId, organizationId),
								gte(workPeriod.startTime, startDate),
								lte(workPeriod.startTime, endDate),
							];

							if (managedEmployeeIds) {
								conditions.push(
									inArray(workPeriod.employeeId, managedEmployeeIds),
								);
							}

							return await dbService.db.query.workPeriod.findMany({
								where: and(...conditions),
							});
						}),
					);

					// Group by date and subarea
					const gaps: CoverageGap[] = [];

					// Group shifts by date and subarea
					const shiftsByDateSubarea = new Map<string, typeof scheduledShifts>();
					for (const s of scheduledShifts) {
						const dateKey = DateTime.fromJSDate(s.date).toISODate();
						const key = `${dateKey}:${s.subareaId}`;
						const existing = shiftsByDateSubarea.get(key) || [];
						existing.push(s);
						shiftsByDateSubarea.set(key, existing);
					}

					// Group work periods by date
					const workPeriodsByDate = new Map<string, typeof clockedInPeriods>();
					for (const wp of clockedInPeriods) {
						const dateKey = DateTime.fromJSDate(wp.startTime)
							.setZone(timezone)
							.toISODate();
						const existing = workPeriodsByDate.get(dateKey!) || [];
						existing.push(wp);
						workPeriodsByDate.set(dateKey!, existing);
					}

					// Calculate gaps
					for (const [key, shifts] of shiftsByDateSubarea) {
						const [dateStr, subareaId] = key.split(":");
						const subarea = subareaMap.get(subareaId);
						if (!subarea) continue;

						// Get unique scheduled employee IDs
						const scheduledEmployeeIds = new Set(
							shifts.map((s) => s.employeeId).filter(Boolean),
						);
						const scheduled = scheduledEmployeeIds.size;

						// Get clocked-in employees for this date
						const dayWorkPeriods = workPeriodsByDate.get(dateStr) || [];
						const clockedInEmployeeIds = new Set(
							dayWorkPeriods.map((wp) => wp.employeeId),
						);
						const clockedIn = clockedInEmployeeIds.size;

						const shortage = scheduled - clockedIn;
						if (shortage >= threshold) {
							gaps.push({
								subareaId,
								subareaName: subarea.name,
								locationName: subarea.locationName,
								timeSlot: `${shifts[0].startTime}-${shifts[shifts.length - 1].endTime}`,
								shortage,
								date: DateTime.fromISO(dateStr).toJSDate(),
							});
						}
					}

					// Sort by date, then shortage (highest first)
					gaps.sort((a, b) => {
						const dateDiff = a.date.getTime() - b.date.getTime();
						if (dateDiff !== 0) return dateDiff;
						return b.shortage - a.shortage;
					});

					return gaps;
				}),

			// ============================================
			// COVERAGE TARGETS IMPLEMENTATIONS
			// ============================================

			createCoverageRule: (input) =>
				Effect.gen(function* (_) {
					const created = yield* _(
						dbService.query("createCoverageRule", async () => {
							const [newRule] = await dbService.db
								.insert(coverageRule)
								.values({
									organizationId: input.organizationId,
									subareaId: input.subareaId,
									dayOfWeek: input.dayOfWeek,
									startTime: input.startTime,
									endTime: input.endTime,
									minimumStaffCount: input.minimumStaffCount,
									priority: input.priority ?? 0,
									createdBy: input.createdBy,
									updatedAt: new Date(),
								})
								.returning();
							return newRule;
						}),
					);

					// Fetch with relations
					const result = yield* _(
						dbService.query("getCoverageRuleWithRelations", async () => {
							return await dbService.db.query.coverageRule.findFirst({
								where: eq(coverageRule.id, created.id),
								with: {
									subarea: {
										columns: { id: true, name: true },
										with: {
											location: {
												columns: { id: true, name: true },
											},
										},
									},
								},
							});
						}),
					);

					return result as CoverageRuleWithRelations;
				}),

			updateCoverageRule: (id, input) =>
				Effect.gen(function* (_) {
					yield* _(
						dbService.query("updateCoverageRule", async () => {
							await dbService.db
								.update(coverageRule)
								.set({
									...(input.subareaId && { subareaId: input.subareaId }),
									...(input.dayOfWeek && { dayOfWeek: input.dayOfWeek }),
									...(input.startTime && { startTime: input.startTime }),
									...(input.endTime && { endTime: input.endTime }),
									...(input.minimumStaffCount !== undefined && {
										minimumStaffCount: input.minimumStaffCount,
									}),
									...(input.priority !== undefined && {
										priority: input.priority,
									}),
									updatedBy: input.updatedBy,
									updatedAt: new Date(),
								})
								.where(eq(coverageRule.id, id));
						}),
					);

					const result = yield* _(
						dbService.query("getCoverageRuleWithRelations", async () => {
							return await dbService.db.query.coverageRule.findFirst({
								where: eq(coverageRule.id, id),
								with: {
									subarea: {
										columns: { id: true, name: true },
										with: {
											location: {
												columns: { id: true, name: true },
											},
										},
									},
								},
							});
						}),
					);

					return result as CoverageRuleWithRelations;
				}),

			deleteCoverageRule: (id) =>
				Effect.gen(function* (_) {
					yield* _(
						dbService.query("deleteCoverageRule", async () => {
							await dbService.db
								.delete(coverageRule)
								.where(eq(coverageRule.id, id));
						}),
					);
				}),

			getCoverageRules: (organizationId, subareaId) =>
				Effect.gen(function* (_) {
					const conditions = [eq(coverageRule.organizationId, organizationId)];
					if (subareaId) {
						conditions.push(eq(coverageRule.subareaId, subareaId));
					}

					const results = yield* _(
						dbService.query("getCoverageRules", async () => {
							return await dbService.db.query.coverageRule.findMany({
								where: and(...conditions),
								with: {
									subarea: {
										columns: { id: true, name: true },
										with: {
											location: {
												columns: { id: true, name: true },
											},
										},
									},
								},
								orderBy: (rule, { asc }) => [
									asc(rule.dayOfWeek),
									asc(rule.startTime),
								],
							});
						}),
					);

					return results as CoverageRuleWithRelations[];
				}),

			getCoverageRuleById: (id) =>
				Effect.gen(function* (_) {
					const result = yield* _(
						dbService.query("getCoverageRuleById", async () => {
							return await dbService.db.query.coverageRule.findFirst({
								where: eq(coverageRule.id, id),
								with: {
									subarea: {
										columns: { id: true, name: true },
										with: {
											location: {
												columns: { id: true, name: true },
											},
										},
									},
								},
							});
						}),
					);

					return result as CoverageRuleWithRelations | null;
				}),

			getTargetHeatmapData: (params) =>
				Effect.gen(function* (_) {
					const { organizationId, startDate, endDate, subareaIds } = params;

					// Fetch rules
					const rulesConditions = [
						eq(coverageRule.organizationId, organizationId),
					];
					if (subareaIds && subareaIds.length > 0) {
						rulesConditions.push(inArray(coverageRule.subareaId, subareaIds));
					}

					const rules = yield* _(
						dbService.query("getCoverageRulesForHeatmap", async () => {
							return await dbService.db.query.coverageRule.findMany({
								where: and(...rulesConditions),
								with: {
									subarea: {
										columns: { id: true, name: true },
										with: {
											location: { columns: { id: true, name: true } },
										},
									},
								},
							});
						}),
					);

					// Fetch published shifts
					const shiftConditions = [
						eq(shift.organizationId, organizationId),
						eq(shift.status, "published"),
						gte(shift.date, startDate),
						lte(shift.date, endDate),
					];
					if (subareaIds && subareaIds.length > 0) {
						shiftConditions.push(inArray(shift.subareaId, subareaIds));
					}

					const shifts = yield* _(
						dbService.query("getShiftsForHeatmap", async () => {
							return await dbService.db.query.shift.findMany({
								where: and(...shiftConditions),
								columns: {
									id: true,
									subareaId: true,
									employeeId: true,
									date: true,
									startTime: true,
									endTime: true,
								},
							});
						}),
					);

					// Get unique subareas from rules
					const subareaMap = new Map<
						string,
						{ id: string; name: string; locationName?: string }
					>();
					for (const rule of rules) {
						if (rule.subarea && !subareaMap.has(rule.subareaId)) {
							subareaMap.set(rule.subareaId, {
								id: rule.subarea.id,
								name: rule.subarea.name,
								locationName: rule.subarea.location?.name,
							});
						}
					}

					// Convert rules to domain entities
					const ruleEntities: CoverageRuleEntity[] = rules.map((r) =>
						toCoverageRuleEntity({
							id: r.id,
							organizationId: r.organizationId,
							subareaId: r.subareaId,
							dayOfWeek: r.dayOfWeek as DayOfWeek,
							startTime: r.startTime,
							endTime: r.endTime,
							minimumStaffCount: r.minimumStaffCount,
							priority: r.priority,
						}),
					);

					// Calculate coverage for each day and subarea
					const dates = getDatesInRange(startDate, endDate);
					const heatmapData: HeatmapDataPoint[] = [];

					for (const date of dates) {
						for (const [subareaId, subareaInfo] of subareaMap) {
							const dateStr = date.toISOString().split("T")[0];
							const subareaShifts: ShiftForCoverage[] = shifts
								.filter((s) => {
									const shiftDateStr = new Date(s.date)
										.toISOString()
										.split("T")[0];
									return s.subareaId === subareaId && shiftDateStr === dateStr;
								})
								.map((s) => ({
									id: s.id,
									employeeId: s.employeeId,
									startTime: s.startTime,
									endTime: s.endTime,
								}));

							const result = calculateCoverage({
								date,
								subareaId,
								subareaName: subareaInfo.name,
								locationName: subareaInfo.locationName,
								rules: ruleEntities,
								shifts: subareaShifts,
							});

							if (result.snapshot.timeSlots.length > 0) {
								heatmapData.push(snapshotToHeatmapDataPoint(result.snapshot));
							}
						}
					}

					return heatmapData;
				}),

			validateScheduleCanPublish: (params) =>
				Effect.gen(function* (_) {
					const { organizationId, startDate, endDate } = params;

					// Fetch all rules
					const rules = yield* _(
						dbService.query("getCoverageRulesForValidation", async () => {
							return await dbService.db.query.coverageRule.findMany({
								where: eq(coverageRule.organizationId, organizationId),
								with: {
									subarea: {
										columns: { id: true, name: true },
										with: {
											location: { columns: { id: true, name: true } },
										},
									},
								},
							});
						}),
					);

					// Fetch all draft shifts in range (that would be published)
					const draftShifts = yield* _(
						dbService.query("getDraftShiftsForValidation", async () => {
							return await dbService.db.query.shift.findMany({
								where: and(
									eq(shift.organizationId, organizationId),
									eq(shift.status, "draft"),
									gte(shift.date, startDate),
									lte(shift.date, endDate),
								),
								columns: {
									id: true,
									subareaId: true,
									employeeId: true,
									date: true,
									startTime: true,
									endTime: true,
								},
							});
						}),
					);

					// Also fetch published shifts (they'll remain)
					const publishedShifts = yield* _(
						dbService.query("getPublishedShiftsForValidation", async () => {
							return await dbService.db.query.shift.findMany({
								where: and(
									eq(shift.organizationId, organizationId),
									eq(shift.status, "published"),
									gte(shift.date, startDate),
									lte(shift.date, endDate),
								),
								columns: {
									id: true,
									subareaId: true,
									employeeId: true,
									date: true,
									startTime: true,
									endTime: true,
								},
							});
						}),
					);

					// Combine all shifts (draft + published)
					const allShifts = [...draftShifts, ...publishedShifts];

					// Get unique subareas
					const subareaMap = new Map<
						string,
						{ id: string; name: string; locationName?: string }
					>();
					for (const rule of rules) {
						if (rule.subarea && !subareaMap.has(rule.subareaId)) {
							subareaMap.set(rule.subareaId, {
								id: rule.subarea.id,
								name: rule.subarea.name,
								locationName: rule.subarea.location?.name,
							});
						}
					}

					// Convert rules to domain entities
					const ruleEntities: CoverageRuleEntity[] = rules.map((r) =>
						toCoverageRuleEntity({
							id: r.id,
							organizationId: r.organizationId,
							subareaId: r.subareaId,
							dayOfWeek: r.dayOfWeek as DayOfWeek,
							startTime: r.startTime,
							endTime: r.endTime,
							minimumStaffCount: r.minimumStaffCount,
							priority: r.priority,
						}),
					);

					// Calculate coverage and extract gaps
					const dates = getDatesInRange(startDate, endDate);
					const allResults: CoverageCalculationResult[] = [];

					for (const date of dates) {
						for (const [subareaId, subareaInfo] of subareaMap) {
							const dateStr = date.toISOString().split("T")[0];
							const subareaShifts: ShiftForCoverage[] = allShifts
								.filter((s) => {
									const shiftDateStr = new Date(s.date)
										.toISOString()
										.split("T")[0];
									return s.subareaId === subareaId && shiftDateStr === dateStr;
								})
								.map((s) => ({
									id: s.id,
									employeeId: s.employeeId,
									startTime: s.startTime,
									endTime: s.endTime,
								}));

							const result = calculateCoverage({
								date,
								subareaId,
								subareaName: subareaInfo.name,
								locationName: subareaInfo.locationName,
								rules: ruleEntities,
								shifts: subareaShifts,
							});

							if (result.snapshot.timeSlots.length > 0) {
								allResults.push(result);
							}
						}
					}

					const gaps = extractGaps(allResults);
					const targetGaps: TargetCoverageGap[] = gaps.map((g) => ({
						date: g.date,
						subareaId: g.subareaId,
						subareaName: g.subareaName,
						locationName: g.locationName,
						timeRange: g.timeRange,
						required: g.required,
						actual: g.actual,
						shortfall: g.shortfall,
						ruleIds: g.ruleIds,
					}));

					return {
						canPublish: targetGaps.length === 0,
						gaps: targetGaps,
					};
				}),

			// ============================================
			// COVERAGE SETTINGS METHODS
			// ============================================

			getCoverageSettings: (organizationId) =>
				Effect.gen(function* (_) {
					const settings = yield* _(
						dbService.query("getCoverageSettings", async () => {
							return await dbService.db.query.coverageSettings.findFirst({
								where: eq(coverageSettings.organizationId, organizationId),
							});
						}),
					);

					// Return defaults if no settings exist
					if (!settings) {
						return {
							id: "",
							organizationId,
							allowPublishWithGaps: true, // Default: allow publishing with gaps
							createdAt: new Date(),
							updatedAt: new Date(),
						};
					}

					return {
						id: settings.id,
						organizationId: settings.organizationId,
						allowPublishWithGaps: settings.allowPublishWithGaps,
						createdAt: settings.createdAt,
						updatedAt: settings.updatedAt,
					};
				}),

			updateCoverageSettings: (organizationId, input) =>
				Effect.gen(function* (_) {
					// Try to find existing settings
					const existing = yield* _(
						dbService.query("getCoverageSettingsForUpdate", async () => {
							return await dbService.db.query.coverageSettings.findFirst({
								where: eq(coverageSettings.organizationId, organizationId),
							});
						}),
					);

					if (existing) {
						// Update existing
						const [updated] = yield* _(
							dbService.query("updateCoverageSettings", async () => {
								return await dbService.db
									.update(coverageSettings)
									.set({
										allowPublishWithGaps: input.allowPublishWithGaps,
										updatedBy: input.updatedBy,
									})
									.where(eq(coverageSettings.id, existing.id))
									.returning();
							}),
						);
						return {
							id: updated.id,
							organizationId: updated.organizationId,
							allowPublishWithGaps: updated.allowPublishWithGaps,
							createdAt: updated.createdAt,
							updatedAt: updated.updatedAt,
						};
					} else {
						// Create new
						const [created] = yield* _(
							dbService.query("insertCoverageSettings", async () => {
								return await dbService.db
									.insert(coverageSettings)
									.values({
										organizationId,
										allowPublishWithGaps: input.allowPublishWithGaps,
										updatedBy: input.updatedBy,
									})
									.returning();
							}),
						);
						return {
							id: created.id,
							organizationId: created.organizationId,
							allowPublishWithGaps: created.allowPublishWithGaps,
							createdAt: created.createdAt,
							updatedAt: created.updatedAt,
						};
					}
				}),
		});
	}),
);

// ============================================
// LAYER DEPENDENCIES
// ============================================

export const CoverageServiceFullLive = CoverageServiceLive.pipe(
	Layer.provide(DatabaseServiceLive),
);
