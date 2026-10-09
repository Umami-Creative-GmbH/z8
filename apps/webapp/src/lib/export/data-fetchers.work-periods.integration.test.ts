/**
 * #876 runtime evidence: the data export's work period rows carry the
 * project and the task.
 *
 * Local contract: pnpm --filter webapp test:integration
 * The runner creates, migrates, verifies, and removes a label-owned PostgreSQL 16 database.
 */

import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { integrationAdminPool } from "@/test/integration-database";

vi.mock("@/lib/logger", async (importOriginal) => {
	const original = await importOriginal<typeof import("@/lib/logger")>();
	const quiet = { error: () => {}, warn: () => {}, info: () => {}, debug: () => {} };
	return {
		...original,
		logger: { ...original.logger, ...quiet },
		createLogger: () => ({ ...original.logger, ...quiet }),
	};
});

const { fetchWorkPeriods } = await import("./data-fetchers");

const ids = {
	organization: "t876-export-org",
	otherOrganization: "t876-export-other-org",
	user: "t876-export-user",
	otherUser: "t876-export-other-user",
	employee: "e8761000-0000-4000-8000-000000000001",
	otherEmployee: "e8761000-0000-4000-8000-000000000002",
	project: "e8761000-0000-4000-8000-000000000020",
	otherProject: "e8761000-0000-4000-8000-000000000021",
	task: "e8761000-0000-4000-8000-000000000030",
	otherTask: "e8761000-0000-4000-8000-000000000031",
	taskPeriod: "e8761000-0000-4000-8000-000000000040",
	projectPeriod: "e8761000-0000-4000-8000-000000000041",
	plainPeriod: "e8761000-0000-4000-8000-000000000042",
	otherPeriod: "e8761000-0000-4000-8000-000000000043",
} as const;

describe("the work period export rows on PostgreSQL", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	const admin = integrationAdminPool();

	async function cleanup() {
		await admin.query("delete from organization where id in ($1, $2)", [
			ids.organization,
			ids.otherOrganization,
		]);
		await admin.query('delete from "user" where id in ($1, $2)', [ids.user, ids.otherUser]);
	}

	async function period(input: {
		id: string;
		organizationId: string;
		employeeId: string;
		userId: string;
		projectId: string | null;
		taskId: string | null;
	}) {
		const clockInId = randomUUID();
		const start = new Date("2026-01-05T08:00:00Z");
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
			 ) values ($1, $2, $3, $4, $5, $6, $7::timestamptz, $7::timestamptz + interval '1 hour', 60,
			   false, $7::timestamptz)`,
			[
				input.id,
				input.employeeId,
				input.organizationId,
				clockInId,
				input.projectId,
				input.taskId,
				start,
			],
		);
	}

	async function seed() {
		await cleanup();
		const timestamp = new Date("2026-01-01T00:00:00Z");
		await admin.query(
			`insert into organization (id, name, slug, timezone, created_at) values
			 ($1, 'T876 export', $1, 'UTC', $3), ($2, 'T876 export other', $2, 'UTC', $3)`,
			[ids.organization, ids.otherOrganization, timestamp],
		);
		await admin.query(
			`insert into "user" (id, name, email, created_at, updated_at) values
			 ($1, $1, $1 || '@example.test', $3, $3), ($2, $2, $2 || '@example.test', $3, $3)`,
			[ids.user, ids.otherUser, timestamp],
		);
		await admin.query(
			`insert into employee (id, user_id, organization_id, role, is_active, updated_at) values
			 ($1, $2, $3, 'admin', true, $7), ($4, $5, $6, 'admin', true, $7)`,
			[
				ids.employee,
				ids.user,
				ids.organization,
				ids.otherEmployee,
				ids.otherUser,
				ids.otherOrganization,
				timestamp,
			],
		);
		await admin.query(
			`insert into project (id, organization_id, name, status, is_active, created_by, updated_at) values
			 ($1, $3, 'T876 website', 'active', true, $5, now()),
			 ($2, $4, 'T876 foreign project', 'active', true, $6, now())`,
			[
				ids.project,
				ids.otherProject,
				ids.organization,
				ids.otherOrganization,
				ids.user,
				ids.otherUser,
			],
		);
		await admin.query(
			`insert into project_task (id, organization_id, project_id, name, created_by, updated_at) values
			 ($1, $3, $5, 'Design', $7, now()), ($2, $4, $6, 'Foreign task', $8, now())`,
			[
				ids.task,
				ids.otherTask,
				ids.organization,
				ids.otherOrganization,
				ids.project,
				ids.otherProject,
				ids.user,
				ids.otherUser,
			],
		);
		const own = { organizationId: ids.organization, employeeId: ids.employee, userId: ids.user };
		await period({ ...own, id: ids.taskPeriod, projectId: ids.project, taskId: ids.task });
		await period({ ...own, id: ids.projectPeriod, projectId: ids.project, taskId: null });
		await period({ ...own, id: ids.plainPeriod, projectId: null, taskId: null });
		await period({
			id: ids.otherPeriod,
			organizationId: ids.otherOrganization,
			employeeId: ids.otherEmployee,
			userId: ids.otherUser,
			projectId: ids.otherProject,
			taskId: ids.otherTask,
		});
	}

	beforeEach(async () => {
		await seed();
	});

	afterAll(async () => {
		await cleanup();
	});

	it("names the project and task of each period, empty when there is none", async () => {
		const rows = await fetchWorkPeriods(ids.organization);

		const byId = new Map(
			rows.map((row) => [
				row.id,
				[row.projectId, row.projectName, row.taskId, row.taskName] as const,
			]),
		);
		expect([...byId.keys()].sort()).toEqual(
			[ids.taskPeriod, ids.projectPeriod, ids.plainPeriod].sort(),
		);
		expect(byId.get(ids.taskPeriod)).toEqual([ids.project, "T876 website", ids.task, "Design"]);
		expect(byId.get(ids.projectPeriod)).toEqual([ids.project, "T876 website", null, null]);
		expect(byId.get(ids.plainPeriod)).toEqual([null, null, null, null]);
	});
});
