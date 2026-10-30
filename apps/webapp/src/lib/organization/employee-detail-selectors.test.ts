import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthenticationError } from "@/lib/effect/errors";

const state = vi.hoisted(() => ({
	activeRuns: 0,
	approved: true,
	authenticated: true,
	revisionFailure: false,
	cacheFailure: false,
	cacheReads: 0,
}));

vi.mock("next/cache", () => ({ cacheLife: vi.fn() }));

vi.mock("@/db", async () => {
	const { drizzle } = await import("drizzle-orm/node-postgres");
	return {
		db: drizzle({
			client: {
				async query(query: { text: string }) {
					state.cacheReads++;
					if (state.activeRuns || state.cacheFailure)
						throw new Error("private cache database details");
					return {
						rows: query.text.includes('from "work_policy"')
							? [["policy-1", "Standard"]]
							: [
									[
										"manager-1",
										"user-2",
										"Ada",
										"Lovelace",
										"Ada Lovelace",
										"ada@example.com",
										null,
									],
								],
					};
				},
			} as never,
		}),
	};
});

vi.mock("@/lib/effect/services/auth.service", async () => {
	const { Context } = await import("effect");
	return { AuthService: Context.Service("AuthService") };
});

vi.mock("@/lib/effect/services/manager.service", async () => {
	const { Context } = await import("effect");
	return { ManagerService: Context.Service("ManagerService") };
});

vi.mock("@/lib/effect/runtime", async () => {
	const { Effect, Layer } = await import("effect");
	const { drizzle } = await import("drizzle-orm/node-postgres");
	const { AuthService } = await import("@/lib/effect/services/auth.service");
	const { DatabaseService, makeDatabaseService } = await import(
		"@/lib/effect/services/database.service"
	);
	const revisionDb = drizzle({
		client: {
			async query() {
				if (state.revisionFailure)
					throw new Error("private revision database details");
				return { rows: [["revision-1"]] };
			},
		} as never,
	});
	// Keep the real SQL builder; only the database's actor lookups and driver are fake.
	const actorDb = Object.assign(revisionDb, {
		query: {
			member: {
				findFirst: async () =>
					state.approved ? { role: "admin", status: "approved" } : undefined,
			},
			employee: {
				findFirst: async () => ({
					id: "actor-1",
					role: "admin",
					isActive: true,
				}),
			},
		},
	});
	const layer = Layer.mergeAll(
		Layer.succeed(
			AuthService,
			AuthService.of({
				getSession: () =>
					state.authenticated
						? Effect.succeed({
								user: { id: "user-1" },
								session: { activeOrganizationId: "org-1" },
							} as never)
						: Effect.fail(
								new AuthenticationError({ message: "Not authenticated" }),
							),
			}),
		),
		Layer.succeed(
			DatabaseService,
			DatabaseService.of(makeDatabaseService(actorDb as never)),
		),
	);
	const module = (await import("@/test/effect-runtime")).runtimeModuleOver(
		layer,
	);
	return {
		...module,
		runtime: {
			async runPromiseExit(
				effect: Parameters<typeof module.runtime.runPromiseExit>[0],
			) {
				state.activeRuns++;
				try {
					return await module.runtime.runPromiseExit(effect);
				} finally {
					state.activeRuns--;
				}
			},
		},
	};
});

import {
	getEmployeeManagerChoices,
	getEmployeeWorkPolicyChoices,
} from "./employee-detail-selectors";

const selectors = [
	{
		name: "manager",
		operation: "employeeDetail.managerChoices",
		read: () => getEmployeeManagerChoices("edited-employee"),
		choices: [
			{
				id: "manager-1",
				userId: "user-2",
				user: {
					firstName: "Ada",
					lastName: "Lovelace",
					name: "Ada Lovelace",
					email: "ada@example.com",
					image: null,
				},
			},
		],
	},
	{
		name: "policy",
		operation: "employeeDetail.policyChoices",
		read: getEmployeeWorkPolicyChoices,
		choices: [{ id: "policy-1", name: "Standard" }],
	},
];

beforeEach(() => {
	Object.assign(state, {
		activeRuns: 0,
		approved: true,
		authenticated: true,
		revisionFailure: false,
		cacheFailure: false,
		cacheReads: 0,
	});
	vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("employee detail selectors", () => {
	it.each(selectors)(
		"returns $name choices from the independent cache reader after fresh authorization completes",
		async ({ read, choices }) => {
			expect(await read()).toEqual({ success: true, data: choices });
		},
	);

	it.each(selectors)(
		"refuses $name choices after membership is revoked, even after a successful read",
		async ({ read }) => {
			expect((await read()).success).toBe(true);
			state.approved = false;
			expect(await read()).toEqual({
				success: false,
				code: "AuthorizationError",
				error: "You do not have access to employee settings",
			});
			expect(state.cacheReads).toBe(1);
		},
	);

	it.each(selectors)(
		"refuses unauthenticated $name reads before reaching cached data",
		async ({ read }) => {
			state.authenticated = false;
			expect(await read()).toEqual({
				success: false,
				code: "AuthenticationError",
				error: "Not authenticated",
			});
			expect(state.cacheReads).toBe(0);
		},
	);

	it.each(selectors)(
		"sanitizes $name revision failures without reading cached data",
		async ({ read, operation }) => {
			state.revisionFailure = true;
			expect(await read()).toEqual({
				success: false,
				code: "DatabaseError",
				error: `Database query failed: ${operation}Revision`,
			});
			expect(state.cacheReads).toBe(0);
		},
	);

	it.each(selectors)(
		"sanitizes independent $name cache database failures",
		async ({ read, operation }) => {
			state.cacheFailure = true;
			expect(await read()).toEqual({
				success: false,
				code: "DatabaseError",
				error: `Database query failed: ${operation}`,
			});
		},
	);
});
