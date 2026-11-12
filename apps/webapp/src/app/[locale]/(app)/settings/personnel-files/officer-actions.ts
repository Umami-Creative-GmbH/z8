"use server";

import { asc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { user } from "@/db/auth-schema";
import { employee, team } from "@/db/schema";
import type { DatabaseClient } from "@/lib/effect/services/database.service";
import { formerSinceDate, isFormerEmployee } from "@/lib/employee-lifecycle/current-roster";
import { noInput, organizationAction } from "@/lib/organization-action/organization-action";
import { personnelFileStoreWork, whilePersonnelFilesOn } from "@/lib/personnel-file/administration";
import { DOCUMENT_CATEGORIES } from "@/lib/personnel-file/document.types";
import type { SavePersonnelFileOfficerGrantInput } from "@/lib/personnel-file/officer-grant";
import {
	listActivePersonnelFileOfficerGrants,
	type PersonnelFileOfficerGrantRecord,
	revokePersonnelFileOfficerGrant,
	savePersonnelFileOfficerGrant,
} from "@/lib/personnel-file/officer-grant-store";
import { isUuid } from "@/lib/validations/uuid";

/**
 * Personnel file officers (#866, ADR 0001): who besides owners and admins
 * sees and manages employee documents, for which employees and categories.
 * Managed by owners and admins on the Access tab of Settings → Personnel files.
 * The officer grant model still decides document access; settings access
 * (org admins, #1592) only decides who configures it.
 */

export type { SavePersonnelFileOfficerGrantInput } from "@/lib/personnel-file/officer-grant";
export type PersonnelFileOfficerGrantData = PersonnelFileOfficerGrantRecord;

export interface PersonnelFileOfficerPersonOption {
	id: string;
	name: string;
	email: string;
}

/** A former employee, with the organization-local date they left (#1439; null when not recorded). */
export interface PersonnelFileOfficerDepartedPersonOption extends PersonnelFileOfficerPersonOption {
	formerSince: string | null;
}

export interface PersonnelFileOfficerAdminData {
	/** Active employees: possible officers and named employees. */
	employees: PersonnelFileOfficerPersonOption[];
	/** Departed employees: they can still be named, their files stay managed. */
	departedEmployees: PersonnelFileOfficerDepartedPersonOption[];
	teams: Array<{ id: string; name: string }>;
	grants: PersonnelFileOfficerGrantData[];
}

const OFF_MESSAGE = "Only owners and admins can manage personnel file officers";

/** The shape of a grant; the store checks IDs, ownership and the scope rules. */
const officerGrantSchema = z.strictObject(
	{
		officerEmployeeId: z.string("officerEmployeeId is required"),
		scope: z.enum(["all", "specific"], "Choose which employees the personnel file officer covers"),
		teamIds: z.array(z.string("teamIds is required"), "teamIds must be an array"),
		employeeIds: z.array(z.string("employeeIds is required"), "employeeIds must be an array"),
		categories: z.array(
			z.enum(DOCUMENT_CATEGORIES),
			"Document categories must be contract, payslip, certificate, sick note or other",
		),
	},
	"Personnel file officer input is required",
) satisfies z.ZodType<SavePersonnelFileOfficerGrantInput>;

function revalidate() {
	revalidatePath("/settings/personnel-files");
	revalidatePath("/personnel-files");
}

/** Officer pickers and grants; the people list marks former employees (#1438). */
async function loadOfficerAdminData(
	db: DatabaseClient,
	organizationId: string,
): Promise<PersonnelFileOfficerAdminData> {
	const [people, teams, grants] = await Promise.all([
		db
			.select({
				id: employee.id,
				employeeNumber: employee.employeeNumber,
				// Current roster (#1438): a due departure counts the same as a deactivation.
				isFormer: isFormerEmployee(employee),
				formerSince: formerSinceDate(employee),
				name: user.name,
				email: user.email,
			})
			.from(employee)
			.innerJoin(user, eq(user.id, employee.userId))
			.where(eq(employee.organizationId, organizationId))
			.orderBy(asc(user.name), asc(employee.employeeNumber), asc(employee.id)),
		db
			.select({ id: team.id, name: team.name })
			.from(team)
			.where(eq(team.organizationId, organizationId))
			.orderBy(asc(team.name)),
		listActivePersonnelFileOfficerGrants(db, { organizationId }),
	]);
	const toOption = (row: (typeof people)[number]): PersonnelFileOfficerPersonOption => ({
		id: row.id,
		name: row.name?.trim() || row.employeeNumber || row.id,
		email: row.email,
	});
	return {
		employees: people.filter((row) => !row.isFormer).map(toOption),
		departedEmployees: people
			.filter((row) => row.isFormer)
			.map((row) => ({ ...toOption(row), formerSince: row.formerSince })),
		teams,
		grants,
	};
}

export const getPersonnelFileOfficerAdminData = organizationAction(
	{ name: "personnelFile.officerAdminData", requires: "orgAdmin", schema: noInput },
	({ organizationId }) =>
		whilePersonnelFilesOn(
			organizationId,
			OFF_MESSAGE,
			personnelFileStoreWork("personnelFile.officerAdminData", (db) =>
				loadOfficerAdminData(db, organizationId),
			),
		),
);

export const savePersonnelFileOfficerGrantAction = organizationAction(
	{
		name: "personnelFile.saveOfficerGrant",
		requires: "orgAdmin",
		schema: officerGrantSchema,
		// The officer joins the role; named employees may be former (their files stay managed).
		addsEmployees: (input) => (isUuid(input.officerEmployeeId) ? [input.officerEmployeeId] : []),
	},
	({ actor, organizationId, input }) =>
		whilePersonnelFilesOn(
			organizationId,
			OFF_MESSAGE,
			personnelFileStoreWork("personnelFile.saveOfficerGrant", async (db) => {
				const { grantId } = await db.transaction((tx) =>
					savePersonnelFileOfficerGrant(tx, {
						organizationId,
						actorUserId: actor.userId,
						grant: input,
					}),
				);
				revalidate();
				return { grantId };
			}),
		),
);

/** Ends the grant's access at once: the access resolver reads the active grant per request. */
export const revokePersonnelFileOfficerGrantAction = organizationAction(
	{
		name: "personnelFile.revokeOfficerGrant",
		requires: "orgAdmin",
		schema: z.strictObject({ grantId: z.string("grantId is required") }),
	},
	({ actor, organizationId, input }) =>
		whilePersonnelFilesOn(
			organizationId,
			OFF_MESSAGE,
			personnelFileStoreWork("personnelFile.revokeOfficerGrant", async (db) => {
				const { grantId } = await db.transaction((tx) =>
					revokePersonnelFileOfficerGrant(tx, {
						organizationId,
						actorUserId: actor.userId,
						grantId: input.grantId,
					}),
				);
				revalidate();
				return { grantId };
			}),
		),
);
