import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type SQL, sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";
import { member } from "@/db/auth-schema";
import { employee } from "@/db/schema";
import { resolveCommandActorEmployee } from "./resolve-command-actor";

function compilePredicate(table: unknown, predicate: unknown) {
	return new PgDialect().sqlToQuery(
		sql`select * from ${table as never} where ${predicate as SQL}`,
	);
}

describe("resolveCommandActorEmployee", () => {
	it.each([
		"telegram",
		"slack",
		"discord",
		"teams",
	])("guards the %s command resolver centrally", (platform) => {
		const source = readFileSync(
			join(import.meta.dirname, `../${platform}/user-resolver.ts`),
			"utf8",
		);
		expect(source).toContain("resolveCommandActorEmployee(");
	});

	it.each([
		["removed membership", null, { id: "employee-1", isActive: true }],
		[
			"inactive employee",
			{ id: "member-1" },
			{ id: "employee-1", isActive: false },
		],
		["cross-organization employee", { id: "member-1" }, null],
	] as const)("rejects a mapping with %s", async (_name, membership, employeeRecord) => {
		const db = {
			query: {
				member: { findFirst: vi.fn(async () => membership) },
				employee: { findFirst: vi.fn(async () => employeeRecord) },
			},
		};

		await expect(
			resolveCommandActorEmployee("user-1", "org-1", db as never),
		).resolves.toBeNull();
	});

	it("returns only an active employee with approved membership in the same organization", async () => {
		const employeeRecord = { id: "employee-1", isActive: true };
		const memberFindFirst = vi.fn(async () => ({ id: "member-1" }));
		const employeeFindFirst = vi.fn(async () => employeeRecord);
		const db = {
			query: {
				member: { findFirst: memberFindFirst },
				employee: { findFirst: employeeFindFirst },
			},
		};

		await expect(
			resolveCommandActorEmployee("user-1", "org-1", db as never),
		).resolves.toEqual(employeeRecord);
		expect(
			compilePredicate(member, memberFindFirst.mock.calls[0]?.[0]?.where)
				.params,
		).toEqual(["user-1", "org-1", "approved"]);
		expect(
			compilePredicate(employee, employeeFindFirst.mock.calls[0]?.[0]?.where)
				.params,
		).toEqual(["user-1", "org-1", true]);
	});
});
