"use server";

import { SpanStatusCode, trace } from "@opentelemetry/api";
import { revalidateTag } from "next/cache";
import { and, desc, eq, gte, isNull, lte, or } from "drizzle-orm";
import { Effect } from "effect";
import { employee, employeeRateHistory } from "@/db/schema";

import { currentTimestamp } from "@/lib/datetime/drizzle-adapter";
import {
	type AnyAppError,
	AuthorizationError,
	NotFoundError,
	ValidationError,
} from "@/lib/effect/errors";
import { runServerActionSafe, type ServerActionResult } from "@/lib/effect/result";
import { AppLayer } from "@/lib/effect/runtime";
import { AuthService } from "@/lib/effect/services/auth.service";
import { DatabaseService } from "@/lib/effect/services/database.service";
import { CACHE_TAGS } from "@/lib/cache/tags";
import { createLogger } from "@/lib/logger";
import { type CreateRateHistory, createRateHistorySchema } from "@/lib/validations/employee";

const logger = createLogger("RateHistoryActions");

// Type for rate history entry
export type RateHistoryEntry = typeof employeeRateHistory.$inferSelect & {
	creator?: {
		id: string;
		name: string;
		email: string;
	};
};

// =============================================================================
// Rate History Actions
// =============================================================================

/**
 * Get rate history for an employee
 * Returns all rate history entries ordered by effectiveFrom descending
 */
export async function getEmployeeRateHistory(
	employeeId: string,
): Promise<ServerActionResult<RateHistoryEntry[]>> {
	const tracer = trace.getTracer("rate-history");

	const effect = tracer.startActiveSpan(
		"getEmployeeRateHistory",
		{
			attributes: {
				"employee.id": employeeId,
			},
		},
		(span) => {
			return Effect.gen(function* (_) {
				const authService = yield* _(AuthService);
				const session = yield* _(authService.getSession());
				const dbService = yield* _(DatabaseService);

				// Get current employee
				const currentEmployee = yield* _(
					dbService.query("getCurrentEmployee", async () => {
						return await dbService.db.query.employee.findFirst({
							where: eq(employee.userId, session.user.id),
						});
					}),
					Effect.flatMap((emp) =>
						emp
							? Effect.succeed(emp)
							: Effect.fail(
									new NotFoundError({
										message: "Employee profile not found",
										entityType: "employee",
									}),
								),
					),
				);

				// Get target employee
				const targetEmployee = yield* _(
					dbService.query("getTargetEmployee", async () => {
						return await dbService.db.query.employee.findFirst({
							where: eq(employee.id, employeeId),
						});
					}),
					Effect.flatMap((emp) =>
						emp
							? Effect.succeed(emp)
							: Effect.fail(
									new NotFoundError({
										message: "Employee not found",
										entityType: "employee",
										entityId: employeeId,
									}),
								),
					),
				);

				// Verify same organization
				if (targetEmployee.organizationId !== currentEmployee.organizationId) {
					yield* _(
						Effect.fail(
							new AuthorizationError({
								message: "Cannot access employee from different organization",
								userId: currentEmployee.id,
								resource: "rate_history",
								action: "read",
							}),
						),
					);
				}

				// Get rate history
				const history = yield* _(
					dbService.query("getRateHistory", async () => {
						return await dbService.db.query.employeeRateHistory.findMany({
							where: eq(employeeRateHistory.employeeId, employeeId),
							with: {
								creator: true,
							},
							orderBy: (rh, { desc }) => [desc(rh.effectiveFrom)],
						});
					}),
				);

				span.setAttribute("history.count", history.length);
				span.setStatus({ code: SpanStatusCode.OK });
				return history as RateHistoryEntry[];
			}).pipe(
				Effect.catchAll((error) =>
					Effect.gen(function* (_) {
						span.recordException(error as Error);
						span.setStatus({
							code: SpanStatusCode.ERROR,
							message: String(error),
						});
						logger.error({ error, employeeId }, "Failed to get rate history");
						return yield* _(Effect.fail(error as AnyAppError));
					}),
				),
				Effect.onExit(() => Effect.sync(() => span.end())),
				Effect.provide(AppLayer),
			);
		},
	);

	return runServerActionSafe(effect);
}

/**
 * Create a new rate history entry
 * Requires admin role
 */
export async function createRateHistoryEntry(
	employeeId: string,
	data: CreateRateHistory,
): Promise<ServerActionResult<void>> {
	const tracer = trace.getTracer("rate-history");

	const effect = tracer.startActiveSpan(
		"createRateHistoryEntry",
		{
			attributes: {
				"employee.id": employeeId,
			},
		},
		(span) => {
			return Effect.gen(function* (_) {
				const authService = yield* _(AuthService);
				const session = yield* _(authService.getSession());
				const dbService = yield* _(DatabaseService);

				// Get current employee and verify admin role
				const currentEmployee = yield* _(
					dbService.query("getCurrentEmployee", async () => {
						return await dbService.db.query.employee.findFirst({
							where: eq(employee.userId, session.user.id),
						});
					}),
					Effect.flatMap((emp) =>
						emp
							? Effect.succeed(emp)
							: Effect.fail(
									new NotFoundError({
										message: "Employee profile not found",
										entityType: "employee",
									}),
								),
					),
				);

				if (currentEmployee.role !== "admin") {
					yield* _(
						Effect.fail(
							new AuthorizationError({
								message: "Only admins can create rate history entries",
								userId: currentEmployee.id,
								resource: "rate_history",
								action: "create",
							}),
						),
					);
				}

				// Validate data
				const validationResult = createRateHistorySchema.safeParse(data);
				if (!validationResult.success) {
					return yield* _(
						Effect.fail(
							new ValidationError({
								message: validationResult.error?.issues?.[0]?.message || "Invalid input",
								field: validationResult.error?.issues?.[0]?.path?.join(".") || "data",
							}),
						),
					);
				}

				const validatedData = validationResult.data;

				// Get target employee
				const targetEmployee = yield* _(
					dbService.query("getTargetEmployee", async () => {
						return await dbService.db.query.employee.findFirst({
							where: eq(employee.id, employeeId),
						});
					}),
					Effect.flatMap((emp) =>
						emp
							? Effect.succeed(emp)
							: Effect.fail(
									new NotFoundError({
										message: "Employee not found",
										entityType: "employee",
										entityId: employeeId,
									}),
								),
					),
				);

				// Verify same organization
				if (targetEmployee.organizationId !== currentEmployee.organizationId) {
					yield* _(
						Effect.fail(
							new AuthorizationError({
								message: "Cannot access employee from different organization",
								userId: currentEmployee.id,
								resource: "rate_history",
								action: "create",
							}),
						),
					);
				}

				// Verify employee is hourly
				if (targetEmployee.contractType !== "hourly") {
					yield* _(
						Effect.fail(
							new ValidationError({
								message: "Rate history can only be created for hourly employees",
								field: "contractType",
							}),
						),
					);
				}

				const newRate = parseFloat(validatedData.hourlyRate);

				// Close the current active rate history entry
				yield* _(
					dbService.query("closeActiveRateHistory", async () => {
						await dbService.db
							.update(employeeRateHistory)
							.set({ effectiveTo: validatedData.effectiveFrom })
							.where(
								and(
									eq(employeeRateHistory.employeeId, employeeId),
									isNull(employeeRateHistory.effectiveTo),
								),
							);
					}),
				);

				// Create new rate history entry
				yield* _(
					dbService.query("createRateHistoryEntry", async () => {
						await dbService.db.insert(employeeRateHistory).values({
							employeeId: employeeId,
							organizationId: targetEmployee.organizationId,
							hourlyRate: newRate.toString(),
							currency: validatedData.currency || "EUR",
							effectiveFrom: validatedData.effectiveFrom,
							effectiveTo: null,
							reason: validatedData.reason || null,
							createdBy: session.user.id,
						});
					}),
				);

				// Update current hourly rate on employee
				yield* _(
					dbService.query("updateEmployeeRate", async () => {
						await dbService.db
							.update(employee)
							.set({
								currentHourlyRate: newRate.toString(),
								updatedAt: currentTimestamp(),
							})
							.where(eq(employee.id, employeeId));
					}),
				);

				logger.info(
					{
						employeeId,
						newRate,
						effectiveFrom: validatedData.effectiveFrom,
					},
					"Rate history entry created",
				);

				// Invalidate caches
				revalidateTag(CACHE_TAGS.EMPLOYEES(targetEmployee.organizationId), "max");

				span.setStatus({ code: SpanStatusCode.OK });
			}).pipe(
				Effect.catchAll((error) =>
					Effect.gen(function* (_) {
						span.recordException(error as Error);
						span.setStatus({
							code: SpanStatusCode.ERROR,
							message: String(error),
						});
						logger.error({ error, employeeId }, "Failed to create rate history entry");
						return yield* _(Effect.fail(error as AnyAppError));
					}),
				),
				Effect.onExit(() => Effect.sync(() => span.end())),
				Effect.provide(AppLayer),
			);
		},
	);

	return runServerActionSafe(effect);
}

/**
 * Get the rate that was effective at a specific date
 */
export async function getRateAtDate(
	employeeId: string,
	date: Date,
): Promise<ServerActionResult<RateHistoryEntry | null>> {
	const tracer = trace.getTracer("rate-history");

	const effect = tracer.startActiveSpan(
		"getRateAtDate",
		{
			attributes: {
				"employee.id": employeeId,
				"date": date.toISOString(),
			},
		},
		(span) => {
			return Effect.gen(function* (_) {
				const authService = yield* _(AuthService);
				const session = yield* _(authService.getSession());
				const dbService = yield* _(DatabaseService);

				// Get current employee
				const currentEmployee = yield* _(
					dbService.query("getCurrentEmployee", async () => {
						return await dbService.db.query.employee.findFirst({
							where: eq(employee.userId, session.user.id),
						});
					}),
					Effect.flatMap((emp) =>
						emp
							? Effect.succeed(emp)
							: Effect.fail(
									new NotFoundError({
										message: "Employee profile not found",
										entityType: "employee",
									}),
								),
					),
				);

				// Get target employee
				const targetEmployee = yield* _(
					dbService.query("getTargetEmployee", async () => {
						return await dbService.db.query.employee.findFirst({
							where: eq(employee.id, employeeId),
						});
					}),
					Effect.flatMap((emp) =>
						emp
							? Effect.succeed(emp)
							: Effect.fail(
									new NotFoundError({
										message: "Employee not found",
										entityType: "employee",
										entityId: employeeId,
									}),
								),
					),
				);

				// Verify same organization
				if (targetEmployee.organizationId !== currentEmployee.organizationId) {
					yield* _(
						Effect.fail(
							new AuthorizationError({
								message: "Cannot access employee from different organization",
								userId: currentEmployee.id,
								resource: "rate_history",
								action: "read",
							}),
						),
					);
				}

				// Find the rate effective at the given date
				// Rate is effective if: effectiveFrom <= date AND (effectiveTo > date OR effectiveTo is null)
				const rateEntry = yield* _(
					dbService.query("getRateAtDate", async () => {
						return await dbService.db.query.employeeRateHistory.findFirst({
							where: and(
								eq(employeeRateHistory.employeeId, employeeId),
								lte(employeeRateHistory.effectiveFrom, date),
								or(isNull(employeeRateHistory.effectiveTo), gte(employeeRateHistory.effectiveTo, date)),
							),
							with: {
								creator: true,
							},
							orderBy: (rh, { desc }) => [desc(rh.effectiveFrom)],
						});
					}),
				);

				span.setStatus({ code: SpanStatusCode.OK });
				return (rateEntry as RateHistoryEntry) || null;
			}).pipe(
				Effect.catchAll((error) =>
					Effect.gen(function* (_) {
						span.recordException(error as Error);
						span.setStatus({
							code: SpanStatusCode.ERROR,
							message: String(error),
						});
						logger.error({ error, employeeId, date }, "Failed to get rate at date");
						return yield* _(Effect.fail(error as AnyAppError));
					}),
				),
				Effect.onExit(() => Effect.sync(() => span.end())),
				Effect.provide(AppLayer),
			);
		},
	);

	return runServerActionSafe(effect);
}
