import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { employee } from "@/db/schema";
import {
	engagementFilterCondition,
	engagementFilterSchema,
	engagementPickerRows,
	filterByEngagement,
	hasExternalContractors,
} from "./engagement-filter";

const rows = [
	{ id: "a", engagementKind: "employee" as const },
	{ id: "b", engagementKind: "contractor" as const },
	// A source that predates the engagement kind counts as an employee.
	{ id: "c" },
];

describe("All | Employees | External Contractors filter (#1995)", () => {
	it("defaults to all and refuses unknown values", () => {
		expect(engagementFilterSchema.parse(undefined)).toBe("all");
		expect(engagementFilterSchema.safeParse("freelancers").success).toBe(false);
	});

	it.each([
		["all", ["a", "b", "c"]],
		["employee", ["a", "c"]],
		["contractor", ["b"]],
	] as const)("keeps %s rows", (filter, expected) => {
		expect(filterByEngagement(rows, filter).map((row) => row.id)).toEqual(expected);
	});

	it("narrows a people picker but keeps the chosen rows listed, in their order", () => {
		expect(engagementPickerRows(rows, "contractor", ["a"]).map((row) => row.id)).toEqual([
			"a",
			"b",
		]);
		expect(engagementPickerRows(rows, "employee", []).map((row) => row.id)).toEqual(["a", "c"]);
		expect(engagementPickerRows(rows, "all", []).map((row) => row.id)).toEqual(["a", "b", "c"]);
	});

	it("offers the filter only once a picker lists an External Contractor", () => {
		expect(hasExternalContractors(rows)).toBe(true);
		expect(hasExternalContractors(rows.filter((row) => row.id !== "b"))).toBe(false);
	});

	it("adds no SQL condition for all, and compares the column otherwise", () => {
		const dialect = new PgDialect();
		expect(engagementFilterCondition(employee.engagementKind, "all")).toBeUndefined();
		const condition = engagementFilterCondition(employee.engagementKind, "contractor");
		if (!condition) throw new Error("expected a condition");
		const query = dialect.sqlToQuery(condition);
		expect(query.sql).toBe('"employee"."engagement_kind" = $1');
		expect(query.params).toEqual(["contractor"]);
	});
});
