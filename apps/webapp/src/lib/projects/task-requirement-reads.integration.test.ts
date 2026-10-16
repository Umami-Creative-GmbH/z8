/**
 * #884: the active task requirement read from PostgreSQL. The SQL rule and the
 * query helpers must agree with the pure rule: a project requires a task AND
 * has at least one open task, within its own organization only.
 */

import { asc, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { project } from "@/db/schema";
import { integrationAdminPool } from "@/test/integration-database";
import {
	activeTaskRequirementSql,
	listActiveTaskRequirements,
	readActiveTaskRequirement,
} from "./task-requirement-reads";

const ids = {
	organization: "t884r-org",
	otherOrganization: "t884r-other-org",
	user: "t884r-user",
	otherUser: "t884r-other-user",
	required: "e8841000-0000-4000-8000-000000000001",
	requiredNoTasks: "e8841000-0000-4000-8000-000000000002",
	requiredOnlyDone: "e8841000-0000-4000-8000-000000000003",
	notRequired: "e8841000-0000-4000-8000-000000000004",
	foreignRequired: "e8841000-0000-4000-8000-000000000005",
} as const;

describe("active task requirement on PostgreSQL", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	const admin = integrationAdminPool();

	async function cleanup() {
		await admin.query("delete from organization where id in ($1, $2)", [
			ids.organization,
			ids.otherOrganization,
		]);
		await admin.query('delete from "user" where id in ($1, $2)', [ids.user, ids.otherUser]);
	}

	beforeEach(async () => {
		await cleanup();
		await admin.query(
			`insert into organization (id, name, slug, created_at) values
			 ($1, 'T884 reads', $1, now()), ($2, 'T884 other', $2, now())`,
			[ids.organization, ids.otherOrganization],
		);
		await admin.query(
			`insert into "user" (id, name, email, created_at, updated_at) values
			 ($1, $1, $1 || '@example.test', now(), now()), ($2, $2, $2 || '@example.test', now(), now())`,
			[ids.user, ids.otherUser],
		);
		await admin.query(
			`insert into project (id, organization_id, name, status, requires_task, created_by, updated_at) values
			 ($1, $6, 'Required', 'active', true, $8, now()),
			 ($2, $6, 'Required, no tasks', 'active', true, $8, now()),
			 ($3, $6, 'Required, only done tasks', 'active', true, $8, now()),
			 ($4, $6, 'Not required', 'active', false, $8, now()),
			 ($5, $7, 'Foreign required', 'active', true, $9, now())`,
			[
				ids.required,
				ids.requiredNoTasks,
				ids.requiredOnlyDone,
				ids.notRequired,
				ids.foreignRequired,
				ids.organization,
				ids.otherOrganization,
				ids.user,
				ids.otherUser,
			],
		);
		await admin.query(
			`insert into project_task (organization_id, project_id, name, state, done_at, done_by, created_by, updated_at) values
			 ($1, $2, 'Open', 'open', null, null, $6, now()),
			 ($1, $2, 'Done', 'done', now(), $6, $6, now()),
			 ($1, $3, 'Done', 'done', now(), $6, $6, now()),
			 ($1, $4, 'Open', 'open', null, null, $6, now()),
			 ($7, $5, 'Open', 'open', null, null, $8, now())`,
			[
				ids.organization,
				ids.required,
				ids.requiredOnlyDone,
				ids.notRequired,
				ids.foreignRequired,
				ids.user,
				ids.otherOrganization,
				ids.otherUser,
			],
		);
	});

	afterAll(cleanup);

	it("reads one project: active only with the requirement and an open task", async () => {
		const read = (projectId: string) =>
			readActiveTaskRequirement({ organizationId: ids.organization, projectId });

		expect(await read(ids.required)).toBe(true);
		expect(await read(ids.requiredNoTasks)).toBe(false);
		expect(await read(ids.requiredOnlyDone)).toBe(false);
		expect(await read(ids.notRequired)).toBe(false);
	});

	it("never answers for another organization's project", async () => {
		expect(
			await readActiveTaskRequirement({
				organizationId: ids.organization,
				projectId: ids.foreignRequired,
			}),
		).toBe(false);
		expect(
			await listActiveTaskRequirements({
				organizationId: ids.organization,
				projectIds: [ids.required, ids.foreignRequired],
			}),
		).toEqual(new Set([ids.required]));
	});

	it("lists the projects of a set whose requirement is active", async () => {
		expect(
			await listActiveTaskRequirements({
				organizationId: ids.organization,
				projectIds: [ids.required, ids.requiredNoTasks, ids.requiredOnlyDone, ids.notRequired],
			}),
		).toEqual(new Set([ids.required]));
		expect(
			await listActiveTaskRequirements({ organizationId: ids.organization, projectIds: [] }),
		).toEqual(new Set());
	});

	it("gives the same rule as a SQL expression for any query, also one over projects", async () => {
		const rows = await db
			.select({
				id: project.id,
				active: activeTaskRequirementSql({
					projectId: project.id,
					organizationId: project.organizationId,
				}),
			})
			.from(project)
			.where(eq(project.organizationId, ids.organization))
			.orderBy(asc(project.id));

		expect(Object.fromEntries(rows.map((row) => [row.id, row.active]))).toEqual({
			[ids.required]: true,
			[ids.requiredNoTasks]: false,
			[ids.requiredOnlyDone]: false,
			[ids.notRequired]: false,
		});
	});

	it("lapses when the last open task is done, and applies again when it reopens", async () => {
		const read = () =>
			readActiveTaskRequirement({ organizationId: ids.organization, projectId: ids.required });
		await admin.query(
			`update project_task set state = 'done', done_at = now(), done_by = $2
			 where project_id = $1 and state = 'open'`,
			[ids.required, ids.user],
		);
		expect(await read()).toBe(false);

		await admin.query(
			`update project_task set state = 'open', done_at = null, done_by = null
			 where project_id = $1 and name = 'Open'`,
			[ids.required],
		);
		expect(await read()).toBe(true);
	});
});
