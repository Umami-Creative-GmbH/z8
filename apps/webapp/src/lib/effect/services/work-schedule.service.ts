import { and, eq, gte, isNull, lte, or } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";
import { employee, employeeWorkSchedule, employeeWorkScheduleDays } from "@/db/schema";
import { NotFoundError, ValidationError, DatabaseError } from "../errors";
import { DatabaseService } from "./database.service";

export interface WorkScheduleDay {
	dayOfWeek: "monday" | "tuesday" | "wednesday" | "thursday" | "friday" | "saturday" | "sunday";
	hoursPerDay: string;
	isWorkDay: boolean;
}

export interface WorkSchedule {
	id: string;
	employeeId: string;
	workClassification: "daily" | "weekly" | "monthly";
	scheduleType: "simple" | "detailed";
	hoursPerWeek: string | null;
	effectiveFrom: Date;
	effectiveUntil: Date | null;
	createdBy: string;
	updatedBy: string | null;
	createdAt: Date;
	updatedAt: Date;
	days?: WorkScheduleDay[];
}

export class WorkScheduleService extends Context.Tag("WorkScheduleService")<
	WorkScheduleService,
	{
		readonly createSimpleSchedule: (
			employeeId: string,
			hoursPerWeek: string,
			classification: "daily" | "weekly" | "monthly",
			effectiveFrom: Date,
			createdBy: string,
		) => Effect.Effect<WorkSchedule, NotFoundError | ValidationError | DatabaseError>;
		readonly createDetailedSchedule: (
			employeeId: string,
			classification: "daily" | "weekly" | "monthly",
			effectiveFrom: Date,
			days: WorkScheduleDay[],
			createdBy: string,
		) => Effect.Effect<WorkSchedule, NotFoundError | ValidationError | DatabaseError>;
		readonly getActiveSchedule: (
			employeeId: string,
			asOfDate: Date,
		) => Effect.Effect<WorkSchedule | null, NotFoundError | DatabaseError>;
		readonly getEmployeeSchedules: (
			employeeId: string,
		) => Effect.Effect<WorkSchedule[], NotFoundError | DatabaseError>;
		readonly endSchedule: (
			scheduleId: string,
			effectiveUntil: Date,
			updatedBy: string,
		) => Effect.Effect<
			void,
			NotFoundError | ValidationError | DatabaseError
		>;
		readonly calculateTotalHours: (schedule: WorkSchedule) => number;
	}
>() {}

export const WorkScheduleServiceLive = Layer.effect(
	WorkScheduleService,
	Effect.gen(function* (_) {
		const dbService = yield* _(DatabaseService);

		return WorkScheduleService.of({
			createSimpleSchedule: (employeeId, hoursPerWeek, classification, effectiveFrom, createdBy) =>
				Effect.gen(function* (_) {
					// Step 1: Validate hours per week
					const hours = parseFloat(hoursPerWeek);
					if (isNaN(hours) || hours < 0 || hours > 168) {
						yield* _(
							Effect.fail(
								new ValidationError({
									message: "Hours per week must be between 0 and 168",
									field: "hoursPerWeek",
									value: hoursPerWeek,
								}),
							),
						);
					}

					// Step 2: Verify employee exists
					const emp = yield* _(
						dbService.query("getEmployeeById", async () => {
							return await dbService.db.query.employee.findFirst({
								where: eq(employee.id, employeeId),
							});
						}),
						Effect.flatMap((e) =>
							e
								? Effect.succeed(e)
								: Effect.fail(
										new NotFoundError({
											message: "Employee not found",
											entityType: "employee",
											entityId: employeeId,
										}),
									),
						),
					);

					// Step 3: End any existing active schedules
					const activeSchedules = yield* _(
						dbService.query("getActiveSchedules", async () => {
							return await dbService.db.query.employeeWorkSchedule.findMany({
								where: and(
									eq(employeeWorkSchedule.employeeId, employeeId),
									isNull(employeeWorkSchedule.effectiveUntil),
								),
							});
						}),
					);

					if (activeSchedules.length > 0) {
						yield* _(
							dbService.query("endActiveSchedules", async () => {
								for (const schedule of activeSchedules) {
									await dbService.db
										.update(employeeWorkSchedule)
										.set({
											effectiveUntil: new Date(effectiveFrom.getTime() - 1),
											updatedBy: createdBy,
											updatedAt: new Date(),
										})
										.where(eq(employeeWorkSchedule.id, schedule.id));
								}
							}),
						);
					}

					// Step 4: Create new simple schedule
					const [newSchedule] = yield* _(
						dbService.query("createSimpleSchedule", async () => {
							return await dbService.db
								.insert(employeeWorkSchedule)
								.values({
									employeeId,
									workClassification: classification,
									scheduleType: "simple",
									hoursPerWeek,
									effectiveFrom,
									createdBy,
								})
								.returning();
						}),
					);

					return {
						...newSchedule,
						days: undefined,
					};
				}),

			createDetailedSchedule: (employeeId, classification, effectiveFrom, days, createdBy) =>
				Effect.gen(function* (_) {
					// Step 1: Validate days array
					if (!days || days.length !== 7) {
						yield* _(
							Effect.fail(
								new ValidationError({
									message: "Detailed schedule must include all 7 days of the week",
									field: "days",
									value: days,
								}),
							),
						);
					}

					// Step 2: Validate each day's hours
					const dayNames = [
						"monday",
						"tuesday",
						"wednesday",
						"thursday",
						"friday",
						"saturday",
						"sunday",
					];
					const providedDays = days.map((d) => d.dayOfWeek);
					const missingDays = dayNames.filter((d) => !providedDays.includes(d as any));

					if (missingDays.length > 0) {
						yield* _(
							Effect.fail(
								new ValidationError({
									message: `Missing days: ${missingDays.join(", ")}`,
									field: "days",
									value: days,
								}),
							),
						);
					}

					for (const day of days) {
						const hours = parseFloat(day.hoursPerDay);
						if (isNaN(hours) || hours < 0 || hours > 24) {
							yield* _(
								Effect.fail(
									new ValidationError({
										message: `Hours per day must be between 0 and 24 for ${day.dayOfWeek}`,
										field: "hoursPerDay",
										value: day.hoursPerDay,
									}),
								),
							);
						}
					}

					// Step 3: Verify employee exists
					const emp = yield* _(
						dbService.query("getEmployeeById", async () => {
							return await dbService.db.query.employee.findFirst({
								where: eq(employee.id, employeeId),
							});
						}),
						Effect.flatMap((e) =>
							e
								? Effect.succeed(e)
								: Effect.fail(
										new NotFoundError({
											message: "Employee not found",
											entityType: "employee",
											entityId: employeeId,
										}),
									),
						),
					);

					// Step 4: End any existing active schedules
					const activeSchedules = yield* _(
						dbService.query("getActiveSchedules", async () => {
							return await dbService.db.query.employeeWorkSchedule.findMany({
								where: and(
									eq(employeeWorkSchedule.employeeId, employeeId),
									isNull(employeeWorkSchedule.effectiveUntil),
								),
							});
						}),
					);

					if (activeSchedules.length > 0) {
						yield* _(
							dbService.query("endActiveSchedules", async () => {
								for (const schedule of activeSchedules) {
									await dbService.db
										.update(employeeWorkSchedule)
										.set({
											effectiveUntil: new Date(effectiveFrom.getTime() - 1),
											updatedBy: createdBy,
											updatedAt: new Date(),
										})
										.where(eq(employeeWorkSchedule.id, schedule.id));
								}
							}),
						);
					}

					// Step 5: Create new detailed schedule
					const [newSchedule] = yield* _(
						dbService.query("createDetailedSchedule", async () => {
							return await dbService.db
								.insert(employeeWorkSchedule)
								.values({
									employeeId,
									workClassification: classification,
									scheduleType: "detailed",
									effectiveFrom,
									createdBy,
								})
								.returning();
						}),
					);

					// Step 6: Create schedule days
					yield* _(
						dbService.query("createScheduleDays", async () => {
							await dbService.db.insert(employeeWorkScheduleDays).values(
								days.map((day) => ({
									scheduleId: newSchedule.id,
									dayOfWeek: day.dayOfWeek,
									hoursPerDay: day.hoursPerDay,
									isWorkDay: day.isWorkDay,
								})),
							);
						}),
					);

					// Step 7: Fetch complete schedule with days
					const completeSchedule = yield* _(
						dbService.query("getScheduleWithDays", async () => {
							return await dbService.db.query.employeeWorkSchedule.findFirst({
								where: eq(employeeWorkSchedule.id, newSchedule.id),
								with: {
									days: true,
								},
							});
						}),
					);

					if (!completeSchedule) {
						yield* _(
							Effect.fail(
								new NotFoundError({
									message: "Failed to retrieve created schedule",
									entityType: "work_schedule",
									entityId: newSchedule.id,
								}),
							),
						);
					}

					if (!completeSchedule) {
						return yield* _(
							Effect.fail(
								new NotFoundError({
									message: "Failed to retrieve created schedule",
									entityType: "work_schedule",
									entityId: newSchedule.id,
								}),
							),
						);
					}

					return {
						...completeSchedule,
						days: completeSchedule.days.map((d) => ({
							dayOfWeek: d.dayOfWeek,
							hoursPerDay: d.hoursPerDay,
							isWorkDay: d.isWorkDay,
						})),
					};
				}),

			getActiveSchedule: (employeeId, asOfDate) =>
				Effect.gen(function* (_) {
					// Verify employee exists
					const emp = yield* _(
						dbService.query("getEmployeeById", async () => {
							return await dbService.db.query.employee.findFirst({
								where: eq(employee.id, employeeId),
							});
						}),
						Effect.flatMap((e) =>
							e
								? Effect.succeed(e)
								: Effect.fail(
										new NotFoundError({
											message: "Employee not found",
											entityType: "employee",
											entityId: employeeId,
										}),
									),
						),
					);

					// Get active schedule as of the specified date
					const schedule = yield* _(
						dbService.query("getActiveSchedule", async () => {
							return await dbService.db.query.employeeWorkSchedule.findFirst({
								where: and(
									eq(employeeWorkSchedule.employeeId, employeeId),
									lte(employeeWorkSchedule.effectiveFrom, asOfDate),
									or(
										isNull(employeeWorkSchedule.effectiveUntil),
										gte(employeeWorkSchedule.effectiveUntil, asOfDate),
									),
								),
								with: {
									days: true,
								},
								orderBy: (schedule, { desc }) => [desc(schedule.effectiveFrom)],
							});
						}),
					);

					if (!schedule) {
						return null;
					}

					return {
						...schedule,
						days: schedule.days?.map((d) => ({
							dayOfWeek: d.dayOfWeek,
							hoursPerDay: d.hoursPerDay,
							isWorkDay: d.isWorkDay,
						})),
					};
				}),

			getEmployeeSchedules: (employeeId) =>
				Effect.gen(function* (_) {
					// Verify employee exists
					const emp = yield* _(
						dbService.query("getEmployeeById", async () => {
							return await dbService.db.query.employee.findFirst({
								where: eq(employee.id, employeeId),
							});
						}),
						Effect.flatMap((e) =>
							e
								? Effect.succeed(e)
								: Effect.fail(
										new NotFoundError({
											message: "Employee not found",
											entityType: "employee",
											entityId: employeeId,
										}),
									),
						),
					);

					// Get all schedules for this employee
					const schedules = yield* _(
						dbService.query("getEmployeeSchedules", async () => {
							return await dbService.db.query.employeeWorkSchedule.findMany({
								where: eq(employeeWorkSchedule.employeeId, employeeId),
								with: {
									days: true,
								},
								orderBy: (schedule, { desc }) => [desc(schedule.effectiveFrom)],
							});
						}),
					);

					return schedules.map((s) => ({
						...s,
						days: s.days?.map((d) => ({
							dayOfWeek: d.dayOfWeek,
							hoursPerDay: d.hoursPerDay,
							isWorkDay: d.isWorkDay,
						})),
					}));
				}),

			endSchedule: (scheduleId, effectiveUntil, updatedBy) =>
				Effect.gen(function* (_) {
					// Verify schedule exists
					const schedule = yield* _(
						dbService.query("getScheduleById", async () => {
							return await dbService.db.query.employeeWorkSchedule.findFirst({
								where: eq(employeeWorkSchedule.id, scheduleId),
							});
						}),
						Effect.flatMap((s) =>
							s
								? Effect.succeed(s)
								: Effect.fail(
										new NotFoundError({
											message: "Work schedule not found",
											entityType: "work_schedule",
											entityId: scheduleId,
										}),
									),
						),
					);

					// Validate effectiveUntil is after effectiveFrom
					if (effectiveUntil <= schedule.effectiveFrom) {
						yield* _(
							Effect.fail(
								new ValidationError({
									message: "Effective until date must be after effective from date",
									field: "effectiveUntil",
									value: effectiveUntil,
								}),
							),
						);
					}

					// Update schedule
					yield* _(
						dbService.query("endSchedule", async () => {
							await dbService.db
								.update(employeeWorkSchedule)
								.set({
									effectiveUntil,
									updatedBy,
									updatedAt: new Date(),
								})
								.where(eq(employeeWorkSchedule.id, scheduleId));
						}),
					);
				}),

			calculateTotalHours: (schedule) => {
				if (schedule.scheduleType === "simple") {
					return schedule.hoursPerWeek ? parseFloat(schedule.hoursPerWeek) : 0;
				}

				// Detailed schedule - sum up all work days
				if (!schedule.days || schedule.days.length === 0) {
					return 0;
				}

				return schedule.days
					.filter((d) => d.isWorkDay)
					.reduce((total, day) => {
						const hours = parseFloat(day.hoursPerDay);
						return total + (isNaN(hours) ? 0 : hours);
					}, 0);
			},
		});
	}),
);
