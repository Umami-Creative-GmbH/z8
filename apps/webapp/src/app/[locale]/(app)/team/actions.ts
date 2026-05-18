"use server";

import { and, eq, inArray } from "drizzle-orm";
import { Effect } from "effect";
import { headers } from "next/headers";
import { db } from "@/db";
import { employee, employeeManagers } from "@/db/schema";
import { auth } from "@/lib/auth";
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
