import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { member } from "@/db/auth-schema";
import { createLogger } from "@/lib/logger";

const logger = createLogger("PrimaryOrganization");

/**
 * The user's primary organization for messages about their account rather than one
 * organization (sign-in emails, security alerts): their earliest membership,
 * deterministic for members of several organizations. None for a user without one.
 */
export async function getUserPrimaryOrganizationId(userId: string): Promise<string | undefined> {
	try {
		const membership = await db.query.member.findFirst({
			where: eq(member.userId, userId),
			columns: { organizationId: true },
			orderBy: [asc(member.createdAt), asc(member.id)],
		});
		return membership?.organizationId;
	} catch (error) {
		logger.warn({ error, userId }, "Failed to get the user's primary organization");
		return undefined;
	}
}
