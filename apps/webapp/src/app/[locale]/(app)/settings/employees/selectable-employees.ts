import { and, asc, count, eq, ilike, inArray, notInArray, or, sql } from "drizzle-orm";
import { Effect } from "effect";
import { user } from "@/db/auth-schema";
import { employee, employeeManagers, team } from "@/db/schema";
import type {
	EmployeeDirectoryStatus,
	EmployeeSelectParams,
	SelectableEmployee,
} from "./employee-action-types";
import { getEmployeeSettingsActorContext } from "./employee-action-utils";

const DEFAULT_LIMIT = 20;

export type EmployeeFilterParams = Omit<EmployeeSelectParams, "status"> & {
	status?: EmployeeDirectoryStatus;
};

export const employeeSortName = sql<string>`
	coalesce(
		nullif(concat_ws(' ', ${user.firstName}, ${user.lastName}), ''),
		nullif(${user.name}, ''),
		${user.email}
	)
`;

export function buildEmployeeFilters(
	organizationId: string,
	params: Pick<
		EmployeeFilterParams,
		"search" | "role" | "roles" | "status" | "teamId" | "excludeIds" | "managerId"
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
		if (params.status === "draft") {
			conditions.push(sql<boolean>`false`);
		} else {
			conditions.push(eq(employee.isActive, params.status === "active"));
		}
	}

	if (params.teamId) {
		conditions.push(eq(employee.teamId, params.teamId));
	}

	if (params.managerId) {
		conditions.push(
			sql<boolean>`exists (
				select 1
				from ${employeeManagers}
				where ${employeeManagers.employeeId} = ${employee.id}
				and ${employeeManagers.managerId} = ${params.managerId}
			)`,
		);
	}

	if (params.excludeIds?.length) {
		conditions.push(notInArray(employee.id, params.excludeIds));
	}

	const normalizedSearch = params.search?.trim();
	if (normalizedSearch) {
		const pattern = `%${normalizedSearch}%`;
		conditions.push(
			or(
				ilike(user.firstName, pattern),
				ilike(user.lastName, pattern),
				ilike(user.name, pattern),
				ilike(user.email, pattern),
				ilike(employee.position, pattern),
			)!,
		);
	}

	return and(...conditions);
}

export type SelectableEmployeeRow = {
	employee: Pick<
		typeof employee.$inferSelect,
		"id" | "userId" | "pronouns" | "position" | "role" | "isActive" | "teamId"
	>;
	user: Pick<
		typeof user.$inferSelect,
		"id" | "firstName" | "lastName" | "name" | "email" | "image"
	>;
	team: Pick<typeof team.$inferSelect, "id" | "name"> | null;
};

export function mapSelectableEmployeeRow(row: SelectableEmployeeRow): SelectableEmployee {
	return {
		...row.employee,
		firstName: row.user.firstName,
		lastName: row.user.lastName,
		user: row.user,
		team: row.team?.id ? row.team : null,
	};
}

/**
 * One page of the employees the acting settings user may pick, as the employee pickers (and the
 * shift dialog's "Assign To") list them: scoped to the active organization and, for managers, to
 * the employees they manage.
 */
export function loadSelectableEmployeePage(params: EmployeeSelectParams) {
	return Effect.gen(function* () {
		const actor = yield* getEmployeeSettingsActorContext({
			queryName: "loadSelectableEmployeePage:actor",
		});
		const { dbService } = actor;
		const limit = params.limit ?? DEFAULT_LIMIT;
		const offset = params.offset ?? 0;
		const where = buildEmployeeFilters(actor.organizationId, {
			...params,
			managerId:
				actor.accessTier === "manager" && actor.currentEmployee
					? actor.currentEmployee.id
					: undefined,
		});

		const [totalResult, rows] = yield* Effect.all([
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
							pronouns: employee.pronouns,
							position: employee.position,
							role: employee.role,
							isActive: employee.isActive,
							teamId: employee.teamId,
						},
						user: {
							id: user.id,
							firstName: user.firstName,
							lastName: user.lastName,
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
		]);

		const total = totalResult[0]?.total ?? 0;
		const typedRows = rows as unknown as SelectableEmployeeRow[];
		return {
			employees: typedRows.map(mapSelectableEmployeeRow),
			total,
			hasMore: offset + rows.length < total,
		};
	});
}
