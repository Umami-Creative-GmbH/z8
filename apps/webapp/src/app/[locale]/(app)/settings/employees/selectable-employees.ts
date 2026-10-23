import { and, asc, count, eq, ilike, inArray, notInArray, or, sql } from "drizzle-orm";
import { Effect } from "effect";
import { user } from "@/db/auth-schema";
import { employee, employeeManagers, team } from "@/db/schema";
import {
	formerSinceDate,
	isFormerEmployee,
	onCurrentRoster,
} from "@/lib/employee-lifecycle/current-roster";
import {
	type EmployeeDirectoryStatus,
	type EmployeeSelectParams,
	normalizeEmployeeSelectStatus,
	type SelectableEmployee,
} from "./employee-action-types";
import { getEmployeeSettingsActorContext } from "./employee-action-utils";

const DEFAULT_LIMIT = 20;

export type EmployeeFilterParams = Omit<EmployeeSelectParams, "status"> & {
	/** Every employee when omitted; callers normalize request values first. */
	status?: EmployeeDirectoryStatus;
};

/**
 * Which of the organization's employees a status keeps (#1438). "current" is
 * the current roster, "former" the employees who left (deactivated or past a
 * due departure), "draft" none (invitation drafts are listed apart).
 */
function employeeStatusCondition(organizationId: string, status: EmployeeDirectoryStatus) {
	switch (status) {
		case "current":
			return onCurrentRoster(organizationId);
		case "former":
			return and(eq(employee.organizationId, organizationId), isFormerEmployee())!;
		case "draft":
			return and(eq(employee.organizationId, organizationId), sql<boolean>`false`)!;
		case "all":
			return eq(employee.organizationId, organizationId);
	}
}

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
	const conditions = [employeeStatusCondition(organizationId, params.status ?? "all")];

	if (params.role && params.role !== "all") {
		conditions.push(eq(employee.role, params.role));
	}

	if (params.roles?.length) {
		conditions.push(inArray(employee.role, params.roles));
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
	> & { isFormer: boolean; formerSince: string | null };
	user: Pick<
		typeof user.$inferSelect,
		"id" | "firstName" | "lastName" | "name" | "email" | "image"
	>;
	team: Pick<typeof team.$inferSelect, "id" | "name"> | null;
};

/**
 * The picker row columns, with the former-employee mark and the date they left
 * for the "Former since …" label (#1438, #1439).
 */
export const selectableEmployeeColumns = {
	employee: {
		id: employee.id,
		userId: employee.userId,
		pronouns: employee.pronouns,
		position: employee.position,
		role: employee.role,
		isActive: employee.isActive,
		isFormer: isFormerEmployee(),
		formerSince: formerSinceDate(),
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
};

export function mapSelectableEmployeeRow(row: SelectableEmployeeRow): SelectableEmployee {
	const { formerSince, ...employeeColumns } = row.employee;
	const isFormer = employeeColumns.isFormer === true;
	return {
		...employeeColumns,
		isFormer,
		...(isFormer ? { formerSince: formerSince ?? null } : {}),
		firstName: row.user.firstName,
		lastName: row.user.lastName,
		user: row.user,
		team: row.team?.id ? row.team : null,
	};
}

/**
 * One page of the employees the acting settings user may pick, as the employee pickers (and the
 * shift dialog's "Assign To") list them: scoped to the active organization and, for managers, to
 * the employees they manage. Only the current roster unless the picker opts in to former
 * employees for a view of the past (#1438).
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
			status: normalizeEmployeeSelectStatus(params.status),
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
					.select(selectableEmployeeColumns)
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
