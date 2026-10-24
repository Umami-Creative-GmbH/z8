import { Effect, Layer } from "effect";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { integrationAdminPool } from "@/test/integration-database";

const queries = vi.hoisted(() => [] as { text: string; params: unknown[] }[]);
const caller = vi.hoisted(() => ({ userId: "t1451-manager" as string | null }));
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
								role: "user",
								email: `${caller.userId}@example.test`,
							},
							session: {
								id: "t1451-session",
								userId: caller.userId,
								activeOrganizationId: "t1451-absence-patterns",
							},
						}
					: null,
		},
	},
}));
vi.mock("@/db", async () =>
	(await import("@/test/integration-database")).integrationDbModule({
		logQuery: (text, params) => queries.push({ text, params }),
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
const { getAbsencePatternsData } = await import(
	"@/app/[locale]/(app)/analytics/actions"
);

const ids = {
	organization: "t1451-absence-patterns",
	unrelatedOrganization: "t1451-unrelated",
	manager: "e1451000-0000-4000-8000-000000000001",
	managed: "e1451000-0000-4000-8000-000000000002",
	unmanaged: "e1451000-0000-4000-8000-000000000003",
	outsider: "e1451000-0000-4000-8000-000000000004",
	category: "e1451100-0000-4000-8000-000000000001",
	otherCategory: "e1451100-0000-4000-8000-000000000002",
	team: "e1451200-0000-4000-8000-000000000001",
} as const;

const range = {
	start: new Date("2026-03-01T00:00:00.000Z"),
	end: new Date("2026-03-31T23:59:59.999Z"),
	startDate: "2026-03-01",
	endDate: "2026-03-31",
	timezone: "UTC",
};

describe("absence-pattern reader on PostgreSQL", () => {
	const admin = integrationAdminPool();
	vi.setConfig({ hookTimeout: 60_000, testTimeout: 60_000 });

	async function cleanup() {
		await admin.query(
			"delete from absence_entry where employee_id = any($1::uuid[])",
			[[ids.manager, ids.managed, ids.unmanaged, ids.outsider]],
		);
		await admin.query("delete from organization where id = any($1::text[])", [
			[ids.organization, ids.unrelatedOrganization],
		]);
		await admin.query('delete from "user" where id like $1', ["t1451-%"]);
	}

	beforeAll(async () => {
		await cleanup();
		for (const organizationId of [
			ids.organization,
			ids.unrelatedOrganization,
		]) {
			await admin.query(
				`insert into organization (id, name, slug, timezone, created_at)
				 values ($1, $1, $1, 'UTC', now())`,
				[organizationId],
			);
		}
		await admin.query(
			`insert into team (id, organization_id, name, updated_at)
			 values ($1, $2, 'Operations', now())`,
			[ids.team, ids.organization],
		);
		for (const [person, employeeId, organizationId, role] of [
			["manager", ids.manager, ids.organization, "manager"],
			["managed", ids.managed, ids.organization, "employee"],
			["unmanaged", ids.unmanaged, ids.organization, "employee"],
			["outsider", ids.outsider, ids.unrelatedOrganization, "employee"],
		]) {
			const userId = `t1451-${person}`;
			await admin.query(
				`insert into "user" (id, name, email, created_at, updated_at)
				 values ($1, $1, $2, now(), now())`,
				[userId, `${userId}@example.test`],
			);
			await admin.query(
				`insert into employee (id, user_id, organization_id, role, team_id, updated_at)
				 values ($1, $2, $3, $4, $5, now())`,
				[
					employeeId,
					userId,
					organizationId,
					role,
					organizationId === ids.organization ? ids.team : null,
				],
			);
		}
		await admin.query(
			`insert into employee_managers (employee_id, manager_id, assigned_by)
			 values ($1, $2, 't1451-manager')`,
			[ids.managed, ids.manager],
		);
		for (const [categoryId, organizationId] of [
			[ids.category, ids.organization],
			[ids.otherCategory, ids.unrelatedOrganization],
		]) {
			await admin.query(
				`insert into absence_category (id, organization_id, type, name, updated_at)
				 values ($1, $2, 'sick', 'Sick leave', now())`,
				[categoryId, organizationId],
			);
		}
		// The first absence crosses the range boundary. The nullable organization
		// column is retained for legacy rows; the employee remains its tenant owner.
		await admin.query(
			`insert into absence_entry
			 (employee_id, category_id, organization_id, start_date, end_date, status, updated_at)
			 values ($1, $3, null, '2026-02-28', '2026-03-02', 'approved', now()),
			        ($2, $3, $4, '2026-03-05', '2026-03-05', 'approved', now())`,
			[ids.managed, ids.unmanaged, ids.category, ids.organization],
		);
		await admin.query(
			`insert into absence_entry
			 (employee_id, category_id, organization_id, start_date, end_date, status, updated_at)
			 select $1, $2, $3, '2026-03-01', '2026-03-31', 'approved', now()
			 from generate_series(1, 1000)`,
			[ids.outsider, ids.otherCategory, ids.unrelatedOrganization],
		);
	});
	afterAll(cleanup);

	async function readPatterns(
		scope:
			| { role: "admin" }
			| { role: "manager"; managerEmployeeId: string } = { role: "admin" },
	) {
		queries.length = 0;
		const result = await Effect.runPromise(
			Effect.gen(function* () {
				const analytics = yield* AnalyticsService;
				return yield* analytics.getAbsencePatterns({
					organizationId: ids.organization,
					dateRange: range,
					scope,
				});
			}).pipe(
				Effect.provide(AnalyticsService.Live),
				Effect.provide(WorkPolicyServiceLive),
				Effect.provide(Layer.succeed(DatabaseService, makeDatabaseService(db))),
			),
		);
		const absenceQuery = queries.find((query) =>
			query.text.includes('from "absence_entry"'),
		);
		expect(absenceQuery).toBeDefined();
		if (!absenceQuery) throw new Error("Absence query was not recorded");
		const retrieved = await admin.query(absenceQuery.text, absenceQuery.params);
		if (process.env.Z8_ABSENCE_QUERY_EVIDENCE === "1") {
			const samples = [];
			for (let sample = 0; sample < 20; sample++) {
				const started = performance.now();
				await admin.query(absenceQuery.text, absenceQuery.params);
				samples.push(performance.now() - started);
			}
			samples.sort((left, right) => left - right);
			console.info(
				"absence-pattern fixture query evidence",
				JSON.stringify({
					rows: retrieved.rowCount,
					samples: samples.length,
					p50Milliseconds: samples[9],
					p95Milliseconds: samples[18],
				}),
			);
		}
		return { result, retrieved, absenceQuery };
	}

	it("retrieves only authorized-organization absences and their relations before computing patterns", async () => {
		const { result, retrieved, absenceQuery } = await readPatterns();
		expect(result.summary).toEqual({
			totalAbsences: 2,
			totalDays: 3,
			avgDaysPerAbsence: 1.5,
			absenceRate: 13.64,
		});
		expect(result.byType).toEqual([
			{ categoryName: "Sick leave", count: 2, totalDays: 2, percentage: 100 },
		]);
		expect(result.timeline).toEqual([
			{
				date: "2026-03-01",
				absenceCount: 1,
				sickLeaveCount: 1,
				vacationCount: 0,
			},
			{
				date: "2026-03-02",
				absenceCount: 1,
				sickLeaveCount: 1,
				vacationCount: 0,
			},
			{
				date: "2026-03-05",
				absenceCount: 1,
				sickLeaveCount: 1,
				vacationCount: 0,
			},
		]);
		expect(retrieved.rows).toHaveLength(2);
		expect(absenceQuery.params).toContain(ids.organization);
	});

	it("retrieves only a manager's assigned employees before computing patterns", async () => {
		const { result, retrieved, absenceQuery } = await readPatterns({
			role: "manager",
			managerEmployeeId: ids.manager,
		});
		expect(result.summary).toEqual({
			totalAbsences: 1,
			totalDays: 2,
			avgDaysPerAbsence: 2,
			absenceRate: 9.09,
		});
		expect(result.patterns.sickLeavePatterns.frequentEmployees).toEqual([
			{ employeeId: ids.managed, count: 1 },
		]);
		expect(retrieved.rows).toHaveLength(1);
		expect(absenceQuery.params).toContain(ids.manager);
	});

	it("the authenticated analytics caller applies current manager assignments and denies employee access", async () => {
		caller.userId = "t1451-manager";
		const allowed = await getAbsencePatternsData(range);
		expect(allowed).toMatchObject({
			success: true,
			data: { summary: { totalAbsences: 1, totalDays: 2 } },
		});

		await admin.query("delete from employee_managers where manager_id = $1", [
			ids.manager,
		]);
		const reduced = await getAbsencePatternsData(range);
		expect(reduced).toMatchObject({
			success: true,
			data: { summary: { totalAbsences: 0, totalDays: 0 } },
		});

		caller.userId = "t1451-managed";
		queries.length = 0;
		const denied = await getAbsencePatternsData(range);
		expect(denied).toMatchObject({
			success: false,
			code: "AuthorizationError",
		});
		expect(
			queries.some((query) => query.text.includes('from "absence_entry"')),
		).toBe(false);
	});
});
