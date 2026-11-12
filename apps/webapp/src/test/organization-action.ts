import { Effect, Layer } from "effect";
import { AuthenticationError } from "@/lib/effect/errors";
import { AuthService, type Session } from "@/lib/effect/services/auth.service";
import { type DatabaseQuery, DatabaseService } from "@/lib/effect/services/database.service";
import {
	SETTINGS_ACCESS_FACTS_QUERY,
	type SettingsAccessFacts,
} from "@/lib/organization-action/settings-access";

/**
 * The caller an `organizationAction` sees in a unit test: who is signed in, their
 * active organization and the facts settings access is decided from.
 */
export interface StubCaller extends SettingsAccessFacts {
	userId: string;
	activeOrganizationId: string | null;
	/** The SSO/MFA organization gate refuses the active organization. */
	organizationAccessRefused?: boolean;
}

/**
 * Stub `AuthService` and `DatabaseService` for unit tests of actions built with
 * `organizationAction`, without mocking any auth module:
 *
 * vi.mock("@/lib/effect/runtime", async () =>
 *   (await import("@/test/effect-runtime")).runtimeModuleOver(
 *     (await import("@/test/organization-action")).organizationActionStubLayer(() => harness.caller, {
 *       db: harness.db,
 *     }),
 *   ),
 * );
 *
 * `caller()` is read on every call, so a test changes `harness.caller`; null is
 * signed out. The settings access facts are answered from the caller; every
 * other query runs against `db` (or `query`, when given).
 */
export function organizationActionStubLayer(
	caller: () => StubCaller | null,
	options: { db?: unknown; query?: DatabaseQuery } = {},
) {
	const runQuery: DatabaseQuery = options.query ?? ((_name, fn) => Effect.promise(fn));
	const query: DatabaseQuery = (name, fn) => {
		if (name !== SETTINGS_ACCESS_FACTS_QUERY) return runQuery(name, fn);
		const current = caller();
		return Effect.succeed({
			membershipRole: current?.membershipRole ?? null,
			employee: current?.employee ?? null,
		} satisfies SettingsAccessFacts) as never;
	};

	return Layer.mergeAll(
		Layer.succeed(
			AuthService,
			AuthService.of({
				getSession: (organizationId) => {
					const current = caller();
					if (!current || (organizationId && current.organizationAccessRefused)) {
						return Effect.fail(new AuthenticationError({ message: "Not authenticated" }));
					}
					return Effect.succeed(sessionOf(current));
				},
			}),
		),
		Layer.succeed(DatabaseService, DatabaseService.of({ db: (options.db ?? {}) as never, query })),
	);
}

function sessionOf(caller: StubCaller): Session {
	return {
		user: { id: caller.userId, email: `${caller.userId}@example.test`, name: caller.userId },
		session: {
			id: `session-${caller.userId}`,
			userId: caller.userId,
			expiresAt: new Date("2099-01-01T00:00:00Z"),
			token: `token-${caller.userId}`,
			activeOrganizationId: caller.activeOrganizationId,
		},
	} as Session;
}
