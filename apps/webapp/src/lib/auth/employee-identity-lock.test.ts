import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";
import {
	acquireEmployeeIdentityLock,
	isEmployeeIdentityConflict,
} from "./employee-identity-lock";

describe("acquireEmployeeIdentityLock", () => {
	it("uses the same parameterized transaction lock for identical organization and email inputs", async () => {
		const execute = vi.fn().mockResolvedValue(undefined);
		const client = { execute } as Parameters<
			typeof acquireEmployeeIdentityLock
		>[0];
		const input = {
			organizationId: "org-'quoted",
			normalizedEmail: "ada+lock@example.com",
		};

		await acquireEmployeeIdentityLock(client, input);
		await acquireEmployeeIdentityLock(client, input);

		const first = new PgDialect().sqlToQuery(execute.mock.calls[0]?.[0]);
		const second = new PgDialect().sqlToQuery(execute.mock.calls[1]?.[0]);
		const normalizedSql = first.sql.replace(/\s+/g, " ");
		expect(first).toEqual(second);
		expect(normalizedSql).toContain("pg_advisory_xact_lock(");
		expect(normalizedSql).toContain(
			"hashtextextended(jsonb_build_array($1, $2)::text, 0)",
		);
		expect(first.params).toEqual([input.organizationId, input.normalizedEmail]);
		expect(first.sql).not.toContain(input.organizationId);
		expect(first.sql).not.toContain(input.normalizedEmail);
	});
});

describe("isEmployeeIdentityConflict", () => {
	it("recognizes both the fixed trigger error and the composite unique index", () => {
		expect(
			isEmployeeIdentityConflict({
				cause: {
					code: "23505",
					message: "Employee identity already exists in organization",
				},
			}),
		).toBe(true);
		expect(
			isEmployeeIdentityConflict({
				cause: {
					code: "23505",
					constraint: "employee_organizationId_userId_unique_idx",
				},
			}),
		).toBe(true);
	});

	it("does not translate unrelated unique violations", () => {
		expect(
			isEmployeeIdentityConflict({
				code: "23505",
				constraint: "unrelated_unique_idx",
			}),
		).toBe(false);
	});
});
