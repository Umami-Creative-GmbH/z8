"use server";

import { and, asc, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { user } from "@/db/auth-schema";
import { employee, travelExpenseSettings } from "@/db/schema";
import type { ServerActionResult } from "@/lib/effect/result";
import { logger } from "@/lib/logger";
import { requireExpenseAdministrator } from "@/lib/travel-expenses/expense-administrator";

/**
 * The organization expense approver (#602): the last reviewer fallback, after
 * the direct manager and the team manager, for submitted expense reports.
 */

export interface TravelExpenseApproverSettings {
	expenseApproverEmployeeId: string | null;
	/** Active managers and admins: only they can review in the Approvals inbox. */
	candidates: { id: string; name: string; role: "manager" | "admin" }[];
}

const requireOrgAdmin = () => requireExpenseAdministrator();

async function loadApproverCandidates(
	organizationId: string,
): Promise<TravelExpenseApproverSettings["candidates"]> {
	const rows = await db
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

export async function getTravelExpenseApproverSettings(): Promise<
	ServerActionResult<TravelExpenseApproverSettings>
> {
	try {
		const access = await requireOrgAdmin();
		if ("error" in access) return { success: false, error: access.error };
		const [settings, candidates] = await Promise.all([
			db
				.select({ expenseApproverEmployeeId: travelExpenseSettings.expenseApproverEmployeeId })
				.from(travelExpenseSettings)
				.where(eq(travelExpenseSettings.organizationId, access.organizationId))
				.limit(1),
			loadApproverCandidates(access.organizationId),
		]);
		return {
			success: true,
			data: {
				expenseApproverEmployeeId: settings[0]?.expenseApproverEmployeeId ?? null,
				candidates,
			},
		};
	} catch (error) {
		logger.error({ error }, "Failed to load the travel expense approver");
		return { success: false, error: "Failed to load the expense approver" };
	}
}

export async function saveTravelExpenseApprover(input: {
	expenseApproverEmployeeId: string | null;
}): Promise<ServerActionResult<{ expenseApproverEmployeeId: string | null }>> {
	try {
		const access = await requireOrgAdmin();
		if ("error" in access) return { success: false, error: access.error };
		const approverId = input.expenseApproverEmployeeId;
		if (approverId !== null) {
			const candidates = await loadApproverCandidates(access.organizationId);
			// Never another organization's employee, nor one who cannot open the inbox.
			if (!candidates.some((candidate) => candidate.id === approverId)) {
				return {
					success: false,
					error: "Choose an active manager or administrator of this organization",
				};
			}
		}
		const now = new Date();
		await db
			.insert(travelExpenseSettings)
			.values({
				organizationId: access.organizationId,
				expenseApproverEmployeeId: approverId,
				updatedAt: now,
				updatedBy: access.userId,
			})
			.onConflictDoUpdate({
				target: travelExpenseSettings.organizationId,
				set: { expenseApproverEmployeeId: approverId, updatedAt: now, updatedBy: access.userId },
			});
		revalidatePath("/settings/travel-expenses");
		return { success: true, data: { expenseApproverEmployeeId: approverId } };
	} catch (error) {
		logger.error({ error }, "Failed to save the travel expense approver");
		return { success: false, error: "Failed to save the expense approver" };
	}
}
