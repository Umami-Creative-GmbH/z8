"use server";

import { eq } from "drizzle-orm";
import { Effect } from "effect";
import { headers } from "next/headers";
import { db } from "@/db";
import { employeeManagers } from "@/db/schema";
import { auth } from "@/lib/auth";
import { NotFoundError } from "@/lib/effect/errors";
import { runServerActionSafe, type ServerActionResult } from "@/lib/effect/result";
import { AppLayer } from "@/lib/effect/runtime";
import { DatabaseService } from "@/lib/effect/services/database.service";

// =============================================================================
// Types
// =============================================================================

export interface ManagedEmployee {
	id: string;
	userId: string;
	firstName: string | null;
	lastName: string | null;
	position: string | null;
	role: "admin" | "manager" | "employee";
	isActive: boolean;
	isPrimaryManager: boolean;
	user: {
		id: string;
		name: string;
		email: string;
		image: string | null;
	};
	team: {
		id: string;
		name: string;
	} | null;
}

// =============================================================================
// Server Actions
// =============================================================================

/**
 * Get current employee from session (reuse pattern from absences)
 */
export async function getCurrentEmployee() {
	const session = await auth.api.getSession({ headers: await headers() });
	if (!session?.user) {
		return null;
	}

	const activeOrgId = session.session?.activeOrganizationId;

	if (activeOrgId) {
		const emp = await db.query.employee.findFirst({
			where: (e, { and, eq }) =>
				and(eq(e.userId, session.user.id), eq(e.organizationId, activeOrgId), eq(e.isActive, true)),
		});
		if (emp) return emp;
	}

	const emp = await db.query.employee.findFirst({
		where: (e, { and, eq }) => and(eq(e.userId, session.user.id), eq(e.isActive, true)),
	});

	return emp;
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
					});
				}

				return await db.query.employee.findFirst({
					where: (e, { and, eq }) => and(eq(e.userId, session.user.id), eq(e.isActive, true)),
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

		// Get all employees where current user is their manager
		const managedEmployeeRecords = yield* _(
			dbService.query("getManagedEmployees", async () => {
				return await dbService.db.query.employeeManagers.findMany({
					where: eq(employeeManagers.managerId, currentEmp.id),
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

		// Transform to ManagedEmployee type
		const managedEmployees: ManagedEmployee[] = managedEmployeeRecords.map((record) => ({
			id: record.employee.id,
			userId: record.employee.userId,
			firstName: record.employee.firstName,
			lastName: record.employee.lastName,
			position: record.employee.position,
			role: record.employee.role,
			isActive: record.employee.isActive,
			isPrimaryManager: record.isPrimary,
			user: {
				id: record.employee.user.id,
				name: record.employee.user.name,
				email: record.employee.user.email,
				image: record.employee.user.image,
			},
			team: record.employee.team
				? {
						id: record.employee.team.id,
						name: record.employee.team.name,
					}
				: null,
		}));

		return managedEmployees;
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}
