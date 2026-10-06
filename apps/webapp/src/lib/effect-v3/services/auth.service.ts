// Frozen Effect v3 copy (#625). The v4 version is lib/effect/services/auth.service.ts.
// Make any change in both copies until #633 deletes lib/effect-v3.
import { Context, Effect, Layer } from "effect-v3";
import { getRequestSession } from "@/lib/auth/request-session";
import { canAccessOrganizationWithSso } from "@/lib/enterprise-identity/session-sso-store";
import { AuthenticationError } from "@/lib/effect/errors";
import type { Session } from "@/lib/effect/services/auth.service";

export type { Session } from "@/lib/effect/services/auth.service";

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
