"use server";

import { asc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { user } from "@/db/auth-schema";
import { employee, team } from "@/db/schema";
import { NotFoundError, ValidationError } from "@/lib/effect/errors";
import type { ServerActionResult } from "@/lib/effect/result";
import { logger } from "@/lib/logger";
import { requirePersonnelFileAdministrator } from "@/lib/personnel-file/administrator";
import type { SavePersonnelFileOfficerGrantInput } from "@/lib/personnel-file/officer-grant";
import {
	listActivePersonnelFileOfficerGrants,
	type PersonnelFileOfficerGrantRecord,
	revokePersonnelFileOfficerGrant,
	savePersonnelFileOfficerGrant,
} from "@/lib/personnel-file/officer-grant-store";

/**
 * Personnel file officers (#866, ADR 0001): who besides owners and admins
 * sees and manages employee documents, for which employees and categories.
 * Managed by owners and admins on the Access tab of Settings → Personnel files.
 */

export type { SavePersonnelFileOfficerGrantInput } from "@/lib/personnel-file/officer-grant";
export type PersonnelFileOfficerGrantData = PersonnelFileOfficerGrantRecord;

export interface PersonnelFileOfficerPersonOption {
	id: string;
	name: string;
	email: string;
}

export interface PersonnelFileOfficerAdminData {
	/** Active employees: possible officers and named employees. */
	employees: PersonnelFileOfficerPersonOption[];
	/** Departed employees: they can still be named, their files stay managed. */
	departedEmployees: PersonnelFileOfficerPersonOption[];
	teams: Array<{ id: string; name: string }>;
	grants: PersonnelFileOfficerGrantData[];
}

function failure(error: unknown, fallback: string): { success: false; error: string } {
	// Validation and not-found messages are written for the administrator.
	if (error instanceof ValidationError || error instanceof NotFoundError) {
		return { success: false, error: error.message };
	}
	logger.error({ error }, fallback);
	return { success: false, error: fallback };
}

function revalidate() {
	revalidatePath("/settings/personnel-files");
	revalidatePath("/personnel-files");
}

export async function getPersonnelFileOfficerAdminData(): Promise<
	ServerActionResult<PersonnelFileOfficerAdminData>
> {
	try {
		const access = await requirePersonnelFileAdministrator();
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
			listActivePersonnelFileOfficerGrants(db, { organizationId: access.organizationId }),
		]);
		const toOption = (row: (typeof people)[number]): PersonnelFileOfficerPersonOption => ({
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
		return failure(error, "Failed to load the personnel file officers");
	}
}

export async function savePersonnelFileOfficerGrantAction(
	input: SavePersonnelFileOfficerGrantInput,
): Promise<ServerActionResult<{ grantId: string }>> {
	try {
		const access = await requirePersonnelFileAdministrator();
		if ("error" in access) return { success: false, error: access.error };
		const { grantId } = await db.transaction((tx) =>
			savePersonnelFileOfficerGrant(tx, {
				organizationId: access.organizationId,
				actorUserId: access.userId,
				grant: input,
			}),
		);
		revalidate();
		return { success: true, data: { grantId } };
	} catch (error) {
		return failure(error, "Failed to save the personnel file officer");
	}
}

/** Ends the grant's access at once: the access resolver reads the active grant per request. */
export async function revokePersonnelFileOfficerGrantAction(input: {
	grantId: string;
}): Promise<ServerActionResult<{ grantId: string }>> {
	try {
		const access = await requirePersonnelFileAdministrator();
		if ("error" in access) return { success: false, error: access.error };
		const { grantId } = await db.transaction((tx) =>
			revokePersonnelFileOfficerGrant(tx, {
				organizationId: access.organizationId,
				actorUserId: access.userId,
				grantId: input?.grantId,
			}),
		);
		revalidate();
		return { success: true, data: { grantId } };
	} catch (error) {
		return failure(error, "Failed to revoke the personnel file officer");
	}
}
