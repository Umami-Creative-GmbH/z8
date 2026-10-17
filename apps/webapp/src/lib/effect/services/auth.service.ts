import { Context, Effect, Layer } from "effect";
import type { SessionAuthUser } from "@/lib/auth/auth-context-user";
import { getRequestSession } from "@/lib/auth/request-session";
import { withMfaDatabase } from "@/lib/organization-mfa/database-context";
import { canAccessOrganization } from "@/lib/organization-mfa/organization-access";
import { AuthenticationError } from "../errors";
import { DatabaseService } from "./database.service";

export interface Session {
	user: SessionAuthUser & {
		invitedVia?: string | null;
	};
	session: {
		id: string;
		userId: string;
		expiresAt: Date;
		token: string;
		activeOrganizationId: string | null;
	};
}

export class AuthService extends Context.Service<
	AuthService,
	{
		readonly getSession: (
			organizationId?: string,
		) => Effect.Effect<Session, AuthenticationError, DatabaseService>;
	}
>()("AuthService") {}

export const AuthServiceLive = Layer.succeed(
	AuthService,
	AuthService.of({
		getSession: (organizationId) =>
			Effect.gen(function* () {
				const database = yield* DatabaseService;
				return yield* database
					.query("organizationAuthentication.session", async () => {
						const session = await withMfaDatabase(database.db, () =>
							getRequestSession(),
						);

						if (
							!session?.user ||
							("ssoRequired" in session && session.ssoRequired === true) ||
							("mfaRequired" in session && !!session.mfaRequired)
						) {
							throw new Error("No session found");
						}

						if (
							organizationId &&
							!(await canAccessOrganization(
								session.session,
								organizationId,
								database.db,
							))
						)
							throw new Error("SSO authentication required");
						return {
							...session,
							session: {
								...session.session,
								activeOrganizationId:
									session.session.activeOrganizationId ?? null,
							},
						} as Session;
					})
					.pipe(
						Effect.mapError(
							() =>
								new AuthenticationError({
									message: "Not authenticated",
								}),
						),
					);
			}),
	}),
);
