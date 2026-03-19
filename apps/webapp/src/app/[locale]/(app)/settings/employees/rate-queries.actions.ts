"use server";

import { and, desc, eq, gte, isNull, lte, or } from "drizzle-orm";
import { Effect } from "effect";
import { employeeRateHistory } from "@/db/schema";
import { runServerActionSafe, type ServerActionResult } from "@/lib/effect/result";
import { AppLayer } from "@/lib/effect/runtime";
import { createLogger } from "@/lib/logger";
import type { RateHistoryEntry } from "./rate-action-types";
import {
	ensureSettingsActorCanAccessEmployeeTarget,
	getEmployeeSettingsActorContext,
	getTargetEmployee,
	runTracedEmployeeAction,
} from "./employee-action-utils";

const logger = createLogger("RateHistoryActions");

export async function getEmployeeRateHistoryAction(
	employeeId: string,
): Promise<ServerActionResult<RateHistoryEntry[]>> {
	return runTracedEmployeeAction({
		name: "getEmployeeRateHistory",
		attributes: {
			"employee.id": employeeId,
		},
		logError: (error) => {
			logger.error({ error, employeeId }, "Failed to get rate history");
		},
			execute: (span) =>
				Effect.gen(function* (_) {
					const actor = yield* _(getEmployeeSettingsActorContext());
					const { dbService } = actor;
					const targetEmployee = yield* _(getTargetEmployee(employeeId));

					yield* _(
						ensureSettingsActorCanAccessEmployeeTarget(actor, targetEmployee, {
							message: "You do not have access to this employee's rates",
							resource: "rate_history",
							action: "read",
					}),
				);

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
				return history as RateHistoryEntry[];
			}),
	});
}

export async function getRateAtDateAction(
	employeeId: string,
	date: Date,
): Promise<ServerActionResult<RateHistoryEntry | null>> {
	return runTracedEmployeeAction({
		name: "getRateAtDate",
		attributes: {
			"employee.id": employeeId,
			date: date.toISOString(),
		},
		logError: (error) => {
			logger.error({ error, employeeId, date }, "Failed to get rate at date");
		},
			execute: () =>
				Effect.gen(function* (_) {
					const actor = yield* _(getEmployeeSettingsActorContext());
					const { dbService } = actor;
					const targetEmployee = yield* _(getTargetEmployee(employeeId));

					yield* _(
						ensureSettingsActorCanAccessEmployeeTarget(actor, targetEmployee, {
							message: "You do not have access to this employee's rates",
							resource: "rate_history",
							action: "read",
					}),
				);

				const rateEntry = yield* _(
					dbService.query("getRateAtDate", async () => {
						return await dbService.db.query.employeeRateHistory.findFirst({
							where: and(
								eq(employeeRateHistory.employeeId, employeeId),
								lte(employeeRateHistory.effectiveFrom, date),
								or(
									isNull(employeeRateHistory.effectiveTo),
									gte(employeeRateHistory.effectiveTo, date),
								),
							),
							with: {
								creator: true,
							},
							orderBy: (rh, { desc }) => [desc(rh.effectiveFrom)],
						});
					}),
				);

				return (rateEntry as RateHistoryEntry) || null;
			}),
	});
}
