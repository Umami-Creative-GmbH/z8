import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { canonicalInboxFilters, requesterEmployeeIdCondition } from "./canonical-inbox-query";

describe("requesterEmployeeIdCondition", () => {
	it("binds any number of requesters as one uuid array parameter (#1980)", () => {
		const ids = Array.from({ length: 70_000 }, () => randomUUID());

		const rendered = new PgDialect().sqlToQuery(
			requesterEmployeeIdCondition(sql`requester.id`, ids),
		);

		expect(rendered.sql).toBe("requester.id = any($1::uuid[])");
		expect(rendered.params).toEqual([ids]);
	});

	it("matches no row, with no parameter, for no requesters", () => {
		const rendered = new PgDialect().sqlToQuery(
			requesterEmployeeIdCondition(sql`requester.id`, []),
		);

		expect(rendered.sql).toBe("false");
		expect(rendered.params).toEqual([]);
	});

	it("keeps the canonical list's requester filter to one parameter", () => {
		const ids = Array.from({ length: 1_000 }, () => randomUUID());

		const rendered = new PgDialect().sqlToQuery(
			canonicalInboxFilters({ requesterEmployeeIds: ids }, new Date("2026-11-23T08:00:00Z")),
		);

		expect(rendered.params).toEqual([ids]);
	});
});
