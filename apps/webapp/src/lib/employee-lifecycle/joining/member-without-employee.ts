import { and, eq } from "drizzle-orm";
import { employee } from "@/db/schema";
import type { JoiningDatabase } from "./invitation-draft";
import { acquireJoiningLocks, joinOrganization, type MembershipRole } from "./joining";

type Employee = typeof employee.$inferSelect;

/**
 * Joins a member who holds an approved membership but has no employee row:
 * the backfill (#1671) and the organization switch route's remaining net (spec
 * #1664 decision 9). A member who has an employee row, current or not, is never
 * touched, so this never reactivates anyone. No seat changes now, so no seat
 * signal is sent. `joined` says whether it wrote the employee.
 */
export async function joinMemberWithoutEmployee(
	database: JoiningDatabase,
	input: {
		organizationId: string;
		userId: string;
		membership: { id: string; role: MembershipRole };
	},
): Promise<{ employee: Employee; joined: boolean }> {
	const result = await database.transaction(async (tx) => {
		// The same locks joining takes: re-entrant, so joining takes them again below.
		await acquireJoiningLocks(tx, input);
		const existing = await tx.query.employee.findFirst({
			where: and(
				eq(employee.userId, input.userId),
				eq(employee.organizationId, input.organizationId),
			),
		});
		if (existing) return { employee: existing, afterCommit: null };
		const joining = await joinOrganization(tx, input);
		return { employee: joining.outcome.employee, afterCommit: joining.afterCommit };
	});
	await result.afterCommit?.run({ seatSignal: false });
	return { employee: result.employee, joined: result.afterCommit !== null };
}
