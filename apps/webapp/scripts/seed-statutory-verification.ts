/**
 * Development seed for the live verification of the statutory monitors (#2018, spec #1934).
 *
 * Creates one fictional organization ("Statutory Verification", Europe/Berlin, shift planning on)
 * whose employees produce every statutory warning in Scheduling and Staffing, dated around the
 * day the seed runs (`src/lib/statutory/__tests__/verification-seed.ts`):
 *
 * | Login (`@example.test`) | Role                                                                    |
 * | ----------------------- | ----------------------------------------------------------------------- |
 * | `stv-admin`             | org admin (member `owner`, employee `admin`)                            |
 * | `stv-planner`           | planner: workforce admin below org admin (member `member`, employee `admin`) |
 * | `stv-manager`           | scoped manager of "Store team" (member `member`, employee `manager`)    |
 * | `stv-mini-warn`         | Minijob, this month at about 87 % of the monthly cap                    |
 * | `stv-mini-over`         | Minijob, this month above the cap                                       |
 * | `stv-seasonal`          | short-term employment, 61 of 70 working days used this year             |
 * | `stv-student`           | working student: lecture weeks over 20 h, an evening-heavy last week    |
 * | `stv-on-call`           | § 12 TzBfG on-call, a shift on short notice, sick leave last week       |
 * | `stv-apprentice`        | 16-year-old apprentice: school day, exam, night and Saturday drafts     |
 *
 * The scoped manager has real team permissions: `team_permissions` on "Store team" (team
 * settings, members, requests), a supervisor row on the "Floor" subarea (coverage rules) and every
 * employee as a direct report (`employee_managers`: the Assign To picker and Staffing candidates).
 * Templates sit on that subarea, so a scoped manager can load them. The planner reaches every
 * coverage rule but, as a workforce admin, no shift templates (#1651).
 *
 * Run it only against a disposable database. From apps/webapp, with POSTGRES_* pointing at it:
 *
 *   pnpm db:seed:statutory-verification --confirm-database=<POSTGRES_DB>
 *
 * It refuses a non-local host and a database other than the confirmed one. Every run first
 * removes what an earlier run created (ids start with `stv-`) and seeds afresh; `--remove` only
 * removes it. The password for every login is `STATUTORY_SEED_PASSWORD`, which is never printed,
 * or else a generated one printed at the end. Keep it out of `src/db/seed`: those seeders run in
 * production.
 */
import { randomBytes } from "node:crypto";
import { Pool } from "pg";
import { Temporal } from "temporal-polyfill";
import {
	removeStatutoryVerificationSeed,
	seedStatutoryVerification,
} from "@/lib/statutory/__tests__/verification-seed";
import { verificationSeedPassword } from "@/lib/statutory/__tests__/verification-seed-password";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

function refuse(message: string): never {
	console.error(`\n✗ ${message}\n`);
	process.exit(1);
}

function argValue(name: string): string | undefined {
	const prefix = `--${name}=`;
	return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

function databaseConfig() {
	const host = process.env.POSTGRES_HOST;
	const database = process.env.POSTGRES_DB;
	if (!host || !database || !process.env.POSTGRES_USER) {
		refuse("Set POSTGRES_HOST, POSTGRES_PORT, POSTGRES_DB, POSTGRES_USER and POSTGRES_PASSWORD.");
	}
	if (!LOCAL_HOSTS.has(host)) {
		refuse(`Refusing to seed ${host}: this seed is for a disposable local database only.`);
	}
	if (argValue("confirm-database") !== database) {
		refuse(
			`Refusing to seed without --confirm-database=${database}. Run it only against a disposable database.`,
		);
	}
	return {
		host,
		port: Number(process.env.POSTGRES_PORT ?? 5432),
		database,
		user: process.env.POSTGRES_USER,
		password: process.env.POSTGRES_PASSWORD,
		options: "-c timezone=UTC",
	};
}

async function main(): Promise<void> {
	const pool = new Pool(databaseConfig());
	try {
		await removeStatutoryVerificationSeed(pool);
		if (process.argv.includes("--remove")) {
			console.log("Removed the statutory verification seed.");
			return;
		}
		const { password, notice } = verificationSeedPassword(process.env.STATUTORY_SEED_PASSWORD, () =>
			randomBytes(12).toString("hex"),
		);
		const people = await seedStatutoryVerification(pool, {
			password,
			now: Temporal.Instant.fromEpochMilliseconds(Date.now()),
		});
		console.log("\nSeeded organization 'Statutory Verification' (Europe/Berlin).\n");
		for (const who of people) console.log(`  ${who.email.padEnd(32)} ${who.name}`);
		console.log(`\n${notice}\n`);
	} finally {
		await pool.end();
	}
}

main().catch((error: unknown) => {
	console.error(error);
	process.exit(1);
});
