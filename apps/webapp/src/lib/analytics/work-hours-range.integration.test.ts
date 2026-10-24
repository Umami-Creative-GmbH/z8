import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { Effect, Layer } from "effect";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
	createLifecycleDatabaseFixture,
	type LifecycleDatabaseFixture,
} from "@/lib/employee-lifecycle/testing/database.test.fixture";
import { withCanonicalRecords } from "@/lib/time-tracking/work-records/__tests__/historical-work";

const queries = vi.hoisted(() => [] as string[]);
const statements = vi.hoisted(
	() => [] as { text: string; params: unknown[] }[],
);
const caller = vi.hoisted(() => ({
	userId: null as string | null,
	organizationId: null as string | null,
}));
vi.mock("next/headers", async () =>
	(await import("@/test/integration-harness")).nextHeaders(),
);
vi.mock("next/server", async (original) =>
	(await import("@/test/integration-harness")).nextServer(original),
);
vi.mock("@/lib/auth", () => ({
	auth: {
		api: {
			getSession: async () =>
				caller.userId
					? {
							user: {
								id: caller.userId,
								email: "fixture@example.test",
								role: "user",
							},
							session: {
								id: "work-hours-fixture",
								userId: caller.userId,
								activeOrganizationId: caller.organizationId,
							},
						}
					: null,
		},
	},
}));
vi.mock("@/db", async () =>
	(await import("@/test/integration-database")).integrationDbModule({
		logQuery: (text, params) => {
			queries.push(text);
			statements.push({ text, params });
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
const { getWorkHoursAnalyticsData } = await import(
	"@/app/[locale]/(app)/analytics/actions"
);

describe("scoped work-hours range evidence on PostgreSQL", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	let fixture: LifecycleDatabaseFixture;
	const people: string[] = [];
	const policyId = randomUUID();

	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();
		await fixture.pool.query(
			`insert into organization_tracking_settings (organization_id,tracking_start_date,activated_at) values ($1,'2026-01-01',now())`,
			[fixture.organizationId],
		);
		await fixture.pool.query(
			`insert into work_policy (id,organization_id,name,regulation_enabled,schedule_enabled,created_by,updated_at) values ($1,$2,'Weekdays',false,true,$3,now())`,
			[policyId, fixture.organizationId, fixture.ownerUserId],
		);
		await fixture.pool.query(
			`insert into work_policy_schedule (policy_id,hours_per_cycle,updated_at) values ($1,40,now())`,
			[policyId],
		);
		await fixture.pool.query(
			`insert into work_policy_assignment (policy_id,organization_id,assignment_type,created_by,updated_at) values ($1,$2,'organization',$3,now())`,
			[policyId, fixture.organizationId, fixture.ownerUserId],
		);
		for (let index = 0; index < 4; index++) {
			const person = await fixture.seedEmployee();
			people.push(person.employeeId);
			await fixture.pool.query(
				`insert into employee_employment_history (employee_id,organization_id,employment_period_id,valid_from,weekly_contract_minutes,review_state,created_by,updated_at) values ($1,$2,$3,'2026-01-01T00:00:00Z',2400,'confirmed',$4,now())`,
				[
					person.employeeId,
					fixture.organizationId,
					person.employmentPeriodId,
					fixture.ownerUserId,
				],
			);
			await withCanonicalRecords(fixture.pool, async (client) => {
				const incoming = randomUUID(),
					outgoing = randomUUID();
				await client.query(
					`insert into time_entry (id,employee_id,organization_id,type,timestamp,utc_offset_minutes,timezone,timezone_source,hash,created_by) values ($1,$3,$4,'clock_in','2026-03-02T09:00:00Z',0,'UTC','user_setting',$1::uuid::text,$5),($2,$3,$4,'clock_out','2026-03-02T17:00:00Z',0,'UTC','user_setting',$2::uuid::text,$5)`,
					[
						incoming,
						outgoing,
						person.employeeId,
						fixture.organizationId,
						fixture.ownerUserId,
					],
				);
				await client.query(
					`insert into work_period (employee_id,organization_id,clock_in_id,clock_out_id,start_time,end_time,duration_minutes,is_active,updated_at) values ($1,$2,$3,$4,'2026-03-02T09:00:00Z','2026-03-02T17:00:00Z',480,false,now())`,
					[person.employeeId, fixture.organizationId, incoming, outgoing],
				);
			});
		}
		await fixture.pool.query(`update employee set role='manager' where id=$1`, [
			fixture.employeeId,
		]);
		await fixture.pool.query(
			`insert into employee_managers (employee_id,manager_id,assigned_by) values ($1,$2,$3)`,
			[people[0], fixture.employeeId, fixture.ownerUserId],
		);
	});
	afterAll(async () => fixture?.close());

	async function read(
		endDate = "2026-03-31",
		employeeId?: string,
		scope:
			| { role: "admin" }
			| { role: "manager"; managerEmployeeId: string } = { role: "admin" },
		client: Parameters<typeof makeDatabaseService>[0] = db,
		startDate = "2026-03-01",
	) {
		queries.length = 0;
		statements.length = 0;
		const start = performance.now();
		const result = await Effect.runPromise(
			Effect.gen(function* () {
				const analytics = yield* AnalyticsService;
				return yield* analytics.getWorkHoursAnalytics({
					organizationId: fixture.organizationId,
					employeeId,
					scope,
					dateRange: {
						start: new Date(`${startDate}T00:00:00Z`),
						end: new Date(`${endDate}T23:59:59.999Z`),
						startDate,
						endDate,
						timezone: "UTC",
					},
				});
			}).pipe(
				Effect.provide(AnalyticsService.Live),
				Effect.provide(WorkPolicyServiceLive),
				Effect.provide(
					Layer.succeed(DatabaseService, makeDatabaseService(client)),
				),
			),
		);
		const evidence = {
			queries: queries.length,
			roster: queries.filter(
				(text) =>
					text.includes('from "employee"') &&
					!text.includes('left join "organization_tracking_settings"'),
			).length,
			tracking: queries.filter((text) =>
				text.includes('left join "organization_tracking_settings"'),
			).length,
			periods: queries.filter((text) => text.includes('from "work_period"'))
				.length,
			elapsedMs: performance.now() - start,
		};
		if (process.env.Z8_WORK_HOURS_QUERY_EVIDENCE === "1")
			console.info(
				"work-hours fixture evidence",
				JSON.stringify({
					endDate,
					employees: result.byEmployee.length,
					...evidence,
				}),
			);
		return { result, evidence };
	}

	it("loads tracking once per bounded employee range rather than repeating it per employee", async () => {
		const { result, evidence } = await read();
		expect(
			result.byEmployee.filter((row) => people.includes(row.employeeId)),
		).toHaveLength(4);
		expect(result.summary.totalHours).toBe(32);
		if (process.env.Z8_WORK_HOURS_LATENCY_EVIDENCE === "1") {
			for (const [begin, end] of [
				["2026-03-01", "2026-03-31"],
				["2026-01-01", "2026-03-31"],
				["2026-01-01", "2026-12-31"],
			]) {
				const samples = [];
				let count = 0;
				for (let sample = 0; sample < 20; sample++) {
					const measured = await read(
						end,
						undefined,
						{ role: "admin" },
						db,
						begin,
					);
					samples.push(measured.evidence.elapsedMs);
					count = measured.evidence.queries;
				}
				samples.sort((a, b) => a - b);
				console.info(
					"work-hours warm reader evidence",
					JSON.stringify({
						employees: 6,
						startDate: begin,
						endDate: end,
						samples: 20,
						queries: count,
						p50Ms: (samples[9] + samples[10]) / 2,
						p95Ms: samples[18],
					}),
				);
			}
		}
		// The declared structural budget is one tracking batch for this six-person fixture.
		expect(evidence.tracking).toBe(1);
	});
	it("reads completed periods in fixed range batches for both raw charts and protected balances", async () => {
		const { result, evidence } = await read();
		expect(result.summary.totalHours).toBe(32);
		expect(evidence.periods).toBeLessThanOrEqual(2);
	});
	it("keeps policy, employment, absence and holiday I/O bounded as the range grows", async () => {
		const month = await read();
		expect(month.evidence.queries).toBeLessThanOrEqual(26);
		const year = await read(
			"2026-12-31",
			undefined,
			{ role: "admin" },
			db,
			"2026-01-01",
		);
		expect(year.result.summary.totalHours).toBe(32);
		expect(year.evidence.queries).toBeLessThanOrEqual(26);
	});
	it("resolves authorized employee inputs once for the whole view", async () => {
		expect((await read()).evidence.roster).toBe(1);
	});
	it("retrieves only a manager's current assigned employees even for a specific unassigned employee", async () => {
		const scope = {
			role: "manager",
			managerEmployeeId: fixture.employeeId,
		} as const;
		const allowed = await read(undefined, undefined, scope);
		expect(allowed.result.byEmployee.map((row) => row.employeeId)).toEqual([
			people[0],
		]);
		expect(allowed.result.summary.totalHours).toBe(8);
		expect((await read(undefined, people[1], scope)).result.byEmployee).toEqual(
			[],
		);
	});
	it("retains explicit month work, requirement and distribution totals", async () => {
		const { result } = await read();
		expect(result.summary).toEqual({
			totalHours: 32,
			avgHoursPerWeek: 1.33,
			overtimeHours: 0,
			undertimeHours: 1024,
		});
		expect(result.distribution).toEqual([
			{
				date: "2026-03-02",
				hours: 32,
				expectedHours: 48,
				isOvertime: false,
				isUndertime: true,
			},
		]);
		expect(
			result.byEmployee.find((row) => row.employeeId === people[0]),
		).toMatchObject({
			totalHours: 8,
			overtimeHours: 0,
			undertimeHours: 168,
			avgHoursPerWeek: 1.82,
		});
	});
	it("authenticates manager scope freshly and rejects an employee before range reads", async () => {
		const manager = await fixture.pool.query(
			`select user_id from employee where id=$1`,
			[fixture.employeeId],
		);
		caller.userId = manager.rows[0].user_id;
		caller.organizationId = fixture.organizationId;
		const range = {
			start: new Date("2026-03-01T00:00:00Z"),
			end: new Date("2026-03-31T23:59:59.999Z"),
			startDate: "2026-03-01",
			endDate: "2026-03-31",
			timezone: "UTC",
		};
		expect(await getWorkHoursAnalyticsData(range)).toMatchObject({
			success: true,
			data: { summary: { totalHours: 8 } },
		});
		const roster = statements.find(
			(query) =>
				query.text.includes('from "employee"') &&
				query.text.includes('"user"') &&
				query.text.includes('"employee_managers"'),
		);
		expect(roster).toBeDefined();
		if (!roster) throw new Error("Manager roster query missing");
		expect(
			(await fixture.pool.query(roster.text, roster.params)).rows.map(
				(row) => row.id,
			),
		).toEqual([people[0]]);
		await fixture.pool.query(
			`delete from employee_managers where manager_id=$1`,
			[fixture.employeeId],
		);
		expect(await getWorkHoursAnalyticsData(range)).toMatchObject({
			success: true,
			data: { byEmployee: [] },
		});
		const member = await fixture.pool.query(
			`select user_id from employee where id=$1`,
			[people[0]],
		);
		caller.userId = member.rows[0].user_id;
		queries.length = 0;
		expect(await getWorkHoursAnalyticsData(range)).toMatchObject({
			success: false,
			code: "AuthorizationError",
		});
		expect(queries.some((text) => text.includes('from "work_period"'))).toBe(
			false,
		);
	});

	async function personWithTerms(timezone = "UTC", contractType = "fixed") {
		const person = await fixture.seedEmployee();
		await fixture.pool.query(
			`insert into user_settings (user_id,timezone,updated_at) values ($1,$2,now())`,
			[person.userId, timezone],
		);
		await fixture.pool.query(
			`update employee set contract_type=$2 where id=$1`,
			[person.employeeId, contractType],
		);
		await fixture.pool.query(
			`insert into employee_employment_history (employee_id,organization_id,employment_period_id,valid_from,weekly_contract_minutes,contract_type,review_state,created_by,updated_at) values ($1,$2,$3,'2026-01-01T00:00:00Z',2400,$5,'confirmed',$4,now())`,
			[
				person.employeeId,
				fixture.organizationId,
				person.employmentPeriodId,
				fixture.ownerUserId,
				contractType,
			],
		);
		return person;
	}
	async function work(
		employeeId: string,
		start: string,
		end: string,
		minutes: number,
		startOffset = 0,
		endOffset = 0,
		organizationId = fixture.organizationId,
	) {
		await withCanonicalRecords(fixture.pool, async (client) => {
			const incoming = randomUUID(),
				outgoing = randomUUID();
			for (const [id, type, at, offset] of [
				[incoming, "clock_in", start, startOffset],
				[outgoing, "clock_out", end, endOffset],
			])
				await client.query(
					`insert into time_entry (id,employee_id,organization_id,type,timestamp,utc_offset_minutes,timezone,timezone_source,hash,created_by) values ($1,$2,$3,$4,$5,$6,$8,'user_setting',$1::uuid::text,$7)`,
					[
						id,
						employeeId,
						organizationId,
						type,
						at,
						offset,
						fixture.ownerUserId,
						offset > 0
							? "Europe/Berlin"
							: offset < 0
								? "America/New_York"
								: "UTC",
					],
				);
			await client.query(
				`insert into work_period (employee_id,organization_id,clock_in_id,clock_out_id,start_time,end_time,duration_minutes,is_active,updated_at) values ($1,$2,$3,$4,$5,$6,$7,false,now())`,
				[employeeId, organizationId, incoming, outgoing, start, end, minutes],
			);
		});
	}
	it("retains protected rounding and employee-local boundaries when captured endpoints differ", async () => {
		const person = await personWithTerms("Europe/Berlin");
		await work(
			person.employeeId,
			"2026-03-31T21:58:30Z",
			"2026-03-31T22:01:00Z",
			3,
			120,
			-240,
		);
		const { result } = await read(undefined, person.employeeId);
		expect(result.summary).toEqual({
			totalHours: 0.03,
			avgHoursPerWeek: 0.01,
			overtimeHours: 0,
			undertimeHours: 183.95,
		});
		expect(result.distribution).toEqual([
			{
				date: "2026-03-31",
				hours: 0.03,
				expectedHours: 8,
				isOvertime: false,
				isUndertime: true,
			},
		]);
	});
	it("retains the 23-hour employee-local DST day in range evidence", async () => {
		const person = await personWithTerms("Europe/Berlin");
		await work(
			person.employeeId,
			"2026-03-28T23:00:00Z",
			"2026-03-29T22:00:00Z",
			1380,
			60,
			120,
		);
		const { result } = await read(undefined, person.employeeId);
		expect(result.summary).toMatchObject({
			totalHours: 23,
			overtimeHours: 0,
			undertimeHours: 161,
		});
		expect(
			result.distribution.find((row) => row.date === "2026-03-29"),
		).toMatchObject({ hours: 22, expectedHours: 0, isOvertime: true });
	});
	it("uses confirmed weekly terms, half-day release and assigned holidays without new per-day I/O", async () => {
		const person = await personWithTerms();
		await fixture.pool.query(
			`insert into employee_employment_history (employee_id,organization_id,employment_period_id,valid_from,weekly_contract_minutes,review_state,created_by,updated_at) values ($1,$2,$3,'2026-03-16T00:00:00Z',1200,'confirmed',$4,now()),($1,$2,$3,'2026-03-01T00:00:00Z',600,'draft',$4,now())`,
			[
				person.employeeId,
				fixture.organizationId,
				person.employmentPeriodId,
				fixture.ownerUserId,
			],
		);
		const absence = randomUUID(),
			category = randomUUID(),
			holiday = randomUUID();
		await fixture.pool.query(
			`insert into absence_category (id,organization_id,type,name,updated_at) values ($1,$2,'sick','Sick',now())`,
			[absence, fixture.organizationId],
		);
		await fixture.pool.query(
			`insert into absence_entry (employee_id,organization_id,category_id,start_date,end_date,start_period,end_period,status,updated_at) values ($1,$2,$3,'2026-03-02','2026-03-02','pm','pm','approved',now())`,
			[person.employeeId, fixture.organizationId, absence],
		);
		await fixture.pool.query(
			`insert into holiday_category (id,organization_id,type,name,updated_at) values ($1,$2,'company_holiday','Fixture holiday',now())`,
			[category, fixture.organizationId],
		);
		await fixture.pool.query(
			`insert into holiday (id,organization_id,category_id,name,start_date,end_date,created_by,updated_at) values ($1,$2,$3,'March holiday','2026-03-03T00:00:00Z','2026-03-03T23:59:59.999Z',$4,now())`,
			[holiday, fixture.organizationId, category, fixture.ownerUserId],
		);
		await fixture.pool.query(
			`insert into holiday_assignment (holiday_id,organization_id,assignment_type,employee_id,created_by,updated_at) values ($1,$2,'employee',$3,$4,now())`,
			[holiday, fixture.organizationId, person.employeeId, fixture.ownerUserId],
		);
		const { result, evidence } = await read(undefined, person.employeeId);
		expect(result.summary.undertimeHours).toBe(116);
		expect(evidence.queries).toBeLessThanOrEqual(26);
	});
	it("keeps hourly requirements on published organization-calendar shifts only", async () => {
		const person = await personWithTerms("UTC", "hourly");
		const location = randomUUID(),
			subarea = randomUUID();
		await fixture.pool.query(
			`insert into location (id,organization_id,name,created_by,updated_at) values ($1,$2,'Fixture site',$3,now())`,
			[location, fixture.organizationId, fixture.ownerUserId],
		);
		await fixture.pool.query(
			`insert into location_subarea (id,location_id,name,created_by,updated_at) values ($1,$2,'Floor',$3,now())`,
			[subarea, location, fixture.ownerUserId],
		);
		await fixture.pool.query(
			`insert into shift (organization_id,employee_id,subarea_id,date,start_time,end_time,status,created_by,updated_at) values ($1,$2,$3,'2026-03-02T00:00:00Z','09:00','17:00','published',$4,now()),($1,$2,$3,'2026-03-03T00:00:00Z','09:00','17:00','draft',$4,now()),($1,$2,$3,'2026-04-01T00:00:00Z','09:00','17:00','published',$4,now())`,
			[fixture.organizationId, person.employeeId, subarea, fixture.ownerUserId],
		);
		await work(
			person.employeeId,
			"2026-03-02T09:00:00Z",
			"2026-03-02T17:00:00Z",
			480,
		);
		expect(
			(await read(undefined, person.employeeId)).result.summary,
		).toMatchObject({ totalHours: 8, overtimeHours: 0, undertimeHours: 0 });
	});
	it("uses the caller's transaction for changed tracking, confirmed terms and absence evidence", async () => {
		await expect(
			db.transaction(async (tx) => {
				await tx.execute(
					sql`insert into employee_tracking_settings (organization_id,employee_id,tracking_start_date) values (${fixture.organizationId},${people[0]},'2026-03-16')`,
				);
				await tx.execute(
					sql`update employee_employment_history set weekly_contract_minutes=1200 where organization_id=${fixture.organizationId} and employee_id=${people[0]} and review_state='confirmed'`,
				);
				const category = randomUUID();
				await tx.execute(
					sql`insert into absence_category (id,organization_id,type,name,updated_at) values (${category},${fixture.organizationId},'sick','Preview',now())`,
				);
				await tx.execute(
					sql`insert into absence_entry (employee_id,organization_id,category_id,start_date,end_date,status,updated_at) values (${people[0]},${fixture.organizationId},${category},'2026-03-16','2026-03-16','approved',now())`,
				);
				expect(
					(await read(undefined, people[0], { role: "admin" }, tx)).result
						.summary,
				).toMatchObject({ totalHours: 8, undertimeHours: 44 });
				throw new Error("rollback fixture preview");
			}),
		).rejects.toThrow("rollback fixture preview");
		expect(
			(await read(undefined, people[0])).result.summary.undertimeHours,
		).toBe(168);
	});
	it("bounds employee inputs and serial I/O as a larger roster crosses a range batch", async () => {
		for (let index = 0; index < 64; index++) await fixture.seedEmployee();
		const { result, evidence } = await read();
		expect(result.byEmployee.length).toBeGreaterThan(64);
		expect(evidence.tracking).toBe(2);
		expect(evidence.roster).toBe(1);
		expect(evidence.queries).toBeLessThanOrEqual(30);
		const ids = new Set(result.byEmployee.map((row) => row.employeeId));
		const periodInputs = statements
			.filter((query) => query.text.includes('from "work_period"'))
			.map(
				(query) =>
					new Set(
						query.params
							.flat()
							.filter((value) => typeof value === "string" && ids.has(value)),
					).size,
			);
		// Public batch contract: one SQL operation admits at most64 scoped employees.
		expect(Math.max(...periodInputs)).toBeLessThanOrEqual(64);
	});
	it("leaves at most one queued read while a one-connection pool serves an interactive probe", async () => {
		const { openIntegrationPool } = await import("@/test/integration-database");
		const { drizzle } = await import("drizzle-orm/node-postgres");
		const authSchema = await import("@/db/auth-schema");
		const schema = await import("@/db/schema");
		const pool = openIntegrationPool({ max: 1 });
		const client = drizzle({
			client: pool,
			schema: { ...authSchema, ...schema },
			logger: {
				logQuery: (text, params) => {
					queries.push(text);
					statements.push({ text, params });
				},
			},
		});
		let peakQueued = 0;
		const timer = setInterval(() => {
			peakQueued = Math.max(peakQueued, pool.waitingCount);
		}, 1);
		try {
			const [response, probe] = await Promise.all([
				read(undefined, undefined, { role: "admin" }, client),
				pool.query("select 1 as ready"),
			]);
			expect(response.result.summary.totalHours).toBeGreaterThan(32);
			expect(probe.rows).toEqual([{ ready: 1 }]);
			expect(pool.totalCount).toBe(1);
			expect(peakQueued).toBeLessThanOrEqual(1);
			if (process.env.Z8_WORK_HOURS_QUERY_EVIDENCE === "1")
				console.info(
					"work-hours one-connection fixture evidence",
					JSON.stringify({
						employees: response.result.byEmployee.length,
						elapsedMs: response.evidence.elapsedMs,
						queries: response.evidence.queries,
						peakQueued,
						connections: pool.totalCount,
					}),
				);
		} finally {
			clearInterval(timer);
			await pool.end();
		}
	});
	it("does not retrieve unrelated-organization employees or their overlapping work", async () => {
		const organizationId = await fixture.createOrganization();
		const outsider = await fixture.seedEmployee({ organizationId });
		await work(
			outsider.employeeId,
			"2026-03-02T09:00:00Z",
			"2026-03-02T17:00:00Z",
			480,
			0,
			0,
			organizationId,
		);
		const { result } = await read();
		expect(
			result.byEmployee.some((row) => row.employeeId === outsider.employeeId),
		).toBe(false);
		for (const statement of statements.filter((query) =>
			query.text.includes('from "work_period"'),
		)) {
			const retrieved = await fixture.pool.query(
				statement.text,
				statement.params,
			);
			expect(
				retrieved.rows.some((row) => row.employee_id === outsider.employeeId),
			).toBe(false);
		}
	});
	it("uses half-open instant boundaries for both range queries", async () => {
		const person = await personWithTerms();
		await work(
			person.employeeId,
			"2026-02-28T23:00:00Z",
			"2026-03-01T00:00:00Z",
			60,
		);
		await work(
			person.employeeId,
			"2026-03-31T23:00:00Z",
			"2026-04-01T00:00:00Z",
			60,
		);
		await work(
			person.employeeId,
			"2026-04-01T00:00:00Z",
			"2026-04-01T01:00:00Z",
			60,
		);
		const { result } = await read(undefined, person.employeeId);
		expect(result.summary).toMatchObject({
			totalHours: 1,
			undertimeHours: 175,
		});
		expect(result.distribution).toEqual([
			{
				date: "2026-03-31",
				hours: 1,
				expectedHours: 8,
				isOvertime: false,
				isUndertime: true,
			},
		]);
	});
});
