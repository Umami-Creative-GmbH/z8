"use server";

import { and, eq, inArray } from "drizzle-orm";
import { Effect } from "effect";
import { unstable_cache } from "next/cache";
import { headers } from "next/headers";
import { db } from "@/db";
import { employee, employeeManagers } from "@/db/schema";
import { auth } from "@/lib/auth";
import { CACHE_TAGS } from "@/lib/cache/tags";
import { AuthorizationError, NotFoundError } from "@/lib/effect/errors";
import { runServerActionSafe, type ServerActionResult } from "@/lib/effect/result";
import { AppLayer } from "@/lib/effect/runtime";
import { DatabaseService } from "@/lib/effect/services/database.service";
import {
	buildVisibleManagedEmployees,
	type CurrentTeamEmployee,
	canUseTeamPage,
	type ManagedEmployee,
	type ManagedEmployeeRecord,
} from "./team-members-data";
import { refreshEmployeeTimeBalances } from "./team-time-balance";

export type { CurrentTeamEmployee, ManagedEmployee } from "./team-members-data";

// =============================================================================
// Server Actions
// =============================================================================

/**
 * Get current employee from session (reuse pattern from absences)
 */
export async function getCurrentEmployee(): Promise<CurrentTeamEmployee | null> {
	const session = await auth.api.getSession({ headers: await headers() });
	if (!session?.user) {
		return null;
	}

	const activeOrgId = session.session?.activeOrganizationId;

	if (activeOrgId) {
		const emp = await db.query.employee.findFirst({
			where: (e, { and, eq }) =>
				and(eq(e.userId, session.user.id), eq(e.organizationId, activeOrgId), eq(e.isActive, true)),
			with: {
				user: true,
				team: true,
			},
		});
		if (emp) return emp as CurrentTeamEmployee;
	}

	return null;
}

function getCachedCalendarManagedEmployeeRecords(organizationId: string, managerId: string) {
	return unstable_cache(
		async () => {
			return await db.query.employeeManagers.findMany({
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
		},
		["calendar-managed-employees", organizationId, managerId],
		{
			revalidate: 5 * 60,
			tags: [CACHE_TAGS.EMPLOYEES(organizationId)],
		},
	)();
}

/**
 * Lightweight employee list for the calendar selector.
 * Avoids team-page balance refresh work and caches the manager relationship lookup.
 */
export async function getCalendarManagedEmployees(): Promise<
	ServerActionResult<ManagedEmployee[]>
> {
	const effect = Effect.gen(function* (_) {
		const session = yield* _(
			Effect.promise(async () => auth.api.getSession({ headers: await headers() })),
		);
		if (!session?.user) {
			return yield* _(
				Effect.fail(
					new NotFoundError({
						message: "Employee profile not found",
						entityType: "employee",
					}),
				),
			);
		}

		const activeOrgId = session.session?.activeOrganizationId;
		const currentEmp = activeOrgId
			? yield* _(
					Effect.promise(async () => {
						return await db.query.employee.findFirst({
							where: (e, { and, eq }) =>
								and(
									eq(e.userId, session.user.id),
									eq(e.organizationId, activeOrgId),
									eq(e.isActive, true),
								),
							with: { user: true, team: true },
						});
					}),
				)
			: null;

		if (!currentEmp) {
			return yield* _(
				Effect.fail(
					new NotFoundError({
						message: "Employee profile not found",
						entityType: "employee",
					}),
				),
			);
		}

		if (!canUseTeamPage(currentEmp.role)) {
			return yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Not authorized",
						resource: "calendar_employees",
						action: "read",
					}),
				),
			);
		}

		const records = yield* _(
			Effect.promise(() =>
				getCachedCalendarManagedEmployeeRecords(currentEmp.organizationId, currentEmp.id),
			),
		);
		const typedRecords = records as unknown as ManagedEmployeeRecord[];
		const byId = new Map<string, ManagedEmployee>();

		for (const record of typedRecords) {
			if (record.employee.organizationId !== currentEmp.organizationId) continue;
			if (record.employee.id === currentEmp.id) continue;

			byId.set(record.employee.id, {
				id: record.employee.id,
				userId: record.employee.userId,
				firstName: record.employee.user.firstName,
				lastName: record.employee.user.lastName,
				pronouns: record.employee.pronouns,
				position: record.employee.position,
				role: record.employee.role,
				isActive: record.employee.isActive,
				isPrimaryManager: record.isPrimary,
				isCurrentUser: false,
				timeBalance: null,
				user: {
					id: record.employee.user.id,
					firstName: record.employee.user.firstName,
					lastName: record.employee.user.lastName,
					name: record.employee.user.name,
					email: record.employee.user.email,
					image: record.employee.user.image,
				},
				team: record.employee.team
					? { id: record.employee.team.id, name: record.employee.team.name }
					: null,
			});
		}

		return [...byId.values()].sort((a, b) =>
			(a.user.name || a.user.email).localeCompare(b.user.name || b.user.email),
		);
	});

	return runServerActionSafe(effect);
}

/**
 * Get all employees managed by the current user
 * Uses the employeeManagers junction table to find direct reports
 */
export async function getManagedEmployees(): Promise<ServerActionResult<ManagedEmployee[]>> {
	const effect = Effect.gen(function* (_) {
		const dbService = yield* _(DatabaseService);

		// Get current employee
		const currentEmp = yield* _(
			Effect.promise(async () => {
				const session = await auth.api.getSession({ headers: await headers() });
				if (!session?.user) return null;

				const activeOrgId = session.session?.activeOrganizationId;
				if (activeOrgId) {
					return await db.query.employee.findFirst({
						where: (e, { and, eq }) =>
							and(
								eq(e.userId, session.user.id),
								eq(e.organizationId, activeOrgId),
								eq(e.isActive, true),
							),
						with: { user: true, team: true },
					});
				}

				return null;
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
		if (!canUseTeamPage(currentEmp.role)) {
			return yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Not authorized",
						resource: "team",
						action: "read",
					}),
				),
			);
		}

		// Get all employees where current user is their manager
		const managedEmployeeRecords = yield* _(
			dbService.query("getManagedEmployees", async () => {
				return await dbService.db.query.employeeManagers.findMany({
					where: and(
						eq(employeeManagers.managerId, currentEmp.id),
						inArray(
							employeeManagers.employeeId,
							dbService.db
								.select({ id: employee.id })
								.from(employee)
								.where(eq(employee.organizationId, currentEmp.organizationId)),
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
			}),
		);

		const typedManagedEmployeeRecords =
			managedEmployeeRecords as unknown as ManagedEmployeeRecord[];
		const visibleEmployeeIds = [
			...new Set([
				currentEmp.id,
				...typedManagedEmployeeRecords
					.filter((record) => record.employee.organizationId === currentEmp.organizationId)
					.map((record) => record.employee.id),
			]),
		];
		const balances = yield* _(
			Effect.promise(() =>
				refreshEmployeeTimeBalances({
					employeeIds: visibleEmployeeIds,
					organizationId: currentEmp.organizationId,
				}),
			),
		);

		return buildVisibleManagedEmployees({
			currentEmployee: currentEmp as CurrentTeamEmployee,
			managedRecords: typedManagedEmployeeRecords,
			balances,
		});
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}
