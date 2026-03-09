"use server";

import { and, asc, count, eq, ilike, inArray, notInArray, or, sql } from "drizzle-orm";
import { Effect } from "effect";
import { user } from "@/db/auth-schema";
import { employee, team } from "@/db/schema";
import { NotFoundError } from "@/lib/effect/errors";
import { runServerActionSafe, type ServerActionResult } from "@/lib/effect/result";
import { AppLayer } from "@/lib/effect/runtime";
import type {
	EmployeeListParams,
	EmployeeSelectParams,
	EmployeeSelectResponse,
	EmployeeWithRelations,
	PaginatedEmployeeResponse,
	SelectableEmployee,
} from "./employee-action-types";
import { ensureSameOrganization, getEmployeeContext } from "./employee-action-utils";

const DEFAULT_LIMIT = 20;

const employeeSortName = sql<string>`
	coalesce(
		nullif(${user.name}, ''),
		nullif(concat_ws(' ', ${employee.firstName}, ${employee.lastName}), '')
	)
`;

function buildEmployeeFilters(
	organizationId: string,
	params: Pick<
		EmployeeSelectParams,
		"search" | "role" | "roles" | "status" | "teamId" | "excludeIds"
	>,
) {
	const conditions = [eq(employee.organizationId, organizationId)];

	if (params.role && params.role !== "all") {
		conditions.push(eq(employee.role, params.role));
	}

	if (params.roles?.length) {
		conditions.push(inArray(employee.role, params.roles));
	}

	if (params.status && params.status !== "all") {
		conditions.push(eq(employee.isActive, params.status === "active"));
	}

	if (params.teamId) {
		conditions.push(eq(employee.teamId, params.teamId));
	}

	if (params.excludeIds?.length) {
		conditions.push(notInArray(employee.id, params.excludeIds));
	}

	const normalizedSearch = params.search?.trim();
	if (normalizedSearch) {
		const pattern = `%${normalizedSearch}%`;
		conditions.push(
			or(
				ilike(user.name, pattern),
				ilike(user.email, pattern),
				ilike(employee.firstName, pattern),
				ilike(employee.lastName, pattern),
				ilike(employee.position, pattern),
			)!,
		);
	}

	return and(...conditions);
}

function mapEmployeeRow(row: {
	employee: typeof employee.$inferSelect;
	user: typeof user.$inferSelect;
	team: typeof team.$inferSelect | null;
}): EmployeeWithRelations {
	return {
		...row.employee,
		user: row.user,
		team: row.team,
	};
}

function mapSelectableEmployeeRow(row: {
	employee: Pick<
		typeof employee.$inferSelect,
		"id" | "userId" | "firstName" | "lastName" | "position" | "role" | "isActive" | "teamId"
	>;
	user: Pick<typeof user.$inferSelect, "id" | "name" | "email" | "image">;
	team: Pick<typeof team.$inferSelect, "id" | "name"> | null;
}): SelectableEmployee {
	return {
		...row.employee,
		user: row.user,
		team: row.team?.id ? row.team : null,
	};
}

function loadEmployeePage(params: EmployeeListParams) {
	return Effect.gen(function* (_) {
		const { currentEmployee, dbService } = yield* _(getEmployeeContext());
		const limit = params.limit ?? DEFAULT_LIMIT;
		const offset = params.offset ?? 0;
		const where = buildEmployeeFilters(currentEmployee.organizationId, params);

		const [totalResult, rows] = yield* _(
			Effect.all([
				dbService.query("countEmployees", async () => {
					return await dbService.db
						.select({ total: count() })
						.from(employee)
						.innerJoin(user, eq(employee.userId, user.id))
						.where(where);
				}),
				dbService.query("listEmployees", async () => {
					return await dbService.db
						.select({ employee, user, team })
						.from(employee)
						.innerJoin(user, eq(employee.userId, user.id))
						.leftJoin(team, eq(employee.teamId, team.id))
						.where(where)
						.orderBy(asc(employeeSortName), asc(user.email), asc(employee.id))
						.limit(limit)
						.offset(offset);
				}),
			]),
		);

		const total = totalResult[0]?.total ?? 0;
		return {
			employees: rows.map(mapEmployeeRow),
			total,
			hasMore: offset + rows.length < total,
		};
	});
}

function loadSelectableEmployeePage(params: EmployeeSelectParams) {
	return Effect.gen(function* (_) {
		const { currentEmployee, dbService } = yield* _(getEmployeeContext());
		const limit = params.limit ?? DEFAULT_LIMIT;
		const offset = params.offset ?? 0;
		const where = buildEmployeeFilters(currentEmployee.organizationId, params);

		const [totalResult, rows] = yield* _(
			Effect.all([
				dbService.query("countSelectableEmployees", async () => {
					return await dbService.db
						.select({ total: count() })
						.from(employee)
						.innerJoin(user, eq(employee.userId, user.id))
						.where(where);
				}),
				dbService.query("listEmployeesForSelect", async () => {
					return await dbService.db
						.select({
							employee: {
								id: employee.id,
								userId: employee.userId,
								firstName: employee.firstName,
								lastName: employee.lastName,
								position: employee.position,
								role: employee.role,
								isActive: employee.isActive,
								teamId: employee.teamId,
							},
							user: {
								id: user.id,
								name: user.name,
								email: user.email,
								image: user.image,
							},
							team: {
								id: team.id,
								name: team.name,
							},
						})
						.from(employee)
						.innerJoin(user, eq(employee.userId, user.id))
						.leftJoin(team, eq(employee.teamId, team.id))
						.where(where)
						.orderBy(asc(employeeSortName), asc(user.email), asc(employee.id))
						.limit(limit)
						.offset(offset);
				}),
			]),
		);

		const total = totalResult[0]?.total ?? 0;
		return {
			employees: rows.map(mapSelectableEmployeeRow),
			total,
			hasMore: offset + rows.length < total,
		};
	});
}

export async function getEmployeeAction(
	employeeId: string,
): Promise<ServerActionResult<EmployeeWithRelations>> {
	const effect = Effect.gen(function* (_) {
		const { currentEmployee, dbService } = yield* _(getEmployeeContext());

		const rows = yield* _(
			dbService.query("getTargetEmployee", async () => {
				return await dbService.db
					.select({ employee, user, team })
					.from(employee)
					.innerJoin(user, eq(employee.userId, user.id))
					.leftJoin(team, eq(employee.teamId, team.id))
					.where(eq(employee.id, employeeId))
					.limit(1);
			}),
		);

		const targetEmployee = rows[0];
		if (!targetEmployee) {
			return yield* _(
				Effect.fail(
					new NotFoundError({
						message: "Employee not found",
						entityType: "employee",
						entityId: employeeId,
					}),
				),
			);
		}

		yield* _(
			ensureSameOrganization(currentEmployee, targetEmployee.employee, "employee", "read"),
		);

		const detail = yield* _(
			dbService.query("getEmployeeRelations", async () => {
				return await dbService.db.query.employee.findFirst({
					where: eq(employee.id, employeeId),
					with: {
						user: true,
						team: true,
						managers: {
							with: {
								manager: {
									with: {
										user: true,
									},
								},
							},
						},
						workPolicyAssignments: {
							with: {
								policy: {
									with: {
										schedule: {
											with: {
												days: true,
											},
										},
									},
								},
							},
							orderBy: (assignment, { desc }) => [desc(assignment.effectiveFrom)],
							limit: 1,
						},
					},
				});
			}),
		);

		if (!detail) {
			return yield* _(
				Effect.fail(
					new NotFoundError({
						message: "Employee not found",
						entityType: "employee",
						entityId: employeeId,
					}),
				),
			);
		}

		return detail as EmployeeWithRelations;
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

export async function listEmployeesAction(
	params: EmployeeListParams = {},
): Promise<ServerActionResult<PaginatedEmployeeResponse>> {
	const effect = loadEmployeePage(params).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

export async function listEmployeesForSelectAction(
	params: EmployeeSelectParams = {},
): Promise<ServerActionResult<EmployeeSelectResponse>> {
	const effect = loadSelectableEmployeePage(params).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

export async function getEmployeesByIdsAction(
	employeeIds: string[],
): Promise<ServerActionResult<SelectableEmployee[]>> {
	if (employeeIds.length === 0) {
		return { success: true, data: [] };
	}

	const effect = Effect.gen(function* (_) {
		const { currentEmployee, dbService } = yield* _(getEmployeeContext());

		const rows = yield* _(
			dbService.query("getEmployeesByIds", async () => {
				return await dbService.db
					.select({
						employee: {
							id: employee.id,
							userId: employee.userId,
							firstName: employee.firstName,
							lastName: employee.lastName,
							position: employee.position,
							role: employee.role,
							isActive: employee.isActive,
							teamId: employee.teamId,
						},
						user: {
							id: user.id,
							name: user.name,
							email: user.email,
							image: user.image,
						},
						team: {
							id: team.id,
							name: team.name,
						},
					})
					.from(employee)
					.innerJoin(user, eq(employee.userId, user.id))
					.leftJoin(team, eq(employee.teamId, team.id))
					.where(
						and(
							eq(employee.organizationId, currentEmployee.organizationId),
							inArray(employee.id, employeeIds),
						),
					)
					.orderBy(asc(employeeSortName), asc(user.email), asc(employee.id));
			}),
		);

		return rows.map(mapSelectableEmployeeRow);
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}
