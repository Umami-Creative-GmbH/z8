import { Context, Effect, Layer } from "effect";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { AuthenticationError } from "../errors";

export interface Session {
	user: {
		id: string;
		email: string;
		name: string;
		role?: string;
	};
	session: {
		id: string;
		userId: string;
		expiresAt: Date;
		token: string;
		activeOrganizationId?: string;
	};
}

export class AuthService extends Context.Tag("AuthService")<
	AuthService,
	{
		readonly getSession: () => Effect.Effect<Session, AuthenticationError>;
	}
>() {}

export const AuthServiceLive = Layer.effect(
	AuthService,
	Effect.sync(() =>
		AuthService.of({
			getSession: () =>
				Effect.tryPromise({
					try: async () => {
						const session = await auth.api.getSession({
							headers: await headers(),
						});

						if (!session?.user) {
							throw new Error("No session found");
						}

						return session as Session;
					},
					catch: () =>
						new AuthenticationError({
							message: "Not authenticated",
						}),
				}),
		}),
	),
);
