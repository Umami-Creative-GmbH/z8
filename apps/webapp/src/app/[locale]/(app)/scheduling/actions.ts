"use server";

import { desc, eq } from "drizzle-orm";
import { Effect } from "effect";
import { headers } from "next/headers";
import { db } from "@/db";
import { employee, location } from "@/db/schema";
import { auth } from "@/lib/auth";
import { AuthorizationError, NotFoundError } from "@/lib/effect/errors";
import { runServerActionSafe, type ServerActionResult } from "@/lib/effect/result";
import { AppLayer } from "@/lib/effect/runtime";
import { AuthService } from "@/lib/effect/services/auth.service";
import { DatabaseService } from "@/lib/effect/services/database.service";
import {
	type IncompleteDayInfo,
	type ShiftMetadata,
	ShiftService,
	type ShiftWithRelations,
} from "@/lib/effect/services/shift.service";
import {
	ShiftRequestService,
	type ShiftRequestWithRelations,
} from "@/lib/effect/services/shift-request.service";
import { createLogger } from "@/lib/logger";
import type {
	CreateTemplateInput,
	DateRange,
	Shift,
	ShiftQuery,
	ShiftRequest,
	ShiftTemplate,
	SubareaInfo,
	SwapRequestInput,
	UpdateTemplateInput,
	UpsertShiftInput,
} from "./types";

const logger = createLogger("SchedulingActions");

// Helper to get current employee
async function _getCurrentEmployee() {
	const session = await auth.api.getSession({ headers: await headers() });
	if (!session?.user) return null;

	const emp = await db.query.employee.findFirst({
		where: eq(employee.userId, session.user.id),
	});

	return emp;
}

// ============================================
// TEMPLATE ACTIONS
// ============================================

export async function createShiftTemplate(
	input: CreateTemplateInput,
): Promise<ServerActionResult<ShiftTemplate>> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());
		const shiftService = yield* _(ShiftService);
		const dbService = yield* _(DatabaseService);

		yield* _(Effect.annotateCurrentSpan("user.id", session.user.id));

		// Get current employee
		const emp = yield* _(
			dbService.query("getCurrentEmployee", async () => {
				return await db.query.employee.findFirst({
					where: eq(employee.userId, session.user.id),
				});
			}),
		);

		if (!emp) {
			return yield* _(
				Effect.fail(
					new NotFoundError({
						message: "Employee profile not found",
						entityType: "employee",
						entityId: session.user.id,
					}),
				),
			);
		}

		// Verify manager/admin role
		if (emp.role !== "manager" && emp.role !== "admin") {
			return yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Only managers and admins can create shift templates",
						userId: session.user.id,
						resource: "shiftTemplate",
						action: "create",
					}),
				),
			);
		}

		const template = yield* _(
			shiftService.createTemplate({
				organizationId: emp.organizationId,
				name: input.name,
				startTime: input.startTime,
				endTime: input.endTime,
				color: input.color,
				subareaId: input.subareaId,
				createdBy: session.user.id,
			}),
		);

		return template;
	}).pipe(Effect.withSpan("createShiftTemplate"), Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

export async function updateShiftTemplate(
	id: string,
	input: UpdateTemplateInput,
): Promise<ServerActionResult<ShiftTemplate>> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());
		const shiftService = yield* _(ShiftService);
		const dbService = yield* _(DatabaseService);

		yield* _(Effect.annotateCurrentSpan("user.id", session.user.id));

		// Get current employee
		const emp = yield* _(
			dbService.query("getCurrentEmployee", async () => {
				return await db.query.employee.findFirst({
					where: eq(employee.userId, session.user.id),
				});
			}),
		);

		if (!emp) {
			return yield* _(
				Effect.fail(
					new NotFoundError({
						message: "Employee profile not found",
						entityType: "employee",
						entityId: session.user.id,
					}),
				),
			);
		}

		// Verify manager/admin role
		if (emp.role !== "manager" && emp.role !== "admin") {
			return yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Only managers and admins can update shift templates",
						userId: session.user.id,
						resource: "shiftTemplate",
						action: "update",
					}),
				),
			);
		}

		const template = yield* _(shiftService.updateTemplate(id, input));

		return template;
	}).pipe(Effect.withSpan("updateShiftTemplate"), Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

export async function deleteShiftTemplate(id: string): Promise<ServerActionResult<void>> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());
		const shiftService = yield* _(ShiftService);
		const dbService = yield* _(DatabaseService);

		yield* _(Effect.annotateCurrentSpan("user.id", session.user.id));

		// Get current employee
		const emp = yield* _(
			dbService.query("getCurrentEmployee", async () => {
				return await db.query.employee.findFirst({
					where: eq(employee.userId, session.user.id),
				});
			}),
		);

		if (!emp) {
			return yield* _(
				Effect.fail(
					new NotFoundError({
						message: "Employee profile not found",
						entityType: "employee",
						entityId: session.user.id,
					}),
				),
			);
		}

		// Verify manager/admin role
		if (emp.role !== "manager" && emp.role !== "admin") {
			return yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Only managers and admins can delete shift templates",
						userId: session.user.id,
						resource: "shiftTemplate",
						action: "delete",
					}),
				),
			);
		}

		yield* _(shiftService.deleteTemplate(id));
	}).pipe(Effect.withSpan("deleteShiftTemplate"), Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

export async function getShiftTemplates(): Promise<ServerActionResult<ShiftTemplate[]>> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());
		const shiftService = yield* _(ShiftService);
		const dbService = yield* _(DatabaseService);

		yield* _(Effect.annotateCurrentSpan("user.id", session.user.id));

		// Get current employee
		const emp = yield* _(
			dbService.query("getCurrentEmployee", async () => {
				return await db.query.employee.findFirst({
					where: eq(employee.userId, session.user.id),
				});
			}),
		);

		if (!emp) {
			return yield* _(
				Effect.fail(
					new NotFoundError({
						message: "Employee profile not found",
						entityType: "employee",
						entityId: session.user.id,
					}),
				),
			);
		}

		const templates = yield* _(shiftService.getTemplates(emp.organizationId));

		return templates;
	}).pipe(Effect.withSpan("getShiftTemplates"), Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

// ============================================
// SHIFT ACTIONS
// ============================================

export async function upsertShift(
	input: UpsertShiftInput,
): Promise<ServerActionResult<{ shift: Shift; metadata: ShiftMetadata }>> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());
		const shiftService = yield* _(ShiftService);
		const dbService = yield* _(DatabaseService);

		yield* _(Effect.annotateCurrentSpan("user.id", session.user.id));

		// Get current employee
		const emp = yield* _(
			dbService.query("getCurrentEmployee", async () => {
				return await db.query.employee.findFirst({
					where: eq(employee.userId, session.user.id),
				});
			}),
		);

		if (!emp) {
			return yield* _(
				Effect.fail(
					new NotFoundError({
						message: "Employee profile not found",
						entityType: "employee",
						entityId: session.user.id,
					}),
				),
			);
		}

		// Verify manager/admin role for creating/updating shifts
		if (emp.role !== "manager" && emp.role !== "admin") {
			return yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Only managers and admins can manage shifts",
						userId: session.user.id,
						resource: "shift",
						action: input.id ? "update" : "create",
					}),
				),
			);
		}

		const result = yield* _(
			shiftService.upsertShift({
				id: input.id,
				organizationId: emp.organizationId,
				employeeId: input.employeeId,
				templateId: input.templateId,
				subareaId: input.subareaId,
				date: input.date,
				startTime: input.startTime,
				endTime: input.endTime,
				notes: input.notes,
				color: input.color,
				createdBy: session.user.id,
			}),
		);

		return result;
	}).pipe(Effect.withSpan("upsertShift"), Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

export async function deleteShift(id: string): Promise<ServerActionResult<void>> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());
		const shiftService = yield* _(ShiftService);

		yield* _(Effect.annotateCurrentSpan("user.id", session.user.id));

		yield* _(shiftService.deleteShift(id, session.user.id));
	}).pipe(Effect.withSpan("deleteShift"), Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

export async function getShifts(
	query: ShiftQuery,
): Promise<ServerActionResult<ShiftWithRelations[]>> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());
		const shiftService = yield* _(ShiftService);
		const dbService = yield* _(DatabaseService);

		yield* _(Effect.annotateCurrentSpan("user.id", session.user.id));

		// Get current employee
		const emp = yield* _(
			dbService.query("getCurrentEmployee", async () => {
				return await db.query.employee.findFirst({
					where: eq(employee.userId, session.user.id),
				});
			}),
		);

		if (!emp) {
			return yield* _(
				Effect.fail(
					new NotFoundError({
						message: "Employee profile not found",
						entityType: "employee",
						entityId: session.user.id,
					}),
				),
			);
		}

		// If employee role, only show their own published shifts + open shifts
		const effectiveQuery = { ...query, organizationId: emp.organizationId };

		if (emp.role === "employee") {
			// Employees can only see their own shifts and open shifts
			if (!query.employeeId) {
				effectiveQuery.employeeId = emp.id;
			} else if (query.employeeId !== emp.id) {
				return yield* _(
					Effect.fail(
						new AuthorizationError({
							message: "You can only view your own shifts",
							userId: session.user.id,
							resource: "shift",
							action: "read",
						}),
					),
				);
			}
			// Only show published shifts to employees
			effectiveQuery.status = "published";
		}

		const shifts = yield* _(shiftService.getShifts(effectiveQuery));

		return shifts;
	}).pipe(Effect.withSpan("getShifts"), Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

export async function publishShifts(
	dateRange: DateRange,
): Promise<ServerActionResult<{ count: number }>> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());
		const shiftService = yield* _(ShiftService);
		const dbService = yield* _(DatabaseService);

		yield* _(Effect.annotateCurrentSpan("user.id", session.user.id));

		// Get current employee
		const emp = yield* _(
			dbService.query("getCurrentEmployee", async () => {
				return await db.query.employee.findFirst({
					where: eq(employee.userId, session.user.id),
				});
			}),
		);

		if (!emp) {
			return yield* _(
				Effect.fail(
					new NotFoundError({
						message: "Employee profile not found",
						entityType: "employee",
						entityId: session.user.id,
					}),
				),
			);
		}

		// Verify manager/admin role
		if (emp.role !== "manager" && emp.role !== "admin") {
			return yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Only managers and admins can publish shifts",
						userId: session.user.id,
						resource: "shift",
						action: "publish",
					}),
				),
			);
		}

		const result = yield* _(
			shiftService.publishShifts(emp.organizationId, dateRange, session.user.id),
		);

		// TODO: Trigger notifications for affected employees
		// This will be implemented when we add notification triggers

		logger.info(
			{ count: result.count, affectedEmployees: result.affectedEmployeeIds.length },
			"Published shifts",
		);

		return { count: result.count };
	}).pipe(Effect.withSpan("publishShifts"), Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

export async function getIncompleteDays(
	dateRange: DateRange,
): Promise<ServerActionResult<IncompleteDayInfo[]>> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());
		const shiftService = yield* _(ShiftService);
		const dbService = yield* _(DatabaseService);

		yield* _(Effect.annotateCurrentSpan("user.id", session.user.id));

		// Get current employee
		const emp = yield* _(
			dbService.query("getCurrentEmployee", async () => {
				return await db.query.employee.findFirst({
					where: eq(employee.userId, session.user.id),
				});
			}),
		);

		if (!emp) {
			return yield* _(
				Effect.fail(
					new NotFoundError({
						message: "Employee profile not found",
						entityType: "employee",
						entityId: session.user.id,
					}),
				),
			);
		}

		const incompleteDays = yield* _(shiftService.getIncompleteDays(emp.organizationId, dateRange));

		return incompleteDays;
	}).pipe(Effect.withSpan("getIncompleteDays"), Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

// ============================================
// SHIFT REQUEST ACTIONS
// ============================================

export async function requestShiftSwap(
	input: SwapRequestInput,
): Promise<ServerActionResult<ShiftRequest>> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());
		const shiftRequestService = yield* _(ShiftRequestService);
		const dbService = yield* _(DatabaseService);

		yield* _(Effect.annotateCurrentSpan("user.id", session.user.id));

		// Get current employee
		const emp = yield* _(
			dbService.query("getCurrentEmployee", async () => {
				return await db.query.employee.findFirst({
					where: eq(employee.userId, session.user.id),
				});
			}),
		);

		if (!emp) {
			return yield* _(
				Effect.fail(
					new NotFoundError({
						message: "Employee profile not found",
						entityType: "employee",
						entityId: session.user.id,
					}),
				),
			);
		}

		const request = yield* _(
			shiftRequestService.requestSwap({
				shiftId: input.shiftId,
				requesterId: emp.id,
				targetEmployeeId: input.targetEmployeeId,
				reason: input.reason,
				reasonCategory: input.reasonCategory,
				notes: input.notes,
			}),
		);

		// TODO: Trigger notification to manager

		return request;
	}).pipe(Effect.withSpan("requestShiftSwap"), Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

export async function requestShiftPickup(
	shiftId: string,
	notes?: string,
): Promise<ServerActionResult<ShiftRequest>> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());
		const shiftRequestService = yield* _(ShiftRequestService);
		const dbService = yield* _(DatabaseService);

		yield* _(Effect.annotateCurrentSpan("user.id", session.user.id));

		// Get current employee
		const emp = yield* _(
			dbService.query("getCurrentEmployee", async () => {
				return await db.query.employee.findFirst({
					where: eq(employee.userId, session.user.id),
				});
			}),
		);

		if (!emp) {
			return yield* _(
				Effect.fail(
					new NotFoundError({
						message: "Employee profile not found",
						entityType: "employee",
						entityId: session.user.id,
					}),
				),
			);
		}

		const request = yield* _(
			shiftRequestService.requestPickup({
				shiftId,
				requesterId: emp.id,
				notes,
			}),
		);

		// TODO: Trigger notification to manager

		return request;
	}).pipe(Effect.withSpan("requestShiftPickup"), Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

export async function approveShiftRequest(
	requestId: string,
): Promise<ServerActionResult<ShiftRequest>> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());
		const shiftRequestService = yield* _(ShiftRequestService);
		const dbService = yield* _(DatabaseService);

		yield* _(Effect.annotateCurrentSpan("user.id", session.user.id));

		// Get current employee
		const emp = yield* _(
			dbService.query("getCurrentEmployee", async () => {
				return await db.query.employee.findFirst({
					where: eq(employee.userId, session.user.id),
				});
			}),
		);

		if (!emp) {
			return yield* _(
				Effect.fail(
					new NotFoundError({
						message: "Employee profile not found",
						entityType: "employee",
						entityId: session.user.id,
					}),
				),
			);
		}

		const request = yield* _(shiftRequestService.approveRequest(requestId, emp.id));

		// TODO: Trigger notification to requester

		return request;
	}).pipe(Effect.withSpan("approveShiftRequest"), Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

export async function rejectShiftRequest(
	requestId: string,
	reason?: string,
): Promise<ServerActionResult<ShiftRequest>> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());
		const shiftRequestService = yield* _(ShiftRequestService);
		const dbService = yield* _(DatabaseService);

		yield* _(Effect.annotateCurrentSpan("user.id", session.user.id));

		// Get current employee
		const emp = yield* _(
			dbService.query("getCurrentEmployee", async () => {
				return await db.query.employee.findFirst({
					where: eq(employee.userId, session.user.id),
				});
			}),
		);

		if (!emp) {
			return yield* _(
				Effect.fail(
					new NotFoundError({
						message: "Employee profile not found",
						entityType: "employee",
						entityId: session.user.id,
					}),
				),
			);
		}

		const request = yield* _(shiftRequestService.rejectRequest(requestId, emp.id, reason));

		// TODO: Trigger notification to requester

		return request;
	}).pipe(Effect.withSpan("rejectShiftRequest"), Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

export async function cancelShiftRequest(requestId: string): Promise<ServerActionResult<void>> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());
		const shiftRequestService = yield* _(ShiftRequestService);

		yield* _(Effect.annotateCurrentSpan("user.id", session.user.id));

		yield* _(shiftRequestService.cancelRequest(requestId, session.user.id));
	}).pipe(Effect.withSpan("cancelShiftRequest"), Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

export async function getPendingShiftRequests(): Promise<
	ServerActionResult<ShiftRequestWithRelations[]>
> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());
		const shiftRequestService = yield* _(ShiftRequestService);
		const dbService = yield* _(DatabaseService);

		yield* _(Effect.annotateCurrentSpan("user.id", session.user.id));

		// Get current employee
		const emp = yield* _(
			dbService.query("getCurrentEmployee", async () => {
				return await db.query.employee.findFirst({
					where: eq(employee.userId, session.user.id),
				});
			}),
		);

		if (!emp) {
			return yield* _(
				Effect.fail(
					new NotFoundError({
						message: "Employee profile not found",
						entityType: "employee",
						entityId: session.user.id,
					}),
				),
			);
		}

		// Verify manager/admin role
		if (emp.role !== "manager" && emp.role !== "admin") {
			return yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Only managers and admins can view pending requests",
						userId: session.user.id,
						resource: "shiftRequest",
						action: "read",
					}),
				),
			);
		}

		const requests = yield* _(shiftRequestService.getPendingRequests(emp.id));

		return requests;
	}).pipe(Effect.withSpan("getPendingShiftRequests"), Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

// ============================================
// OPEN SHIFTS (for employee marketplace)
// ============================================

export async function getOpenShifts(
	dateRange: DateRange,
): Promise<ServerActionResult<ShiftWithRelations[]>> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());
		const shiftService = yield* _(ShiftService);
		const dbService = yield* _(DatabaseService);

		yield* _(Effect.annotateCurrentSpan("user.id", session.user.id));

		// Get current employee
		const emp = yield* _(
			dbService.query("getCurrentEmployee", async () => {
				return await db.query.employee.findFirst({
					where: eq(employee.userId, session.user.id),
				});
			}),
		);

		if (!emp) {
			return yield* _(
				Effect.fail(
					new NotFoundError({
						message: "Employee profile not found",
						entityType: "employee",
						entityId: session.user.id,
					}),
				),
			);
		}

		// Get published open shifts (no employee assigned)
		const shifts = yield* _(
			shiftService.getShifts({
				organizationId: emp.organizationId,
				startDate: dateRange.start,
				endDate: dateRange.end,
				status: "published",
				includeOpenShifts: true,
			}),
		);

		// Filter to only include open shifts
		const openShifts = shifts.filter((s) => s.employeeId === null);

		return openShifts;
	}).pipe(Effect.withSpan("getOpenShifts"), Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

// ============================================
// LOCATION/SUBAREA ACTIONS
// ============================================

export interface LocationWithSubareas {
	id: string;
	name: string;
	subareas: Array<{
		id: string;
		name: string;
		isActive: boolean;
	}>;
}

export async function getLocationsWithSubareas(): Promise<
	ServerActionResult<LocationWithSubareas[]>
> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());
		const dbService = yield* _(DatabaseService);

		yield* _(Effect.annotateCurrentSpan("user.id", session.user.id));

		// Get current employee
		const emp = yield* _(
			dbService.query("getCurrentEmployee", async () => {
				return await db.query.employee.findFirst({
					where: eq(employee.userId, session.user.id),
				});
			}),
		);

		if (!emp) {
			return yield* _(
				Effect.fail(
					new NotFoundError({
						message: "Employee profile not found",
						entityType: "employee",
						entityId: session.user.id,
					}),
				),
			);
		}

		// Get all locations with their subareas
		const locations = yield* _(
			dbService.query("getLocationsWithSubareas", async () => {
				return await db.query.location.findMany({
					where: eq(location.organizationId, emp.organizationId),
					with: {
						subareas: {
							columns: {
								id: true,
								name: true,
								isActive: true,
							},
						},
					},
					orderBy: [desc(location.createdAt)],
				});
			}),
		);

		return locations.map((loc) => ({
			id: loc.id,
			name: loc.name,
			subareas: loc.subareas,
		}));
	}).pipe(Effect.withSpan("getLocationsWithSubareas"), Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}
