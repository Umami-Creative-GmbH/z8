import { Effect } from "effect-v3";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthService, AuthServiceLive } from "./auth.service";

const mocks = vi.hoisted(() => ({ getSession: vi.fn(), ssoAllowed: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/server", async (importOriginal) => ({
	...(await importOriginal<typeof import("next/server")>()),
	connection: async () => undefined,
}));
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
});
