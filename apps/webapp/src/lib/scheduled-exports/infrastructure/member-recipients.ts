import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { member, user } from "@/db/auth-schema";

/**
 * The Z8 users among a scheduled export's recipient addresses who are members of the
 * organization, keyed by lowercased address. An org admin recipient (or an approved
 * external recipient who is also a member) gets their own recipient language; any
 * other address has no user here.
 */
export async function findMemberUserIdsByEmail(
	organizationId: string,
	emails: readonly string[],
): Promise<Map<string, string>> {
	const addresses = [...new Set(emails.map((email) => email.trim().toLowerCase()))].filter(Boolean);
	if (addresses.length === 0) return new Map();

	const rows = await db
		.selectDistinct({ userId: user.id, email: sql<string>`lower(${user.email})` })
		.from(member)
		.innerJoin(user, eq(member.userId, user.id))
		.where(
			and(eq(member.organizationId, organizationId), inArray(sql`lower(${user.email})`, addresses)),
		);

	return new Map(rows.map((row) => [row.email, row.userId]));
}
