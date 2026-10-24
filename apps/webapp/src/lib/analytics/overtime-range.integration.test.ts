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
								id: "overtime-fixture",
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
const { getOvertimeBurnDownData } = await import(
	"@/app/[locale]/(app)/analytics/actions"
);
const range = {
	start: new Date("2026-03-02T00:00:00Z"),
	end: new Date("2026-03-08T23:59:59.999Z"),
	startDate: "2026-03-02",
	endDate: "2026-03-08",
	timezone: "UTC",
};

describe("overtime range evidence on PostgreSQL", () => {
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
			`insert into work_policy (id,organization_id,name,regulation_enabled,schedule_enabled,created_by,updated_at) values ($1,$2,'Overtime weekdays',false,true,$3,now())`,
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
		endDate = "2026-03-08",
		filters?: { teamId?: string; managerId?: string; costCenterId?: string },
		dates = range,
		client: typeof db = db,
	) {
		queries.length = 0;
		statements.length = 0;
		const start = performance.now();
		const result = await Effect.runPromise(
			Effect.gen(function* () {
				const analytics = yield* AnalyticsService;
				return yield* analytics.getOvertimeBurnDown({
					organizationId: fixture.organizationId,
					scope: { role: "admin" },
					filters,
					dateRange:
						dates === range
							? { ...range, end: new Date(`${endDate}T23:59:59.999Z`), endDate }
							: dates,
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

	it("keeps employee tracking and work reads independent of weekly output buckets", async () => {
		const week = await read();
		const month = await read("2026-03-29");
		expect(week.result.weeklySeries).toEqual([
			{ weekStart: "2026-03-02", overtimeHours: 20 },
		]);
		expect(month.result.weeklySeries).toEqual([
			{ weekStart: "2026-03-02", overtimeHours: 20 },
			{ weekStart: "2026-03-09", overtimeHours: 0 },
			{ weekStart: "2026-03-16", overtimeHours: 0 },
			{ weekStart: "2026-03-23", overtimeHours: 0 },
		]);
		console.log(
			JSON.stringify({
				fixture: "six employees, one/four weeks",
				week: week.evidence,
				month: month.evidence,
			}),
		);
		if (process.env.Z8_OVERTIME_QUERY_EVIDENCE === "1") {
			for (const end of ["2026-03-08", "2026-03-29"]) {
				const samples = [];
				for (let index = 0; index < 20; index++)
					samples.push((await read(end)).evidence.elapsedMs);
				samples.sort((a, b) => a - b);
				console.info(
					"overtime warm reader evidence",
					JSON.stringify({
						employees: 6,
						endDate: end,
						samples: samples.length,
						p50Ms: samples[9],
						p95Ms: samples[18],
					}),
				);
			}
		}
		// Declared before the change: one tracking batch and at most two work batches,
		// regardless of how many weekly output buckets this fixed roster requests.
		expect(week.evidence.tracking).toBe(1);
		expect(month.evidence.tracking).toBe(1);
		expect(week.evidence.periods).toBeLessThanOrEqual(2);
		expect(month.evidence.periods).toBeLessThanOrEqual(2);
		for (const [endDate, buckets] of [
			["2026-03-31", 14],
			["2026-12-31", 53],
		] as const) {
			const dates = {
				...range,
				start: new Date("2026-01-01T00:00:00Z"),
				startDate: "2026-01-01",
				end: new Date(`${endDate}T23:59:59.999Z`),
				endDate,
			};
			const response = await read(undefined, undefined, dates);
			expect(response.result.weeklySeries).toHaveLength(buckets);
			expect(
				response.result.weeklySeries.reduce(
					(sum, row) => sum + row.overtimeHours,
					0,
				),
			).toBe(20);
			expect(response.evidence.tracking).toBe(1);
			expect(response.evidence.periods).toBe(1);
			expect(response.evidence.queries).toBe(15);
		}
	});
	async function personWithTerms(timezone = "UTC", weeklyMinutes = 0) {
		const person = await fixture.seedEmployee();
		const teamId = randomUUID();
		await fixture.pool.query(
			`insert into team (id,organization_id,name,updated_at) values ($1,$2,'Isolated overtime',now())`,
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
	it("preserves whole-week stored minutes when daily allocation would require reconciliation", async () => {
		const person = await personWithTerms();
		await addWork(
			person.employeeId,
			"2026-03-02T22:00:00Z",
			"2026-03-03T02:00:00Z",
			180,
		);
		expect(
			(await read(undefined, { teamId: person.teamId })).result.weeklySeries,
		).toEqual([{ weekStart: "2026-03-02", overtimeHours: 3 }]);
	});
	it("clips at tracking start and blocks ambiguous work crossing that protected boundary", async () => {
		const person = await personWithTerms();
		await fixture.pool.query(
			`insert into employee_tracking_settings (organization_id,employee_id,tracking_start_date) values ($1,$2,'2026-03-04')`,
			[fixture.organizationId, person.employeeId],
		);
		await addWork(
			person.employeeId,
			"2026-03-03T23:00:00Z",
			"2026-03-04T01:00:00Z",
			120,
		);
		expect(
			(await read(undefined, { teamId: person.teamId })).result.weeklySeries[0]
				.overtimeHours,
		).toBe(1);
		await addWork(
			person.employeeId,
			"2026-03-03T22:00:00Z",
			"2026-03-04T02:00:00Z",
			180,
		);
		await expect(read(undefined, { teamId: person.teamId })).rejects.toThrow(
			"interval reconciliation",
		);
	});

	it("clips employee employment start and keeps protected rounding at a Monday boundary", async () => {
		const person = await personWithTerms("UTC", 2400);
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
			(await read(undefined, { teamId: person.teamId })).result.weeklySeries[0]
				.overtimeHours,
		).toBe(32); //48 protected hours,16 required
		const rounded = await personWithTerms();
		await addWork(
			rounded.employeeId,
			"2026-03-01T23:58:30Z",
			"2026-03-02T00:01:00Z",
			3,
			60,
			-300,
		);
		expect(
			(await read(undefined, { teamId: rounded.teamId })).result.weeklySeries[0]
				.overtimeHours,
		).toBe(0.02);
	});
	it("uses full Monday weeks for partial selections and employee-local DST with captured travel endpoints", async () => {
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
			(await read(undefined, { teamId: person.teamId }, dates)).result
				.weeklySeries,
		).toEqual([{ weekStart: "2026-03-23", overtimeHours: 23 }]);
	});
	it("uses confirmed terms, policy days, assigned holiday and half-day absence once per range", async () => {
		const person = await personWithTerms("UTC", 2400);
		const category = randomUUID(),
			holidayCategory = randomUUID(),
			holiday = randomUUID();
		await fixture.pool.query(
			`insert into absence_category (id,organization_id,type,name,updated_at) values ($1,$2,'sick','Sick',now())`,
			[category, fixture.organizationId],
		);
		await fixture.pool.query(
			`insert into absence_entry (employee_id,organization_id,category_id,start_date,end_date,start_period,end_period,status,updated_at) values ($1,$2,$3,'2026-03-02','2026-03-02','pm','pm','approved',now())`,
			[person.employeeId, fixture.organizationId, category],
		);
		await fixture.pool.query(
			`insert into holiday_category (id,organization_id,type,name,updated_at) values ($1,$2,'company_holiday','Holiday',now())`,
			[holidayCategory, fixture.organizationId],
		);
		await fixture.pool.query(
			`insert into holiday (id,organization_id,category_id,name,start_date,end_date,created_by,updated_at) values ($1,$2,$3,'Holiday','2026-03-03T00:00:00Z','2026-03-03T23:59:59.999Z',$4,now())`,
			[holiday, fixture.organizationId, holidayCategory, fixture.ownerUserId],
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
			(await read(undefined, { teamId: person.teamId })).result.weeklySeries[0]
				.overtimeHours,
		).toBe(20); //48 - (40 -4 -8)
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
			(await read(undefined, { teamId: person.teamId })).result.weeklySeries[0]
				.overtimeHours,
		).toBe(32); //confirmed reduction Wed-Fri12h
	});
	it("refreshes manager scope in the actual authenticated action and denies employee access", async () => {
		const manager = await fixture.seedEmployee();
		await fixture.pool.query(`update employee set role='manager' where id=$1`, [
			manager.employeeId,
		]);
		await fixture.pool.query(
			`insert into employee_managers (employee_id,manager_id,is_primary,assigned_by) values ($1,$2,true,$3)`,
			[people[0], manager.employeeId, fixture.ownerUserId],
		);
		caller.userId = manager.userId;
		caller.organizationId = fixture.organizationId;
		expect(await getOvertimeBurnDownData(range)).toMatchObject({
			success: true,
			data: { weeklySeries: [{ weekStart: "2026-03-02", overtimeHours: 5 }] },
		});
		const roster = statements.findLast(
			(row) =>
				row.text.includes('from "employee"') &&
				row.text.includes('"employee"."is_active"'),
		);
		expect(roster?.text).toContain('"employee_managers"');
		await fixture.pool.query(
			`delete from employee_managers where manager_id=$1`,
			[manager.employeeId],
		);
		expect(await getOvertimeBurnDownData(range)).toMatchObject({
			success: true,
			data: { weeklySeries: [{ weekStart: "2026-03-02", overtimeHours: 0 }] },
		});
		await fixture.pool.query(
			`update employee set role='employee' where id=$1`,
			[manager.employeeId],
		);
		queries.length = 0;
		expect(await getOvertimeBurnDownData(range)).toMatchObject({
			success: false,
			code: "AuthorizationError",
		});
		expect(queries.some((text) => text.includes('from "work_period"'))).toBe(
			false,
		);
		const member = await fixture.pool.query(
			`select user_id from employee where id=$1`,
			[people[0]],
		);
		caller.userId = member.rows[0].user_id;
		queries.length = 0;
		expect(await getOvertimeBurnDownData(range)).toMatchObject({
			success: false,
			code: "AuthorizationError",
		});
		expect(queries.some((text) => text.includes('from "work_period"'))).toBe(
			false,
		);
	});

	it("preserves legacy UTC-start stored duration, global holiday exclusion and policy days while excluding deleted/live work", async () => {
		const person = await personWithTerms("Europe/Berlin", 0);
		await fixture.pool.query(
			`update organization_tracking_settings set activated_at=null where organization_id=$1`,
			[fixture.organizationId],
		);
		try {
			// Full Berlin week starts Sunday23UTC; legacy includes that entire UTC start day.
			await addWork(
				person.employeeId,
				"2026-03-08T12:00:00Z",
				"2026-03-08T13:00:00Z",
				60,
			);
			await addWork(
				person.employeeId,
				"2026-03-09T00:00:00Z",
				"2026-03-11T00:00:00Z",
				2880,
			);
			await addWork(
				person.employeeId,
				"2026-03-12T00:00:00Z",
				"2026-03-13T00:00:00Z",
				1440,
			);
			await addWork(
				person.employeeId,
				"2026-03-13T00:00:00Z",
				"2026-03-14T00:00:00Z",
				1440,
			);
			await withCanonicalRecords(fixture.pool, async (client) => {
				await client.query(
					`update work_period set deleted_at=now() where employee_id=$1 and start_time='2026-03-12T00:00:00Z'`,
					[person.employeeId],
				);
				await client.query(
					`update work_period set is_active=true where employee_id=$1 and start_time='2026-03-13T00:00:00Z'`,
					[person.employeeId],
				);
			});
			const dates = {
				start: new Date("2026-03-08T23:00:00Z"),
				end: new Date("2026-03-15T22:59:59.999Z"),
				startDate: "2026-03-09",
				endDate: "2026-03-15",
				timezone: "Europe/Berlin",
			};
			expect(
				(await read(undefined, { teamId: person.teamId }, dates)).result
					.weeklySeries[0].overtimeHours,
			).toBe(9); //49 stored -40 policy; zero confirmed terms do not replace legacy policy
			const category = randomUUID();
			await fixture.pool.query(
				`insert into holiday_category (id,organization_id,type,name,exclude_from_calculations,updated_at) values ($1,$2,'company_holiday','Legacy exclusion',true,now())`,
				[category, fixture.organizationId],
			);
			// No employee assignment: legacy exclusions are organization-wide UTC days.
			await fixture.pool.query(
				`insert into holiday (organization_id,category_id,name,start_date,end_date,created_by,updated_at) values ($1,$2,'Legacy global','2026-03-10T00:00:00Z','2026-03-10T23:59:59.999Z',$3,now())`,
				[fixture.organizationId, category, fixture.ownerUserId],
			);
			expect(
				(await read(undefined, { teamId: person.teamId }, dates)).result
					.weeklySeries[0].overtimeHours,
			).toBe(17); //actual startMonday retained49; excluded8expected
		} finally {
			await fixture.pool.query(
				`update organization_tracking_settings set activated_at=now() where organization_id=$1`,
				[fixture.organizationId],
			);
		}
	});
	it("retains inclusive cost-center week-start assignments and manager/team filters", async () => {
		const person = await personWithTerms();
		await addWork(
			person.employeeId,
			"2026-03-02T08:00:00Z",
			"2026-03-02T10:00:00Z",
			120,
		);
		await addWork(
			person.employeeId,
			"2026-03-09T08:00:00Z",
			"2026-03-09T11:00:00Z",
			180,
		);
		const first = randomUUID(),
			second = randomUUID();
		await fixture.pool.query(
			`insert into cost_center (id,organization_id,name,updated_at) values ($1,$3,'First cost',now()),($2,$3,'Second cost',now())`,
			[first, second, fixture.organizationId],
		);
		await fixture.pool.query(
			`insert into employee_cost_center_assignment (organization_id,employee_id,cost_center_id,effective_from,effective_to,updated_at) values ($1,$2,$3,'2026-03-01T00:00:00Z','2026-03-09T00:00:00Z',now()),($1,$2,$4,'2026-03-09T00:00:00Z',null,now())`,
			[fixture.organizationId, person.employeeId, first, second],
		);
		await fixture.pool.query(
			`insert into employee_managers (employee_id,manager_id,is_primary,assigned_by) values ($1,$2,true,$3)`,
			[person.employeeId, fixture.ownerEmployeeId, fixture.ownerUserId],
		);
		const response = await read("2026-03-15", {
			teamId: person.teamId,
			managerId: fixture.ownerEmployeeId,
			costCenterId: first,
		});
		expect(response.result.weeklySeries).toEqual([
			{ weekStart: "2026-03-02", overtimeHours: 2 },
			{ weekStart: "2026-03-09", overtimeHours: 0 },
		]);
		expect(
			(
				await read("2026-03-15", {
					teamId: person.teamId,
					managerId: fixture.ownerEmployeeId,
					costCenterId: second,
				})
			).result.weeklySeries,
		).toEqual([
			{ weekStart: "2026-03-02", overtimeHours: 0 },
			{ weekStart: "2026-03-09", overtimeHours: 3 },
		]);
		expect(
			(
				await read("2026-03-15", {
					teamId: person.teamId,
					managerId: randomUUID(),
				})
			).result.weeklySeries.every((row) => row.overtimeHours === 0),
		).toBe(true);
	});

	it("filters tenant rosters in SQL before reading work evidence", async () => {
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
		expect(
			(await read(undefined, { teamId: person.teamId })).result.weeklySeries[0]
				.overtimeHours,
		).toBe(1);
		const roster = statements.find((row) =>
			row.text.includes('"employee"."is_active"'),
		);
		expect(roster?.text).toContain('"employee"."organization_id"');
		expect(roster?.params).toContain(fixture.organizationId);
		for (const statement of statements.filter((row) =>
			row.text.includes('from "work_period"'),
		)) {
			const retrieved = await fixture.pool.query(
				statement.text,
				statement.params,
			);
			expect(
				retrieved.rows.every((row) => row.employee_id === person.employeeId),
			).toBe(true);
			expect(statement.params).toContain(fixture.organizationId);
		}
	});
	it("bounds SQL employee inputs as the roster crosses64 without weekly query growth", async () => {
		// Keep previously-created semantic cases outside this roster.
		const teamId = randomUUID();
		await fixture.pool.query(
			`insert into team (id,organization_id,name,updated_at) values ($1,$2,'Large overtime roster',now())`,
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
		const week = await read(undefined, { teamId });
		const month = await read("2026-03-29", { teamId });
		expect(week.evidence.tracking).toBe(2);
		expect(month.evidence.tracking).toBe(2);
		expect(week.evidence.periods).toBe(2);
		expect(month.evidence.periods).toBe(2);
		expect(month.evidence.queries).toBe(week.evidence.queries);
		for (const statement of statements.filter((row) =>
			row.text.includes('from "work_period"'),
		)) {
			expect(
				new Set(
					statement.params
						.flat()
						.filter((value) => typeof value === "string" && ids.has(value)),
				).size,
			).toBeLessThanOrEqual(64);
		}
		const { openIntegrationPool } = await import("@/test/integration-database");
		const { drizzle } = await import("drizzle-orm/node-postgres");
		const authSchema = await import("@/db/auth-schema"),
			schema = await import("@/db/schema");
		const pool = openIntegrationPool({ max: 1 });
		const singleClient = drizzle({
			client: pool,
			schema: { ...authSchema, ...schema },
		});
		let peakQueued = 0;
		const timer = setInterval(() => {
			peakQueued = Math.max(peakQueued, pool.waitingCount);
		}, 1);
		try {
			const [response, probe] = await Promise.all([
				read("2026-03-29", { teamId }, range, singleClient),
				pool.query("select 1 as ready"),
			]);
			expect(
				response.result.weeklySeries.every((row) => row.overtimeHours === 0),
			).toBe(true);
			expect(probe.rows).toEqual([{ ready: 1 }]);
			expect(pool.totalCount).toBe(1);
			expect(peakQueued).toBeLessThanOrEqual(1);
		} finally {
			clearInterval(timer);
			await pool.end();
		}
	});
});
