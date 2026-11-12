"use server";

import { asc, eq } from "drizzle-orm";
import { Effect } from "effect";
import { z } from "zod";
import { user } from "@/db/auth-schema";
import { employee, team } from "@/db/schema";
import { formerSinceDate, isFormerEmployee } from "@/lib/employee-lifecycle/current-roster";
import { noInput, organizationAction } from "@/lib/organization-action/organization-action";
import type { SaveExpenseOfficerGrantInput } from "@/lib/travel-expenses/expense-officer-grant";
import {
	type ExpenseOfficerGrantRecord,
	listActiveExpenseOfficerGrants,
	revokeExpenseOfficerGrant,
	saveExpenseOfficerGrant,
} from "@/lib/travel-expenses/expense-officer-grant-store";
import { expenseStore, revalidateExpenseSettings } from "./expense-settings-effects";

/**
 * Expense officers (#747, ADR 0001): who handles approved expense reports
 * besides owners and admins, in which scope and with which capabilities.
 * Managed by org admins on the Access tab. The grant model still decides who
 * acts as an expense officer; this module only decides who configures it.
 */

export type { SaveExpenseOfficerGrantInput } from "@/lib/travel-expenses/expense-officer-grant";
export type ExpenseOfficerGrantData = ExpenseOfficerGrantRecord;

export interface ExpenseOfficerPersonOption {
	id: string;
	name: string;
	email: string;
}

/** A former employee, with the organization-local date they left (#1439; null when not recorded). */
export interface ExpenseOfficerDepartedPersonOption extends ExpenseOfficerPersonOption {
	formerSince: string | null;
}

export interface ExpenseOfficerAdminData {
	/** Active employees: possible officers and named employees. */
	employees: ExpenseOfficerPersonOption[];
	/** Departed employees: they can still be named, since their last reports may be owed. */
	departedEmployees: ExpenseOfficerDepartedPersonOption[];
	teams: Array<{ id: string; name: string }>;
	grants: ExpenseOfficerGrantData[];
}

export const getExpenseOfficerAdminData = organizationAction(
	{ name: "travelExpenses.getExpenseOfficers", requires: "orgAdmin", schema: noInput },
	({ organizationId }) =>
		Effect.gen(function* () {
			const [people, teams, grants] = yield* expenseStore(
				"travelExpenses.getExpenseOfficers",
				"Failed to load the expense officers",
				(database) =>
					Promise.all([
						database
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
						database
							.select({ id: team.id, name: team.name })
							.from(team)
							.where(eq(team.organizationId, organizationId))
							.orderBy(asc(team.name)),
						listActiveExpenseOfficerGrants(database, { organizationId }),
					]),
			);
			const toOption = (row: (typeof people)[number]): ExpenseOfficerPersonOption => ({
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
			} satisfies ExpenseOfficerAdminData;
		}),
);

/**
 * The grant's shape; the grant rules (`validateExpenseOfficerGrant`) check
 * ownership and the scope with messages written for the administrator.
 */
const saveGrantSchema = z.object(
	{
		officerEmployeeId: z.string("Expense officer input is required"),
		scope: z.enum(["all", "specific"], "Choose who the expense officer handles"),
		teamIds: z.array(z.string(), "teamIds must be a list"),
		employeeIds: z.array(z.string(), "employeeIds must be a list"),
		canExport: z.boolean("canExport must be true or false"),
		canRecordReimbursements: z.boolean("canRecordReimbursements must be true or false"),
	},
	"Expense officer input is required",
) satisfies z.ZodType<SaveExpenseOfficerGrantInput>;

export const saveExpenseOfficerGrantAction = organizationAction(
	{
		name: "travelExpenses.saveExpenseOfficer",
		requires: "orgAdmin",
		schema: saveGrantSchema,
		// Departed employees may still be named in the scope; only the officer must be current.
		addsEmployees: (input) => [input.officerEmployeeId],
	},
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const { grantId } = yield* expenseStore(
				"travelExpenses.saveExpenseOfficer",
				"Failed to save the expense officer",
				(database) =>
					database.transaction((tx) =>
						saveExpenseOfficerGrant(tx, {
							organizationId,
							actorUserId: actor.userId,
							grant: input,
						}),
					),
			);
			yield* revalidateExpenseSettings("/travel-expenses");
			return { grantId };
		}),
);

/** Ends the grant's access at once: every finance surface reads the active grant per request. */
export const revokeExpenseOfficerGrantAction = organizationAction(
	{
		name: "travelExpenses.revokeExpenseOfficer",
		requires: "orgAdmin",
		schema: z.strictObject({ grantId: z.string("Expense officer not found") }),
	},
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const { grantId } = yield* expenseStore(
				"travelExpenses.revokeExpenseOfficer",
				"Failed to revoke the expense officer",
				(database) =>
					database.transaction((tx) =>
						revokeExpenseOfficerGrant(tx, {
							organizationId,
							actorUserId: actor.userId,
							grantId: input.grantId,
						}),
					),
			);
			yield* revalidateExpenseSettings("/travel-expenses");
			return { grantId };
		}),
);
