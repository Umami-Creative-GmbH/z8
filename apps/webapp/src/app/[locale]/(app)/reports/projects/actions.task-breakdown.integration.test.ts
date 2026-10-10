/**
 * #876 runtime evidence: the project report's "By task" section.
 *
 * Local contract: pnpm --filter webapp test:integration
 * The runner creates, migrates, verifies, and removes a label-owned PostgreSQL 16 database.
 *
 * The real project report action runs against PostgreSQL. Only the
 * request/session, SSO proof, logger and Next cache boundaries are replaced.
 */

import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { integrationAdminPool } from "@/test/integration-database";

const { sessions } = await vi.hoisted(async () => {
	const { AsyncLocalStorage } = await import("node:async_hooks");
	return {
		sessions: new AsyncLocalStorage<{ userId: string; organizationId: string }>(),
	};
});

vi.mock("next/server", async (importOriginal) =>
	(await import("@/test/integration-harness")).nextServer(importOriginal),
);

vi.mock("next/headers", async () => (await import("@/test/integration-harness")).nextHeaders());

vi.mock("next/cache", async (importOriginal) =>
	(await import("@/test/integration-harness")).nextCache(importOriginal),
);

vi.mock("@/lib/auth", () => ({
	auth: {
		api: {
			getSession: async () => {
				const current = sessions.getStore();
				return current
					? {
							user: { id: current.userId, role: "user" },
							session: {
								id: `t876-session-${current.userId}`,
								userId: current.userId,
								activeOrganizationId: current.organizationId,
							},
						}
					: null;
			},
		},
	},
}));

vi.mock("@/lib/enterprise-identity/session-sso-store", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/enterprise-identity/session-sso-store")>()),
	canAccessOrganizationWithSso: async () => true,
}));

vi.mock("@/lib/logger", async (importOriginal) => {
	const original = await importOriginal<typeof import("@/lib/logger")>();
	const quiet = { error: () => {}, warn: () => {}, info: () => {}, debug: () => {} };
	return {
		...original,
		logger: { ...original.logger, ...quiet },
		createLogger: () => ({ ...original.logger, ...quiet }),
	};
});

const reports = await import("./actions");

const ids = {
	organization: "t876-report-org",
	otherOrganization: "t876-other-org",
	ownerUser: "t876-owner-user",
	otherUser: "t876-other-user",
	owner: "e8760000-0000-4000-8000-000000000001",
	otherEmployee: "e8760000-0000-4000-8000-000000000002",
	project: "e8760000-0000-4000-8000-000000000020",
	siblingProject: "e8760000-0000-4000-8000-000000000021",
	otherProject: "e8760000-0000-4000-8000-000000000022",
	design: "e8760000-0000-4000-8000-000000000030",
	build: "e8760000-0000-4000-8000-000000000031",
	siblingTask: "e8760000-0000-4000-8000-000000000032",
	otherTask: "e8760000-0000-4000-8000-000000000033",
} as const;
const users = [ids.ownerUser, ids.otherUser];

const rangeStart = new Date("2026-01-05T00:00:00Z");
const rangeEnd = new Date("2026-01-10T23:59:59Z");

describe("the project report's By task section on PostgreSQL", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	const admin = integrationAdminPool();

	function actAs<T>(userId: string, action: () => Promise<T>): Promise<T> {
		return sessions.run({ userId, organizationId: ids.organization }, action);
	}

	async function cleanup() {
		await admin.query("delete from organization where id in ($1, $2)", [
			ids.organization,
			ids.otherOrganization,
		]);
		await admin.query('delete from "user" where id = any($1::text[])', [users]);
	}

	async function book(input: {
		organizationId: string;
		employeeId: string;
		userId: string;
		projectId: string | null;
		taskId: string | null;
		start: string;
		minutes: number;
	}) {
		const clockInId = randomUUID();
		const start = new Date(input.start);
		const end = new Date(start.getTime() + input.minutes * 60_000);
		await admin.query(
			`insert into time_entry (
				id, employee_id, organization_id, type, timestamp, utc_offset_minutes,
				timezone, timezone_source, hash, created_by, created_at
			 ) values ($1, $2, $3, 'clock_in', $4, 0, 'UTC', 'backfill', $6, $5, $4)`,
			[clockInId, input.employeeId, input.organizationId, start, input.userId, `t876-${clockInId}`],
		);
		await admin.query(
			`insert into work_period (
				id, employee_id, organization_id, clock_in_id, project_id, task_id,
				start_time, end_time, duration_minutes, is_active, updated_at
			 ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, false, $8)`,
			[
				randomUUID(),
				input.employeeId,
				input.organizationId,
				clockInId,
				input.projectId,
				input.taskId,
				start,
				end,
				input.minutes,
			],
		);
	}

	async function seed() {
		await cleanup();
		const timestamp = new Date("2026-01-01T00:00:00Z");
		await admin.query(
			`insert into organization (id, name, slug, timezone, created_at) values
			 ($1, 'T876 reports', $1, 'UTC', $3), ($2, 'T876 other', $2, 'UTC', $3)`,
			[ids.organization, ids.otherOrganization, timestamp],
		);
		await admin.query(
			`insert into "user" (id, name, email, created_at, updated_at)
			 select user_id, user_id, user_id || '@example.test', $2, $2 from unnest($1::text[]) as user_id`,
			[users, timestamp],
		);
		await admin.query(
			`insert into member (id, organization_id, user_id, role, status, created_at) values
			 ($1, $2, $3, 'owner', 'approved', $7), ($4, $5, $6, 'owner', 'approved', $7)`,
			[
				`${ids.ownerUser}-member`,
				ids.organization,
				ids.ownerUser,
				`${ids.otherUser}-member`,
				ids.otherOrganization,
				ids.otherUser,
				timestamp,
			],
		);
		await admin.query(
			`insert into employee (id, user_id, organization_id, role, is_active, updated_at) values
			 ($1, $2, $3, 'admin', true, $7), ($4, $5, $6, 'admin', true, $7)`,
			[
				ids.owner,
				ids.ownerUser,
				ids.organization,
				ids.otherEmployee,
				ids.otherUser,
				ids.otherOrganization,
				timestamp,
			],
		);
		await admin.query(
			`insert into project (id, organization_id, name, status, is_active, created_by, updated_at) values
			 ($1, $4, 'T876 project', 'active', true, $6, now()),
			 ($2, $4, 'T876 sibling project', 'active', true, $6, now()),
			 ($3, $5, 'T876 foreign project', 'active', true, $7, now())`,
			[
				ids.project,
				ids.siblingProject,
				ids.otherProject,
				ids.organization,
				ids.otherOrganization,
				ids.ownerUser,
				ids.otherUser,
			],
		);
		await admin.query(
			`insert into project_task (
				id, organization_id, project_id, name, estimate_hours, state, done_at, done_by,
				created_by, updated_at
			 ) values
			 ($1, $5, $7, 'Design', 10, 'open', null, null, $9, now()),
			 ($2, $5, $7, 'Build', null, 'done', now(), $9, $9, now()),
			 ($3, $5, $8, 'Sibling task', 4, 'open', null, null, $9, now()),
			 ($4, $6, $10, 'Foreign task', 4, 'open', null, null, $11, now())`,
			[
				ids.design,
				ids.build,
				ids.siblingTask,
				ids.otherTask,
				ids.organization,
				ids.otherOrganization,
				ids.project,
				ids.siblingProject,
				ids.ownerUser,
				ids.otherProject,
				ids.otherUser,
			],
		);

		const own = { organizationId: ids.organization, employeeId: ids.owner, userId: ids.ownerUser };
		// In the report period: two tasks plus untasked time on the project.
		await book({
			...own,
			projectId: ids.project,
			taskId: ids.design,
			start: "2026-01-05T08:00:00Z",
			minutes: 90,
		});
		await book({
			...own,
			projectId: ids.project,
			taskId: ids.design,
			start: "2026-01-06T08:00:00Z",
			minutes: 60,
		});
		await book({
			...own,
			projectId: ids.project,
			taskId: ids.build,
			start: "2026-01-07T08:00:00Z",
			minutes: 60,
		});
		await book({
			...own,
			projectId: ids.project,
			taskId: null,
			start: "2026-01-08T08:00:00Z",
			minutes: 30,
		});
		// Before the report period: counts towards the estimate only.
		await book({
			...own,
			projectId: ids.project,
			taskId: ids.design,
			start: "2026-01-02T08:00:00Z",
			minutes: 120,
		});
		// Another project and another organization never reach the report.
		await book({
			...own,
			projectId: ids.siblingProject,
			taskId: ids.siblingTask,
			start: "2026-01-06T10:00:00Z",
			minutes: 45,
		});
		await book({
			organizationId: ids.otherOrganization,
			employeeId: ids.otherEmployee,
			userId: ids.otherUser,
			projectId: ids.otherProject,
			taskId: ids.otherTask,
			start: "2026-01-06T10:00:00Z",
			minutes: 240,
		});
	}

	beforeEach(async () => {
		await seed();
	});

	afterAll(async () => {
		await cleanup();
	});

	it("adds the task rows and the No task row up to the report total", async () => {
		const result = await actAs(ids.ownerUser, () =>
			reports.getProjectDetailedReport(ids.project, rangeStart, rangeEnd),
		);

		expect(result.success).toBe(true);
		if (!result.success) return;
		const report = result.data;
		expect(report.summary.totalMinutes).toBe(240);
		expect(report.taskBreakdown.reduce((sum, row) => sum + row.totalMinutes, 0)).toBe(240);
		expect(
			report.taskBreakdown.map((row) => [
				row.taskName,
				row.state,
				row.totalMinutes,
				row.percentOfTotal,
			]),
		).toEqual([
			["Design", "open", 150, 62.5],
			["Build", "done", 60, 25],
			[null, null, 30, 12.5],
		]);
		expect(report.taskBreakdown.at(-1)?.taskId).toBeNull();
	});

	it("shows estimate progress only for a task with an estimate, from all its booked hours", async () => {
		const result = await actAs(ids.ownerUser, () =>
			reports.getProjectDetailedReport(ids.project, rangeStart, rangeEnd),
		);

		expect(result.success).toBe(true);
		if (!result.success) return;
		const byTask = new Map(result.data.taskBreakdown.map((row) => [row.taskId, row]));
		expect(byTask.get(ids.design)?.estimate).toEqual({
			estimateHours: 10,
			bookedHours: 4.5,
			percentUsed: 45,
		});
		expect(byTask.get(ids.build)?.estimate).toBeNull();
		expect(byTask.get(null)?.estimate).toBeNull();
	});
});
