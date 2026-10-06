import { Effect, Layer } from "effect";
import { Effect as EffectV3, Layer as LayerV3 } from "effect-v3";
import { describe, expect, it, vi } from "vitest";
import {
	getEmployeeContext,
	getEmployeeSettingsActorContext,
} from "@/app/[locale]/(app)/settings/employees/employee-action-utils";
import { getProjectSettingsActorContext } from "@/app/[locale]/(app)/settings/projects/project-scope";
import { AuthServiceLive } from "@/lib/effect/services/auth.service";
import { DatabaseService } from "@/lib/effect/services/database.service";
import { AuthServiceLive as AuthServiceLiveV3 } from "@/lib/effect-v3/services/auth.service";
import { DatabaseService as DatabaseServiceV3 } from "@/lib/effect-v3/services/database.service";

const mocks = vi.hoisted(() => ({
	query: vi.fn(),
	allowed: vi.fn(async (_session: unknown, orgId: string) => orgId === "open"),
}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/server", async (importOriginal) => ({
	...(await importOriginal<typeof import("next/server")>()),
	connection: async () => undefined,
}));
vi.mock("@/lib/auth", () => ({
	auth: {
		api: {
			getSession: async () => ({
				user: { id: "actor" },
				session: {
					id: "password-session",
					userId: "actor",
					activeOrganizationId: "open",
				},
			}),
		},
	},
}));
vi.mock("@/lib/enterprise-identity/session-sso-store", () => ({
	canAccessOrganizationWithSso: mocks.allowed,
}));
vi.mock("@/db", () => ({
	db: {
		query: {
			member: { findFirst: async () => ({ role: "owner" }) },
			employee: {
				findFirst: async () => ({
					id: "emp",
					organizationId: "open",
					userId: "actor",
					role: "admin",
					isActive: true,
				}),
			},
		},
	},
}));
import { db } from "@/db";

describe("nonactive organization settings authorization", () => {
	// The employee helpers stay on Effect v3 until #631 ports them.
	it.each([getEmployeeContext, getEmployeeSettingsActorContext])(
		"blocks the real actor helper before DB reads, but permits an open organization",
		async (getActor) => {
			mocks.query.mockClear();
			const database = LayerV3.succeed(DatabaseServiceV3, {
				db,
				query: (name, execute) => {
					mocks.query(name);
					return EffectV3.promise(execute);
				},
			});
			const run = (organizationId: string) =>
				EffectV3.runPromise(
					getActor({ organizationId }).pipe(
						EffectV3.provide(AuthServiceLiveV3),
						EffectV3.provide(database),
					),
				);
			await expect(run("locked")).rejects.toThrow("Not authenticated");
			expect(mocks.query).not.toHaveBeenCalled();
			await expect(run("open")).resolves.toBeDefined();
		},
	);

	it("blocks the real project actor helper before DB reads, but permits an open organization", async () => {
		mocks.query.mockClear();
		const database = Layer.succeed(DatabaseService, {
			db,
			query: (name, execute) => {
				mocks.query(name);
				return Effect.promise(execute);
			},
		});
		const run = (organizationId: string) =>
			Effect.runPromise(
				getProjectSettingsActorContext({ organizationId }).pipe(
					Effect.provide(AuthServiceLive),
					Effect.provide(database),
				),
			);
		await expect(run("locked")).rejects.toThrow("Not authenticated");
		expect(mocks.query).not.toHaveBeenCalled();
		await expect(run("open")).resolves.toBeDefined();
	});
});
