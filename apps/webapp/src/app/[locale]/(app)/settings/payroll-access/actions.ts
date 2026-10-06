"use server";

import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { Effect } from "effect";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
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
	ValidationError,
} from "@/lib/effect/errors";
import { runServerActionSafe, type ServerActionResult } from "@/lib/effect/result";
import {
	assertPayrollOfficerSettingsContext,
	buildValidatedPayrollAccessInput,
	type SavePayrollAccessInput,
	validateId,
	validateIdList,
} from "./action-helpers";

export type { SavePayrollAccessInput } from "./action-helpers";

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
	teams: PayrollAccessTeamOption[];
	grants: PayrollAccessGrantData[];
}

export async function getPayrollAccessAdminDataAction(): Promise<
	ServerActionResult<PayrollAccessAdminData>
> {
	return runPayrollAccessAdminAction(async () => {
		const { organizationId } = await requirePayrollAccessAdminContext("read");

		const [employeeRows, teamRows, grantRows, grantTeamRows, grantEmployeeRows] = await Promise.all(
			[
				db
					.select({
						id: employee.id,
						employeeNumber: employee.employeeNumber,
						userName: user.name,
						userEmail: user.email,
					})
					.from(employee)
					.innerJoin(user, eq(employee.userId, user.id))
					.where(and(eq(employee.organizationId, organizationId), eq(employee.isActive, true)))
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
					.where(
						and(
							eq(payrollAccessGrant.organizationId, organizationId),
							eq(payrollAccessGrant.isActive, true),
						),
					)
					.orderBy(asc(payrollAccessGrant.payrollEmployeeId)),
				db
					.select({ grantId: payrollAccessTeam.grantId, teamId: payrollAccessTeam.teamId })
					.from(payrollAccessTeam)
					.where(eq(payrollAccessTeam.organizationId, organizationId)),
				db
					.select({
						grantId: payrollAccessEmployee.grantId,
						employeeId: payrollAccessEmployee.employeeId,
					})
					.from(payrollAccessEmployee)
					.where(eq(payrollAccessEmployee.organizationId, organizationId)),
			],
		);

		return {
			employees: employeeRows.map((row) => ({
				id: row.id,
				name: row.userName?.trim() || row.employeeNumber || row.id,
				email: row.userEmail,
			})),
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
	return runPayrollAccessAdminAction(async () => {
		const { authContext, organizationId } = await requirePayrollAccessAdminContext("write");
		const validated = await validateSavePayrollAccessInput(input, organizationId);

		const grantId = await db.transaction(async (tx) => {
			const [existingActiveGrant] = await tx
				.select({ id: payrollAccessGrant.id })
				.from(payrollAccessGrant)
				.where(
					and(
						eq(payrollAccessGrant.organizationId, organizationId),
						eq(payrollAccessGrant.payrollEmployeeId, validated.payrollEmployeeId),
						eq(payrollAccessGrant.isActive, true),
					),
				)
				.limit(1);

			let grantId = existingActiveGrant?.id;

			if (!grantId) {
				const [existingInactiveGrant] = await tx
					.select({ id: payrollAccessGrant.id })
					.from(payrollAccessGrant)
					.where(
						and(
							eq(payrollAccessGrant.organizationId, organizationId),
							eq(payrollAccessGrant.payrollEmployeeId, validated.payrollEmployeeId),
							eq(payrollAccessGrant.isActive, false),
						),
					)
					.orderBy(desc(payrollAccessGrant.updatedAt))
					.limit(1);

				if (existingInactiveGrant) {
					await tx
						.update(payrollAccessGrant)
						.set({
							isActive: true,
							scope: validated.scope,
							updatedBy: authContext.user.id,
						})
						.where(
							and(
								eq(payrollAccessGrant.id, existingInactiveGrant.id),
								eq(payrollAccessGrant.organizationId, organizationId),
							),
						);
					grantId = existingInactiveGrant.id;
				} else {
					const [insertedGrant] = await tx
						.insert(payrollAccessGrant)
						.values({
							organizationId,
							payrollEmployeeId: validated.payrollEmployeeId,
							scope: validated.scope,
							createdBy: authContext.user.id,
							updatedBy: authContext.user.id,
						})
						.returning({ id: payrollAccessGrant.id });

					if (!insertedGrant) {
						throw new DatabaseError({
							message: "Failed to create payroll access grant",
							operation: "insert",
							table: "payroll_access_grant",
						});
					}
					grantId = insertedGrant.id;
				}
			} else {
				await tx
					.update(payrollAccessGrant)
					.set({ scope: validated.scope, updatedBy: authContext.user.id })
					.where(
						and(
							eq(payrollAccessGrant.id, grantId),
							eq(payrollAccessGrant.organizationId, organizationId),
						),
					);
			}

			await tx
				.delete(payrollAccessTeam)
				.where(
					and(
						eq(payrollAccessTeam.organizationId, organizationId),
						eq(payrollAccessTeam.grantId, grantId),
					),
				);
			await tx
				.delete(payrollAccessEmployee)
				.where(
					and(
						eq(payrollAccessEmployee.organizationId, organizationId),
						eq(payrollAccessEmployee.grantId, grantId),
					),
				);

			if (validated.teamIds.length > 0) {
				await tx.insert(payrollAccessTeam).values(
					validated.teamIds.map((teamId) => ({
						organizationId,
						grantId,
						teamId,
						createdBy: authContext.user.id,
					})),
				);
			}

			if (validated.employeeIds.length > 0) {
				await tx.insert(payrollAccessEmployee).values(
					validated.employeeIds.map((employeeId) => ({
						organizationId,
						grantId,
						employeeId,
						createdBy: authContext.user.id,
					})),
				);
			}

			return grantId;
		});

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

async function validateSavePayrollAccessInput(
	input: SavePayrollAccessInput,
	organizationId: string,
): Promise<SavePayrollAccessInput> {
	if (!input || typeof input !== "object") {
		throw new ValidationError({ message: "Payroll access input is required" });
	}

	const payrollEmployeeId = validateId(input.payrollEmployeeId, "payrollEmployeeId");
	const teamIds = validateIdList(input.teamIds, "teamIds");
	const employeeIds = validateIdList(input.employeeIds, "employeeIds");
	const employeeIdsToValidate = [payrollEmployeeId, ...employeeIds];

	const activeEmployeeRows = await db
		.select({ id: employee.id })
		.from(employee)
		.where(
			and(
				eq(employee.organizationId, organizationId),
				eq(employee.isActive, true),
				inArray(employee.id, employeeIdsToValidate),
			),
		);

	let teamRows: { id: string }[] = [];
	if (teamIds.length > 0) {
		teamRows = await db
			.select({ id: team.id })
			.from(team)
			.where(and(eq(team.organizationId, organizationId), inArray(team.id, teamIds)));
	}

	return buildValidatedPayrollAccessInput(
		{ payrollEmployeeId, scope: input.scope, teamIds, employeeIds },
		{
			activeEmployeeIds: activeEmployeeRows.map((row) => row.id),
			organizationTeamIds: teamRows.map((row) => row.id),
		},
	);
}

async function runPayrollAccessAdminAction<T>(
	action: () => Promise<T>,
): Promise<ServerActionResult<T>> {
	return runServerActionSafe(
		Effect.tryPromise({
			try: action,
			catch: (error) => {
				if (isAppError(error)) return error;

				return new DatabaseError({
					message: "Payroll access action failed",
					operation: "payroll_access_admin_action",
					cause: error,
				});
			},
		}),
	);
}

function isAppError(
	error: unknown,
): error is AuthenticationError | AuthorizationError | DatabaseError | ValidationError {
	return (
		error instanceof AuthenticationError ||
		error instanceof AuthorizationError ||
		error instanceof DatabaseError ||
		error instanceof ValidationError
	);
}
