/**
 * #794: project reports count only completed, non-deleted work. The report
 * server actions run against PostgreSQL; only the session is mocked.
 */

import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { integrationAdminPool } from "@/test/integration-database";

const harness = vi.hoisted(() => ({
	userId: "t794-admin-user",
	organizationId: "t794-project-report-org",
}));

vi.mock("next/headers", async () => (await import("@/test/integration-harness")).nextHeaders());

vi.mock("next/server", async (importOriginal) =>
	(await import("@/test/integration-harness")).nextServer(importOriginal),
);

vi.mock("next/cache", async (importOriginal) =>
	(await import("@/test/integration-harness")).nextCache(importOriginal),
);

vi.mock("@/lib/auth", () => ({
	auth: {
		api: {
			getSession: async () => ({
				user: { id: harness.userId, role: "user" },
				session: {
					id: `t794-session-${harness.userId}`,
					userId: harness.userId,
					activeOrganizationId: harness.organizationId,
				},
			}),
		},
	},
}));

vi.mock("@/lib/billing/guard", async () =>
	(await import("@/test/integration-harness")).billingGuard(),
);

const { getProjectDetailedReport, getProjectsOverview } = await import("./actions");

const ids = {
	organization: "t794-project-report-org",
	adminUser: "t794-admin-user",
	workerUser: "t794-worker-user",
	admin: "d7940000-0000-4000-8000-000000000001",
	worker: "d7940000-0000-4000-8000-000000000002",
	project: "d7940000-0000-4000-8000-0000000000b1",
} as const;
const users = [ids.adminUser, ids.workerUser];
const rangeStart = new Date("2026-03-01T00:00:00Z");
const rangeEnd = new Date("2026-03-31T23:59:59Z");

describe("project reports on PostgreSQL", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	const admin = integrationAdminPool();

	async function cleanup() {
		await admin.query("delete from work_period where organization_id = $1", [ids.organization]);
		await admin.query("delete from time_entry where organization_id = $1", [ids.organization]);
		await admin.query("delete from organization where id = $1", [ids.organization]);
		await admin.query('delete from "user" where id = any($1::text[])', [users]);
	}

	async function workPeriod(options: {
		employeeId: string;
		start: string;
		end?: string;
		minutes?: number;
		deleted?: boolean;
	}) {
		const clockInId = randomUUID();
		const clockOutId = options.end ? randomUUID() : null;
		for (const [entryId, type, timestamp] of [
			[clockInId, "clock_in", options.start],
			...(clockOutId ? [[clockOutId, "clock_out", options.end]] : []),
		]) {
			await admin.query(
				`insert into time_entry
				 (id, employee_id, organization_id, type, timestamp, utc_offset_minutes, timezone, timezone_source, hash, created_by)
				 values ($1, $2, $3, $4, $5, 60, 'Europe/Berlin', 'user_setting', $7, $6)`,
				[entryId, options.employeeId, ids.organization, type, timestamp, ids.adminUser, entryId],
			);
		}
		await admin.query(
			`insert into work_period
			 (employee_id, organization_id, clock_in_id, clock_out_id, project_id, start_time, end_time,
			  duration_minutes, is_active, deleted_at, deleted_by, updated_at)
			 values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now())`,
			[
				options.employeeId,
				ids.organization,
				clockInId,
				clockOutId,
				ids.project,
				options.start,
				options.end ?? null,
				options.minutes ?? null,
				!options.end,
				options.deleted ? "2026-04-01T00:00:00Z" : null,
				options.deleted ? ids.adminUser : null,
			],
		);
	}

	beforeEach(async () => {
		await cleanup();
		await admin.query(
			`insert into organization (id, name, slug, timezone, created_at)
			 values ($1, 'T794 project reports', $1, 'UTC', now())`,
			[ids.organization],
		);
		await admin.query(
			`insert into "user" (id, name, email, created_at, updated_at)
			 select user_id, user_id, user_id || '@example.test', now(), now() from unnest($1::text[]) as user_id`,
			[users],
		);
		await admin.query(
			`insert into member (id, organization_id, user_id, role, status, created_at) values
			 ('t794-m-admin', $1, $2, 'owner', 'approved', now()),
			 ('t794-m-worker', $1, $3, 'member', 'approved', now())`,
			[ids.organization, ids.adminUser, ids.workerUser],
		);
		await admin.query(
			`insert into employee (id, user_id, organization_id, role, updated_at) values
			 ($1, $2, $5, 'admin', now()), ($3, $4, $5, 'employee', now())`,
			[ids.admin, ids.adminUser, ids.worker, ids.workerUser, ids.organization],
		);
		await admin.query(
			`insert into project (id, organization_id, name, status, budget_hours, created_by, updated_at)
			 values ($1, $2, 'Website relaunch', 'active', 10, $3, now())`,
			[ids.project, ids.organization, ids.adminUser],
		);

		// Counted: completed work inside the range (2h) and before it (1h, budget only).
		await workPeriod({
			employeeId: ids.worker,
			start: "2026-03-10T08:00:00Z",
			end: "2026-03-10T10:00:00Z",
			minutes: 120,
		});
		await workPeriod({
			employeeId: ids.worker,
			start: "2026-02-10T08:00:00Z",
			end: "2026-02-10T09:00:00Z",
			minutes: 60,
		});
		// Not counted: work deleted by an approved correction, in and before the range.
		await workPeriod({
			employeeId: ids.worker,
			start: "2026-03-11T08:00:00Z",
			end: "2026-03-11T11:00:00Z",
			minutes: 180,
			deleted: true,
		});
		await workPeriod({
			employeeId: ids.worker,
			start: "2026-02-11T08:00:00Z",
			end: "2026-02-11T12:00:00Z",
			minutes: 240,
			deleted: true,
		});
		// Not counted: live work by another employee.
		await workPeriod({ employeeId: ids.admin, start: "2026-03-12T08:00:00Z" });
	});
	afterAll(cleanup);

	it("overview excludes deleted and live work from hours, counts and budget usage", async () => {
		const result = await getProjectsOverview(rangeStart, rangeEnd);
		if (!result.success) throw new Error(result.error);

		const [summary] = result.data.projects;
		expect(summary).toMatchObject({
			id: ids.project,
			totalMinutes: 120,
			totalHours: 2,
			workPeriodCount: 1,
			uniqueEmployees: 1,
			percentBudgetUsed: 30,
		});
		expect(result.data.totals.totalHours).toBe(2);
		expect(result.data.totals.projectsOverBudget).toBe(0);
	});

	it("detail report excludes deleted and live work from summary and breakdowns", async () => {
		const result = await getProjectDetailedReport(ids.project, rangeStart, rangeEnd);
		if (!result.success) throw new Error(result.error);

		expect(result.data.summary).toMatchObject({
			totalMinutes: 120,
			workPeriodCount: 1,
			uniqueEmployees: 1,
			percentBudgetUsed: 20,
			remainingBudgetHours: 8,
		});
		expect(result.data.employeeBreakdown).toEqual([
			expect.objectContaining({
				employeeId: ids.worker,
				totalMinutes: 120,
				workPeriodCount: 1,
			}),
		]);
		expect(result.data.teamBreakdown.flatMap((team) => team.members)).toEqual([
			expect.objectContaining({ employeeId: ids.worker, workPeriodCount: 1 }),
		]);
		expect(result.data.timeSeries).toEqual([
			{ date: "2026-03-10", hours: 2, cumulativeHours: 2 },
		]);
	});
});
