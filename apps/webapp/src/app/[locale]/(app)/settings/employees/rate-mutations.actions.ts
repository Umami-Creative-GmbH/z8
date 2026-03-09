"use server";

import { and, eq, isNull } from "drizzle-orm";
import { Effect } from "effect";
import { employee, employeeRateHistory } from "@/db/schema";
import { currentTimestamp } from "@/lib/datetime/drizzle-adapter";
import { ValidationError } from "@/lib/effect/errors";
import type { ServerActionResult } from "@/lib/effect/result";
import { createLogger } from "@/lib/logger";
import { type CreateRateHistory, createRateHistorySchema } from "@/lib/validations/employee";
import {
	ensureSameOrganization,
	getEmployeeContext,
	getTargetEmployee,
	parseHourlyRate,
	requireAdmin,
	revalidateEmployeesCache,
	runTracedEmployeeAction,
	validateInput,
} from "./employee-action-utils";

const logger = createLogger("RateHistoryActions");

export async function createRateHistoryEntryAction(
	employeeId: string,
	data: CreateRateHistory,
): Promise<ServerActionResult<void>> {
	return runTracedEmployeeAction({
		name: "createRateHistoryEntry",
		attributes: {
			"employee.id": employeeId,
		},
		logError: (error) => {
			logger.error({ error, employeeId }, "Failed to create rate history entry");
		},
		execute: () =>
			Effect.gen(function* (_) {
				const { session, dbService, currentEmployee } = yield* _(getEmployeeContext());

				yield* _(
					requireAdmin(currentEmployee, {
						message: "Only admins can create rate history entries",
						resource: "rate_history",
						action: "create",
					}),
				);

				const validatedData = yield* _(validateInput(createRateHistorySchema, data));
				const targetEmployee = yield* _(getTargetEmployee(employeeId));

				yield* _(
					ensureSameOrganization(currentEmployee, targetEmployee, "rate_history", "create"),
				);

				if (targetEmployee.contractType !== "hourly") {
					return yield* _(
						Effect.fail(
							new ValidationError({
								message: "Rate history can only be created for hourly employees",
								field: "contractType",
							}),
						),
					);
				}

				const newRate = parseHourlyRate(validatedData.hourlyRate);
				if (newRate === null) {
					return yield* _(
						Effect.fail(
							new ValidationError({
								message: "Invalid hourly rate",
								field: "hourlyRate",
							}),
						),
					);
				}

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

				yield* _(
					dbService.query("createRateHistoryEntry", async () => {
						await dbService.db.insert(employeeRateHistory).values({
							employeeId,
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

				revalidateEmployeesCache(targetEmployee.organizationId);
			}),
	});
}
