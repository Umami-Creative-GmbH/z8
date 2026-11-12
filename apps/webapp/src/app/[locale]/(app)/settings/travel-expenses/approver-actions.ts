"use server";

import { and, asc, eq, inArray } from "drizzle-orm";
import { Effect } from "effect";
import { z } from "zod";
import { user } from "@/db/auth-schema";
import { employee, travelExpenseSettings } from "@/db/schema";
import { ValidationError } from "@/lib/effect/errors";
import type { DatabaseClient } from "@/lib/effect/services/database.service";
import { noInput, organizationAction } from "@/lib/organization-action/organization-action";
import { expenseStore, revalidateExpenseSettings } from "./expense-settings-effects";

/**
 * The organization expense approver (#602): the last reviewer fallback, after
 * the direct manager and the team manager, for submitted expense reports.
 */

export interface TravelExpenseApproverSettings {
	expenseApproverEmployeeId: string | null;
	/** Active managers and admins: only they can review in the Approvals inbox. */
	candidates: { id: string; name: string; role: "manager" | "admin" }[];
}

async function loadApproverCandidates(
	database: DatabaseClient,
	organizationId: string,
): Promise<TravelExpenseApproverSettings["candidates"]> {
	const rows = await database
		.select({ id: employee.id, name: user.name, role: employee.role })
		.from(employee)
		.innerJoin(user, eq(user.id, employee.userId))
		.where(
			and(
				eq(employee.organizationId, organizationId),
				eq(employee.isActive, true),
				inArray(employee.role, ["manager", "admin"]),
			),
		)
		.orderBy(asc(user.name));
	return rows.flatMap((row) =>
		row.role === "manager" || row.role === "admin" ? [{ ...row, role: row.role }] : [],
	);
}

export const getTravelExpenseApproverSettings = organizationAction(
	{ name: "travelExpenses.getApprover", requires: "orgAdmin", schema: noInput },
	({ organizationId }) =>
		Effect.gen(function* () {
			const [settings, candidates] = yield* expenseStore(
				"travelExpenses.getApprover",
				"Failed to load the expense approver",
				(database) =>
					Promise.all([
						database
							.select({
								expenseApproverEmployeeId: travelExpenseSettings.expenseApproverEmployeeId,
							})
							.from(travelExpenseSettings)
							.where(eq(travelExpenseSettings.organizationId, organizationId))
							.limit(1),
						loadApproverCandidates(database, organizationId),
					]),
			);
			return {
				expenseApproverEmployeeId: settings[0]?.expenseApproverEmployeeId ?? null,
				candidates,
			} satisfies TravelExpenseApproverSettings;
		}),
);

const notACandidate = "Choose an active manager or administrator of this organization";

export const saveTravelExpenseApprover = organizationAction(
	{
		name: "travelExpenses.saveApprover",
		requires: "orgAdmin",
		schema: z.strictObject({
			expenseApproverEmployeeId: z.string(notACandidate).nullable(),
		}),
		addsEmployees: (input) => [input.expenseApproverEmployeeId],
	},
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const failure = "Failed to save the expense approver";
			const approverId = input.expenseApproverEmployeeId;
			if (approverId !== null) {
				const candidates = yield* expenseStore(
					"travelExpenses.loadApproverCandidates",
					failure,
					(database) => loadApproverCandidates(database, organizationId),
				);
				// Never another organization's employee, nor one who cannot open the inbox.
				if (!candidates.some((candidate) => candidate.id === approverId)) {
					return yield* Effect.fail(
						new ValidationError({ message: notACandidate, field: "expenseApproverEmployeeId" }),
					);
				}
			}
			const now = new Date();
			yield* expenseStore("travelExpenses.saveApprover", failure, (database) =>
				database
					.insert(travelExpenseSettings)
					.values({
						organizationId,
						expenseApproverEmployeeId: approverId,
						updatedAt: now,
						updatedBy: actor.userId,
					})
					.onConflictDoUpdate({
						target: travelExpenseSettings.organizationId,
						set: { expenseApproverEmployeeId: approverId, updatedAt: now, updatedBy: actor.userId },
					}),
			);
			yield* revalidateExpenseSettings();
			return { expenseApproverEmployeeId: approverId };
		}),
);
