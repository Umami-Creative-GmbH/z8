import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { auditLog } from "@/db/schema/audit";
import { integrationAdminPool } from "@/test/integration-database";

const migration = readFileSync(
	join(process.cwd(), "drizzle/0259_audit_log_text_entity_id.sql"),
	"utf8",
);

describe("audit targets with text IDs (#1266)", () => {
	it("declares text audit targets in the application schema", () => {
		expect(auditLog.entityId.getSQLType()).toBe("text");
	});

	it("preserves UUID history and its index, accepts text targets, and can run twice", async () => {
		const client = await integrationAdminPool().connect();
		const existingId = "12660000-0000-4000-8000-000000000001";
		const organizationId = "tracking-review-organization";
		try {
			await client.query("begin");
			await client.query("create schema t1266_audit_migration");
			await client.query(
				"set local search_path to t1266_audit_migration, public",
			);
			await client.query(
				"create table audit_log (entity_type text not null, entity_id uuid not null)",
			);
			await client.query(
				'create index "auditLog_entityType_entityId_idx" on audit_log (entity_type, entity_id)',
			);
			await client.query("insert into audit_log values ('employee', $1)", [
				existingId,
			]);
			await client.query(migration);
			await client.query(migration);
			await client.query("insert into audit_log values ('organization', $1)", [
				organizationId,
			]);
			const rows = await client.query(
				"select entity_type, entity_id from audit_log order by entity_type",
			);
			expect(rows.rows).toEqual([
				{ entity_type: "employee", entity_id: existingId },
				{ entity_type: "organization", entity_id: organizationId },
			]);
			const index = await client.query(
				`select indexdef from pg_indexes where schemaname = 't1266_audit_migration'
				 and indexname = 'auditLog_entityType_entityId_idx'`,
			);
			expect(index.rows[0]?.indexdef).toContain("(entity_type, entity_id)");
			await expect(
				client.query("insert into audit_log values ('employee', null)"),
			).rejects.toMatchObject({ code: "23502" });
		} finally {
			await client.query("rollback");
			client.release();
		}
	});
});
