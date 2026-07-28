import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PgDialect } from "drizzle-orm/pg-core";
import { Effect, Layer } from "effect";
import { describe, expect, it, vi } from "vitest";
import { AuthService } from "@/lib/effect/services/auth.service";
import { DatabaseService } from "@/lib/effect/services/database.service";
import { getEmployeeContext, getEmployeeSettingsActorContext } from "./employee-action-utils";
import {
	canAccessManagedEmployeeSettingsTarget,
	filterEmployeeUpdateForScopedManager,
} from "./employee-scope";

const source = readFileSync(
	fileURLToPath(new URL("./employee-action-utils.ts", import.meta.url)),
	"utf8",
);

describe("employee settings scope helpers", () => {
	it("keeps org admins fully enabled regardless of manager relationships", () => {
		expect(
			canAccessManagedEmployeeSettingsTarget({
				actorRole: "admin",
				isManagedEmployee: false,
			}),
		).toBe(true);
	});

	it("limits managers to employees they actively manage", () => {
		expect(
			canAccessManagedEmployeeSettingsTarget({
				actorRole: "manager",
				isManagedEmployee: true,
			}),
		).toBe(true);

		expect(
			canAccessManagedEmployeeSettingsTarget({
				actorRole: "manager",
				isManagedEmployee: false,
			}),
		).toBe(false);
	});

	it("keeps regular employees out of managed settings surfaces", () => {
		expect(
			canAccessManagedEmployeeSettingsTarget({
				actorRole: "employee",
				isManagedEmployee: true,
			}),
		).toBe(false);
	});

	it("strips org-admin-only employee fields from scoped manager edits", () => {
		const startDate = new Date("2026-05-01T00:00:00.000Z");

		expect(
			filterEmployeeUpdateForScopedManager({
				firstName: "Alex",
				lastName: "Stone",
				position: "Supervisor",
				startDate,
				role: "admin",
				employeeNumber: "EMP-1",
				contractType: "hourly",
				hourlyRate: "24",
				canUseWebapp: false,
			}),
		).toEqual({
			position: "Supervisor",
			startDate,
		});
	});

	it("loads settings actors regardless of employee activity while keeping normal employee context active-only", () => {
		const actorBody = source.slice(
			source.indexOf("export function getEmployeeSettingsActorContext"),
			source.indexOf("export function requireAdmin"),
		);

		expect(actorBody).toContain('eq(member.status, "approved")');
		expect(actorBody).not.toContain("eq(employee.isActive, true)");
		expect(
			source.slice(source.indexOf("export function getEmployeeContext")),
		).toContain("eq(employee.isActive, true)");
	});
});

function runSettingsActorContext(
	membershipRecord: { role: string } | null,
	employeeRecord: {
		id: string;
		organizationId: string;
		role: string;
		isActive: boolean;
	} | null,
) {
	const authLayer = Layer.succeed(AuthService, {
		getSession: () =>
			Effect.succeed({
				user: { id: "user-1" },
				session: { activeOrganizationId: "org-1" },
			} as never),
	});
	const databaseLayer = Layer.succeed(DatabaseService, {
		db: {
			query: {
				member: { findFirst: async () => membershipRecord },
				employee: { findFirst: async () => employeeRecord },
			},
		} as never,
		query: (_name, execute) => Effect.promise(execute),
	});

	return Effect.runPromise(
		getEmployeeSettingsActorContext().pipe(
			Effect.provide(Layer.merge(authLayer, databaseLayer)),
		),
	);
}

describe("getEmployeeSettingsActorContext", () => {
	it("denies explicitly inactive employees even when their approved membership is owner", async () => {
		await expect(
			runSettingsActorContext(
				{ role: "owner" },
				{
					id: "employee-1",
					organizationId: "org-1",
					role: "admin",
					isActive: false,
				},
			),
		).rejects.toThrow("Organization access is inactive");
	});

	it.each(["owner", "admin"])(
		"retains bootstrap org-admin access for an approved %s without an employee",
		async (role) => {
			const actor = await runSettingsActorContext({ role }, null);

			expect(actor.accessTier).toBe("orgAdmin");
			expect(actor.currentEmployee).toBeNull();
		},
	);

	it.each(["pending", "rejected"])(
		"does not grant settings access for a %s membership",
		async () => {
			await expect(
				runSettingsActorContext(null, {
					id: "employee-1",
					organizationId: "org-1",
					role: "admin",
					isActive: true,
				}),
			).rejects.toThrow("You do not have access to employee settings");
		},
	);
});

function runEmployeeContext(
	activeOrganizationId: string | null,
	options?: { organizationId?: string },
) {
	const findFirst = vi.fn(async ({ where }) => {
		const query = new PgDialect().sqlToQuery(where);
		const organizationId = query.params.find(
			(parameter) => parameter === "org-1" || parameter === "org-2",
		);
		return {
			id: organizationId === "org-2" ? "employee-org-2" : "employee-org-1",
			userId: "user-1",
			organizationId: organizationId ?? "org-1",
			isActive: true,
		};
	});
	const authLayer = Layer.succeed(AuthService, {
		getSession: () =>
			Effect.succeed({
				user: { id: "user-1" },
				session: { activeOrganizationId },
			} as never),
	});
	const databaseLayer = Layer.succeed(DatabaseService, {
		db: { query: { employee: { findFirst } } } as never,
		query: (_name, execute) => Effect.promise(execute),
	});

	return {
		findFirst,
		result: Effect.runPromise(
			getEmployeeContext(options).pipe(
				Effect.provide(Layer.merge(authLayer, databaseLayer)),
			),
		),
	};
}

describe("getEmployeeContext organization scope", () => {
	it("loads the current user's active employee only from the active organization", async () => {
		const { findFirst, result } = runEmployeeContext("org-2");

		await expect(result).resolves.toMatchObject({
			currentEmployee: { id: "employee-org-2", organizationId: "org-2" },
		});
		const query = new PgDialect().sqlToQuery(findFirst.mock.calls[0]?.[0].where);
		expect(query.params).toEqual(["user-1", "org-2", true]);
	});

	it("denies employee context when the session has no active organization", async () => {
		const { findFirst, result } = runEmployeeContext(null);

		await expect(result).rejects.toThrow("No active organization selected");
		expect(findFirst).not.toHaveBeenCalled();
	});

	it("preserves an explicitly requested organization scope", async () => {
		const { findFirst, result } = runEmployeeContext("org-1", {
			organizationId: "org-2",
		});

		await expect(result).resolves.toMatchObject({
			currentEmployee: { id: "employee-org-2", organizationId: "org-2" },
		});
		const query = new PgDialect().sqlToQuery(findFirst.mock.calls[0]?.[0].where);
		expect(query.params).toEqual(["user-1", "org-2", true]);
	});
});
