import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import * as schema from "@/db/auth-schema";
import { secondaryStorage } from "@/lib/redis";

type OrganizationSessionRevocationDb = Pick<typeof db, "delete" | "select">;

type OrganizationSessionRevocationDependencies = {
	db: OrganizationSessionRevocationDb;
	deleteSecondarySession: (token: string) => Promise<void>;
};

const defaultDependencies: OrganizationSessionRevocationDependencies = {
	db,
	deleteSecondarySession: (token) => secondaryStorage.deleteOrThrow(token),
};

export async function deleteOrganizationActiveSessionRows(
	userId: string,
	organizationId: string,
	dbClient: OrganizationSessionRevocationDb,
) {
	const predicate = and(
		eq(schema.session.userId, userId),
		eq(schema.session.activeOrganizationId, organizationId),
	);
	const sessions = await dbClient
		.select({ token: schema.session.token })
		.from(schema.session)
		.where(predicate);

	await dbClient.delete(schema.session).where(predicate);
	return sessions.map(({ token }) => token);
}

export async function revokeOrganizationActiveSessions(
	userId: string,
	organizationId: string,
	dependencies: OrganizationSessionRevocationDependencies = defaultDependencies,
) {
	const tokens = await deleteOrganizationActiveSessionRows(
		userId,
		organizationId,
		dependencies.db,
	);
	await Promise.all(
		tokens.map((token) => dependencies.deleteSecondarySession(token)),
	);
}
