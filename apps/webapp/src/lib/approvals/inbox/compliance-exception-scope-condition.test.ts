import { alias, PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { complianceException } from "@/db/schema";
import { complianceExceptionScopeCondition } from "./compliance-exception-inbox";

const dialect = new PgDialect();

describe("complianceExceptionScopeCondition", () => {
	it("covers no exception without a scope", () => {
		expect(complianceExceptionScopeCondition(null)).toEqual({ kind: "none" });
	});

	it("covers every exception of the organization for an organization-wide scope", () => {
		expect(complianceExceptionScopeCondition({ kind: "organization" })).toEqual({ kind: "all" });
	});

	it("covers no exception for a manager who manages nobody", () => {
		expect(complianceExceptionScopeCondition({ kind: "managed", employeeIds: [] })).toEqual({
			kind: "none",
		});
	});

	it("covers the managed employees' exceptions, read from compliance_exception by default", () => {
		const condition = complianceExceptionScopeCondition({
			kind: "managed",
			employeeIds: ["employee-1", "employee-2"],
		});

		if (condition.kind !== "condition")
			throw new Error(`expected a condition, got ${condition.kind}`);
		expect(dialect.sqlToQuery(condition.sql)).toMatchObject({
			sql: '"compliance_exception"."employee_id" in ($1, $2)',
			params: ["employee-1", "employee-2"],
		});
	});

	it("reads the employee column of the alias a query gives the table", () => {
		const exception = alias(complianceException, "exception");

		const condition = complianceExceptionScopeCondition(
			{ kind: "managed", employeeIds: ["employee-1"] },
			exception.employeeId,
		);

		if (condition.kind !== "condition")
			throw new Error(`expected a condition, got ${condition.kind}`);
		expect(dialect.sqlToQuery(condition.sql)).toMatchObject({
			sql: '"exception"."employee_id" in ($1)',
			params: ["employee-1"],
		});
	});
});
