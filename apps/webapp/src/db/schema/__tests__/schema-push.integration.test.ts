import { pushSchema } from "drizzle-kit/api";
import { drizzle } from "drizzle-orm/node-postgres";
import {
	foreignKey,
	pgSchema,
	text,
	unique,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";
import { expect, it } from "vitest";
import {
	integrationAdminPool,
	openIntegrationPool,
} from "@/test/integration-database";

const namespace = pgSchema("schema_push_roundtrip");
const parent = namespace.table(
	"parent",
	{
		id: uuid("id").primaryKey(),
		organizationId: text("organization_id").notNull(),
		employeeId: uuid("employee_id").notNull(),
		externalId: text("external_id").notNull(),
	},
	(table) => [
		uniqueIndex("parent_ownership_idx").on(
			table.id,
			table.organizationId,
			table.employeeId,
		),
		// Constraint order deliberately differs from the physical table-column order.
		unique("parent_external_unique").on(table.externalId, table.organizationId),
	],
);
const child = namespace.table(
	"child",
	{
		id: uuid("id").primaryKey(),
		organizationId: text("organization_id").notNull(),
		employeeId: uuid("employee_id").notNull(),
		parentId: uuid("parent_id").notNull(),
		externalId: text("external_id").notNull(),
	},
	(table) => [
		foreignKey({
			name: "child_parent_fk",
			columns: [table.parentId, table.organizationId, table.employeeId],
			foreignColumns: [parent.id, parent.organizationId, parent.employeeId],
		}),
		foreignKey({
			name: "child_external_fk",
			columns: [table.externalId, table.organizationId],
			foreignColumns: [parent.externalId, parent.organizationId],
		}),
	],
);

it("pushes foreign keys backed by standalone indexes and preserves populated composite keys on retry", async () => {
	const pool = integrationAdminPool();
	const db = drizzle(openIntegrationPool({ max: 2 }));
	const schema = { namespace, parent, child };
	const parentId = "00000000-0000-0000-0000-000000000001";
	const employeeId = "00000000-0000-0000-0000-000000000002";
	const childId = "00000000-0000-0000-0000-000000000003";
	try {
		const initial = await pushSchema(schema, db, [namespace.schemaName]);
		expect(initial.hasDataLoss).toBe(false);
		await initial.apply();
		await pool.query(
			"INSERT INTO schema_push_roundtrip.parent VALUES ($1, 'org', $2, 'external')",
			[parentId, employeeId],
		);
		await pool.query(
			"INSERT INTO schema_push_roundtrip.child VALUES ($1, 'org', $2, $3, 'external')",
			[childId, employeeId, parentId],
		);
		const repeat = await pushSchema(schema, db, [namespace.schemaName]);
		expect(repeat.hasDataLoss).toBe(false);
		expect(repeat.statementsToExecute).toEqual([]);
		await expect(
			pool.query(
				"INSERT INTO schema_push_roundtrip.child VALUES ($1, 'other-org', $2, $3, 'external')",
				["00000000-0000-0000-0000-000000000004", employeeId, parentId],
			),
		).rejects.toMatchObject({ code: "23503" });
		const result = await pool.query(
			`SELECT id FROM schema_push_roundtrip.child`,
		);
		expect(result.rows).toEqual([{ id: childId }]);
	} finally {
		await pool.query("DROP SCHEMA IF EXISTS schema_push_roundtrip CASCADE");
	}
});
