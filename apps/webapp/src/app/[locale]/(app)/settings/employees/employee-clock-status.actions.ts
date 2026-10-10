"use server";

import { and, desc, eq, inArray } from "drizzle-orm";
import { Effect } from "effect";
import type { EmployeeClockStatus } from "@/components/user-avatar";
import { employee, timeEntry } from "@/db/schema";
import { dateFromInstant } from "@/lib/datetime/temporal-core";
import {
	runServerActionSafe,
	type ServerActionResult,
} from "@/lib/effect/result";
import { type ClockPresence, readClockPresence } from "@/lib/time-tracking/clock-presence";
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
	/** Only `on-break`: where the break in progress started (#861), and its zone. */
	breakStartedAt?: string;
	breakStartedZone?: string | null;
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

export async function getEmployeeClockStatuses(
	employeeIds: string[],
): Promise<ServerActionResult<EmployeeClockPresenceMap>> {
	const normalizedEmployeeIds = normalizeEmployeeIds(employeeIds);

	const effect = Effect.gen(function* () {
		if (normalizedEmployeeIds.length === 0) {
			return {} satisfies EmployeeClockPresenceMap;
		}

		const actor = yield* getEmployeeSettingsActorContext({
			queryName: "getEmployeeClockStatuses",
		});
		const organizationEmployeeRows = yield* actor.dbService.query(
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
		);
		const organizationEmployeeIds = new Set(organizationEmployeeRows.map((row) => row.id));
		const managedEmployeeIds = yield* getManagedEmployeeIdsForSettingsActor(actor);
		const accessibleEmployeeIds =
			managedEmployeeIds === null
				? normalizedEmployeeIds.filter((employeeId) => organizationEmployeeIds.has(employeeId))
				: normalizedEmployeeIds.filter(
						(employeeId) =>
							organizationEmployeeIds.has(employeeId) && managedEmployeeIds.has(employeeId),
					);

		if (accessibleEmployeeIds.length === 0) {
			return {} satisfies EmployeeClockPresenceMap;
		}

		// Live work, and a break in progress on it (#861).
		const activeRows: Array<Pick<ClockPresence, "employeeId" | "breakSince" | "breakZone">> =
			yield* actor.dbService.query("getEmployeeClockStatuses:activeWorkPeriods", () =>
				readClockPresence(actor.dbService.db, {
					organizationId: actor.organizationId,
					employeeIds: accessibleEmployeeIds,
				}),
			);
		const activityRows = yield* actor.dbService.query(
			"getEmployeeClockStatuses:activity",
			async () => {
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
					.orderBy(timeEntry.employeeId, desc(timeEntry.timestamp), desc(timeEntry.id));
			},
		);

		const accessibleEmployeeIdSet = new Set(accessibleEmployeeIds);
		const liveWorkByEmployeeId = new Map(
			activeRows.flatMap((row) =>
				accessibleEmployeeIdSet.has(row.employeeId) ? [[row.employeeId, row] as const] : [],
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
				const live = liveWorkByEmployeeId.get(employeeId);
				const breakSince = live?.breakSince ?? null;
				const presence: EmployeeClockPresence = {
					status: !live ? "clocked-out" : breakSince ? "on-break" : "clocked-in",
					lastActivityAt: activity?.timestamp.toISOString() ?? null,
					lastActivityUtcOffsetMinutes: activity?.utcOffsetMinutes ?? null,
					...(breakSince
						? {
								breakStartedAt: dateFromInstant(breakSince).toISOString(),
								breakStartedZone: live?.breakZone ?? null,
							}
						: {}),
				};
				return [employeeId, presence];
			}),
		) satisfies EmployeeClockPresenceMap;
	});

	return runServerActionSafe(effect);
}
