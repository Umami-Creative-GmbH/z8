import { and, eq } from "drizzle-orm";
import { member } from "@/db/auth-schema";
import { employee } from "@/db/schema";
import { consumeInvitationDrafts, type JoiningDatabase } from "./invitation-draft";
import { acquireJoiningLocks, joinOrganization, type MembershipRole } from "./joining";

/**
 * Repairs on read (spec #1664 decision 9, until they are removed): a member
 * who holds an approved membership but has no employee row joins. A member
 * who has an employee row, current or not, is never touched, so a repair never
 * reactivates anyone. No seat changes now, so no seat signal is sent.
 */
export async function joinMemberWithoutEmployee(
	database: JoiningDatabase,
	input: {
		organizationId: string;
		userId: string;
		membership: { id: string; role: MembershipRole };
	},
) {
	const repaired = await database.transaction(async (tx) => {
		// The same locks joining takes: re-entrant, so joining takes them again below.
		await acquireJoiningLocks(tx, input);
		const existing = await tx.query.employee.findFirst({
			where: and(
				eq(employee.userId, input.userId),
				eq(employee.organizationId, input.organizationId),
			),
		});
		if (existing) return { employee: existing, afterCommit: null };
		const joined = await joinOrganization(tx, input);
		return { employee: joined.outcome.employee, afterCommit: joined.afterCommit };
	});
	await repaired.afterCommit?.run({ seatSignal: false });
	return repaired.employee;
}

/** Joins every approved member of the organization who has no employee, then clears consumed drafts. */
export async function joinMembersWithoutEmployee(
	database: JoiningDatabase,
	organizationId: string,
) {
	const [members, employees] = await Promise.all([
		database.query.member.findMany({
			where: and(eq(member.organizationId, organizationId), eq(member.status, "approved")),
			columns: { id: true, userId: true, role: true },
		}),
		database.query.employee.findMany({
			where: eq(employee.organizationId, organizationId),
			columns: { userId: true },
		}),
	]);
	const employedUserIds = new Set(employees.map((row) => row.userId));

	await Promise.all(
		members
			.filter((row) => !employedUserIds.has(row.userId))
			.map((row) =>
				joinMemberWithoutEmployee(database, {
					organizationId,
					userId: row.userId,
					membership: { id: row.id, role: row.role },
				}),
			),
	);
	await consumeInvitationDrafts(database, { organizationId });
}
