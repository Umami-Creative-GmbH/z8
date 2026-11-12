import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import { AuthService } from "@/lib/effect/services/auth.service";
import { DatabaseService } from "@/lib/effect/services/database.service";
import { getEmployeeSettingsActorContext } from "./employee-action-utils";
import { filterEmployeeUpdateForScopedManager } from "./employee-scope";

const source = readFileSync(
	fileURLToPath(new URL("./employee-action-utils.ts", import.meta.url)),
	"utf8",
);

describe("employee settings scope helpers", () => {
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
			}),
		).toEqual({
			position: "Supervisor",
			startDate,
		});
	});

	it("loads settings actors regardless of employee activity", () => {
		const actorBody = source.slice(
			source.indexOf("export function getEmployeeSettingsActorContext"),
			source.indexOf("export function getTargetUser"),
		);

		expect(actorBody).toContain('eq(member.status, "approved")');
		expect(actorBody).not.toContain("eq(employee.isActive, true)");
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
		getEmployeeSettingsActorContext().pipe(Effect.provide(Layer.merge(authLayer, databaseLayer))),
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
