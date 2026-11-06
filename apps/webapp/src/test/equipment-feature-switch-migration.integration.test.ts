import { randomBytes } from "node:crypto";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { Pool } from "pg";
import { expect, it } from "vitest";
import {
	integrationAdminPool,
	openIntegrationPool,
} from "@/test/integration-database";

const migrationsFolder = fileURLToPath(
	new URL("../../drizzle", import.meta.url),
);
const switchTag = "0309_equipment_feature_switch";

type Journal = { entries: { tag: string; when: number }[] };

/**
 * Equipment tracking switch (#1572): a database deployed before the switch keeps
 * equipment on only for organizations that already set up or recorded equipment.
 * Runs in a sibling database so the shared integration database is never mutated.
 */
it("switches equipment on only for organizations with equipment data, and never again on replay", {
	timeout: 120000,
}, async () => {
	const admin = integrationAdminPool();
	const journalPath = join(migrationsFolder, "meta", "_journal.json");
	const journal = JSON.parse(await readFile(journalPath, "utf8")) as Journal;
	const switchIndex = journal.entries.findIndex(
		(entry) => entry.tag === switchTag,
	);
	expect(switchIndex).toBeGreaterThan(0);

	const databaseName = `approval_workflow_repository_test_equipment_switch_${randomBytes(6).toString("hex")}`;
	const temporaryDirectory = await mkdtemp(
		join(tmpdir(), "z8-equipment-switch-"),
	);
	let pool: Pool | undefined;
	let databaseCreated = false;
	try {
		const deployedFolder = join(temporaryDirectory, "drizzle");
		await cp(migrationsFolder, deployedFolder, { recursive: true });
		await writeFile(
			join(deployedFolder, "meta", "_journal.json"),
			`${JSON.stringify({ ...journal, entries: journal.entries.slice(0, switchIndex) }, null, 2)}\n`,
		);
		await admin.query(`create database "${databaseName}"`);
		databaseCreated = true;
		pool = openIntegrationPool({ databaseName });
		await migrate(drizzle({ client: pool }), {
			migrationsFolder: deployedFolder,
		});

		for (const id of ["t1572-policy", "t1572-type", "t1572-empty"])
			await pool.query(
				"insert into organization(id,name,slug,created_at) values($1,$1,$1,now())",
				[id],
			);
		await pool.query(
			"insert into equipment_policy(organization_id,retention_months) values('t1572-policy',24)",
		);
		await pool.query(
			"insert into equipment_type(organization_id,name,tracking_mode,default_return_required) values('t1572-type','Laptop','individual',true)",
		);

		await migrate(drizzle({ client: pool }), { migrationsFolder });
		const migrated = pool;
		const flags = async () =>
			Object.fromEntries(
				(
					await migrated.query<{
						id: string;
						equipment_enabled: boolean | null;
					}>(
						"select id,equipment_enabled from organization where id like 't1572-%'",
					)
				).rows.map((row) => [row.id, row.equipment_enabled]),
			);
		expect(await flags()).toEqual({
			"t1572-policy": true,
			"t1572-type": true,
			"t1572-empty": false,
		});

		// An owner switches it off; replaying the migration must not switch it back on.
		await pool.query(
			"update organization set equipment_enabled=false where id='t1572-type'",
		);
		const sql = await readFile(
			join(migrationsFolder, `${switchTag}.sql`),
			"utf8",
		);
		await pool.query(sql);
		expect(await flags()).toEqual({
			"t1572-policy": true,
			"t1572-type": false,
			"t1572-empty": false,
		});

		// New organizations start with equipment off.
		await pool.query(
			"insert into organization(id,name,slug,created_at) values('t1572-new','t1572-new','t1572-new',now())",
		);
		expect((await flags())["t1572-new"]).toBe(false);
	} finally {
		try {
			await pool?.end();
			if (databaseCreated) {
				await admin.query(
					`drop database if exists "${databaseName}" with (force)`,
				);
			}
		} finally {
			await rm(temporaryDirectory, { recursive: true, force: true });
		}
	}
});
