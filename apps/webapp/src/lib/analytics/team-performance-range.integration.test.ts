import { randomUUID } from "node:crypto";
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
								id: "team-performance-fixture",
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
const { getTeamPerformanceData } = await import(
	"@/app/[locale]/(app)/analytics/actions"
);
const range = {
	start: new Date("2026-03-02T00:00:00Z"),
	end: new Date("2026-03-08T23:59:59.999Z"),
	startDate: "2026-03-02",
	endDate: "2026-03-08",
	timezone: "UTC",
};

describe("team-performance range evidence on PostgreSQL", () => {
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
			`insert into work_policy (id,organization_id,name,regulation_enabled,schedule_enabled,created_by,updated_at) values ($1,$2,'Team weekdays',false,true,$3,now())`,
			[policyId, fixture.organizationId, fixture.ownerUserId],
		);
		await fixture.pool.query(
			`insert into work_policy_schedule (policy_id,schedule_type,hours_per_cycle,updated_at) values ($1,'simple',40,now())`,
			[policyId],
		);
		const schedule = await fixture.pool.query(
			`select id from work_policy_schedule where policy_id=$1`,
			[policyId],
		);
		for (const day of [
			"monday",
			"tuesday",
			"wednesday",
			"thursday",
			"friday",
		]) {
			await fixture.pool.query(
				`insert into work_policy_schedule_day (schedule_id,day_of_week,hours_per_day,is_work_day) values ($1,$2,8,true)`,
				[schedule.rows[0].id, day],
			);
		}
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
			for (const day of ["02", "03", "04", "05", "06"]) {
				await addWork(
					person.employeeId,
					`2026-03-${day}T08:00:00Z`,
					`2026-03-${day}T17:00:00Z`,
					540,
				);
			}
		}
	});
	afterAll(async () => fixture?.close());

	async function addWork(
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
			await client.query(
				`insert into time_entry (id,employee_id,organization_id,type,timestamp,utc_offset_minutes,timezone,timezone_source,hash,created_by) values ($1,$3,$4,'clock_in',$6,$8,$10,'user_setting',$1::uuid::text,$5),($2,$3,$4,'clock_out',$7,$9,$11,'user_setting',$2::uuid::text,$5)`,
				[
					incoming,
					outgoing,
					employeeId,
					organizationId,
					fixture.ownerUserId,
					start,
					end,
					startOffset,
					endOffset,
					startOffset > 0
						? "Europe/Berlin"
						: startOffset < 0
							? "America/New_York"
							: "UTC",
					endOffset > 0
						? "Europe/Berlin"
						: endOffset < 0
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
	async function read(
		dates = range,
		teamId?: string,
		scope:
			| { role: "admin" }
			| { role: "manager"; managerEmployeeId: string } = { role: "admin" },
		client: Parameters<typeof makeDatabaseService>[0] = db,
	) {
		queries.length = 0;
		statements.length = 0;
		const start = performance.now();
		const result = await Effect.runPromise(
			Effect.gen(function* () {
				const analytics = yield* AnalyticsService;
				return yield* analytics.getTeamPerformance({
					organizationId: fixture.organizationId,
					dateRange: dates,
					teamId,
					scope,
				});
			}).pipe(
				Effect.provide(AnalyticsService.Live),
				Effect.provide(WorkPolicyServiceLive),
				Effect.provide(
					Layer.succeed(DatabaseService, makeDatabaseService(client)),
				),
			),
		);
		return {
			result,
			evidence: {
				queries: queries.length,
				tracking: queries.filter((text) =>
					text.includes('left join "organization_tracking_settings"'),
				).length,
				periods: queries.filter((text) => text.includes('from "work_period"'))
					.length,
				elapsedMs: performance.now() - start,
			},
		};
	}
	async function personWithTerms(timezone = "UTC", weeklyMinutes = 0) {
		const person = await fixture.seedEmployee();
		const teamId = randomUUID();
		await fixture.pool.query(
			`insert into team (id,organization_id,name,updated_at) values ($1,$2,'Isolated team',now())`,
			[teamId, fixture.organizationId],
		);
		await fixture.pool.query(`update employee set team_id=$2 where id=$1`, [
			person.employeeId,
			teamId,
		]);
		await fixture.pool.query(
			`insert into user_settings (user_id,timezone,updated_at) values ($1,$2,now())`,
			[person.userId, timezone],
		);
		await fixture.pool.query(
			`insert into employee_employment_history (employee_id,organization_id,employment_period_id,valid_from,weekly_contract_minutes,review_state,created_by,updated_at) values ($1,$2,$3,'2026-01-01T00:00:00Z',$5,'confirmed',$4,now())`,
			[
				person.employeeId,
				fixture.organizationId,
				person.employmentPeriodId,
				fixture.ownerUserId,
				weeklyMinutes,
			],
		);
		return { ...person, teamId };
	}
	it("bounds employee evidence reads independently of month, quarter and year range length", async () => {
		const results = [];
		for (const dates of [
			{
				...range,
				start: new Date("2026-03-01T00:00:00Z"),
				end: new Date("2026-03-31T23:59:59.999Z"),
				startDate: "2026-03-01",
				endDate: "2026-03-31",
			},
			{
				...range,
				start: new Date("2026-01-01T00:00:00Z"),
				end: new Date("2026-03-31T23:59:59.999Z"),
				startDate: "2026-01-01",
				endDate: "2026-03-31",
			},
			{
				...range,
				start: new Date("2026-01-01T00:00:00Z"),
				end: new Date("2026-12-31T23:59:59.999Z"),
				startDate: "2026-01-01",
				endDate: "2026-12-31",
			},
		]) {
			const response = await read(dates);
			results.push(response.evidence);
			if (process.env.Z8_TEAM_QUERY_EVIDENCE === "1") {
				const samples = [];
				for (let index = 0; index < 20; index++)
					samples.push((await read(dates)).evidence.elapsedMs);
				samples.sort((a, b) => a - b);
				console.info(
					"team warm reader evidence",
					JSON.stringify({
						start: dates.startDate,
						end: dates.endDate,
						employees: 6,
						samples: 20,
						p50: (samples[9] + samples[10]) / 2,
						p95: samples[18],
						queries: response.evidence.queries,
					}),
				);
			}
			expect(response.result.organizationTotal).toBe(180);
		}
		console.info("team range evidence", JSON.stringify(results));
		expect(results.map((row) => row.tracking)).toEqual([1, 1, 1]);
		expect(results.map((row) => row.periods)).toEqual([2, 2, 2]);
		expect(results.every((row) => row.queries <= 20)).toBe(true);
	});
	it("restricts team and manager visibility before retrieving personal range data", async () => {
		const teamId = randomUUID();
		await fixture.pool.query(
			`insert into team (id,organization_id,name,updated_at) values ($1,$2,'Visible team',now())`,
			[teamId, fixture.organizationId],
		);
		await fixture.pool.query(
			`update employee set team_id=$2 where id in ($1,$3)`,
			[people[0], teamId, people[1]],
		);
		await fixture.pool.query(
			`insert into employee_managers (employee_id,manager_id,assigned_by) values ($1,$2,$3)`,
			[people[0], fixture.employeeId, fixture.ownerUserId],
		);
		const response = await read(range, teamId, {
			role: "manager",
			managerEmployeeId: fixture.employeeId,
		});
		expect(response.result.teams).toHaveLength(1);
		expect(response.result.teams[0]).toMatchObject({
			teamId,
			teamName: "Visible team",
			employeeCount: 1,
			totalHours: 45,
			avgHoursPerEmployee: 45,
		});
		expect(response.result.teams[0].employees).toEqual([
			{
				employeeId: people[0],
				employeeName: "Lifecycle",
				totalHours: 45,
				expectedHours: 40,
				variance: 5,
				percentageOfExpected: 112.5,
			},
		]);
		const captured = [...statements];
		const roster = captured.find((row) =>
			row.text.includes('"employee"."is_active"'),
		);
		expect(roster?.text).toContain("employee_managers");
		if (!roster) throw new Error("Expected the authorized roster query");
		const retrieved = await fixture.pool.query(roster.text, roster.params);
		expect(retrieved.rows).toHaveLength(1);
		for (const statement of captured.filter((row) =>
			row.text.includes('from "work_period"'),
		)) {
			expect(statement.params).toContain(fixture.organizationId);
			const rows = await fixture.pool.query(statement.text, statement.params);
			expect(rows.rows.every((row) => row.employee_id === people[0])).toBe(
				true,
			);
		}
		expect(
			(
				await read(range, randomUUID(), {
					role: "manager",
					managerEmployeeId: fixture.employeeId,
				})
			).result,
		).toMatchObject({ teams: [], organizationTotal: 0 });
	});
	it("retains raw chart hours and whole-window protected stored minutes across midnight and travel", async () => {
		const person = await personWithTerms();
		await addWork(
			person.employeeId,
			"2026-03-02T22:00:00Z",
			"2026-03-03T02:00:00Z",
			180,
			60,
			-300,
		);
		const response = await read(range, person.teamId);
		expect(response.result.teams[0].employees).toEqual([
			{
				employeeId: person.employeeId,
				employeeName: "Lifecycle",
				totalHours: 4,
				expectedHours: 0,
				variance: 3,
				percentageOfExpected: 0,
			},
		]);
		await addWork(
			person.employeeId,
			"2026-03-04T00:00:00Z",
			"2026-03-04T00:02:30Z",
			3,
		);
		expect(
			(await read(range, person.teamId)).result.teams[0].employees[0],
		).toMatchObject({ totalHours: 4.03, variance: 3.05 });
	});
	it("uses employee local DST boundaries rather than the viewing timezone or captured travel offsets", async () => {
		const person = await personWithTerms("Europe/Berlin");
		await addWork(
			person.employeeId,
			"2026-03-28T23:00:00Z",
			"2026-03-29T22:00:00Z",
			1380,
			60,
			-240,
		);
		const dates = {
			start: new Date("2026-03-28T23:00:00Z"),
			end: new Date("2026-03-29T21:59:59.999Z"),
			startDate: "2026-03-29",
			endDate: "2026-03-29",
			timezone: "Europe/Berlin",
		};
		expect(
			(await read(dates, person.teamId)).result.teams[0].employees[0],
		).toMatchObject({ totalHours: 23, expectedHours: 0, variance: 23 });
	});
	it("retains confirmed term changes, assigned holiday and half absence requirements without per-person IO", async () => {
		const person = await personWithTerms("UTC", 2400);
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
			`insert into holiday_category (id,organization_id,type,name,updated_at) values ($1,$2,'company_holiday','Assigned',now())`,
			[category, fixture.organizationId],
		);
		await fixture.pool.query(
			`insert into holiday (id,organization_id,category_id,name,start_date,end_date,created_by,updated_at) values ($1,$2,$3,'Holiday','2026-03-03T00:00:00Z','2026-03-03T23:59:59.999Z',$4,now())`,
			[holiday, fixture.organizationId, category, fixture.ownerUserId],
		);
		await fixture.pool.query(
			`insert into holiday_assignment (holiday_id,organization_id,assignment_type,employee_id,created_by,updated_at) values ($1,$2,'employee',$3,$4,now())`,
			[holiday, fixture.organizationId, person.employeeId, fixture.ownerUserId],
		);
		await addWork(
			person.employeeId,
			"2026-03-02T00:00:00Z",
			"2026-03-04T00:00:00Z",
			2880,
		);
		expect(
			(await read(range, person.teamId)).result.teams[0].employees[0],
		).toMatchObject({
			totalHours: 48,
			expectedHours: 28,
			variance: 20,
			percentageOfExpected: 171.43,
		});
		await fixture.pool.query(
			`insert into employee_employment_history (employee_id,organization_id,employment_period_id,valid_from,weekly_contract_minutes,review_state,created_by,updated_at) values ($1,$2,$3,'2026-03-04T00:00:00Z',1200,'confirmed',$4,now()),($1,$2,$3,'2026-03-01T00:00:00Z',600,'draft',$4,now())`,
			[
				person.employeeId,
				fixture.organizationId,
				person.employmentPeriodId,
				fixture.ownerUserId,
			],
		);
		expect(
			(await read(range, person.teamId)).result.teams[0].employees[0],
		).toMatchObject({
			expectedHours: 16,
			variance: 32,
			percentageOfExpected: 300,
		});
	});
	it("freshly authorizes the actual action after assignment removal and role reduction", async () => {
		const manager = await fixture.seedEmployee();
		await fixture.pool.query(`update employee set role='manager' where id=$1`, [
			manager.employeeId,
		]);
		await fixture.pool.query(
			`insert into employee_managers (employee_id,manager_id,assigned_by) values ($1,$2,$3)`,
			[people[0], manager.employeeId, fixture.ownerUserId],
		);
		caller.userId = manager.userId;
		caller.organizationId = fixture.organizationId;
		expect(await getTeamPerformanceData(range)).toMatchObject({
			success: true,
			data: { organizationTotal: 45, teams: [{ employeeCount: 1 }] },
		});
		await fixture.pool.query(
			`delete from employee_managers where manager_id=$1`,
			[manager.employeeId],
		);
		expect(await getTeamPerformanceData(range)).toMatchObject({
			success: true,
			data: { organizationTotal: 0, teams: [] },
		});
		await fixture.pool.query(
			`update employee set role='employee' where id=$1`,
			[manager.employeeId],
		);
		queries.length = 0;
		expect(await getTeamPerformanceData(range)).toMatchObject({
			success: false,
			code: "AuthorizationError",
		});
		expect(queries.some((text) => text.includes('from "work_period"'))).toBe(
			false,
		);
		caller.userId = null;
		expect(await getTeamPerformanceData(range)).toMatchObject({
			success: false,
		});
	});
	it("keeps protected tracking and employment boundaries while charts retain raw history", async () => {
		const person = await personWithTerms("UTC", 2400);
		await fixture.pool.query(
			`insert into employee_tracking_settings (organization_id,employee_id,tracking_start_date) values ($1,$2,'2026-03-04')`,
			[fixture.organizationId, person.employeeId],
		);
		await fixture.pool.query(
			`update employee set start_date='2026-03-05T00:00:00Z' where id=$1`,
			[person.employeeId],
		);
		await addWork(
			person.employeeId,
			"2026-03-04T00:00:00Z",
			"2026-03-07T00:00:00Z",
			4320,
		);
		expect(
			(await read(range, person.teamId)).result.teams[0].employees[0],
		).toMatchObject({
			totalHours: 72,
			expectedHours: 16,
			variance: 32,
			percentageOfExpected: 300,
		});
		const ambiguous = await personWithTerms();
		await fixture.pool.query(
			`insert into employee_tracking_settings (organization_id,employee_id,tracking_start_date) values ($1,$2,'2026-03-04')`,
			[fixture.organizationId, ambiguous.employeeId],
		);
		await addWork(
			ambiguous.employeeId,
			"2026-03-03T22:00:00Z",
			"2026-03-04T02:00:00Z",
			180,
		);
		await expect(read(range, ambiguous.teamId)).rejects.toThrow(
			"interval reconciliation",
		);
		await fixture.pool.query(
			"update employee set is_active=false where id=$1",
			[ambiguous.employeeId],
		);
	});
	it("excludes deleted and live periods from chart and variance totals, with exact half-open edges", async () => {
		const person = await personWithTerms();
		for (const [start, end] of [
			["2026-03-01T23:00:00Z", "2026-03-02T00:00:00Z"],
			["2026-03-08T23:00:00Z", "2026-03-09T00:00:00Z"],
			["2026-03-09T00:00:00Z", "2026-03-09T01:00:00Z"],
			["2026-03-04T09:00:00Z", "2026-03-04T10:00:00Z"],
			["2026-03-05T09:00:00Z", "2026-03-05T10:00:00Z"],
		])
			await addWork(person.employeeId, start, end, 60);
		await withCanonicalRecords(fixture.pool, async (client) => {
			await client.query(
				`update work_period set deleted_at=now() where employee_id=$1 and start_time='2026-03-04T09:00:00Z'`,
				[person.employeeId],
			);
			await client.query(
				`update work_period set is_active=true where employee_id=$1 and start_time='2026-03-05T09:00:00Z'`,
				[person.employeeId],
			);
		});
		expect(
			(await read(range, person.teamId)).result.teams[0].employees[0],
		).toMatchObject({ totalHours: 1, expectedHours: 0, variance: 1 });
	});
	it("keeps legacy raw elapsed work and current team-policy expectations with global holiday exclusions", async () => {
		const person = await personWithTerms("UTC", 0);
		const legacyRange = {
			...range,
			start: new Date("2026-03-09T00:00:00Z"),
			end: new Date("2026-03-15T23:59:59.999Z"),
			startDate: "2026-03-09",
			endDate: "2026-03-15",
		};
		await fixture.pool.query(
			`update organization_tracking_settings set activated_at=null where organization_id=$1`,
			[fixture.organizationId],
		);
		try {
			await addWork(
				person.employeeId,
				"2026-03-09T09:00:00Z",
				"2026-03-09T10:00:00Z",
				30,
			);
			expect(
				(await read(legacyRange, person.teamId)).result.teams[0].employees[0],
			).toMatchObject({ totalHours: 1, expectedHours: 40, variance: -39 });
			const policy = randomUUID();
			await fixture.pool.query(
				`insert into work_policy (id,organization_id,name,regulation_enabled,schedule_enabled,created_by,updated_at) values ($1,$2,'Two days',false,true,$3,now())`,
				[policy, fixture.organizationId, fixture.ownerUserId],
			);
			const schedule = await fixture.pool.query(
				`insert into work_policy_schedule (policy_id,schedule_type,hours_per_cycle,updated_at) values ($1,'simple',12,now()) returning id`,
				[policy],
			);
			for (const day of ["tuesday", "thursday"])
				await fixture.pool.query(
					`insert into work_policy_schedule_day (schedule_id,day_of_week,hours_per_day,is_work_day) values ($1,$2,6,true)`,
					[schedule.rows[0].id, day],
				);
			await fixture.pool.query(
				`insert into work_policy_assignment (policy_id,organization_id,assignment_type,team_id,created_by,updated_at) values ($1,$2,'team',$3,$4,now())`,
				[policy, fixture.organizationId, person.teamId, fixture.ownerUserId],
			);
			expect(
				(await read(legacyRange, person.teamId)).result.teams[0].employees[0],
			).toMatchObject({ totalHours: 1, expectedHours: 12, variance: -11 });
			const category = randomUUID();
			await fixture.pool.query(
				`insert into holiday_category (id,organization_id,type,name,exclude_from_calculations,updated_at) values ($1,$2,'company_holiday','Global only',true,now())`,
				[category, fixture.organizationId],
			);
			await fixture.pool.query(
				`insert into holiday (organization_id,category_id,name,start_date,end_date,created_by,updated_at) values ($1,$2,'Unassigned global','2026-03-10T00:00:00Z','2026-03-10T23:59:59.999Z',$3,now())`,
				[fixture.organizationId, category, fixture.ownerUserId],
			);
			expect(
				(await read(legacyRange, person.teamId)).result.teams[0].employees[0],
			).toMatchObject({
				totalHours: 1,
				expectedHours: 6,
				variance: -5,
				percentageOfExpected: 16.67,
			});
		} finally {
			await fixture.pool.query(
				`update organization_tracking_settings set activated_at=now() where organization_id=$1`,
				[fixture.organizationId],
			);
		}
	});
	it("preserves unassigned-team labels and refreshes names and current roster membership", async () => {
		const person = await personWithTerms();
		await fixture.pool.query(`update employee set team_id=null where id=$1`, [
			person.employeeId,
		]);
		await fixture.pool.query(`update "user" set name='' where id=$1`, [
			person.userId,
		]);
		let response = await read(range);
		const noTeam = response.result.teams.find((row) => row.teamId === "");
		expect(noTeam?.teamName).toBe("No Team");
		expect(
			noTeam?.employees.find((row) => row.employeeId === person.employeeId)
				?.employeeName,
		).toBe("Unknown");
		await fixture.pool.query(
			`update "user" set name='Renamed colleague' where id=$1`,
			[person.userId],
		);
		response = await read(range);
		expect(
			response.result.teams
				.flatMap((row) => row.employees)
				.find((row) => row.employeeId === person.employeeId)?.employeeName,
		).toBe("Renamed colleague");
		await fixture.pool.query(
			`update employee set is_active=false where id=$1`,
			[person.employeeId],
		);
		expect(
			(await read(range)).result.teams
				.flatMap((row) => row.employees)
				.some((row) => row.employeeId === person.employeeId),
		).toBe(false);
	});
	it("reads transaction-local tracking and confirmed terms through the bound database", async () => {
		const person = await personWithTerms("UTC", 2400);
		await addWork(
			person.employeeId,
			"2026-03-02T09:00:00Z",
			"2026-03-02T17:00:00Z",
			480,
		);
		expect(
			(await read(range, person.teamId)).result.teams[0].employees[0],
		).toMatchObject({ expectedHours: 40, variance: -32 });
		await expect(
			db.transaction(async (tx) => {
				const { sql } = await import("drizzle-orm");
				await tx.execute(
					sql`insert into employee_tracking_settings (organization_id,employee_id,tracking_start_date) values (${fixture.organizationId},${person.employeeId},'2026-03-04')`,
				);
				await tx.execute(
					sql`update employee_employment_history set weekly_contract_minutes=1200 where employee_id=${person.employeeId} and review_state='confirmed'`,
				);
				expect(
					(await read(range, person.teamId, { role: "admin" }, tx)).result
						.teams[0].employees[0],
				).toMatchObject({ totalHours: 8, expectedHours: 12, variance: -12 });
				throw new Error("rollback team fixture");
			}),
		).rejects.toThrow("rollback team fixture");
		expect(
			(await read(range, person.teamId)).result.teams[0].employees[0],
		).toMatchObject({ expectedHours: 40, variance: -32 });
	});
	it("does not retrieve unrelated organizations even when their synthetic work dominates the requested range", async () => {
		const person = await personWithTerms();
		const otherOrganization = await fixture.createOrganization();
		const outsider = await fixture.seedEmployee({
			organizationId: otherOrganization,
		});
		await addWork(
			person.employeeId,
			"2026-03-02T08:00:00Z",
			"2026-03-02T09:00:00Z",
			60,
		);
		await addWork(
			outsider.employeeId,
			"2026-03-02T08:00:00Z",
			"2026-03-02T18:00:00Z",
			600,
			0,
			0,
			otherOrganization,
		);
		expect((await read(range, person.teamId)).result.organizationTotal).toBe(1);
		const captured = [...statements];
		for (const statement of captured.filter((row) =>
			row.text.includes('from "work_period"'),
		)) {
			expect(statement.params).toContain(fixture.organizationId);
			const rows = await fixture.pool.query(statement.text, statement.params);
			expect(
				rows.rows.every((row) => row.employee_id === person.employeeId),
			).toBe(true);
		}
	});
	it("uses serial batches of at most64 employees and shares a one-connection pool with an interactive read", async () => {
		const teamId = randomUUID();
		await fixture.pool.query(
			`insert into team (id,organization_id,name,updated_at) values ($1,$2,'Large team',now())`,
			[teamId, fixture.organizationId],
		);
		const ids = new Set<string>();
		for (let index = 0; index < 65; index++) {
			const person = await fixture.seedEmployee();
			ids.add(person.employeeId);
			await fixture.pool.query(`update employee set team_id=$2 where id=$1`, [
				person.employeeId,
				teamId,
			]);
		}
		const week = await read(range, teamId);
		const annual = await read(
			{
				...range,
				start: new Date("2026-01-01T00:00:00Z"),
				end: new Date("2026-12-31T23:59:59.999Z"),
				startDate: "2026-01-01",
				endDate: "2026-12-31",
			},
			teamId,
		);
		expect(annual.result.teams[0]).toMatchObject({
			employeeCount: 65,
			totalHours: 0,
			avgHoursPerEmployee: 0,
		});
		expect(week.evidence.tracking).toBe(2);
		expect(annual.evidence.tracking).toBe(2);
		expect(annual.evidence.periods).toBe(4);
		expect(annual.evidence.queries).toBe(week.evidence.queries);
		for (const statement of statements.filter((row) =>
			row.text.includes('from "work_period"'),
		)) {
			const admitted = new Set(
				statement.params
					.flat()
					.filter((value) => typeof value === "string" && ids.has(value)),
			);
			expect(admitted.size).toBeGreaterThan(0);
			expect(admitted.size).toBeLessThanOrEqual(64);
		}
		const { openIntegrationPool } = await import("@/test/integration-database");
		const { drizzle } = await import("drizzle-orm/node-postgres");
		const authSchema = await import("@/db/auth-schema"),
			schema = await import("@/db/schema");
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
				read(range, teamId, { role: "admin" }, client),
				pool.query("select 1 as ready"),
			]);
			expect(response.result.teams[0].employeeCount).toBe(65);
			expect(probe.rows).toEqual([{ ready: 1 }]);
			expect(pool.totalCount).toBe(1);
			expect(peakQueued).toBeLessThanOrEqual(1);
			console.info(
				"team large batch probe",
				JSON.stringify({
					...annual.evidence,
					peakQueued,
					concurrentReadMs: response.evidence.elapsedMs,
				}),
			);
		} finally {
			clearInterval(timer);
			await pool.end();
		}
	});
	it("counts the 25-hour DST fold from UTC work instants in the employee calendar", async () => {
		const person = await personWithTerms("America/New_York");
		await addWork(
			person.employeeId,
			"2026-11-01T04:00:00Z",
			"2026-11-02T05:00:00Z",
			1500,
			-240,
			-300,
		);
		const dates = {
			start: new Date("2026-11-01T04:00:00Z"),
			end: new Date("2026-11-02T04:59:59.999Z"),
			startDate: "2026-11-01",
			endDate: "2026-11-01",
			timezone: "America/New_York",
		};
		expect(
			(await read(dates, person.teamId)).result.teams[0].employees[0],
		).toMatchObject({ totalHours: 25, expectedHours: 0, variance: 25 });
	});
	it("keeps hourly team requirements on published organization-calendar shifts", async () => {
		const person = await personWithTerms();
		await fixture.pool.query(
			`update employee set contract_type='hourly' where id=$1`,
			[person.employeeId],
		);
		await fixture.pool.query(
			`update employee_employment_history set contract_type='hourly' where employee_id=$1 and review_state='confirmed'`,
			[person.employeeId],
		);
		const location = randomUUID(),
			subarea = randomUUID();
		await fixture.pool.query(
			`insert into location (id,organization_id,name,created_by,updated_at) values ($1,$2,'Hourly site',$3,now())`,
			[location, fixture.organizationId, fixture.ownerUserId],
		);
		await fixture.pool.query(
			`insert into location_subarea (id,location_id,name,created_by,updated_at) values ($1,$2,'Floor',$3,now())`,
			[subarea, location, fixture.ownerUserId],
		);
		await fixture.pool.query(
			`insert into shift (organization_id,employee_id,subarea_id,date,start_time,end_time,status,created_by,updated_at) values ($1,$2,$3,'2026-03-02T00:00:00Z','09:00','17:00','published',$4,now()),($1,$2,$3,'2026-03-03T00:00:00Z','09:00','17:00','draft',$4,now()),($1,$2,$3,'2026-03-09T00:00:00Z','09:00','17:00','published',$4,now())`,
			[fixture.organizationId, person.employeeId, subarea, fixture.ownerUserId],
		);
		await addWork(
			person.employeeId,
			"2026-03-02T09:00:00Z",
			"2026-03-02T17:00:00Z",
			480,
		);
		expect(
			(await read(range, person.teamId)).result.teams[0].employees[0],
		).toMatchObject({
			totalHours: 8,
			expectedHours: 8,
			variance: 0,
			percentageOfExpected: 100,
		});
	});
});
