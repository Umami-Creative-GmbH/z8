"use server";

import { asc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { user } from "@/db/auth-schema";
import { employee, team } from "@/db/schema";
import { NotFoundError, ValidationError } from "@/lib/effect/errors";
import type { ServerActionResult } from "@/lib/effect/result";
import { logger } from "@/lib/logger";
import { requireExpenseAdministrator } from "@/lib/travel-expenses/expense-administrator";
import type { SaveExpenseOfficerGrantInput } from "@/lib/travel-expenses/expense-officer-grant";
import {
	type ExpenseOfficerGrantRecord,
	listActiveExpenseOfficerGrants,
	revokeExpenseOfficerGrant,
	saveExpenseOfficerGrant,
} from "@/lib/travel-expenses/expense-officer-grant-store";

/**
 * Expense officers (#747, ADR 0001): who handles approved expense reports
 * besides owners and admins, in which scope and with which capabilities.
 * Managed by organization administrators on the Access tab.
 */

export type { SaveExpenseOfficerGrantInput } from "@/lib/travel-expenses/expense-officer-grant";
export type ExpenseOfficerGrantData = ExpenseOfficerGrantRecord;

export interface ExpenseOfficerPersonOption {
	id: string;
	name: string;
	email: string;
}

export interface ExpenseOfficerAdminData {
	/** Active employees: possible officers and named employees. */
	employees: ExpenseOfficerPersonOption[];
	/** Departed employees: they can still be named, since their last reports may be owed. */
	departedEmployees: ExpenseOfficerPersonOption[];
	teams: Array<{ id: string; name: string }>;
	grants: ExpenseOfficerGrantData[];
}

function failure(error: unknown, fallback: string): { success: false; error: string } {
	// Validation and not-found messages are written for the administrator.
	if (error instanceof ValidationError || error instanceof NotFoundError) {
		return { success: false, error: error.message };
	}
	logger.error({ error }, fallback);
	return { success: false, error: fallback };
}

export async function getExpenseOfficerAdminData(): Promise<
	ServerActionResult<ExpenseOfficerAdminData>
> {
	try {
		const access = await requireExpenseAdministrator();
		if ("error" in access) return { success: false, error: access.error };
		const [people, teams, grants] = await Promise.all([
			db
				.select({
					id: employee.id,
					employeeNumber: employee.employeeNumber,
					isActive: employee.isActive,
					name: user.name,
					email: user.email,
				})
				.from(employee)
				.innerJoin(user, eq(user.id, employee.userId))
				.where(eq(employee.organizationId, access.organizationId))
				.orderBy(asc(user.name), asc(employee.employeeNumber), asc(employee.id)),
			db
				.select({ id: team.id, name: team.name })
				.from(team)
				.where(eq(team.organizationId, access.organizationId))
				.orderBy(asc(team.name)),
			listActiveExpenseOfficerGrants(db, { organizationId: access.organizationId }),
		]);
		const toOption = (row: (typeof people)[number]): ExpenseOfficerPersonOption => ({
			id: row.id,
			name: row.name?.trim() || row.employeeNumber || row.id,
			email: row.email,
		});
		return {
			success: true,
			data: {
				employees: people.filter((row) => row.isActive).map(toOption),
				departedEmployees: people.filter((row) => !row.isActive).map(toOption),
				teams,
				grants,
			},
		};
	} catch (error) {
		return failure(error, "Failed to load the expense officers");
	}
}

export async function saveExpenseOfficerGrantAction(
	input: SaveExpenseOfficerGrantInput,
): Promise<ServerActionResult<{ grantId: string }>> {
	try {
		const access = await requireExpenseAdministrator();
		if ("error" in access) return { success: false, error: access.error };
		const { grantId } = await db.transaction((tx) =>
			saveExpenseOfficerGrant(tx, {
				organizationId: access.organizationId,
				actorUserId: access.userId,
				grant: input,
			}),
		);
		revalidatePath("/settings/travel-expenses");
		revalidatePath("/travel-expenses");
		return { success: true, data: { grantId } };
	} catch (error) {
		return failure(error, "Failed to save the expense officer");
	}
}

/** Ends the grant's access at once: every finance surface reads the active grant per request. */
export async function revokeExpenseOfficerGrantAction(input: {
	grantId: string;
}): Promise<ServerActionResult<{ grantId: string }>> {
	try {
		const access = await requireExpenseAdministrator();
		if ("error" in access) return { success: false, error: access.error };
		const { grantId } = await db.transaction((tx) =>
			revokeExpenseOfficerGrant(tx, {
				organizationId: access.organizationId,
				actorUserId: access.userId,
				grantId: input?.grantId,
			}),
		);
		revalidatePath("/settings/travel-expenses");
		revalidatePath("/travel-expenses");
		return { success: true, data: { grantId } };
	} catch (error) {
		return failure(error, "Failed to revoke the expense officer");
	}
}
