/**
 * `memoizedReader` reuses a read only when the statement, its parameters and how its rows are
 * mapped are the same; anything it cannot key exactly runs on its own (#1934).
 */
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { organization } from "@/db/auth-schema";
import { integrationAdminPool } from "@/test/integration-database";
import { statutoryFixture } from "@/test/statutory-fixtures";
import { memoizedReader } from "./read-memo";

describe("memoizedReader (PostgreSQL)", () => {
	const fx = statutoryFixture(integrationAdminPool(), "t1934-read-memo");

	beforeEach(fx.cleanup);
	afterAll(fx.cleanup);

	it("shares a read between two runs that build the same query", async () => {
		const org = await fx.organization("a");
		const reader = memoizedReader(db);
		const read = () =>
			reader
				.select({ id: organization.id, name: organization.name })
				.from(organization)
				.where(eq(organization.id, org.id));
		const first = await read();
		// Renamed in between: a shared read still returns the rows of the first.
		await db.update(organization).set({ name: "Renamed" }).where(eq(organization.id, org.id));
		expect(await read()).toEqual(first);
	});

	it("does not share a read between selects that decode the same column differently", async () => {
		const org = await fx.organization("a");
		const reader = memoizedReader(db);
		const decoded = (decode: (value: unknown) => unknown) =>
			reader
				.select({ value: sql`${organization.id}`.mapWith(decode) })
				.from(organization)
				.where(eq(organization.id, org.id));

		expect(await decoded((value) => `a:${String(value)}`)).toEqual([{ value: `a:${org.id}` }]);
		expect(await decoded((value) => `b:${String(value)}`)).toEqual([{ value: `b:${org.id}` }]);
	});

	it("does not share a read between relational queries with different extras", async () => {
		const org = await fx.organization("a");
		const reader = memoizedReader(db);
		// The same SQL: the extra's alias names its column, its key names the row's field.
		const tagged = await reader.query.organization.findFirst({
			where: eq(organization.id, org.id),
			columns: { id: true },
			extras: { tag: sql`'x'`.as("extra") },
		});
		const labelled = await reader.query.organization.findFirst({
			where: eq(organization.id, org.id),
			columns: { id: true },
			extras: { label: sql`'x'`.as("extra") },
		});

		expect(tagged).toEqual({ id: org.id, tag: "x" });
		expect(labelled).toEqual({ id: org.id, label: "x" });
	});

	it("runs a prepared statement with the values it is executed with", async () => {
		const first = await fx.organization("a");
		const second = await fx.organization("b");
		const reader = memoizedReader(db);
		const byId = () =>
			reader
				.select({ id: organization.id })
				.from(organization)
				.where(eq(organization.id, sql.placeholder("id")));

		expect(await byId().execute({ id: first.id })).toEqual([{ id: first.id }]);
		expect(await byId().execute({ id: second.id })).toEqual([{ id: second.id }]);
	});
});
