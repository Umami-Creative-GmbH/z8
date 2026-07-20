import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import * as authSchema from "@/db/auth-schema";
import { employee } from "@/db/schema";
import { hasOrganizationRole } from "./organization-role";

type AuthSecondaryStorageDb = Pick<typeof db, "delete" | "query">;

type SecondaryStorage = {
	get: (key: string) => Promise<string | null>;
	set: (key: string, value: string, ttl?: number) => Promise<void>;
	delete: (key: string) => Promise<void>;
};

type StrictSecondaryStorage = SecondaryStorage & {
	deleteOrThrow: (key: string) => Promise<void>;
};

type SerializedSession = {
	activeOrganizationId: string | null;
	token: string;
	userId: string;
};

const sessionInvalidationErrorMessage =
	"Organization session invalidation failed";

type ParsedSecondaryValue =
	| { kind: "session"; session: SerializedSession }
	| { kind: "invalid-session" }
	| { kind: "other" };

function parseSecondaryValue(value: string): ParsedSecondaryValue {
	try {
		const parsed = JSON.parse(value) as unknown;
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
			return { kind: "other" };
		if (!("session" in parsed)) return { kind: "other" };

		const session = parsed.session;
		if (!session || typeof session !== "object" || Array.isArray(session))
			return { kind: "invalid-session" };

		const { activeOrganizationId, token, userId } = session as {
			activeOrganizationId?: unknown;
			token?: unknown;
			userId?: unknown;
		};
		if (
			(activeOrganizationId !== null &&
				(typeof activeOrganizationId !== "string" ||
					activeOrganizationId.length === 0)) ||
			typeof token !== "string" ||
			token.length === 0 ||
			typeof userId !== "string" ||
			userId.length === 0
		) {
			return { kind: "invalid-session" };
		}

		return {
			kind: "session",
			session: { activeOrganizationId, token, userId },
		};
	} catch {
		return { kind: "other" };
	}
}

async function invalidateSession(
	storage: StrictSecondaryStorage,
	dbClient: AuthSecondaryStorageDb,
	key: string,
	session: SerializedSession,
) {
	if (session.token !== key) throw new Error(sessionInvalidationErrorMessage);

	try {
		await dbClient
			.delete(authSchema.session)
			.where(
				and(
					eq(authSchema.session.token, session.token),
					eq(authSchema.session.userId, session.userId),
				),
			);
		await storage.deleteOrThrow(key);
	} catch {
		throw new Error(sessionInvalidationErrorMessage);
	}
}

export function createGuardedAuthSecondaryStorage(
	storage: StrictSecondaryStorage,
	dbClient: AuthSecondaryStorageDb = db,
): SecondaryStorage {
	return {
		get: async (key) => {
			const value = await storage.get(key);
			if (value === null) return null;

			const parsed = parseSecondaryValue(value);
			if (parsed.kind === "other") return value;
			if (parsed.kind === "invalid-session") {
				throw new Error(sessionInvalidationErrorMessage);
			}

			try {
				const { activeOrganizationId, userId } = parsed.session;
				const persistedSession = await dbClient.query.session.findFirst({
					where: and(
						eq(authSchema.session.token, parsed.session.token),
						eq(authSchema.session.userId, userId),
					),
					columns: { id: true },
				});
				if (!persistedSession) {
					await invalidateSession(storage, dbClient, key, parsed.session);
					return null;
				}
				if (activeOrganizationId === null) return value;

				const [membership, employeeRecord] = await Promise.all([
					dbClient.query.member.findFirst({
						where: and(
							eq(authSchema.member.userId, userId),
							eq(authSchema.member.organizationId, activeOrganizationId),
							eq(authSchema.member.status, "approved"),
						),
						columns: { role: true },
					}),
					dbClient.query.employee.findFirst({
						where: and(
							eq(employee.userId, userId),
							eq(employee.organizationId, activeOrganizationId),
						),
						columns: { isActive: true },
					}),
				]);
				const hasAccess =
					membership != null &&
					(employeeRecord != null
						? employeeRecord.isActive === true
						: hasOrganizationRole(membership.role, "owner") ||
							hasOrganizationRole(membership.role, "admin"));
				if (hasAccess) return value;
			} catch {
				// Identifiable sessions fail closed when committed access cannot be checked.
			}

			await invalidateSession(storage, dbClient, key, parsed.session);
			return null;
		},
		delete: storage.delete,
		set: storage.set,
	};
}
