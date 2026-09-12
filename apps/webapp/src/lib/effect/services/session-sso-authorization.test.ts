import { Effect, Layer } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthService, AuthServiceLive } from "./auth.service";
import {
	AuthorizationService,
	AuthorizationServiceLive,
} from "./authorization.service";
import { DatabaseService } from "./database.service";

const mocks = vi.hoisted(() => ({ getSession: vi.fn(), ssoAllowed: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/auth", () => ({
	auth: { api: { getSession: mocks.getSession } },
}));
vi.mock("@/lib/enterprise-identity/session-sso-store", () => ({
	canAccessOrganizationWithSso: mocks.ssoAllowed,
}));

describe("Effect SSO authorization boundaries", () => {
	it("requires proof for an explicit nonactive organization requested through AuthService", async () => {
		mocks.getSession.mockResolvedValue({ user: { id: "actor" }, session: { id: "session", userId: "actor", activeOrganizationId: "open" } });
		mocks.ssoAllowed.mockResolvedValue(false);
		await expect(Effect.runPromise(Effect.gen(function* () { return yield* (yield* AuthService).getSession("locked"); }).pipe(Effect.provide(AuthServiceLive)))).rejects.toThrow("Not authenticated");
	});
	beforeEach(() => {
		mocks.getSession.mockResolvedValue({
			user: { id: "actor" },
			session: { id: "session", userId: "actor", activeOrganizationId: null },
		});
		mocks.ssoAllowed.mockResolvedValue(false);
	});

	it("rejects quarantined active organizations in the Effect auth service", async () => {
		mocks.getSession.mockResolvedValue({
			user: { id: "actor" },
			session: { id: "session", userId: "actor", activeOrganizationId: null },
			ssoRequired: true,
		});
		await expect(
			Effect.runPromise(
				Effect.gen(function* () {
					return yield* (yield* AuthService).getSession();
				}).pipe(Effect.provide(AuthServiceLive)),
			),
		).rejects.toThrow("Not authenticated");
	});

	it("preserves sessions without an active organization for onboarding and non-SSO use", async () => {
		expect(
			await Effect.runPromise(
				Effect.gen(function* () {
					return yield* (yield* AuthService).getSession();
				}).pipe(Effect.provide(AuthServiceLive)),
			),
		).toMatchObject({ user: { id: "actor" } });
	});

	it.each(["loadPrincipal", "buildAbility"] as const)(
		"%s cannot grant platform-admin authority over a nonactive SSO org without proof",
		async (method) => {
			const database = Layer.succeed(DatabaseService, {
				db: {} as never,
				query: (_name, execute) => Effect.promise(execute),
			});
			const effect = Effect.gen(function* () {
				return yield* (yield* AuthorizationService)[method](
					"actor",
					"locked",
					true,
				);
			}).pipe(
				Effect.provide(AuthorizationServiceLive),
				Effect.provide(database),
			);
			await expect(Effect.runPromise(effect)).rejects.toThrow(
				"SSO authentication required",
			);
		},
	);
});
