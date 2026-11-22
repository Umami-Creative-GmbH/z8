import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PgDialect } from "drizzle-orm/pg-core";
import { Effect, Layer } from "effect";
import { describe, expect, it, vi } from "vitest";
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
		former?: boolean;
	} | null,
	onEmployeeFindFirst?: (args: unknown) => void,
) {
	const employeeFindFirst = vi.fn(async (args: unknown) => {
		onEmployeeFindFirst?.(args);
		return employeeRecord;
	});
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
				employee: { findFirst: employeeFindFirst },
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

	it("denies active employees whose departure has come due (former=true) and queries isFormerEmployee", async () => {
		let capturedArgs: { extras?: { former?: unknown } } | undefined;

		await expect(
			runSettingsActorContext(
				{ role: "member" },
				{
					id: "employee-1",
					organizationId: "org-1",
					role: "manager",
					isActive: true,
					former: true,
				},
				(args) => {
					capturedArgs = args as { extras?: { former?: unknown } };
				},
			),
		).rejects.toThrow("Organization access is inactive");

		const formerExtra = capturedArgs?.extras?.former as {
			sql: Parameters<PgDialect["sqlToQuery"]>[0];
		};
		const sql = new PgDialect().sqlToQuery(formerExtra.sql).sql;
		expect(sql).toContain("employee_departure_denies_access");
	});

	it.each([
		["owner", "owner"],
		["admin", "orgAdmin"],
	] as const)(
		"retains bootstrap %s settings access without an employee",
		async (role, expectedAccess) => {
			const actor = await runSettingsActorContext({ role }, null);

			expect(actor.settingsAccess).toBe(expectedAccess);
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
