import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { member } from "@/db/auth-schema";

export async function getCurrentApprovedMembership(input: {
	userId: string;
	organizationId: string;
}) {
	return (
		(await db.query.member.findFirst({
			where: and(
				eq(member.userId, input.userId),
				eq(member.organizationId, input.organizationId),
				eq(member.status, "approved"),
			),
			columns: { role: true },
			orderBy: (membership, { desc }) => [
				desc(membership.createdAt),
				desc(membership.id),
			],
		})) ?? null
	);
}
