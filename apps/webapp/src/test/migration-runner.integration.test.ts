import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import {
	integrationAdminPool,
	parseIntegrationDatabaseUrl,
} from "@/test/integration-database";

const execute = promisify(execFile);
const appDirectory = fileURLToPath(new URL("../../", import.meta.url));

it("the production migration runner recovers a deployed database and safely retries", {
	timeout: 60000,
}, async () => {
	const pool = integrationAdminPool();
	const config = parseIntegrationDatabaseUrl(
		process.env.APPROVAL_WORKFLOW_REPOSITORY_TEST_DATABASE_URL ?? "",
	);
	const journal = JSON.parse(
		await readFile(
			new URL("../../drizzle/meta/_journal.json", import.meta.url),
			"utf8",
		),
	) as { entries: { tag: string; when: number }[] };
	const recovery = journal.entries.find(
		(e) => e.tag === "0141_app_auth_code_pkce_recovery",
	);
	expect(recovery).toBeDefined();
	const timestamp = recovery?.when ?? 0;
	const before = (
		await pool.query(
			"select hash,created_at::text from drizzle.__drizzle_migrations order by created_at",
		)
	).rows;
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
	const legacyHash = createHash("sha256")
		.update("legacy-ledger-test-fixture")
		.digest("hex");
	const url = new URL(config.databaseUrl);
	const env: NodeJS.ProcessEnv = {
		...process.env,
		DATABASE_URL: config.databaseUrl,
		POSTGRES_HOST: url.hostname,
		POSTGRES_PORT: url.port,
		POSTGRES_DB: config.databaseName,
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
	// Simulate a deployment through 0140. Only this gate-verified disposable DB is mutated.
	const client = await pool.connect();
	try {
		await client.query("begin");
		await client.query(
			"alter table public.app_auth_code drop column code_challenge",
		);
		await client.query(
			"delete from drizzle.__drizzle_migrations where created_at >= $1 or created_at::text = any($2::text[])",
			[timestamp, recoveredGaps],
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
	const deployedLedger = (
		await pool.query(
			"select hash,created_at::text from drizzle.__drizzle_migrations order by created_at",
		)
	).rows;
	const expectedLedger = [
		...deployedLedger,
		...before.filter((row) => Number(row.created_at) >= timestamp),
	].sort((a, b) => Number(a.created_at) - Number(b.created_at));
	const legacy = (
		await pool.query(
			"select * from public.app_auth_code where code='runner-fixture-code'",
		)
	).rows[0];
	try {
		await run();
		const restored = (
			await pool.query(
				"select * from public.app_auth_code where code='runner-fixture-code'",
			)
		).rows[0];
		expect(restored).toEqual({ ...legacy, code_challenge: null });
		const applied = (
			await pool.query(
				"select hash,created_at::text from drizzle.__drizzle_migrations order by created_at",
			)
		).rows;
		expect(applied).toEqual(expectedLedger);
		expect(
			applied.filter((r) => r.created_at === String(timestamp)),
		).toHaveLength(1);
		await run();
		expect(
			(
				await pool.query(
					"select hash,created_at::text from drizzle.__drizzle_migrations order by created_at",
				)
			).rows,
		).toEqual(applied);
		expect(
			(
				await pool.query(
					"select * from public.app_auth_code where code='runner-fixture-code'",
				)
			).rows[0],
		).toEqual(restored);
	} finally {
		await pool.query(
			"delete from drizzle.__drizzle_migrations where created_at::text = any($1::text[])",
			[legacyTimestamps],
		);
		for (const row of before.filter((row) =>
			recoveredGaps.includes(row.created_at),
		)) {
			await pool.query(
				"insert into drizzle.__drizzle_migrations (hash,created_at) select $1,$2 where not exists (select 1 from drizzle.__drizzle_migrations where created_at=$2)",
				[row.hash, row.created_at],
			);
		}
		await pool.query(`delete from public."user" where id='t780-runner-user'`);
	}
});
