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
const billing = vi.hoisted(() => ({ enabled: "false" }));
vi.mock("@/env", async (original) => {
	const actual = await original<typeof import("@/env")>();
	return {
		env: new Proxy(actual.env, {
			get: (target, key) =>
				key === "BILLING_ENABLED" ? billing.enabled : Reflect.get(target, key),
		}),
	};
});
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
								id: "recent-analytics-fixture",
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
const { DatabaseService, makeDatabaseService } = await import(
	"@/lib/effect/services/database.service"
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

describe("recent analytics authorization and dependency versions on PostgreSQL", () => {
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
	it("denies a revoked organization membership before retrieving or looking up analytics", async () => {
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
			data: { organizationTotal: 45 },
		});
		await fixture.pool.query(
			`update member set status='rejected' where id=$1`,
			[manager.memberId],
		);
		queries.length = 0;
		expect(await getTeamPerformanceData(range)).toMatchObject({
			success: false,
			code: "AuthorizationError",
		});
		expect(queries.some((text) => text.includes('from "work_period"'))).toBe(
			false,
		);
	});
	it("rechecks enabled billing before analytics lookup and never provisions a trial on reads", async () => {
		caller.userId = fixture.ownerUserId;
		caller.organizationId = fixture.organizationId;
		const subscriptionId = randomUUID();
		await fixture.pool.query(
			`insert into subscription (id,organization_id,status) values ($1,$2,'active')`,
			[subscriptionId, fixture.organizationId],
		);
		billing.enabled = "true";
		try {
			expect(await getTeamPerformanceData(range)).toMatchObject({
				success: true,
			});
			await fixture.pool.query(
				`update subscription set status='past_due' where id=$1`,
				[subscriptionId],
			);
			queries.length = 0;
			expect(await getTeamPerformanceData(range)).toMatchObject({
				success: false,
				code: "BillingError",
			});
			expect(
				queries.some(
					(text) =>
						text.includes("with visible as materialized") ||
						text.includes('from "work_period"'),
				),
			).toBe(false);
			await fixture.pool.query(`delete from subscription where id=$1`, [
				subscriptionId,
			]);
			queries.length = 0;
			expect(await getTeamPerformanceData(range)).toMatchObject({
				success: false,
				code: "BillingError",
			});
			expect(queries.some((text) => /^\s*(insert|update)/i.test(text))).toBe(
				false,
			);
			expect(
				(
					await fixture.pool.query(
						`select count(*)::int count from subscription where organization_id=$1`,
						[fixture.organizationId],
					)
				).rows[0].count,
			).toBe(0);
		} finally {
			billing.enabled = "false";
			await fixture.pool.query(`delete from subscription where id=$1`, [
				subscriptionId,
			]);
		}
	});
	it("denies an inactive or due-departure actor before analytics lookup", async () => {
		const manager = await fixture.seedEmployee();
		await fixture.pool.query(`update employee set role='manager' where id=$1`, [
			manager.employeeId,
		]);
		caller.userId = manager.userId;
		caller.organizationId = fixture.organizationId;
		expect(await getTeamPerformanceData(range)).toMatchObject({
			success: true,
		});
		await fixture.pool.query(
			`insert into employee_departure (organization_id,employee_id,employment_period_id,mode,last_working_day,timezone,cutoff_at,created_by,request_id,request_fingerprint,revision,status) values ($1,$2,$3,'scheduled','2026-01-01','UTC','2026-01-02T00:00:00Z',$4,gen_random_uuid(),'test',1,'pending')`,
			[
				fixture.organizationId,
				manager.employeeId,
				manager.employmentPeriodId,
				fixture.ownerUserId,
			],
		);
		queries.length = 0;
		expect(await getTeamPerformanceData(range)).toMatchObject({
			success: false,
			code: "NotFoundError",
		});
		expect(
			queries.some(
				(text) =>
					text.includes("with visible as materialized") ||
					text.includes('from "work_period"'),
			),
		).toBe(false);
		await fixture.pool.query(
			`delete from employee_departure where employee_id=$1`,
			[manager.employeeId],
		);
		await fixture.pool.query(
			`update employee set is_active=false where id=$1`,
			[manager.employeeId],
		);
		queries.length = 0;
		expect(await getTeamPerformanceData(range)).toMatchObject({
			success: false,
			code: "NotFoundError",
		});
		expect(
			queries.some((text) => text.includes("with visible as materialized")),
		).toBe(false);
	});
	async function identity(
		employeeId = people[0],
		client: Parameters<typeof makeDatabaseService>[0] = db,
	) {
		const { loadRecentAnalyticsIdentity } = await import(
			"@/lib/analytics/recent-identity"
		);
		return Effect.runPromise(
			loadRecentAnalyticsIdentity(
				{
					id: fixture.ownerEmployeeId,
					userId: fixture.ownerUserId,
					organizationId: fixture.organizationId,
					role: "admin",
				},
				{ kind: "work-hours", dateRange: range, employeeId },
			).pipe(
				Effect.provide(
					Layer.succeed(DatabaseService, makeDatabaseService(client)),
				),
			),
		);
	}
	it("bypasses missing or deleted markers and never resurrects their old cache keys after rebuild or recreation", async () => {
		const {
			markEmployeeWorkBalanceDirty,
			refreshEmployeeWorkBalanceFromPeriods,
			deleteEmployeeWorkBalance,
		} = await import("@/lib/work-balance/service");
		expect((await identity()).identity.cacheable).toBe(false);
		const input = {
			organizationId: fixture.organizationId,
			employeeId: people[0],
		};
		await markEmployeeWorkBalanceDirty(input);
		const dirty = (await identity()).identity;
		expect(dirty.cacheable).toBe(true);
		await refreshEmployeeWorkBalanceFromPeriods({
			...input,
			forceFullRebuild: true,
			now: new Date("2026-03-08T12:00:00Z"),
		});
		const clean = (await identity()).identity;
		expect(clean.cacheable).toBe(true);
		expect(clean.revision).not.toBe(dirty.revision);
		await deleteEmployeeWorkBalance(input);
		expect((await identity()).identity.cacheable).toBe(false);
		await markEmployeeWorkBalanceDirty(input);
		const recreated = (await identity()).identity;
		expect(recreated.cacheable).toBe(true);
		expect(recreated.revision).not.toBe(dirty.revision);
		expect(recreated.revision).not.toBe(clean.revision);
	});
	it("versions same-timestamp confirmed terms, policy days, tracking and absence removals", async () => {
		let previous = (await identity()).identity.revision;
		async function changed() {
			const next = (await identity()).identity.revision;
			expect(next).not.toBe(previous);
			previous = next;
		}
		await fixture.pool.query(
			`update employee_employment_history set weekly_contract_minutes=1200 where employee_id=$1 and review_state='confirmed'`,
			[people[0]],
		);
		await changed();
		await fixture.pool.query(
			`update work_policy_schedule_day set hours_per_day=4 where schedule_id in(select id from work_policy_schedule where policy_id=$1) and day_of_week='monday'`,
			[policyId],
		);
		await changed();
		await fixture.pool.query(
			`insert into employee_tracking_settings (organization_id,employee_id,tracking_start_date) values ($1,$2,'2026-03-03')`,
			[fixture.organizationId, people[0]],
		);
		await changed();
		await fixture.pool.query(
			`update employee_tracking_settings set tracking_start_date='2026-03-04' where organization_id=$1 and employee_id=$2`,
			[fixture.organizationId, people[0]],
		);
		await changed();
		await fixture.pool.query(
			`delete from employee_tracking_settings where organization_id=$1 and employee_id=$2`,
			[fixture.organizationId, people[0]],
		);
		await changed();
		const category = randomUUID(),
			absence = randomUUID();
		await fixture.pool.query(
			`insert into absence_category (id,organization_id,type,name,updated_at) values ($1,$2,'sick','Cache absence',now())`,
			[category, fixture.organizationId],
		);
		await changed();
		await fixture.pool.query(
			`insert into absence_entry (id,organization_id,employee_id,category_id,start_date,end_date,status,updated_at) values ($1,$2,$3,$4,'2026-03-02','2026-03-02','approved',now())`,
			[absence, fixture.organizationId, people[0], category],
		);
		await changed();
		await fixture.pool.query(
			`update absence_entry set end_period='am',start_period='am' where id=$1`,
			[absence],
		);
		await changed();
		await fixture.pool.query(`delete from absence_entry where id=$1`, [
			absence,
		]);
		await changed();
	});
	it("versions holiday/preset membership and deletion without invalidating another organization", async () => {
		const other = await fixture.createOrganization();
		const outsider = await fixture.seedEmployee({
			organizationId: other,
			role: "admin",
		});
		const { loadRecentAnalyticsIdentity } = await import(
			"@/lib/analytics/recent-identity"
		);
		async function otherIdentity() {
			return Effect.runPromise(
				loadRecentAnalyticsIdentity(
					{
						id: outsider.employeeId,
						userId: outsider.userId,
						organizationId: other,
						role: "admin",
					},
					{ kind: "team", dateRange: range },
				).pipe(
					Effect.provide(
						Layer.succeed(DatabaseService, makeDatabaseService(db)),
					),
				),
			);
		}
		const untouched = (await otherIdentity()).identity.revision;
		let previous = (await identity()).identity.revision;
		async function changed() {
			const next = (await identity()).identity.revision;
			expect(next).not.toBe(previous);
			previous = next;
			expect((await otherIdentity()).identity.revision).toBe(untouched);
		}
		const category = randomUUID(),
			holiday = randomUUID(),
			assignment = randomUUID(),
			preset = randomUUID(),
			presetDay = randomUUID(),
			presetAssignment = randomUUID();
		await fixture.pool.query(
			`insert into holiday_category (id,organization_id,type,name,updated_at) values ($1,$2,'company_holiday','Cache calendar',now())`,
			[category, fixture.organizationId],
		);
		await changed();
		await fixture.pool.query(
			`insert into holiday (id,organization_id,category_id,name,start_date,end_date,created_by,updated_at) values ($1,$2,$3,'Cache holiday','2026-03-02T00:00:00Z','2026-03-02T23:59:59Z',$4,now())`,
			[holiday, fixture.organizationId, category, fixture.ownerUserId],
		);
		await changed();
		await fixture.pool.query(
			`insert into holiday_assignment (id,holiday_id,organization_id,assignment_type,employee_id,created_by,updated_at) values ($1,$2,$3,'employee',$4,$5,now())`,
			[
				assignment,
				holiday,
				fixture.organizationId,
				people[0],
				fixture.ownerUserId,
			],
		);
		await changed();
		await fixture.pool.query(`delete from holiday_assignment where id=$1`, [
			assignment,
		]);
		await changed();
		await fixture.pool.query(`delete from holiday where id=$1`, [holiday]);
		await changed();
		await fixture.pool.query(
			`insert into holiday_preset (id,organization_id,name,created_by,updated_at) values ($1,$2,'Cache preset',$3,now())`,
			[preset, fixture.organizationId, fixture.ownerUserId],
		);
		await changed();
		await fixture.pool.query(
			`insert into holiday_preset_holiday (id,preset_id,name,month,day) values ($1,$2,'Preset day',3,2)`,
			[presetDay, preset],
		);
		await changed();
		await fixture.pool.query(
			`insert into holiday_preset_assignment (id,preset_id,organization_id,assignment_type,employee_id,created_by,updated_at) values ($1,$2,$3,'employee',$4,$5,now())`,
			[
				presetAssignment,
				preset,
				fixture.organizationId,
				people[0],
				fixture.ownerUserId,
			],
		);
		await changed();
		await fixture.pool.query(`delete from holiday_preset_holiday where id=$1`, [
			presetDay,
		]);
		await changed();
		await fixture.pool.query(
			`delete from holiday_preset_assignment where id=$1`,
			[presetAssignment],
		);
		await changed();
	});
	it("keeps transaction-local revisions out of subsequent committed identities", async () => {
		const before = (await identity()).identity.revision;
		await expect(
			db.transaction(async (tx) => {
				const { sql } = await import("drizzle-orm");
				await tx.execute(
					sql`update employee_employment_history set weekly_contract_minutes=600 where employee_id=${people[0]} and review_state='confirmed'`,
				);
				expect((await identity(people[0], tx)).identity.revision).not.toBe(
					before,
				);
				throw new Error("rollback cache source fixture");
			}),
		).rejects.toThrow("rollback cache source fixture");
		expect((await identity()).identity.revision).toBe(before);
	});
	it("keys actual current manager visibility, filters, actor identity and custom-role revisions", async () => {
		const manager = await fixture.seedEmployee();
		await fixture.pool.query(`update employee set role='manager' where id=$1`, [
			manager.employeeId,
		]);
		await fixture.pool.query(
			`insert into employee_managers (employee_id,manager_id,assigned_by) values ($1,$2,$3),($4,$2,$3)`,
			[people[0], manager.employeeId, fixture.ownerUserId, people[1]],
		);
		const { loadRecentAnalyticsIdentity } = await import(
			"@/lib/analytics/recent-identity"
		);
		const actor = {
			id: manager.employeeId,
			userId: manager.userId,
			organizationId: fixture.organizationId,
			role: "manager" as const,
		};
		async function prepared(
			request: Parameters<typeof loadRecentAnalyticsIdentity>[1] = {
				kind: "team",
				dateRange: range,
			},
		) {
			return Effect.runPromise(
				loadRecentAnalyticsIdentity(actor, request).pipe(
					Effect.provide(
						Layer.succeed(DatabaseService, makeDatabaseService(db)),
					),
				),
			);
		}
		const initial = await prepared();
		expect(initial.identity.visibleEmployeeIds).toEqual(
			[people[0], people[1]].sort(),
		);
		expect(
			(
				await prepared({
					kind: "work-hours",
					dateRange: range,
					employeeId: people[2],
				})
			).identity.visibleEmployeeIds,
		).toEqual([]);
		await fixture.pool.query(
			`delete from employee_managers where manager_id=$1 and employee_id=$2`,
			[manager.employeeId, people[1]],
		);
		const reduced = await prepared();
		expect(reduced.identity.visibleEmployeeIds).toEqual([people[0]]);
		expect(reduced.identity.revision).not.toBe(initial.identity.revision);
		const customRole = randomUUID();
		await fixture.pool.query(
			`insert into custom_role (id,organization_id,name,base_tier,created_by,updated_at) values ($1,$2,'Additional reporting','manager',$3,now())`,
			[customRole, fixture.organizationId, fixture.ownerUserId],
		);
		await fixture.pool.query(
			`insert into custom_role_permission (custom_role_id,action,subject) values ($1,'read','Report')`,
			[customRole],
		);
		await fixture.pool.query(
			`insert into employee_custom_role (employee_id,custom_role_id,assigned_by) values ($1,$2,$3)`,
			[manager.employeeId, customRole, fixture.ownerUserId],
		);
		const granted = await prepared();
		expect(granted.identity.revision).not.toBe(reduced.identity.revision);
		expect(granted.identity.visibleEmployeeIds).toEqual([people[0]]);
		await fixture.pool.query(
			`delete from custom_role_permission where custom_role_id=$1`,
			[customRole],
		);
		expect((await prepared()).identity.revision).not.toBe(
			granted.identity.revision,
		);
		await fixture.pool.query(
			`insert into custom_role_permission (custom_role_id,action,subject) values ($1,'read','Report')`,
			[customRole],
		);
		await fixture.pool.query(
			`update employee set role='employee' where id=$1`,
			[manager.employeeId],
		);
		caller.userId = manager.userId;
		caller.organizationId = fixture.organizationId;
		queries.length = 0;
		expect(await getTeamPerformanceData(range)).toMatchObject({
			success: false,
			code: "AuthorizationError",
		});
		expect(
			queries.some((text) => text.includes("with visible as materialized")),
		).toBe(false);
	});
	it("reads stable scoped revision metadata without retrieving work periods or making employee-sized query queues", async () => {
		const samples = [];
		let last: Awaited<ReturnType<typeof identity>>["identity"] | undefined;
		for (let index = 0; index < 21; index++) {
			queries.length = 0;
			const start = performance.now();
			const value = await identity();
			if (index > 0) samples.push(performance.now() - start);
			if (last) expect(value.identity).toEqual(last);
			last = value.identity;
			expect(queries).toHaveLength(2);
			expect(queries.some((text) => text.includes('from "work_period"'))).toBe(
				false,
			);
		}
		samples.sort((a, b) => a - b);
		console.info(
			"recent metadata warm evidence",
			JSON.stringify({
				samples: 20,
				employees: 1,
				queries: 2,
				p50: (samples[9] + samples[10]) / 2,
				p95: samples[18],
			}),
		);
	});
	it("versions an accepted canonical work correction in its transaction and exposes the new total immediately", async () => {
		caller.userId = fixture.ownerUserId;
		caller.organizationId = fixture.organizationId;
		expect(await getTeamPerformanceData(range)).toMatchObject({
			success: true,
			data: { organizationTotal: 180 },
		});
		const previous = (await identity()).identity.revision;
		const period = await fixture.pool.query(
			`select id from work_period where organization_id=$1 and employee_id=$2 and start_time='2026-03-02T08:00:00Z'`,
			[fixture.organizationId, people[0]],
		);
		const { withCompletedWorkTransaction } = await import(
			"@/lib/time-tracking/completed-work-transaction"
		);
		const { readWorkRecord, applyWorkRecordChange } = await import(
			"@/lib/time-tracking/work-records"
		);
		const { parseInstant } = await import("@/lib/datetime/temporal-core");
		const key = {
			organizationId: fixture.organizationId,
			employeeId: people[0],
			workPeriodId: period.rows[0].id,
		};
		const result = await withCompletedWorkTransaction(
			{ ...key, actorUserId: fixture.ownerUserId },
			async (scope) => {
				const current = await readWorkRecord(scope, key);
				if (!current) throw new Error("Expected synthetic completed work");
				return applyWorkRecordChange(scope, {
					kind: "amend",
					organizationId: key.organizationId,
					employeeId: key.employeeId,
					expected: current.expected,
					actorUserId: fixture.ownerUserId,
					times: {
						clockOut: {
							at: parseInstant("2026-03-02T16:00:00Z"),
							capture: {
								utcOffsetMinutes: 0,
								timezone: "UTC",
								timezoneSource: "user_setting",
							},
						},
						notes: "Synthetic accepted correction",
						entries: {
							createdBy: fixture.ownerUserId,
							ipAddress: null,
							deviceInfo: "cache fixture",
						},
						appendOperation: "completed_work_correction",
					},
				});
			},
		);
		expect(result.kind).toBe("amended");
		expect((await identity()).identity.revision).not.toBe(previous);
		expect(await getTeamPerformanceData(range)).toMatchObject({
			success: true,
			data: { organizationTotal: 179 },
		});
	});
});
