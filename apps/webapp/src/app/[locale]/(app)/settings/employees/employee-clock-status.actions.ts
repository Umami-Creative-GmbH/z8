"use server";

import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { Effect } from "effect";
import type { EmployeeClockStatus } from "@/components/user-avatar";
import { employee, timeEntry, workPeriod } from "@/db/schema";
import { type AnyAppError, DatabaseError } from "@/lib/effect/errors";
import {
	runServerActionSafe,
	type ServerActionResult,
} from "@/lib/effect/result";
import { AppLayer } from "@/lib/effect/runtime";
import {
	getEmployeeSettingsActorContext,
	getManagedEmployeeIdsForSettingsActor,
} from "./employee-action-utils";

export type EmployeeClockStatusMap = Record<string, EmployeeClockStatus>;
export interface EmployeeClockActivity {
	lastActivityAt: string;
	lastActivityUtcOffsetMinutes: number;
}
export interface EmployeeClockPresence {
	status: EmployeeClockStatus;
	lastActivityAt: string | null;
	lastActivityUtcOffsetMinutes: number | null;
}
export type EmployeeClockPresenceMap = Record<string, EmployeeClockPresence>;

function normalizeEmployeeIds(employeeIds: string[]) {
	return Array.from(
		new Set(
			employeeIds.flatMap((id) => {
				const trimmed = id.trim();
				return trimmed ? [trimmed] : [];
			}),
		),
	).toSorted();
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
): Promise<ServerActionResult<EmployeeClockPresenceMap>> {
	const normalizedEmployeeIds = normalizeEmployeeIds(employeeIds);

	const effect = Effect.gen(function* (_) {
		if (normalizedEmployeeIds.length === 0) {
			return {} satisfies EmployeeClockPresenceMap;
		}

		const actor = yield* _(
			getEmployeeSettingsActorContext({
				queryName: "getEmployeeClockStatuses",
			}),
		);
		const organizationEmployeeRows = yield* _(
			resolveQueryEffect(
				"getEmployeeClockStatuses:organizationEmployees",
				actor.dbService.query(
					"getEmployeeClockStatuses:organizationEmployees",
					async () => {
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
					},
				),
			),
		);
		const organizationEmployeeIds = new Set(
			organizationEmployeeRows.map((row) => row.id),
		);
		const managedEmployeeIds = yield* _(
			getManagedEmployeeIdsForSettingsActor(actor),
		);
		const accessibleEmployeeIds =
			managedEmployeeIds === null
				? normalizedEmployeeIds.filter((employeeId) =>
						organizationEmployeeIds.has(employeeId),
					)
				: normalizedEmployeeIds.filter(
						(employeeId) =>
							organizationEmployeeIds.has(employeeId) &&
							managedEmployeeIds.has(employeeId),
					);

		if (accessibleEmployeeIds.length === 0) {
			return {} satisfies EmployeeClockPresenceMap;
		}

		const activeRows = yield* _(
			resolveQueryEffect(
				"getEmployeeClockStatuses:activeWorkPeriods",
				actor.dbService.query(
					"getEmployeeClockStatuses:activeWorkPeriods",
					async () => {
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
					},
				),
			),
		);
		const activityRows = yield* _(
			resolveQueryEffect(
				"getEmployeeClockStatuses:activity",
				actor.dbService.query("getEmployeeClockStatuses:activity", async () => {
					return await actor.dbService.db
						.selectDistinctOn([timeEntry.employeeId], {
							employeeId: timeEntry.employeeId,
							timestamp: timeEntry.timestamp,
							utcOffsetMinutes: timeEntry.utcOffsetMinutes,
						})
						.from(timeEntry)
						.where(
							and(
								eq(timeEntry.organizationId, actor.organizationId),
								inArray(timeEntry.employeeId, accessibleEmployeeIds),
								inArray(timeEntry.type, ["clock_in", "clock_out"]),
								eq(timeEntry.isSuperseded, false),
							),
						)
						.orderBy(
							timeEntry.employeeId,
							desc(timeEntry.timestamp),
							desc(timeEntry.id),
						);
				}),
			),
		);

		const accessibleEmployeeIdSet = new Set(accessibleEmployeeIds);
		const clockedInEmployeeIds = new Set(
			activeRows.flatMap((row) =>
				accessibleEmployeeIdSet.has(row.employeeId) ? [row.employeeId] : [],
			),
		);
		const latestActivityByEmployeeId = new Map<
			string,
			{ timestamp: Date; utcOffsetMinutes: number }
		>();
		for (const row of activityRows) {
			if (
				accessibleEmployeeIdSet.has(row.employeeId) &&
				!latestActivityByEmployeeId.has(row.employeeId)
			) {
				latestActivityByEmployeeId.set(row.employeeId, row);
			}
		}

		return Object.fromEntries(
			accessibleEmployeeIds.map((employeeId) => {
				const activity = latestActivityByEmployeeId.get(employeeId);
				return [
					employeeId,
					{
						status: clockedInEmployeeIds.has(employeeId)
							? "clocked-in"
							: "clocked-out",
						lastActivityAt: activity?.timestamp.toISOString() ?? null,
						lastActivityUtcOffsetMinutes: activity?.utcOffsetMinutes ?? null,
					},
				];
			}),
		) satisfies EmployeeClockPresenceMap;
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}
