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
});
