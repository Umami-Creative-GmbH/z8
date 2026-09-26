import { Context, Effect, Layer } from "effect";
import type { SessionAuthUser } from "@/lib/auth/auth-context-user";
import { getRequestSession } from "@/lib/auth/request-session";
import { canAccessOrganizationWithSso } from "@/lib/enterprise-identity/session-sso-store";
import { AuthenticationError } from "../errors";

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

export class AuthService extends Context.Tag("AuthService")<
	AuthService,
	{
		readonly getSession: (
			organizationId?: string,
		) => Effect.Effect<Session, AuthenticationError>;
	}
>() {}

export const AuthServiceLive = Layer.effect(
	AuthService,
	Effect.sync(() =>
		AuthService.of({
			getSession: (organizationId) =>
				Effect.tryPromise({
					try: async () => {
						const session = await getRequestSession();

						if (
							!session?.user ||
							("ssoRequired" in session && session.ssoRequired === true)
						) {
							throw new Error("No session found");
						}

						if (
							organizationId &&
							!(await canAccessOrganizationWithSso(
								session.session,
								organizationId,
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
					},
					catch: () =>
						new AuthenticationError({
							message: "Not authenticated",
						}),
				}),
		}),
	),
);
