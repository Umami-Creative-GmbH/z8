"use server";

import { and, eq, inArray, isNull } from "drizzle-orm";
import { Effect } from "effect";
import type { EmployeeClockStatus } from "@/components/user-avatar";
import { employee, workPeriod } from "@/db/schema";
import { type AnyAppError, DatabaseError } from "@/lib/effect/errors";
import { runServerActionSafe, type ServerActionResult } from "@/lib/effect/result";
import { AppLayer } from "@/lib/effect/runtime";
import {
	getEmployeeSettingsActorContext,
	getManagedEmployeeIdsForSettingsActor,
} from "./employee-action-utils";

export type EmployeeClockStatusMap = Record<string, EmployeeClockStatus>;

function normalizeEmployeeIds(employeeIds: string[]) {
	return [...new Set(employeeIds.map((id) => id.trim()).filter(Boolean))].sort();
}

function resolveQueryEffect<T>(
	operation: string,
	value: Effect.Effect<T, AnyAppError, unknown> | Promise<T> | T,
): Effect.Effect<T, AnyAppError, unknown> {
	if (Effect.isEffect(value)) {
		return value as Effect.Effect<T, AnyAppError, unknown>;
	}

	if (value instanceof Promise) {
		return Effect.tryPromise({
			try: () => value,
			catch: (error) =>
				new DatabaseError({
					message: "Failed to load employee clock statuses",
					operation,
					cause: error,
				}),
		});
	}

	return Effect.succeed(value);
}

export async function getEmployeeClockStatuses(
	employeeIds: string[],
): Promise<ServerActionResult<EmployeeClockStatusMap>> {
	const normalizedEmployeeIds = normalizeEmployeeIds(employeeIds);

	const effect = Effect.gen(function* (_) {
		if (normalizedEmployeeIds.length === 0) {
			return {} satisfies EmployeeClockStatusMap;
		}

		const actor = yield* _(
			getEmployeeSettingsActorContext({ queryName: "getEmployeeClockStatuses" }),
		);
		const organizationEmployeeRows = yield* _(
			resolveQueryEffect(
				"getEmployeeClockStatuses:organizationEmployees",
				actor.dbService.query("getEmployeeClockStatuses:organizationEmployees", async () => {
					return await actor.dbService.db
						.select({ id: employee.id })
						.from(employee)
						.where(
							and(
								eq(employee.organizationId, actor.organizationId),
								eq(employee.isActive, true),
								inArray(employee.id, normalizedEmployeeIds),
							),
						);
				}),
			),
		);
		const organizationEmployeeIds = new Set(organizationEmployeeRows.map((row) => row.id));
		const managedEmployeeIds = yield* _(getManagedEmployeeIdsForSettingsActor(actor));
		const accessibleEmployeeIds =
			managedEmployeeIds === null
				? normalizedEmployeeIds.filter((employeeId) => organizationEmployeeIds.has(employeeId))
				: normalizedEmployeeIds.filter(
						(employeeId) =>
							organizationEmployeeIds.has(employeeId) && managedEmployeeIds.has(employeeId),
					);

		if (accessibleEmployeeIds.length === 0) {
			return {} satisfies EmployeeClockStatusMap;
		}

		const activeRows = yield* _(
			resolveQueryEffect(
				"getEmployeeClockStatuses:activeWorkPeriods",
				actor.dbService.query("getEmployeeClockStatuses:activeWorkPeriods", async () => {
					return await actor.dbService.db
						.select({ employeeId: workPeriod.employeeId })
						.from(workPeriod)
						.where(
							and(
								eq(workPeriod.organizationId, actor.organizationId),
								inArray(workPeriod.employeeId, accessibleEmployeeIds),
								eq(workPeriod.isActive, true),
								isNull(workPeriod.clockOutId),
								isNull(workPeriod.endTime),
							),
						);
				}),
			),
		);

		const accessibleEmployeeIdSet = new Set(accessibleEmployeeIds);
		const clockedInEmployeeIds = new Set(
			activeRows
				.map((row) => row.employeeId)
				.filter((employeeId) => accessibleEmployeeIdSet.has(employeeId)),
		);

		return Object.fromEntries(
			accessibleEmployeeIds.map((employeeId) => [
				employeeId,
				clockedInEmployeeIds.has(employeeId) ? "clocked-in" : "clocked-out",
			]),
		) satisfies EmployeeClockStatusMap;
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}
