import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { Pool } from "pg";
import { expect, it } from "vitest";
import {
	integrationAdminPool,
	openIntegrationPool,
	parseIntegrationDatabaseUrl,
} from "@/test/integration-database";

const execute = promisify(execFile);
const appDirectory = fileURLToPath(new URL("../../", import.meta.url));
const migrationsFolder = fileURLToPath(new URL("../../drizzle", import.meta.url));
const recoveryTag = "0141_app_auth_code_pkce_recovery";

type Journal = { entries: { tag: string; when: number }[] };

const ledgerQuery =
	"select hash,created_at::text from drizzle.__drizzle_migrations order by created_at";

/**
 * Simulates a production database deployed through 0140 in its own sibling
 * database, so the shared integration database is never mutated and every
 * migration after 0141 is applied for real instead of being un-recorded.
 */
it("the production migration runner recovers a deployed database and safely retries", {
	timeout: 120000,
}, async () => {
	const admin = integrationAdminPool();
	const config = parseIntegrationDatabaseUrl(
		process.env.APPROVAL_WORKFLOW_REPOSITORY_TEST_DATABASE_URL ?? "",
	);
	const journalPath = join(migrationsFolder, "meta", "_journal.json");
	const journal = JSON.parse(await readFile(journalPath, "utf8")) as Journal;
	const recoveryIndex = journal.entries.findIndex((e) => e.tag === recoveryTag);
	expect(recoveryIndex).toBeGreaterThan(0);
	const timestamp = journal.entries[recoveryIndex]?.when ?? 0;
	const recoveredGaps = journal.entries
		.filter((entry) =>
			[
				"0027_employee_work_balance",
				"0055_approval_workflow_expand",
				"0056_approval_workflow_cycle_identity",
			].includes(entry.tag),
		)
		.map((entry) => String(entry.when));
	// Read-only production evidence on 2026-10-09: former clock-index/payroll tags.
	const legacyTimestamps = ["1785269198390", "1785269198391"];
	const legacyHash = createHash("sha256").update("legacy-ledger-test-fixture").digest("hex");
	// The runner must record exactly 0141 and every later migration, whatever follows it.
	const pendingMigrations = readMigrationFiles({ migrationsFolder })
		.filter((migration) => migration.folderMillis >= timestamp)
		.map((migration) => ({
			hash: migration.hash,
			created_at: String(migration.folderMillis),
		}));
	expect(pendingMigrations[0]?.created_at).toBe(String(timestamp));

	const databaseName = `approval_workflow_repository_test_runner_${randomBytes(6).toString("hex")}`;
	const url = new URL(config.databaseUrl);
	url.pathname = `/${databaseName}`;
	const databaseUrl = url.toString();
	const env: NodeJS.ProcessEnv = {
		...process.env,
		DATABASE_URL: databaseUrl,
		POSTGRES_HOST: url.hostname,
		POSTGRES_PORT: url.port,
		POSTGRES_DB: databaseName,
		POSTGRES_USER: decodeURIComponent(url.username),
		POSTGRES_PASSWORD: decodeURIComponent(url.password),
		POSTGRES_SSL_MODE: "disable",
	};
	delete env.DRIZZLE_MIGRATE_COMMAND;
	delete env.POSTGRES_SSL_CA_CERT;
	delete env.POSTGRES_SSL_ROOT_CERT_PATH;
	const run = () =>
		execute(process.execPath, ["./scripts/migrate-with-lock.js"], {
			cwd: appDirectory,
			env,
			timeout: 25000,
		});

	const temporaryDirectory = await mkdtemp(join(tmpdir(), "z8-migration-runner-"));
	let pool: Pool | undefined;
	let databaseCreated = false;
	try {
		// A deployment through 0140: the real chain with its journal cut before 0141.
		const deployedFolder = join(temporaryDirectory, "drizzle");
		await cp(migrationsFolder, deployedFolder, { recursive: true });
		await writeFile(
			join(deployedFolder, "meta", "_journal.json"),
			`${JSON.stringify({ ...journal, entries: journal.entries.slice(0, recoveryIndex) }, null, 2)}\n`,
		);
		await admin.query(`create database "${databaseName}"`);
		databaseCreated = true;
		pool = openIntegrationPool({ databaseName });
		await migrate(drizzle({ client: pool }), { migrationsFolder: deployedFolder });

		// Production ledger drift: missing gap rows and rows for retired tags.
		const client = await pool.connect();
		try {
			await client.query("begin");
			await client.query(
				"delete from drizzle.__drizzle_migrations where created_at::text = any($1::text[])",
				[recoveredGaps],
			);
			for (const when of legacyTimestamps) {
				await client.query(
					"insert into drizzle.__drizzle_migrations (hash,created_at) values ($1,$2)",
					[legacyHash, when],
				);
			}
			await client.query(
				`insert into public."user" (id,name,email,created_at,updated_at) values ('t780-runner-user','Runner fixture','t780-runner@example.test',now(),now())`,
			);
			await client.query(
				"insert into public.app_auth_code(user_id,app,code,session_token,expires_at) values ('t780-runner-user','desktop','runner-fixture-code','runner-fixture-session',now()+interval '5 minutes')",
			);
			await client.query("commit");
		} catch (error) {
			await client.query("rollback");
			throw error;
		} finally {
			client.release();
		}
		const deployedLedger = (await pool.query(ledgerQuery)).rows;
		const expectedLedger = [...deployedLedger, ...pendingMigrations].sort(
			(a, b) => Number(a.created_at) - Number(b.created_at),
		);
		const legacy = (
			await pool.query("select * from public.app_auth_code where code='runner-fixture-code'")
		).rows[0];
		// The SQL chain through 0140 never created the PKCE column.
		expect(legacy).toBeDefined();
		expect(legacy).not.toHaveProperty("code_challenge");

		await run();
		const restored = (
			await pool.query("select * from public.app_auth_code where code='runner-fixture-code'")
		).rows[0];
		expect(restored).toEqual({ ...legacy, code_challenge: null });
		const applied = (await pool.query(ledgerQuery)).rows;
		expect(applied).toEqual(expectedLedger);
		expect(applied.filter((r) => r.created_at === String(timestamp))).toHaveLength(1);

		await run();
		expect((await pool.query(ledgerQuery)).rows).toEqual(applied);
		expect(
			(await pool.query("select * from public.app_auth_code where code='runner-fixture-code'"))
				.rows[0],
		).toEqual(restored);
	} finally {
		try {
			await pool?.end();
			if (databaseCreated) {
				await admin.query(`drop database if exists "${databaseName}" with (force)`);
			}
		} finally {
			await rm(temporaryDirectory, { recursive: true, force: true });
		}
	}
});
