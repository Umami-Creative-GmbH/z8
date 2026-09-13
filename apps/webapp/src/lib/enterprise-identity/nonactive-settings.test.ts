import { Effect, Layer } from "effect";
import { describe, expect, it, vi } from "vitest";
import {
	getEmployeeContext,
	getEmployeeSettingsActorContext,
} from "@/app/[locale]/(app)/settings/employees/employee-action-utils";
import { getProjectSettingsActorContext } from "@/app/[locale]/(app)/settings/projects/project-scope";
import { AuthServiceLive } from "@/lib/effect/services/auth.service";
import { DatabaseService } from "@/lib/effect/services/database.service";

const mocks = vi.hoisted(() => ({
	query: vi.fn(),
	allowed: vi.fn(async (_session: unknown, orgId: string) => orgId === "open"),
}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
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
	it.each([
		getEmployeeContext,
		getEmployeeSettingsActorContext,
		getProjectSettingsActorContext,
	])(
		"blocks the real actor helper before DB reads, but permits an open organization",
		async (getActor) => {
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
					getActor({ organizationId }).pipe(
						Effect.provide(AuthServiceLive),
						Effect.provide(database),
					),
				);
			await expect(run("locked")).rejects.toThrow("Not authenticated");
			expect(mocks.query).not.toHaveBeenCalled();
			await expect(run("open")).resolves.toBeDefined();
		},
	);
});
