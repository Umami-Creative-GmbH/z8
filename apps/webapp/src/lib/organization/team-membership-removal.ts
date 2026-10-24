import { and, eq } from "drizzle-orm";
import type { db } from "@/db";
import { employee, teamMembership } from "@/db/schema";
import { currentTimestamp } from "@/lib/datetime/drizzle-adapter";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type TeamMembershipWriter = Pick<Transaction, "delete" | "query" | "update">;

/**
 * Removes one team membership in the caller's transaction; when it was the
 * employee's primary (compatibility) team, the alphabetically first remaining
 * membership (by id) becomes the primary team, else none. Shared by the team
 * settings action and the deactivation (#1440).
 */
export async function removeTeamMembership(
	tx: TeamMembershipWriter,
	input: { organizationId: string; teamId: string; employeeId: string },
): Promise<void> {
	const { organizationId, teamId, employeeId } = input;
	await tx
		.delete(teamMembership)
		.where(
			and(
				eq(teamMembership.organizationId, organizationId),
				eq(teamMembership.teamId, teamId),
				eq(teamMembership.employeeId, employeeId),
			),
		);

	// Re-read under protection: the compatibility team may have moved.
	const current = await tx.query.employee.findFirst({
		where: and(eq(employee.id, employeeId), eq(employee.organizationId, organizationId)),
		columns: { teamId: true },
	});
	if (current?.teamId !== teamId) return;

	const remainingMemberships = await tx.query.teamMembership.findMany({
		where: and(
			eq(teamMembership.organizationId, organizationId),
			eq(teamMembership.employeeId, employeeId),
		),
	});
	const nextTeamId =
		remainingMemberships
			.flatMap((membership) => (membership.teamId !== teamId ? [membership.teamId] : []))
			.toSorted()[0] ?? null;

	await tx
		.update(employee)
		.set({ teamId: nextTeamId, updatedAt: currentTimestamp() })
		.where(and(eq(employee.id, employeeId), eq(employee.organizationId, organizationId)));
}
