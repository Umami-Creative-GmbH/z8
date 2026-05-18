"use server";

import { and, eq, inArray } from "drizzle-orm";
import { Effect } from "effect";
import { headers } from "next/headers";
import { db } from "@/db";
import { type employee, employeeManagers, type team } from "@/db/schema";
import { auth } from "@/lib/auth";
import { NotFoundError } from "@/lib/effect/errors";
import { runServerActionSafe, type ServerActionResult } from "@/lib/effect/result";
import { AppLayer } from "@/lib/effect/runtime";
import { DatabaseService } from "@/lib/effect/services/database.service";
import { refreshEmployeeTimeBalances, type EmployeeTimeBalancePayload } from "./team-time-balance";

// =============================================================================
// Types
// =============================================================================

export interface ManagedEmployee {
	id: string;
	userId: string;
	firstName: string | null;
	lastName: string | null;
	pronouns: string | null;
	position: string | null;
	role: "admin" | "manager" | "employee";
	isActive: boolean;
	isPrimaryManager: boolean;
	isCurrentUser: boolean;
	timeBalance: EmployeeTimeBalancePayload | null;
	user: {
		id: string;
		firstName: string | null;
		lastName: string | null;
		name: string;
		email: string;
		image: string | null;
	};
	team: {
		id: string;
		name: string;
	} | null;
}

export type CurrentTeamEmployee = Pick<
	typeof employee.$inferSelect,
	| "id"
	| "userId"
	| "organizationId"
	| "firstName"
	| "lastName"
	| "pronouns"
	| "position"
	| "role"
	| "isActive"
> & {
	user: {
		id: string;
		firstName: string | null;
		lastName: string | null;
		name: string;
		email: string;
		image: string | null;
	};
	team: Pick<typeof team.$inferSelect, "id" | "name"> | null;
};

type ManagedEmployeeRecord = Pick<typeof employeeManagers.$inferSelect, "isPrimary"> & {
	employee: Pick<
		typeof employee.$inferSelect,
		| "id"
		| "userId"
		| "organizationId"
		| "firstName"
		| "lastName"
		| "pronouns"
		| "position"
		| "role"
		| "isActive"
	> & {
		user: {
			id: string;
			firstName: string | null;
			lastName: string | null;
			name: string;
			email: string;
			image: string | null;
		};
		team: Pick<typeof team.$inferSelect, "id" | "name"> | null;
	};
};

// =============================================================================
// Server Actions
// =============================================================================

export function buildVisibleManagedEmployees(input: {
	currentEmployee: CurrentTeamEmployee;
	managedRecords: ManagedEmployeeRecord[];
	balances: Map<string, EmployeeTimeBalancePayload>;
}): ManagedEmployee[] {
	const byId = new Map<string, ManagedEmployee>();
	const toManagedEmployee = (
		emp: ManagedEmployeeRecord["employee"] | CurrentTeamEmployee,
		isPrimaryManager: boolean,
		isCurrentUser: boolean,
	): ManagedEmployee => ({
		id: emp.id,
		userId: emp.userId,
		firstName: emp.user.firstName,
		lastName: emp.user.lastName,
		pronouns: emp.pronouns,
		position: emp.position,
		role: emp.role,
		isActive: emp.isActive,
		isPrimaryManager,
		isCurrentUser,
		timeBalance: input.balances.get(emp.id) ?? null,
		user: {
			id: emp.user.id,
			firstName: emp.user.firstName,
			lastName: emp.user.lastName,
			name: emp.user.name,
			email: emp.user.email,
			image: emp.user.image,
		},
		team: emp.team ? { id: emp.team.id, name: emp.team.name } : null,
	});

	byId.set(input.currentEmployee.id, toManagedEmployee(input.currentEmployee, false, true));
	for (const record of input.managedRecords) {
		if (record.employee.organizationId !== input.currentEmployee.organizationId) continue;
		if (record.employee.id === input.currentEmployee.id) continue;
		byId.set(record.employee.id, toManagedEmployee(record.employee, record.isPrimary, false));
	}

	return [...byId.values()];
}

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

	const emp = await db.query.employee.findFirst({
		where: (e, { and, eq }) => and(eq(e.userId, session.user.id), eq(e.isActive, true)),
		with: {
			user: true,
			team: true,
		},
	});

	return emp as CurrentTeamEmployee | null;
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

				return await db.query.employee.findFirst({
					where: (e, { and, eq }) => and(eq(e.userId, session.user.id), eq(e.isActive, true)),
					with: { user: true, team: true },
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
