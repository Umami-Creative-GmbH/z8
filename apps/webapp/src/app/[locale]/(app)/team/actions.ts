"use server";

import { and, eq, inArray } from "drizzle-orm";
import { Effect } from "effect";
import { unstable_cache } from "next/cache";
import { db } from "@/db";
import { employee, employeeManagers } from "@/db/schema";
import { getRequestSession } from "@/lib/auth/request-session";
import { CACHE_TAGS } from "@/lib/cache/tags";
import { AuthorizationError, NotFoundError } from "@/lib/effect/errors";
import { runServerActionSafe, type ServerActionResult } from "@/lib/effect/result";
import type { DatabaseClient } from "@/lib/effect/services/database.service";
import { DatabaseService } from "@/lib/effect/services/database.service";
import { onCurrentRoster } from "@/lib/employee-lifecycle/current-roster";
import { formerEmployeesAmong } from "@/lib/employee-lifecycle/current-roster-among";
import { formerMark } from "@/lib/employee-lifecycle/former-since";
import { getEmployeeWorkBalances } from "@/lib/work-balance/service";
import {
	buildVisibleManagedEmployees,
	type CurrentTeamEmployee,
	canUseTeamPage,
	type ManagedEmployee,
	type ManagedEmployeeRecord,
} from "./team-members-data";

export type { CurrentTeamEmployee, ManagedEmployee } from "./team-members-data";

// =============================================================================
// Server Actions
// =============================================================================

/**
 * Get current employee from session (reuse pattern from absences)
 */
export async function getCurrentEmployee(): Promise<CurrentTeamEmployee | null> {
	const session = await getRequestSession();
	if (!session?.user) {
		return null;
	}

	const activeOrgId = session.session?.activeOrganizationId;

	if (activeOrgId) {
		const emp = await db.query.employee.findFirst({
			where: (e, { and, eq }) => and(eq(e.userId, session.user.id), onCurrentRoster(activeOrgId, e)),
			with: {
				user: true,
				team: true,
			},
		});
		if (emp) return emp as CurrentTeamEmployee;
	}

	return null;
}

/**
 * Which of the given employees of the organization are former employees
 * (#1438), as entries of id and the date each left (null when not recorded,
 * #1439). Entries rather than a map, so they survive the calendar cache.
 */
async function formerEmployeesAmongEntries(
	database: DatabaseClient,
	organizationId: string,
	employeeIds: string[],
): Promise<Array<[string, string | null]>> {
	return [...(await formerEmployeesAmong(database, organizationId, employeeIds))];
}

function getCachedCalendarManagedEmployeeRecords(
	organizationId: string,
	managerId: string,
	fresh = false,
) {
	const load = async () => {
		// A calendar is a view of the past: former reports stay, marked (#1438).
		const records = await db.query.employeeManagers.findMany({
			where: and(
				eq(employeeManagers.managerId, managerId),
				inArray(
					employeeManagers.employeeId,
					db
						.select({ id: employee.id })
						.from(employee)
						.where(eq(employee.organizationId, organizationId)),
				),
			),
			with: {
				employee: {
					with: {
						user: true,
						team: true,
					},
				},
			},
		});
		const formerSince = await formerEmployeesAmongEntries(
			db,
			organizationId,
			records.map((record) => record.employeeId),
		);
		return { records, formerSince };
	};
	if (fresh) return load();
	return unstable_cache(load, ["calendar-managed-employees", organizationId, managerId], {
		revalidate: 5 * 60,
		tags: [CACHE_TAGS.EMPLOYEES(organizationId)],
	})();
}

type CalendarManagedEmployeesOptions = { fresh?: boolean };

/**
 * Lightweight employee list for the calendar selector.
 * Avoids team-page balance refresh work and caches the manager relationship lookup.
 * Former reports stay selectable, marked, so that their past stays readable.
 */
export async function getCalendarManagedEmployees(
	options?: CalendarManagedEmployeesOptions,
): Promise<
	ServerActionResult<ManagedEmployee[]>
> {
	const effect = Effect.gen(function* () {
		const session = yield* Effect.promise(() => getRequestSession());
		if (!session?.user) {
			return yield* Effect.fail(
				new NotFoundError({
					message: "Employee profile not found",
					entityType: "employee",
				}),
			);
		}

		const activeOrgId = session.session?.activeOrganizationId;
		const currentEmp = activeOrgId
			? yield* Effect.promise(async () => {
					return await db.query.employee.findFirst({
						where: (e, { and, eq }) =>
							and(eq(e.userId, session.user.id), onCurrentRoster(activeOrgId, e)),
						with: { user: true, team: true },
					});
				})
			: null;

		if (!currentEmp) {
			return yield* Effect.fail(
				new NotFoundError({
					message: "Employee profile not found",
					entityType: "employee",
				}),
			);
		}

		if (!canUseTeamPage(currentEmp.role)) {
			return yield* Effect.fail(
				new AuthorizationError({
					message: "Not authorized",
					resource: "calendar_employees",
					action: "read",
				}),
			);
		}

		const { records, formerSince } = yield* Effect.promise(() =>
			getCachedCalendarManagedEmployeeRecords(currentEmp.organizationId, currentEmp.id, options?.fresh === true),
		);
		const typedRecords = records as unknown as ManagedEmployeeRecord[];
		const formerSinceById = new Map(formerSince);
		const byId = new Map<string, ManagedEmployee>();

		for (const record of typedRecords) {
			const recordEmployee = record.employee;
			if (recordEmployee.organizationId !== currentEmp.organizationId) continue;
			if (recordEmployee.id === currentEmp.id) continue;

			byId.set(recordEmployee.id, {
				id: recordEmployee.id,
				userId: recordEmployee.userId,
				firstName: recordEmployee.user.firstName,
				lastName: recordEmployee.user.lastName,
				pronouns: recordEmployee.pronouns,
				position: recordEmployee.position,
				role: recordEmployee.role,
				isActive: recordEmployee.isActive,
				...formerMark(formerSinceById, recordEmployee.id),
				isPrimaryManager: record.isPrimary,
				isCurrentUser: false,
				timeBalance: null,
				user: {
					id: recordEmployee.user.id,
					firstName: recordEmployee.user.firstName,
					lastName: recordEmployee.user.lastName,
					name: recordEmployee.user.name,
					email: recordEmployee.user.email,
					image: recordEmployee.user.image,
				},
				team: recordEmployee.team
					? { id: recordEmployee.team.id, name: recordEmployee.team.name }
					: null,
			});
		}

		return Array.from(byId.values()).toSorted((a, b) =>
			(a.user.name || a.user.email).localeCompare(b.user.name || b.user.email),
		);
	});

	return runServerActionSafe(effect);
}

type ManagedEmployeesOptions = {
	/** Also list reports who are former employees, marked. */
	includeFormer?: boolean;
};

/**
 * Get all employees managed by the current user
 * Uses the employeeManagers junction table to find direct reports.
 * Only reports on the current roster, unless `includeFormer` asks for former
 * employees too; those come back marked (#1438).
 */
export async function getManagedEmployees(
	options?: ManagedEmployeesOptions,
): Promise<ServerActionResult<ManagedEmployee[]>> {
	const includeFormer = options?.includeFormer === true;
	const effect = Effect.gen(function* () {
		const dbService = yield* DatabaseService;

		// Get current employee
		const currentEmp = yield* Effect.promise(async () => {
				const session = await getRequestSession();
				if (!session?.user) return null;

				const activeOrgId = session.session?.activeOrganizationId;
				if (activeOrgId) {
					return await db.query.employee.findFirst({
						where: (e, { and, eq }) =>
							and(eq(e.userId, session.user.id), onCurrentRoster(activeOrgId, e)),
						with: { user: true, team: true },
					});
				}

				return null;
			}).pipe(Effect.flatMap((emp) =>
				emp
					? Effect.succeed(emp)
					: Effect.fail(
							new NotFoundError({
								message: "Employee profile not found",
								entityType: "employee",
							}),
						),
			));
		if (!canUseTeamPage(currentEmp.role)) {
			return yield* Effect.fail(
				new AuthorizationError({
					message: "Not authorized",
					resource: "team",
					action: "read",
				}),
			);
		}

		// Get all employees where current user is their manager
		const { managedEmployeeRecords, formerSince } = yield* dbService.query(
			"getManagedEmployees",
			async () => {
				const managedEmployeeRecords = await dbService.db.query.employeeManagers.findMany({
					where: and(
						eq(employeeManagers.managerId, currentEmp.id),
						inArray(
							employeeManagers.employeeId,
							dbService.db
								.select({ id: employee.id })
								.from(employee)
								.where(
									includeFormer
										? eq(employee.organizationId, currentEmp.organizationId)
										: onCurrentRoster(currentEmp.organizationId),
								),
						),
					),
					with: {
						employee: {
							with: {
								user: true,
								team: true,
							},
						},
					},
				});
				const formerSince = includeFormer
					? await formerEmployeesAmong(
							dbService.db,
							currentEmp.organizationId,
							managedEmployeeRecords.map((record) => record.employeeId),
						)
					: new Map<string, string | null>();
				return { managedEmployeeRecords, formerSince };
			},
		);

		const typedManagedEmployeeRecords =
			managedEmployeeRecords as unknown as ManagedEmployeeRecord[];
		const visibleEmployeeIds = [
			...new Set([
				currentEmp.id,
				...typedManagedEmployeeRecords.flatMap((record) =>
					record.employee.organizationId === currentEmp.organizationId ? [record.employee.id] : [],
				),
			]),
		];
		const balances = yield* Effect.promise(() =>
			getEmployeeWorkBalances({
				employeeIds: visibleEmployeeIds,
				organizationId: currentEmp.organizationId,
			}),
		);

		return buildVisibleManagedEmployees({
			currentEmployee: currentEmp as CurrentTeamEmployee,
			managedRecords: typedManagedEmployeeRecords,
			balances,
			formerSinceById: formerSince,
		});
	});

	return runServerActionSafe(effect);
}
