/** Public reader + the existing PostgreSQL query logger; parameters and relation payloads never leave the fixture. */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { Effect, Layer } from "effect";
import type { PoolClient } from "pg";
import { Temporal } from "temporal-polyfill";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
	integrationAdminPool,
	verifySuiteDatabase,
} from "@/test/integration-database";

const queries = vi.hoisted(() => [] as { text: string; params: unknown[] }[]);
vi.mock("@/db", async () =>
	(await import("@/test/integration-database")).integrationDbModule({
		logQuery: (text, params) => {
			if (text.includes('from "absence_entry"')) queries.push({ text, params });
		},
	}),
);
const { db } = await import("@/db");
const { AnalyticsService } = await import(
	"@/lib/effect/services/analytics.service"
);
const { DatabaseService, makeDatabaseService } = await import(
	"@/lib/effect/services/database.service"
);
const { WorkPolicyServiceLive } = await import(
	"@/lib/effect/services/work-policy.service"
);

const prefix = `t1474-${randomBytes(6).toString("hex")}`;
const months = Array.from({ length: 121 }, (_, index) => {
	const first = Temporal.PlainDate.from("2016-01-01").add({ months: index });
	return {
		start: first.subtract({ days: 2 }).toString(),
		end: first.add({ days: 1 }).toString(),
	};
});
const populations = [
	{ label: "small", count: 8, managed: 2 },
	{ label: "large", count: 200, managed: 10 },
	{ label: "unrelated", count: 2000, managed: 0 },
].map((input) => ({
	...input,
	organizationId: `${prefix}-${input.label}`,
	teamIds: [randomUUID(), randomUUID()],
	categoryIds: [randomUUID(), randomUUID()],
	people: Array.from({ length: input.count }, (_, index) => ({
		employeeId: randomUUID(),
		userId: `${prefix}-${input.label}-${index}`,
		index,
	})),
}));
const ranges = [
	{
		label: "month",
		startDate: "2025-03-01",
		endDate: "2025-03-31",
		absencesPerPerson: 2,
		daysPerPerson: 4,
	},
	{
		label: "quarter",
		startDate: "2025-01-01",
		endDate: "2025-03-31",
		absencesPerPerson: 4,
		daysPerPerson: 12,
	},
	{
		label: "year",
		startDate: "2025-01-01",
		endDate: "2025-12-31",
		absencesPerPerson: 13,
		daysPerPerson: 48,
	},
	{
		label: "older-month",
		startDate: "2020-03-01",
		endDate: "2020-03-31",
		absencesPerPerson: 2,
		daysPerPerson: 4,
	},
	{
		label: "older-quarter",
		startDate: "2020-01-01",
		endDate: "2020-03-31",
		absencesPerPerson: 4,
		daysPerPerson: 12,
	},
	{
		label: "older-year",
		startDate: "2020-01-01",
		endDate: "2020-12-31",
		absencesPerPerson: 13,
		daysPerPerson: 48,
	},
];
const candidates = [
	{ label: "existing", name: null, ddl: null },
	{
		label: "employee-start-end-btree",
		name: "t1474_absence_start_end",
		ddl: "create index t1474_absence_start_end on absence_entry (employee_id, start_date, end_date)",
	},
	{
		label: "employee-end-start-btree",
		name: "t1474_absence_end_start",
		ddl: "create index t1474_absence_end_start on absence_entry (employee_id, end_date, start_date)",
	},
	{
		label: "employee-bounds-gist",
		name: "t1474_absence_bounds_gist",
		ddl: "create index t1474_absence_bounds_gist on absence_entry using gist (employee_id, start_date, end_date)",
	},
	{ label: "existing-repeat", name: null, ddl: null },
] as const;
const admin = integrationAdminPool();
const migratedIndexName = "absenceEntry_employeeId_endDate_startDate_idx";
const migrationSql = await readFile(
	new URL(
		"../../../drizzle/0284_absence_employee_overlap.sql",
		import.meta.url,
	),
	"utf8",
);
let restoreMigratedIndex = false;
const createdIndexes = new Set<string>();
const statements: {
	label: string;
	sql: string;
	params: unknown[];
	rows: number;
}[] = [];

const metrics = (values: number[]) => {
	const sorted = [...values].sort((left, right) => left - right);
	return {
		samples: sorted.length,
		p50:
			(sorted[Math.floor((sorted.length - 1) / 2)] +
				sorted[Math.ceil((sorted.length - 1) / 2)]) /
			2,
		p95: sorted[Math.ceil(sorted.length * 0.95) - 1],
		min: sorted[0],
		max: sorted.at(-1),
	};
};

type PlanNode = { [name: string]: unknown; Plans?: PlanNode[] };
/** No conditions, expressions, outputs, literals or raw plan strings survive this allowlist. */
function numericalPlan(input: PlanNode): PlanNode {
	const strings = [
		"Node Type",
		"Parent Relationship",
		"Join Type",
		"Scan Direction",
		"Relation Name",
		"Index Name",
		"Strategy",
	];
	const numbers = [
		"Startup Cost",
		"Total Cost",
		"Plan Rows",
		"Plan Width",
		"Actual Startup Time",
		"Actual Total Time",
		"Actual Rows",
		"Actual Loops",
		"Rows Removed by Filter",
		"Rows Removed by Index Recheck",
		"Heap Fetches",
		"Shared Hit Blocks",
		"Shared Read Blocks",
		"Shared Dirtied Blocks",
		"Shared Written Blocks",
		"Local Hit Blocks",
		"Local Read Blocks",
		"Temp Read Blocks",
		"Temp Written Blocks",
		"WAL Records",
		"WAL FPI",
		"WAL Bytes",
	];
	return {
		...Object.fromEntries(
			strings.flatMap((key) =>
				typeof input[key] === "string" ? [[key, input[key]]] : [],
			),
		),
		...Object.fromEntries(
			numbers.flatMap((key) =>
				typeof input[key] === "number" && Number.isFinite(input[key])
					? [[key, input[key]]]
					: [],
			),
		),
		...(input.Plans ? { Plans: input.Plans.map(numericalPlan) } : {}),
	};
}

async function explain(
	sql: string,
	params: unknown[],
	client: Pick<PoolClient, "query"> = admin,
) {
	const result = await client.query(
		`explain (analyze, buffers, wal, format json) ${sql}`,
		params,
	);
	const raw = result.rows[0]["QUERY PLAN"][0];
	return {
		planningMs: Number(raw["Planning Time"]),
		executionMs: Number(raw["Execution Time"]),
		plan: numericalPlan(raw.Plan),
	};
}

async function seed() {
	const verified = await verifySuiteDatabase();
	if (
		verified.databaseName.startsWith("approval_workflow_repository_test_perf_")
	)
		throw new Error(
			"Never run absence index experiments against an app browser fixture",
		);
	for (const population of populations) {
		await admin.query(
			"insert into organization (id,name,slug,timezone,created_at) values ($1,$1,$1,'UTC',now())",
			[population.organizationId],
		);
		await admin.query(
			"insert into team (id,organization_id,name,updated_at) select id,$2,'Synthetic team '||ordinal,now() from unnest($1::uuid[]) with ordinality input(id,ordinal)",
			[population.teamIds, population.organizationId],
		);
		await admin.query(
			"insert into absence_category (id,organization_id,type,name,updated_at) values ($1,$3,'sick','Sick leave',now()),($2,$3,'vacation','Vacation',now())",
			[
				population.categoryIds[0],
				population.categoryIds[1],
				population.organizationId,
			],
		);
		await admin.query(
			"insert into \"user\" (id,name,email,created_at,updated_at) select id,'Synthetic person',id||'@example.test',now(),now() from unnest($1::text[]) id",
			[population.people.map((person) => person.userId)],
		);
		await admin.query(
			"insert into employee (id,user_id,organization_id,role,team_id,start_date,is_active,updated_at) select id,user_id,$3,case when ordinal=0 then 'manager'::role else 'employee'::role end,case when ordinal%2=0 then $4::uuid else $5::uuid end,'2015-01-01',ordinal%10<>9,now() from unnest($1::uuid[],$2::text[],$6::int[]) as input(id,user_id,ordinal)",
			[
				population.people.map((person) => person.employeeId),
				population.people.map((person) => person.userId),
				population.organizationId,
				population.teamIds[0],
				population.teamIds[1],
				population.people.map((person) => person.index),
			],
		);
		for (const person of population.people.slice(1, population.managed + 1))
			await admin.query(
				"insert into employee_managers (employee_id,manager_id,assigned_by) values ($1,$2,$3)",
				[
					person.employeeId,
					population.people[0].employeeId,
					population.people[0].userId,
				],
			);
		for (let offset = 0; offset < population.people.length; offset += 500) {
			const people = population.people.slice(offset, offset + 500);
			await admin.query(
				"insert into absence_entry (employee_id,category_id,organization_id,start_date,end_date,status,notes,updated_at) select person.id,case when history.ordinal%3=0 then $2::uuid else $3::uuid end,case when (person.ordinal+history.ordinal)%4=0 then null else $1 end,history.start_date,history.end_date,case when history.ordinal%3=0 then 'approved'::approval_status when history.ordinal%3=1 then 'pending'::approval_status else 'rejected'::approval_status end,'Synthetic history with no employee data',now() from unnest($4::uuid[],$5::int[]) person(id,ordinal) cross join unnest($6::date[],$7::date[],$8::int[]) history(start_date,end_date,ordinal)",
				[
					population.organizationId,
					population.categoryIds[0],
					population.categoryIds[1],
					people.map((person) => person.employeeId),
					people.map((person) => person.index),
					months.map((month) => month.start),
					months.map((month) => month.end),
					months.map((_, index) => index),
				],
			);
		}
	}
	await admin.query("analyze absence_entry");
	await admin.query("analyze employee");
	await admin.query("analyze employee_managers");
}

async function cleanup() {
	for (const name of createdIndexes)
		await admin.query(`drop index if exists ${name}`);
	createdIndexes.clear();
	const organizations = populations.map(
		(population) => population.organizationId,
	);
	await admin.query(
		"delete from absence_entry where employee_id in (select id from employee where organization_id=any($1::text[]))",
		[organizations],
	);
	await admin.query("delete from organization where id=any($1::text[])", [
		organizations,
	]);
	await admin.query('delete from "user" where id like $1', [`${prefix}-%`]);
	if (restoreMigratedIndex) {
		await admin.query(migrationSql);
		restoreMigratedIndex = false;
	}
}

describe("representative scoped absence plans", () => {
	vi.setConfig({ hookTimeout: 180000, testTimeout: 180000 });
	beforeAll(seed);
	afterAll(cleanup);

	it("migrates a valid employee/end/start B-tree without excluding legacy organizations or statuses", async () => {
		// The repository runner applied the real migration chain. Retry the actual
		// migration in a transaction, as deployment does, without changing its keys.
		const client = await admin.connect();
		try {
			await client.query("begin");
			try {
				await client.query(migrationSql);
			} finally {
				await client.query("rollback");
			}
		} finally {
			client.release();
		}
		const result = await admin.query(
			`select access.amname method, index_data.indisvalid valid,
			 index_data.indisready ready, index_data.indisunique unique,
			 index_data.indpred is null unfiltered,
			 array(select attribute.attname::text from unnest(index_data.indkey) with ordinality key(attnum, ordinal)
			 join pg_attribute attribute on attribute.attrelid=index_data.indrelid and attribute.attnum=key.attnum
			 order by key.ordinal) columns
			 from pg_index index_data join pg_class index_class on index_class.oid=index_data.indexrelid
			 join pg_am access on access.oid=index_class.relam
			 where index_data.indrelid='absence_entry'::regclass and index_class.relname=$1`,
			[migratedIndexName],
		);
		expect(result.rows).toEqual([
			{
				method: "btree",
				valid: true,
				ready: true,
				unique: false,
				unfiltered: true,
				columns: ["employee_id", "end_date", "start_date"],
			},
		]);
	});

	it("preserves public results, legacy-null ownership and selective visibility across unrelated histories", async () => {
		for (const population of populations.filter(
			(population) => population.label !== "unrelated",
		))
			for (const range of ranges)
				for (const role of ["admin", "manager"] as const) {
					queries.length = 0;
					const start = Temporal.PlainDate.from(range.startDate)
						.toZonedDateTime("UTC")
						.toInstant();
					const end = Temporal.PlainDate.from(range.endDate)
						.add({ days: 1 })
						.toZonedDateTime("UTC")
						.toInstant()
						.subtract({ milliseconds: 1 });
					const result = await Effect.runPromise(
						Effect.gen(function* () {
							const analytics = yield* AnalyticsService;
							return yield* analytics.getAbsencePatterns({
								organizationId: population.organizationId,
								dateRange: {
									start: new Date(start.epochMilliseconds),
									end: new Date(end.epochMilliseconds),
									startDate: range.startDate,
									endDate: range.endDate,
									timezone: "UTC",
								},
								scope:
									role === "admin"
										? { role }
										: {
												role,
												managerEmployeeId: population.people[0].employeeId,
											},
							});
						}).pipe(
							Effect.provide(AnalyticsService.Live),
							Effect.provide(WorkPolicyServiceLive),
							Effect.provide(
								Layer.succeed(DatabaseService, makeDatabaseService(db)),
							),
						),
					);
					const visible =
						role === "admin" ? population.count : population.managed;
					expect(result.summary.totalAbsences).toBe(
						visible * range.absencesPerPerson,
					);
					expect(result.summary.totalDays).toBe(visible * range.daysPerPerson);
					expect(queries).toHaveLength(1);
					const query = queries[0];
					const rows = await admin.query(query.text, query.params);
					expect(rows.rowCount).toBe(visible * range.absencesPerPerson);
					expect(
						rows.rows.filter((row) => row.organization_id === null).length,
					).toBeGreaterThan(0);
					statements.push({
						label: `${population.label}/${role}/${range.label}`,
						sql: query.text,
						params: query.params,
						rows: rows.rowCount ?? 0,
					});
				}
	});

	if (process.env.Z8_ABSENCE_INDEX_EVIDENCE)
		it("records actual eager-relation plans and candidate read/storage/write costs", async () => {
			const output = process.env.Z8_ABSENCE_INDEX_EVIDENCE;
			if (!output) throw new Error("Index evidence output is required");
			if (statements.length !== 24)
				throw new Error(
					"All public caller conditions must complete before measuring indexes",
				);
			const others = await admin.query(
				"select count(*)::int count from organization where not (id=any($1::text[]))",
				[populations.map((population) => population.organizationId)],
			);
			if (others.rows[0].count !== 0)
				throw new Error(
					"Index measurement requires an exclusive disposable fixture database",
				);
			// Reproduce the measured predecessor after the production migration is
			// installed. This is only reached in the exclusive disposable database,
			// after the migrated schema/caller assertions passed. Never drop other
			// schema indexes; cleanup restores this exact migration even on failure.
			restoreMigratedIndex = true;
			await admin.query(`drop index "${migratedIndexName}"`);
			await admin.query("create extension if not exists btree_gist");
			const existingIndexes = (
				await admin.query(
					"select index_class.relname name, access.amname method, pg_relation_size(index_class.oid)::float8 bytes, index_data.indisunique is_unique, (index_data.indpred is not null) is_partial from pg_index index_data join pg_class index_class on index_class.oid=index_data.indexrelid join pg_am access on access.oid=index_class.relam where index_data.indrelid='absence_entry'::regclass order by index_class.relname",
				)
			).rows;
			const evidence: { [key: string]: unknown } = {
				schema: 1,
				existingIndexes,
				runtime: {
					node: process.version,
					postgres: (await admin.query("show server_version")).rows[0]
						.server_version,
					samples: 20,
					cacheState: "warm, no OS/shared-buffer eviction",
					plannerSettings: (
						await admin.query(
							"select name,setting,unit from pg_settings where name=any($1::text[]) order by name",
							[
								[
									"shared_buffers",
									"effective_cache_size",
									"work_mem",
									"random_page_cost",
									"default_statistics_target",
									"jit",
									"jit_above_cost",
									"max_parallel_workers_per_gather",
								],
							],
						)
					).rows,
				},
				fixture: {
					small: 8,
					large: 200,
					unrelated: 2000,
					months: 121,
					totalAbsences: 267168,
					managerEmployees: [2, 10],
					legacyOrganization: "one quarter null",
					statuses: "approved/pending/rejected included unchanged",
					rangeZone: "UTC",
					histories:
						"2016-01 through 2026-01, four inclusive calendar days crossing each month start",
				},
				conditions: statements.map((statement) => ({
					label: statement.label,
					rows: statement.rows,
					sqlSha256: createHash("sha256").update(statement.sql).digest("hex"),
				})),
				variants: [],
				decision: "unreviewed",
				baselineExcludesMigratedIndex: migratedIndexName,
				limitations: [
					"Warm disposable PostgreSQL measurements, not browser/production latency.",
					"No SQL, parameters, relation payloads, personal data or tokens are retained.",
					"GiST scalar interval bounds use btree_gist; a daterange expression alone cannot serve the unchanged two-inequality statement.",
				],
			};
			for (const candidate of candidates) {
				const buildStarted = performance.now();
				if (candidate.ddl) {
					await admin.query(candidate.ddl);
					createdIndexes.add(candidate.name);
				}
				const indexBuildMs = candidate.name
					? performance.now() - buildStarted
					: null;
				await admin.query("analyze absence_entry");
				const size = candidate.name
					? Number(
							(
								await admin.query(
									"select pg_relation_size($1::regclass) bytes",
									[candidate.name],
								)
							).rows[0].bytes,
						)
					: 0;
				const reads = [];
				for (const statement of statements) {
					const plans = [];
					const wall = [];
					const explainWall = [];
					for (let iteration = 0; iteration < 20; iteration++) {
						const started = performance.now();
						const result = await admin.query(statement.sql, statement.params);
						wall.push(performance.now() - started);
						expect(result.rowCount).toBe(statement.rows);
						const explainStarted = performance.now();
						plans.push(await explain(statement.sql, statement.params));
						explainWall.push(performance.now() - explainStarted);
					}
					reads.push({
						condition: statement.label,
						rows: statement.rows,
						queryRoundTripMs: metrics(wall),
						explainRoundTripMs: metrics(explainWall),
						executionMs: metrics(plans.map((plan) => plan.executionMs)),
						sharedHitBlocks: planMetric(plans, "Shared Hit Blocks"),
						sharedReadBlocks: planMetric(plans, "Shared Read Blocks"),
						tempWrittenBlocks: planMetric(plans, "Temp Written Blocks"),
						firstPlan: plans[0],
						lastPlan: plans.at(-1),
					});
				}
				(evidence.variants as unknown[]).push({
					candidate: candidate.label,
					indexBytes: size,
					indexBuildMs,
					reads,
					writes: await measureWrites(),
				});
				await writeFile(output, JSON.stringify(evidence, null, 2), {
					mode: 0o600,
				});
				if (candidate.name) {
					await admin.query(`drop index ${candidate.name}`);
					createdIndexes.delete(candidate.name);
				}
				await admin.query("vacuum (analyze) absence_entry");
			}
			expect((evidence.variants as unknown[]).length).toBe(5);
		});
});

function planMetric(
	plans: Awaited<ReturnType<typeof explain>>[],
	name: string,
) {
	const values = plans.map((plan) => plan.plan[name]);
	return values.every(
		(value): value is number =>
			typeof value === "number" && Number.isFinite(value),
	)
		? metrics(values)
		: null;
}

async function measureWrites() {
	const population = populations[2];
	const ids = (
		await admin.query(
			"select id from absence_entry where employee_id=$1 order by start_date limit 100",
			[population.people[0].employeeId],
		)
	).rows.map((row) => row.id);
	const result = [];
	for (const operation of ["insert", "change-end-date"] as const) {
		const samples = [];
		const client = await admin.connect();
		try {
			for (let iteration = 0; iteration < 20; iteration++) {
				await client.query("begin");
				try {
					const plan =
						operation === "insert"
							? await explain(
									"insert into absence_entry (employee_id,category_id,organization_id,start_date,end_date,status,updated_at) select $1,$2,$3,'2010-03-01','2010-03-04','approved',now() from generate_series(1,100)",
									[
										population.people[0].employeeId,
										population.categoryIds[0],
										population.organizationId,
									],
									client,
								)
							: await explain(
									"update absence_entry set end_date=end_date+1 where id=any($1::uuid[])",
									[ids],
									client,
								);
					samples.push(plan);
				} finally {
					await client.query("rollback");
				}
			}
		} finally {
			client.release();
		}
		const wal = samples.map((sample) => Number(sample.plan["WAL Bytes"]));
		if (wal.some((value) => !Number.isFinite(value) || value < 0))
			throw new Error("Write WAL evidence is unavailable");
		result.push({
			operation,
			rowsPerTransaction: 100,
			executionMs: metrics(samples.map((sample) => sample.executionMs)),
			walBytes: metrics(wal),
			firstPlan: samples[0],
			lastPlan: samples.at(-1),
		});
	}
	return result;
}
