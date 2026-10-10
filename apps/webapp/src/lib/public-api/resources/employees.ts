import { and, asc, eq, gt, inArray, not, sql } from "drizzle-orm";
import { z } from "zod";
import { user } from "@/db/auth-schema";
import { employee, employeeManagers, teamMembership } from "@/db/schema";
import { employeeHasOrganizationAccess } from "@/lib/employee-lifecycle/access";
import { defineEndpoint } from "../endpoint";
import { decodeCursor, pageOf, pageQueryShape, pageSchema } from "../pagination";
import { problem } from "../problem";
import { idSchema, localDateSchema } from "../schemas";

const localDate = localDateSchema();

export const employeeSchema = z
	.object({
		id: idSchema(),
		firstName: z.string().nullable(),
		lastName: z.string().nullable(),
		workEmail: z.string(),
		employeeNumber: z.string().nullable(),
		teamIds: z.array(idSchema()).describe("Every team the employee belongs to."),
		managerId: idSchema().nullable().describe("The employee's primary manager, an employee id."),
		status: z
			.enum(["active", "departed"])
			.describe("`departed` once the employee's departure has taken effect."),
		startDate: localDate.nullable(),
		departureDate: localDate
			.nullable()
			.describe("The last working day of a scheduled or completed departure."),
	})
	.meta({ title: "Employee" });

export type PublicEmployee = z.infer<typeof employeeSchema>;

const hasAccess = employeeHasOrganizationAccess();

/**
 * The employee's newest departure that was not canceled: its last working day,
 * or the local date of its cutoff when none was recorded.
 */
const departureDate = sql<string | null>`(
	SELECT coalesce(d.last_working_day::text, to_char(d.cutoff_at AT TIME ZONE d.timezone, 'YYYY-MM-DD'))
	FROM employee_departure d
	WHERE d.organization_id = "employee"."organization_id"
		AND d.employee_id = "employee"."id"
		AND d.status <> 'canceled'
	ORDER BY d.cutoff_at DESC
	LIMIT 1
)`;

export const listEmployees = defineEndpoint({
	method: "GET",
	path: "/api/v1/employees",
	operationId: "listEmployees",
	tag: "Employees",
	summary: "List employees",
	description:
		"The organization's employees, including departed ones. Contract, salary, address and birthday are never returned.",
	scope: "employees:read",
	query: z.object({
		...pageQueryShape,
		status: z
			.enum(["active", "departed"])
			.optional()
			.describe("Only employees with this status. Both by default."),
	}),
	response: pageSchema(employeeSchema),
	async run({ principal, query, database }) {
		const after = query.cursor ? decodeCursor(query.cursor, ["string"]) : null;
		if (query.cursor && !after) {
			return {
				ok: false,
				problem: problem("validation_failed", {
					errors: [{ parameter: "cursor", message: "Not a cursor of this list" }],
				}),
			};
		}
		const { organizationId } = principal;
		const rows = await database
			.select({
				id: employee.id,
				teamId: employee.teamId,
				firstName: sql<string | null>`coalesce(${employee.firstName}, ${user.firstName})`,
				lastName: sql<string | null>`coalesce(${employee.lastName}, ${user.lastName})`,
				workEmail: user.email,
				employeeNumber: employee.employeeNumber,
				active: hasAccess,
				startDate: sql<string | null>`to_char(${employee.startDate}, 'YYYY-MM-DD')`,
				departureDate,
			})
			.from(employee)
			.innerJoin(user, eq(user.id, employee.userId))
			.where(
				and(
					eq(employee.organizationId, organizationId),
					query.status === "active" ? hasAccess : undefined,
					query.status === "departed" ? not(hasAccess) : undefined,
					after ? gt(employee.id, String(after[0])) : undefined,
				),
			)
			.orderBy(asc(employee.id))
			.limit(query.limit + 1);

		const ids = rows.map((row) => row.id);
		const [memberships, managers] =
			ids.length === 0
				? [[], []]
				: await Promise.all([
						database
							.select({ employeeId: teamMembership.employeeId, teamId: teamMembership.teamId })
							.from(teamMembership)
							.where(
								and(
									eq(teamMembership.organizationId, organizationId),
									inArray(teamMembership.employeeId, ids),
								),
							),
						database
							.select({
								employeeId: employeeManagers.employeeId,
								managerId: employeeManagers.managerId,
							})
							.from(employeeManagers)
							.innerJoin(employee, eq(employee.id, employeeManagers.managerId))
							.where(
								and(
									eq(employee.organizationId, organizationId),
									eq(employeeManagers.isPrimary, true),
									inArray(employeeManagers.employeeId, ids),
								),
							),
					]);
		const teamsOf = new Map<string, Set<string>>();
		for (const row of [
			...rows.map((r) => ({ employeeId: r.id, teamId: r.teamId })),
			...memberships,
		]) {
			if (!row.teamId) continue;
			const teams = teamsOf.get(row.employeeId) ?? new Set<string>();
			teams.add(row.teamId);
			teamsOf.set(row.employeeId, teams);
		}
		const managerOf = new Map(managers.map((row) => [row.employeeId, row.managerId]));

		const page = pageOf(
			rows,
			query.limit,
			(row): PublicEmployee => ({
				id: row.id,
				firstName: row.firstName,
				lastName: row.lastName,
				workEmail: row.workEmail,
				employeeNumber: row.employeeNumber,
				teamIds: [...(teamsOf.get(row.id) ?? [])].sort(),
				managerId: managerOf.get(row.id) ?? null,
				status: row.active ? "active" : "departed",
				startDate: row.startDate,
				departureDate: row.departureDate,
			}),
			(row) => [row.id],
		);
		return { ok: true, body: page, rowCount: page.data.length };
	},
});
