"use server";

import { and, asc, eq, inArray, or } from "drizzle-orm";
import { Effect } from "effect";
import { revalidatePath } from "next/cache";
import { user } from "@/db/auth-schema";
import {
	employee,
	payrollAccessEmployee,
	payrollAccessGrant,
	payrollAccessTeam,
	team,
} from "@/db/schema";
import { z } from "zod";
import {
	AuthorizationError,
	DatabaseError,
	NotFoundError,
	ValidationError,
} from "@/lib/effect/errors";
import { type DatabaseClient, DatabaseService } from "@/lib/effect/services/database.service";
import {
	formerSinceDate,
	isFormerEmployee,
	onCurrentRoster,
} from "@/lib/employee-lifecycle/current-roster";
import { noInput, organizationAction } from "@/lib/organization-action/organization-action";
import { revokePayrollAccessGrant, savePayrollAccessGrant } from "@/lib/payroll-access/grant-store";

export type { SavePayrollAccessInput } from "@/lib/payroll-access/grant-scope";

export interface PayrollAccessEmployeeOption {
	id: string;
	name: string;
	email: string;
}

export interface PayrollAccessTeamOption {
	id: string;
	name: string;
}

export interface PayrollAccessGrantData {
	id: string;
	payrollEmployeeId: string;
	scope: "all" | "specific";
	teamIds: string[];
	employeeIds: string[];
}

/** A former employee, with the organization-local date they left (#1439; null when not recorded). */
export interface PayrollAccessDepartedEmployeeOption extends PayrollAccessEmployeeOption {
	formerSince: string | null;
}

export interface PayrollAccessAdminData {
	employees: PayrollAccessEmployeeOption[];
	/**
	 * Departed employees still on an active grant, as officer or named employee. A named
	 * one stays on the grant until an admin removes them.
	 */
	departedEmployees: PayrollAccessDepartedEmployeeOption[];
	teams: PayrollAccessTeamOption[];
	grants: PayrollAccessGrantData[];
}

const savePayrollAccessSchema = z.strictObject({
	payrollEmployeeId: z.guid("Payroll access IDs must be valid"),
	scope: z.enum(["all", "specific"], "Payroll access scope must be all or specific"),
	teamIds: z.array(z.string("Team IDs must be strings"), "Team IDs must be a list"),
	employeeIds: z.array(z.string("Employee IDs must be strings"), "Employee IDs must be a list"),
});

const revokePayrollAccessSchema = z.strictObject({
	grantId: z.string("Payroll access grant is required"),
});

export const getPayrollAccessAdminDataAction = organizationAction(
	{ name: "payrollAccess.getAdminData", requires: "orgAdmin", schema: noInput },
	({ organizationId }) =>
		payrollAccessQuery("payrollAccess.getAdminData", (db) =>
			loadPayrollAccessAdminData(db, organizationId),
		),
);

async function loadPayrollAccessAdminData(
	db: DatabaseClient,
	organizationId: string,
): Promise<PayrollAccessAdminData> {
	const activeGrant = and(
		eq(payrollAccessGrant.organizationId, organizationId),
		eq(payrollAccessGrant.isActive, true),
	);

	const [employeeRows, teamRows, grantRows, grantTeamRows, grantEmployeeRows] = await Promise.all([
		db
			.select({
				id: employee.id,
				employeeNumber: employee.employeeNumber,
				// Current roster (#1438): a due departure counts the same as a deactivation.
				isFormer: isFormerEmployee(employee),
				formerSince: formerSinceDate(employee),
				userName: user.name,
				userEmail: user.email,
			})
			.from(employee)
			.innerJoin(user, eq(employee.userId, user.id))
			.where(
				and(
					eq(employee.organizationId, organizationId),
					or(
						onCurrentRoster(organizationId),
						inArray(
							employee.id,
							db
								.select({ id: payrollAccessEmployee.employeeId })
								.from(payrollAccessEmployee)
								.innerJoin(
									payrollAccessGrant,
									eq(payrollAccessEmployee.grantId, payrollAccessGrant.id),
								)
								.where(activeGrant),
						),
						inArray(
							employee.id,
							db
								.select({ id: payrollAccessGrant.payrollEmployeeId })
								.from(payrollAccessGrant)
								.where(activeGrant),
						),
					),
				),
			)
			.orderBy(asc(user.name), asc(employee.employeeNumber), asc(employee.id)),
		db
			.select({ id: team.id, name: team.name })
			.from(team)
			.where(eq(team.organizationId, organizationId))
			.orderBy(asc(team.name)),
		db
			.select({
				id: payrollAccessGrant.id,
				payrollEmployeeId: payrollAccessGrant.payrollEmployeeId,
				scope: payrollAccessGrant.scope,
			})
			.from(payrollAccessGrant)
			.where(activeGrant)
			.orderBy(asc(payrollAccessGrant.payrollEmployeeId)),
		db
			.select({ grantId: payrollAccessTeam.grantId, teamId: payrollAccessTeam.teamId })
			.from(payrollAccessTeam)
			.innerJoin(payrollAccessGrant, eq(payrollAccessTeam.grantId, payrollAccessGrant.id))
			.where(and(eq(payrollAccessTeam.organizationId, organizationId), activeGrant)),
		db
			.select({
				grantId: payrollAccessEmployee.grantId,
				employeeId: payrollAccessEmployee.employeeId,
			})
			.from(payrollAccessEmployee)
			.innerJoin(payrollAccessGrant, eq(payrollAccessEmployee.grantId, payrollAccessGrant.id))
			.where(and(eq(payrollAccessEmployee.organizationId, organizationId), activeGrant)),
	]);
	const toOption = (row: (typeof employeeRows)[number]): PayrollAccessEmployeeOption => ({
		id: row.id,
		name: row.userName?.trim() || row.employeeNumber || row.id,
		email: row.userEmail,
	});

	return {
		employees: employeeRows.filter((row) => !row.isFormer).map(toOption),
		departedEmployees: employeeRows
			.filter((row) => row.isFormer)
			.map((row) => ({ ...toOption(row), formerSince: row.formerSince })),
		teams: teamRows,
		grants: grantRows.map((grant) => ({
			id: grant.id,
			payrollEmployeeId: grant.payrollEmployeeId,
			scope: grant.scope === "all" ? "all" : "specific",
			teamIds: grantTeamRows
				.flatMap((row) => (row.grantId === grant.id ? [row.teamId] : []))
				.sort(),
			employeeIds: grantEmployeeRows
				.flatMap((row) => (row.grantId === grant.id ? [row.employeeId] : []))
				.sort(),
		})),
	};
}

export const savePayrollAccessAction = organizationAction(
	{
		name: "payrollAccess.save",
		requires: "orgAdmin",
		schema: savePayrollAccessSchema,
		// Named employees are not declared: one already on the grant stays valid after
		// they leave (#749). The grant store refuses newly named former employees.
		addsEmployees: (input) => [input.payrollEmployeeId],
	},
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const { grantId } = yield* payrollAccessQuery("payrollAccess.save", (db) =>
				db.transaction((tx) =>
					savePayrollAccessGrant(tx, {
						organizationId,
						actorUserId: actor.userId,
						grant: input,
					}),
				),
			);

			revalidatePath("/settings/payroll-access");
			revalidatePath("/payroll");

			return { grantId };
		}),
);

export const revokePayrollAccessGrantAction = organizationAction(
	{ name: "payrollAccess.revoke", requires: "orgAdmin", schema: revokePayrollAccessSchema },
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const { grantId } = yield* payrollAccessQuery("payrollAccess.revoke", (db) =>
				db.transaction((tx) =>
					revokePayrollAccessGrant(tx, {
						organizationId,
						actorUserId: actor.userId,
						grantId: input.grantId,
					}),
				),
			);

			revalidatePath("/settings/payroll-access");
			revalidatePath("/payroll");

			return { grantId };
		}),
);

/** Runs `work` on the runtime's database; a typed failure it throws keeps its type. */
function payrollAccessQuery<T>(name: string, work: (db: DatabaseClient) => Promise<T>) {
	return DatabaseService.use((dbService) => dbService.query(name, () => work(dbService.db))).pipe(
		Effect.mapError((error) => (isAppError(error.cause) ? error.cause : error)),
	);
}

function isAppError(
	error: unknown,
): error is AuthorizationError | DatabaseError | NotFoundError | ValidationError {
	return (
		error instanceof AuthorizationError ||
		error instanceof DatabaseError ||
		error instanceof NotFoundError ||
		error instanceof ValidationError
	);
}
