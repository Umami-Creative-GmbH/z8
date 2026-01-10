import { and, desc, eq, gte, isNull, lte, sql } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";
import {
	employee,
	type shift as ShiftTable,
	type shiftTemplate as ShiftTemplateTable,
	shift,
	shiftTemplate,
} from "@/db/schema";
import { AuthorizationError, type DatabaseError, NotFoundError, ValidationError } from "../errors";
import { DatabaseService } from "./database.service";

// Type definitions
type Shift = typeof ShiftTable.$inferSelect;
type ShiftTemplate = typeof ShiftTemplateTable.$inferSelect;
type ShiftStatus = "draft" | "published";

export interface CreateTemplateInput {
	organizationId: string;
	name: string;
	startTime: string; // "HH:mm" format
	endTime: string;
	color?: string;
	createdBy: string;
}

export interface UpdateTemplateInput {
	name?: string;
	startTime?: string;
	endTime?: string;
	color?: string;
	isActive?: boolean;
}

export interface UpsertShiftInput {
	id?: string; // If provided, update; otherwise create
	organizationId: string;
	employeeId?: string | null; // null = open shift
	templateId?: string | null;
	date: Date;
	startTime: string;
	endTime: string;
	notes?: string;
	color?: string;
	createdBy: string;
}

export interface ShiftQuery {
	organizationId: string;
	startDate?: Date;
	endDate?: Date;
	employeeId?: string;
	status?: ShiftStatus;
	includeOpenShifts?: boolean;
}

export interface DateRange {
	start: Date;
	end: Date;
}

export interface ShiftMetadata {
	hasOverlap: boolean;
	overlappingShifts: Array<{ id: string; date: Date; startTime: string; endTime: string }>;
}

export interface IncompleteDayInfo {
	date: Date;
	openShiftCount: number;
}

export interface ShiftWithRelations extends Shift {
	employee?: {
		id: string;
		firstName: string | null;
		lastName: string | null;
	} | null;
	template?: ShiftTemplate | null;
}

export class ShiftService extends Context.Tag("ShiftService")<
	ShiftService,
	{
		// Template operations
		readonly createTemplate: (
			input: CreateTemplateInput,
		) => Effect.Effect<ShiftTemplate, ValidationError | DatabaseError>;

		readonly updateTemplate: (
			id: string,
			input: UpdateTemplateInput,
		) => Effect.Effect<ShiftTemplate, NotFoundError | ValidationError | DatabaseError>;

		readonly deleteTemplate: (id: string) => Effect.Effect<void, NotFoundError | DatabaseError>;

		readonly getTemplates: (
			organizationId: string,
		) => Effect.Effect<ShiftTemplate[], DatabaseError>;

		// Shift operations
		readonly upsertShift: (
			input: UpsertShiftInput,
		) => Effect.Effect<
			{ shift: Shift; metadata: ShiftMetadata },
			ValidationError | NotFoundError | DatabaseError
		>;

		readonly deleteShift: (
			id: string,
			userId: string,
		) => Effect.Effect<void, NotFoundError | AuthorizationError | DatabaseError>;

		readonly getShifts: (query: ShiftQuery) => Effect.Effect<ShiftWithRelations[], DatabaseError>;

		readonly getShiftById: (id: string) => Effect.Effect<ShiftWithRelations | null, DatabaseError>;

		// Publishing workflow
		readonly publishShifts: (
			organizationId: string,
			dateRange: DateRange,
			publishedBy: string,
		) => Effect.Effect<
			{ count: number; affectedEmployeeIds: string[] },
			AuthorizationError | DatabaseError
		>;

		// Analytics
		readonly getIncompleteDays: (
			organizationId: string,
			dateRange: DateRange,
		) => Effect.Effect<IncompleteDayInfo[], DatabaseError>;
	}
>() {}

export const ShiftServiceLive = Layer.effect(
	ShiftService,
	Effect.gen(function* (_) {
		const dbService = yield* _(DatabaseService);

		return ShiftService.of({
			// Template operations
			createTemplate: (input) =>
				Effect.gen(function* (_) {
					// Validate time format
					if (!isValidTimeFormat(input.startTime) || !isValidTimeFormat(input.endTime)) {
						yield* _(
							Effect.fail(
								new ValidationError({
									message: "Invalid time format. Use HH:mm format.",
									field: "startTime/endTime",
								}),
							),
						);
					}

					const createdTemplate = yield* _(
						dbService.query("createShiftTemplate", async () => {
							const [template] = await dbService.db
								.insert(shiftTemplate)
								.values({
									organizationId: input.organizationId,
									name: input.name,
									startTime: input.startTime,
									endTime: input.endTime,
									color: input.color,
									createdBy: input.createdBy,
									updatedAt: new Date(),
								})
								.returning();
							return template;
						}),
					);

					return createdTemplate;
				}),

			updateTemplate: (id, input) =>
				Effect.gen(function* (_) {
					// Verify template exists
					const existing = yield* _(
						dbService.query("getTemplateById", async () => {
							return await dbService.db.query.shiftTemplate.findFirst({
								where: eq(shiftTemplate.id, id),
							});
						}),
					);

					if (!existing) {
						yield* _(
							Effect.fail(
								new NotFoundError({
									message: "Shift template not found",
									entityType: "shiftTemplate",
									entityId: id,
								}),
							),
						);
					}

					// Validate time format if provided
					if (input.startTime && !isValidTimeFormat(input.startTime)) {
						yield* _(
							Effect.fail(
								new ValidationError({
									message: "Invalid start time format. Use HH:mm format.",
									field: "startTime",
								}),
							),
						);
					}

					if (input.endTime && !isValidTimeFormat(input.endTime)) {
						yield* _(
							Effect.fail(
								new ValidationError({
									message: "Invalid end time format. Use HH:mm format.",
									field: "endTime",
								}),
							),
						);
					}

					const updatedTemplate = yield* _(
						dbService.query("updateShiftTemplate", async () => {
							const [template] = await dbService.db
								.update(shiftTemplate)
								.set({
									...(input.name && { name: input.name }),
									...(input.startTime && { startTime: input.startTime }),
									...(input.endTime && { endTime: input.endTime }),
									...(input.color !== undefined && { color: input.color }),
									...(input.isActive !== undefined && { isActive: input.isActive }),
								})
								.where(eq(shiftTemplate.id, id))
								.returning();
							return template;
						}),
					);

					return updatedTemplate;
				}),

			deleteTemplate: (id) =>
				Effect.gen(function* (_) {
					// Verify template exists
					const existing = yield* _(
						dbService.query("getTemplateById", async () => {
							return await dbService.db.query.shiftTemplate.findFirst({
								where: eq(shiftTemplate.id, id),
							});
						}),
					);

					if (!existing) {
						yield* _(
							Effect.fail(
								new NotFoundError({
									message: "Shift template not found",
									entityType: "shiftTemplate",
									entityId: id,
								}),
							),
						);
					}

					// Soft delete by setting isActive to false
					yield* _(
						dbService.query("softDeleteShiftTemplate", async () => {
							await dbService.db
								.update(shiftTemplate)
								.set({ isActive: false })
								.where(eq(shiftTemplate.id, id));
						}),
					);
				}),

			getTemplates: (organizationId) =>
				Effect.gen(function* (_) {
					const templates = yield* _(
						dbService.query("getShiftTemplates", async () => {
							return await dbService.db.query.shiftTemplate.findMany({
								where: and(
									eq(shiftTemplate.organizationId, organizationId),
									eq(shiftTemplate.isActive, true),
								),
								orderBy: [desc(shiftTemplate.createdAt)],
							});
						}),
					);

					return templates;
				}),

			// Shift operations
			upsertShift: (input) =>
				Effect.gen(function* (_) {
					// Validate time format
					if (!isValidTimeFormat(input.startTime) || !isValidTimeFormat(input.endTime)) {
						yield* _(
							Effect.fail(
								new ValidationError({
									message: "Invalid time format. Use HH:mm format.",
									field: "startTime/endTime",
								}),
							),
						);
					}

					// Check for overlapping shifts if employee is assigned
					let overlappingShifts: Array<{
						id: string;
						date: Date;
						startTime: string;
						endTime: string;
					}> = [];

					if (input.employeeId) {
						const employeeId = input.employeeId;
						// Verify employee exists
						const employeeRecord = yield* _(
							dbService.query("verifyEmployeeExists", async () => {
								return await dbService.db.query.employee.findFirst({
									where: eq(employee.id, employeeId),
								});
							}),
						);

						if (!employeeRecord) {
							yield* _(
								Effect.fail(
									new NotFoundError({
										message: "Employee not found",
										entityType: "employee",
										entityId: input.employeeId,
									}),
								),
							);
						}

						// Check for overlapping shifts
						overlappingShifts = yield* _(
							dbService.query("checkOverlappingShifts", async () => {
								const dayStart = new Date(input.date);
								dayStart.setHours(0, 0, 0, 0);
								const dayEnd = new Date(input.date);
								dayEnd.setHours(23, 59, 59, 999);

								const existingShifts = await dbService.db.query.shift.findMany({
									where: and(
										eq(shift.employeeId, employeeId),
										gte(shift.date, dayStart),
										lte(shift.date, dayEnd),
										input.id ? sql`${shift.id} != ${input.id}` : undefined,
									),
								});

								// Check for time overlaps
								return existingShifts
									.filter((s) => {
										return timesOverlap(input.startTime, input.endTime, s.startTime, s.endTime);
									})
									.map((s) => ({
										id: s.id,
										date: s.date,
										startTime: s.startTime,
										endTime: s.endTime,
									}));
							}),
						);
					}

					let createdShift: Shift;

					if (input.id) {
						const shiftId = input.id;
						// Update existing shift
						const existing = yield* _(
							dbService.query("getShiftById", async () => {
								return await dbService.db.query.shift.findFirst({
									where: eq(shift.id, shiftId),
								});
							}),
						);

						if (!existing) {
							yield* _(
								Effect.fail(
									new NotFoundError({
										message: "Shift not found",
										entityType: "shift",
										entityId: input.id,
									}),
								),
							);
						}

						createdShift = yield* _(
							dbService.query("updateShift", async () => {
								const [s] = await dbService.db
									.update(shift)
									.set({
										employeeId: input.employeeId,
										templateId: input.templateId,
										date: input.date,
										startTime: input.startTime,
										endTime: input.endTime,
										notes: input.notes,
										color: input.color,
									})
									.where(eq(shift.id, shiftId))
									.returning();
								return s;
							}),
						);
					} else {
						// Create new shift
						createdShift = yield* _(
							dbService.query("createShift", async () => {
								const [s] = await dbService.db
									.insert(shift)
									.values({
										organizationId: input.organizationId,
										employeeId: input.employeeId,
										templateId: input.templateId,
										date: input.date,
										startTime: input.startTime,
										endTime: input.endTime,
										notes: input.notes,
										color: input.color,
										status: "draft",
										createdBy: input.createdBy,
										updatedAt: new Date(),
									})
									.returning();
								return s;
							}),
						);
					}

					return {
						shift: createdShift,
						metadata: {
							hasOverlap: overlappingShifts.length > 0,
							overlappingShifts,
						},
					};
				}),

			deleteShift: (id, userId) =>
				Effect.gen(function* (_) {
					const existing = yield* _(
						dbService.query("getShiftById", async () => {
							return await dbService.db.query.shift.findFirst({
								where: eq(shift.id, id),
							});
						}),
					);

					if (!existing) {
						return yield* _(
							Effect.fail(
								new NotFoundError({
									message: "Shift not found",
									entityType: "shift",
									entityId: id,
								}),
							),
						);
					}

					// Only allow deleting draft shifts, or published by admins
					if (existing.status === "published") {
						yield* _(
							Effect.fail(
								new AuthorizationError({
									message: "Cannot delete published shifts",
									userId,
									resource: "shift",
									action: "delete",
								}),
							),
						);
					}

					yield* _(
						dbService.query("deleteShift", async () => {
							await dbService.db.delete(shift).where(eq(shift.id, id));
						}),
					);
				}),

			getShifts: (query) =>
				Effect.gen(function* (_) {
					const shifts = yield* _(
						dbService.query("getShifts", async () => {
							const conditions = [eq(shift.organizationId, query.organizationId)];

							if (query.startDate) {
								conditions.push(gte(shift.date, query.startDate));
							}
							if (query.endDate) {
								conditions.push(lte(shift.date, query.endDate));
							}
							if (query.employeeId) {
								conditions.push(eq(shift.employeeId, query.employeeId));
							}
							if (query.status) {
								conditions.push(eq(shift.status, query.status));
							}
							if (query.includeOpenShifts) {
								// Include shifts where employeeId is null
							} else if (query.employeeId) {
								// Already filtered by employeeId
							}

							return await dbService.db.query.shift.findMany({
								where: and(...conditions),
								with: {
									employee: {
										columns: {
											id: true,
											firstName: true,
											lastName: true,
										},
									},
									template: true,
								},
								orderBy: [desc(shift.date), desc(shift.startTime)],
							});
						}),
					);

					return shifts as ShiftWithRelations[];
				}),

			getShiftById: (id) =>
				Effect.gen(function* (_) {
					const result = yield* _(
						dbService.query("getShiftById", async () => {
							return await dbService.db.query.shift.findFirst({
								where: eq(shift.id, id),
								with: {
									employee: {
										columns: {
											id: true,
											firstName: true,
											lastName: true,
										},
									},
									template: true,
								},
							});
						}),
					);

					return result as ShiftWithRelations | null;
				}),

			publishShifts: (organizationId, dateRange, publishedBy) =>
				Effect.gen(function* (_) {
					// Get all draft shifts in the date range
					const draftShifts = yield* _(
						dbService.query("getDraftShifts", async () => {
							return await dbService.db.query.shift.findMany({
								where: and(
									eq(shift.organizationId, organizationId),
									eq(shift.status, "draft"),
									gte(shift.date, dateRange.start),
									lte(shift.date, dateRange.end),
								),
							});
						}),
					);

					if (draftShifts.length === 0) {
						return { count: 0, affectedEmployeeIds: [] };
					}

					// Collect unique employee IDs (excluding open shifts)
					const affectedEmployeeIds = [
						...new Set(
							draftShifts.filter((s) => s.employeeId !== null).map((s) => s.employeeId as string),
						),
					];

					// Update all draft shifts to published
					yield* _(
						dbService.query("publishShifts", async () => {
							const shiftIds = draftShifts.map((s) => s.id);
							await dbService.db
								.update(shift)
								.set({
									status: "published",
									publishedAt: new Date(),
									publishedBy,
								})
								.where(
									and(
										eq(shift.organizationId, organizationId),
										sql`${shift.id} = ANY(${shiftIds})`,
									),
								);
						}),
					);

					return {
						count: draftShifts.length,
						affectedEmployeeIds,
					};
				}),

			getIncompleteDays: (organizationId, dateRange) =>
				Effect.gen(function* (_) {
					const result = yield* _(
						dbService.query("getIncompleteDays", async () => {
							// Get open shifts (no employee assigned) grouped by date
							const openShifts = await dbService.db.query.shift.findMany({
								where: and(
									eq(shift.organizationId, organizationId),
									isNull(shift.employeeId),
									gte(shift.date, dateRange.start),
									lte(shift.date, dateRange.end),
								),
							});

							// Group by date
							const dayMap = new Map<string, number>();
							for (const s of openShifts) {
								const dateKey = s.date.toISOString().split("T")[0];
								dayMap.set(dateKey, (dayMap.get(dateKey) || 0) + 1);
							}

							return Array.from(dayMap.entries()).map(([dateStr, count]) => ({
								date: new Date(dateStr),
								openShiftCount: count,
							}));
						}),
					);

					return result;
				}),
		});
	}),
);

// Helper functions
function isValidTimeFormat(time: string): boolean {
	const regex = /^([01]\d|2[0-3]):([0-5]\d)$/;
	return regex.test(time);
}

function timesOverlap(start1: string, end1: string, start2: string, end2: string): boolean {
	// Convert HH:mm to minutes for comparison
	const toMinutes = (time: string) => {
		const [hours, minutes] = time.split(":").map(Number);
		return hours * 60 + minutes;
	};

	const s1 = toMinutes(start1);
	const e1 = toMinutes(end1);
	const s2 = toMinutes(start2);
	const e2 = toMinutes(end2);

	// Check if ranges overlap
	return s1 < e2 && s2 < e1;
}
