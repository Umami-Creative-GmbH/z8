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
import { type AuthContext, requireAbility, requireAuth } from "@/lib/auth-helpers";
import {
	AuthenticationError,
	AuthorizationError,
	DatabaseError,
	NotFoundError,
	ValidationError,
} from "@/lib/effect/errors";
import { runServerActionSafe, type ServerActionResult } from "@/lib/effect/result";
import { type DatabaseClient, DatabaseService } from "@/lib/effect/services/database.service";
import type { SavePayrollAccessInput } from "@/lib/payroll-access/grant-scope";
import { revokePayrollAccessGrant, savePayrollAccessGrant } from "@/lib/payroll-access/grant-store";
import { assertPayrollOfficerSettingsContext } from "./action-helpers";

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

export interface PayrollAccessAdminData {
	employees: PayrollAccessEmployeeOption[];
	/**
	 * Departed employees still on an active grant, as officer or named employee. A named
	 * one stays on the grant until an admin removes them.
	 */
	departedEmployees: PayrollAccessEmployeeOption[];
	teams: PayrollAccessTeamOption[];
	grants: PayrollAccessGrantData[];
}

export async function getPayrollAccessAdminDataAction(): Promise<
	ServerActionResult<PayrollAccessAdminData>
> {
	return runPayrollAccessAdminAction(async (db) => {
		const { organizationId } = await requirePayrollAccessAdminContext("read");
		const activeGrant = and(
			eq(payrollAccessGrant.organizationId, organizationId),
			eq(payrollAccessGrant.isActive, true),
		);

		const [employeeRows, teamRows, grantRows, grantTeamRows, grantEmployeeRows] = await Promise.all(
			[
				db
					.select({
						id: employee.id,
						employeeNumber: employee.employeeNumber,
						isActive: employee.isActive,
						userName: user.name,
						userEmail: user.email,
					})
					.from(employee)
					.innerJoin(user, eq(employee.userId, user.id))
					.where(
						and(
							eq(employee.organizationId, organizationId),
							or(
								eq(employee.isActive, true),
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
			],
		);
		const toOption = (row: (typeof employeeRows)[number]): PayrollAccessEmployeeOption => ({
			id: row.id,
			name: row.userName?.trim() || row.employeeNumber || row.id,
			email: row.userEmail,
		});

		return {
			employees: employeeRows.filter((row) => row.isActive).map(toOption),
			departedEmployees: employeeRows.filter((row) => !row.isActive).map(toOption),
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
	});
}

export async function savePayrollAccessAction(
	input: SavePayrollAccessInput,
): Promise<ServerActionResult<{ grantId: string }>> {
	return runPayrollAccessAdminAction(async (db) => {
		const { authContext, organizationId } = await requirePayrollAccessAdminContext("write");
		const { grantId } = await db.transaction((tx) =>
			savePayrollAccessGrant(tx, {
				organizationId,
				actorUserId: authContext.user.id,
				grant: input,
			}),
		);

		revalidatePath("/settings/payroll-access");
		revalidatePath("/payroll");

		return { grantId };
	});
}

export async function revokePayrollAccessGrantAction(input: {
	grantId: string;
}): Promise<ServerActionResult<{ grantId: string }>> {
	return runPayrollAccessAdminAction(async (db) => {
		const { authContext, organizationId } = await requirePayrollAccessAdminContext("write");
		const { grantId } = await db.transaction((tx) =>
			revokePayrollAccessGrant(tx, {
				organizationId,
				actorUserId: authContext.user.id,
				grantId: input?.grantId,
			}),
		);

		revalidatePath("/settings/payroll-access");
		revalidatePath("/payroll");

		return { grantId };
	});
}

async function requirePayrollAccessAdminContext(
	action: "read" | "write",
): Promise<{ authContext: AuthContext; organizationId: string }> {
	try {
		const [authContext, ability] = await Promise.all([requireAuth(), requireAbility()]);
		const activeOrganizationId = authContext.session.activeOrganizationId;
		assertPayrollOfficerSettingsContext(
			{
				userId: authContext.user.id,
				employeeOrganizationId: authContext.employee?.organizationId ?? null,
				activeOrganizationId,
				canManagePayrollOfficerSettings: ability.can("manage", "PayrollOfficerSettings"),
			},
			action,
		);

		return { authContext, organizationId: activeOrganizationId as string };
	} catch (error) {
		if (isAppError(error)) throw error;
		if (error instanceof Error && error.message === "Authentication required") {
			throw new AuthenticationError({ message: "Authentication required" });
		}
		throw error;
	}
}

/** Runs `action` with the client of the runtime's `DatabaseService`. */
async function runPayrollAccessAdminAction<T>(
	action: (db: DatabaseClient) => Promise<T>,
): Promise<ServerActionResult<T>> {
	return runServerActionSafe(
		DatabaseService.use((dbService) =>
			dbService.query("payrollAccess.adminAction", () => action(dbService.db)),
		).pipe(
			// Typed failures thrown by the action keep their type.
			Effect.mapError((error) => (isAppError(error.cause) ? error.cause : error)),
		),
	);
}

function isAppError(
	error: unknown,
): error is
	| AuthenticationError
	| AuthorizationError
	| DatabaseError
	| NotFoundError
	| ValidationError {
	return (
		error instanceof AuthenticationError ||
		error instanceof AuthorizationError ||
		error instanceof DatabaseError ||
		error instanceof NotFoundError ||
		error instanceof ValidationError
	);
}
