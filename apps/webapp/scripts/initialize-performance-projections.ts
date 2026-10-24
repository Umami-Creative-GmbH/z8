/** Guarded fixture setup through the existing work-balance rebuild API. Existing projections are never reset. */
import { readFile, writeFile } from "node:fs/promises";
import { Temporal } from "temporal-polyfill";
import {
	closeIntegrationPools,
	integrationAdminPool,
	verifySuiteDatabase,
} from "@/test/integration-database";
import { projectionFailure } from "../../../scripts/performance/projection-initialization.mjs";

type Fixture = {
	kind: string;
	version: number;
	actors: Record<string, { organizationId: string }>;
	organizations: { label: string; employees: number }[];
	projectionInitialization?: Record<string, unknown>;
};

const [manifestPath, progressPath, asOf] = process.argv.slice(2);
let closeApplicationPool: (() => Promise<void>) | undefined;
let failureStage = "preflight";
async function run() {
	if (!manifestPath || !progressPath || !asOf)
		throw new Error(
			"Explicit fixture manifest, progress path and as-of instant required",
		);
	const instant = Temporal.Instant.from(asOf);
	const fixture: Fixture = JSON.parse(await readFile(manifestPath, "utf8"));
	if (fixture.kind !== "disposable" || fixture.version !== 2)
		throw new Error("Version 2 disposable fixture required");
	const configuration = await verifySuiteDatabase();
	const connection = new URL(configuration.databaseUrl);
	if (
		!/^approval_workflow_repository_test_perf_[a-f0-9]{12}$/.test(
			configuration.databaseName,
		) ||
		process.env.POSTGRES_DB !== configuration.databaseName ||
		process.env.POSTGRES_HOST !== connection.hostname ||
		String(process.env.POSTGRES_PORT) !== (connection.port || "5432") ||
		process.env.POSTGRES_USER !== decodeURIComponent(connection.username) ||
		process.env.POSTGRES_PASSWORD !== decodeURIComponent(connection.password)
	)
		throw new Error("Application and guarded fixture database must match");
	const organizations = [
		...new Set(
			Object.values(fixture.actors).map((actor) => actor.organizationId),
		),
	];
	if (organizations.length !== 2 || fixture.organizations.length !== 2)
		throw new Error("Both synthetic fixture organizations required");
	const people: {
		id: string;
		organization_id: string;
		projection_id: string | null;
	}[] = [];
	for (const organizationId of organizations) {
		const identity = /^perf-(small|large)-[a-f0-9]{12}$/.exec(organizationId);
		if (!identity) throw new Error("Synthetic organization identity required");
		const expected = identity[1] === "small" ? 8 : 200;
		if (
			fixture.organizations.find(
				(organization) => organization.label === identity[1],
			)?.employees !== expected
		)
			throw new Error("Unexpected synthetic manifest population");
		const result = await integrationAdminPool().query<{
			id: string;
			organization_id: string;
			projection_id: string | null;
		}>(
			"select e.id, e.organization_id, b.id as projection_id from employee e left join employee_work_balance b on b.employee_id=e.id and b.organization_id=e.organization_id where e.organization_id=$1",
			[organizationId],
		);
		if (result.rows.length !== expected)
			throw new Error("Unexpected synthetic database population");
		people.push(...result.rows);
	}
	if (people.length !== 208)
		throw new Error("Both small and large synthetic rosters are required");
	const missing = people.filter((person) => person.projection_id === null);
	const progress = {
		status: "running",
		total: people.length,
		preserved: people.length - missing.length,
		rebuilt: 0,
		requestedAsOf: instant.toString(),
	};
	const save = () =>
		writeFile(progressPath, JSON.stringify(progress, null, 2), { mode: 0o600 });
	await save();
	try {
		if (missing.length) {
			failureStage = "load-work-balance-api";
			// Import the production pool only after its configuration and both synthetic rosters passed the gate.
			const { db } = await import("@/db");
			closeApplicationPool = () => db.$client.end();
			const { refreshEmployeeWorkBalanceFromPeriods } = await import(
				"@/lib/work-balance/service"
			);
			for (const person of missing) {
				failureStage = "rebuild-projection";
				await refreshEmployeeWorkBalanceFromPeriods({
					organizationId: person.organization_id,
					employeeId: person.id,
					forceFullRebuild: true,
					now: new Date(instant.epochMilliseconds),
				});
				failureStage = "verify-projection";
				const row = await integrationAdminPool().query(
					"select id from employee_work_balance where employee_id=$1 and organization_id=$2",
					[person.id, person.organization_id],
				);
				if (row.rowCount !== 1)
					throw new Error(
						"Work-balance API did not initialize the fixture projection",
					);
				progress.rebuilt++;
				await save();
			}
		}
		progress.status = "complete";
		await save();
		if (missing.length > 0 || !fixture.projectionInitialization) {
			fixture.projectionInitialization = {
				...progress,
				method: "refreshEmployeeWorkBalanceFromPeriods",
				existingRowsPreserved: true,
			};
			await writeFile(manifestPath, JSON.stringify(fixture, null, 2), {
				mode: 0o600,
			});
		}
		console.log(
			`Synthetic projections ready: ${progress.total} total, ${progress.preserved} preserved, ${progress.rebuilt} rebuilt.`,
		);
	} catch (error) {
		progress.status = "failed";
		await save();
		throw error;
	}
}

run()
	.catch(async (error) => {
		if (progressPath)
			await writeFile(
				`${progressPath}.failure-private.json`,
				JSON.stringify(projectionFailure(error, failureStage), null, 2),
				{ mode: 0o600 },
			);
		console.error(
			"Synthetic projection initialization failed; inspect only the private fixture configuration/progress.",
		);
		process.exitCode = 1;
	})
	.finally(async () => {
		await closeApplicationPool?.();
		await closeIntegrationPools();
	});
