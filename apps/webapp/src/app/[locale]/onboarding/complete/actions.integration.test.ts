import { Layer } from "effect";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { integrationAdminPool } from "@/test/integration-database";

const actor = vi.hoisted(() => ({ id: "r032-1827-a", authenticated: true }));
vi.mock("next/headers", async () => (await import("@/test/integration-harness")).nextHeaders());
vi.mock("@/lib/auth/request-session", () => ({
	getRequestSession: async () =>
		actor.authenticated
			? {
					user: { id: actor.id, firstName: "Fixture", lastName: "Person" },
					session: { id: "synthetic-request", userId: actor.id, activeOrganizationId: null },
				}
			: null,
}));
vi.mock("@/lib/effect/runtime", async () => {
	const { OnboardingServiceLive } = await import("@/lib/effect/services/onboarding.service");
	const { AuthServiceLive } = await import("@/lib/effect/services/auth.service");
	const { DatabaseServiceLive } = await import("@/lib/effect/services/database.service");
	return (await import("@/test/effect-runtime")).runtimeModuleOver(
		OnboardingServiceLive.pipe(Layer.provide(Layer.mergeAll(AuthServiceLive, DatabaseServiceLive))),
	);
});

import { GET } from "@/app/api/user/onboarding-status/route";
import { completeOnboarding, getOnboardingSummary } from "./actions";

describe("personal completion production action against PostgreSQL", () => {
	const pool = integrationAdminPool();
	async function cleanup() {
		await pool.query('DELETE FROM "user" WHERE id=ANY($1::text[])', [
			["r032-1827-a", "r032-1827-b"],
		]);
	}
	beforeEach(async () => {
		await cleanup();
		actor.id = "r032-1827-a";
		actor.authenticated = true;
		await pool.query(
			'INSERT INTO "user" (id,name,email,email_verified,created_at,updated_at) VALUES ($1,$1,$2,true,now(),now()),($3,$3,$4,true,now(),now())',
			[actor.id, "r032-a@example.test", "r032-1827-b", "r032-b@example.test"],
		);
	});
	afterAll(cleanup);
	it("completes only the authenticated personal setup without establishing organization membership", async () => {
		expect(await (await GET()).json()).toEqual({ onboardingComplete: false, onboardingStep: null });
		expect((await completeOnboarding()).success).toBe(true);
		expect(await (await GET()).json()).toEqual({ onboardingComplete: true, onboardingStep: null });
		expect(await getOnboardingSummary()).toMatchObject({
			success: true,
			data: { hasOrganization: false, isAdmin: false },
		});
		actor.id = "r032-1827-b";
		expect(await (await GET()).json()).toEqual({ onboardingComplete: false, onboardingStep: null });
	});
	it("refuses an unauthenticated completion without changing the personal flag", async () => {
		actor.authenticated = false;
		expect(await completeOnboarding()).toMatchObject({
			success: false,
			code: "AuthenticationError",
		});
		actor.authenticated = true;
		expect(await (await GET()).json()).toEqual({ onboardingComplete: false, onboardingStep: null });
	});
});
