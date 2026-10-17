import { Effect } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { AuthService, AuthServiceLive } from "./auth.service";
import { DatabaseService, makeDatabaseService } from "./database.service";

const mocks = vi.hoisted(() => ({ getSession: vi.fn(), ssoAllowed: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/server", async (importOriginal) => ({
	...(await importOriginal<typeof import("next/server")>()),
	connection: async () => undefined,
}));
vi.mock("@/lib/auth", () => ({
	auth: { api: { getSession: mocks.getSession } },
}));
vi.mock("@/lib/organization-mfa/organization-access", () => ({
	canAccessOrganization: mocks.ssoAllowed,
}));

const getSession = (organizationId?: string) =>
	Effect.runPromise(
		Effect.gen(function* () {
			return yield* (yield* AuthService).getSession(organizationId);
		}).pipe(
			Effect.provide(AuthServiceLive),
			Effect.provideService(DatabaseService, makeDatabaseService(db)),
		),
	);

describe("AuthService SSO boundaries", () => {
	beforeEach(() => {
		mocks.getSession.mockResolvedValue({
			user: { id: "actor" },
			session: { id: "session", userId: "actor", activeOrganizationId: null },
		});
		mocks.ssoAllowed.mockResolvedValue(false);
	});

	it("requires proof for an explicit nonactive organization", async () => {
		mocks.getSession.mockResolvedValue({
			user: { id: "actor" },
			session: { id: "session", userId: "actor", activeOrganizationId: "open" },
		});

		await expect(getSession("locked")).rejects.toThrow("Not authenticated");
	});

	it("rejects quarantined active organizations", async () => {
		mocks.getSession.mockResolvedValue({
			user: { id: "actor" },
			session: { id: "session", userId: "actor", activeOrganizationId: null },
			ssoRequired: true,
		});

		await expect(getSession()).rejects.toThrow("Not authenticated");
	});

	it("preserves sessions without an active organization for onboarding and non-SSO use", async () => {
		expect(await getSession()).toMatchObject({ user: { id: "actor" } });
	});
});
