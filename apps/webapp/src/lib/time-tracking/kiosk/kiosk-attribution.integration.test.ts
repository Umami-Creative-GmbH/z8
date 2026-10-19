/**
 * #887: project and work-category selection at an online kiosk clock-out, on
 * PostgreSQL, through the kiosk endpoints' service. After the PIN, a clocked-in
 * employee's status names the choices their booking eligibility offers; the
 * clock-out keeps, replaces or clears either, and Clocking checks each choice
 * again before anything is written, in both admissions.
 *
 * Local contract: pnpm --filter webapp test:integration
 *
 * The work transactions are the real coordinated adapter, follow-ups are
 * recorded, and the PIN check is the real one. Only billing provisioning and the
 * Next request/cache boundaries are replaced.
 */

import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { type Instant, parseInstant } from "@/lib/datetime/temporal-core";
import { integrationAdminPool } from "@/test/integration-database";

vi.mock("next/server", async (importOriginal) =>
	(await import("@/test/integration-harness")).nextServer(importOriginal),
);
vi.mock("next/headers", async () => (await import("@/test/integration-harness")).nextHeaders());
vi.mock("next/cache", async (importOriginal) =>
	(await import("@/test/integration-harness")).nextCache(importOriginal),
);
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: async () => null } } }));
vi.mock("@/lib/billing/guard", async () =>
	(await import("@/test/integration-harness")).billingGuard(),
);

const { createClocking } = await import("@/lib/time-tracking/clocking/clocking");
const { recordingFollowUps } = await import("@/lib/time-tracking/clocking/follow-ups");
const { coordinatedTransactions } = await import("@/lib/time-tracking/clocking/transactions");
const { setOwnKioskPin } = await import("@/lib/time-tracking/kiosk/pin-store");
const { hashKioskSecret } = await import("./credentials");
const { KIOSK_TOKEN_HEADER } = await import("./protocol");
const { createKioskClockService } = await import("./clock-service");

const ids = {
	organization: "t887-kiosk-org",
	otherOrganization: "t887-kiosk-other-org",
	workerUser: "t887-worker-user",
	kioskOnlyUser: "t887-kiosk-only-user",
	managerUser: "t887-manager-user",
	foreignUser: "t887-foreign-user",
	worker: "f8870000-0000-4000-8000-000000000001",
	kioskOnly: "f8870000-0000-4000-8000-000000000002",
	manager: "f8870000-0000-4000-8000-000000000003",
	foreign: "f8870000-0000-4000-8000-000000000004",
	team: "f8870000-0000-4000-8000-000000000005",
	store: "f8870000-0000-4000-8000-000000000011",
	foreignStore: "f8870000-0000-4000-8000-000000000012",
	kiosk: "f8870000-0000-4000-8000-000000000021",
	/** Assigned to the worker directly. */
	direct: "f8870000-0000-4000-8000-000000000031",
	/** Assigned to the worker's team. */
	teamProject: "f8870000-0000-4000-8000-000000000032",
	/** Assigned to nobody the worker belongs to. */
	unassigned: "f8870000-0000-4000-8000-000000000033",
	/** Assigned to the worker, but completed: not bookable. */
	completed: "f8870000-0000-4000-8000-000000000034",
	/** Another organization's project, assigned to that organization's employee. */
	foreignProject: "f8870000-0000-4000-8000-000000000035",
	categorySet: "f8870000-0000-4000-8000-000000000041",
	travel: "f8870000-0000-4000-8000-000000000042",
	training: "f8870000-0000-4000-8000-000000000043",
	/** Inactive, though still in the set. */
	retired: "f8870000-0000-4000-8000-000000000044",
	/** Active, but in no set the worker has. */
	outsideSet: "f8870000-0000-4000-8000-000000000045",
	foreignCategory: "f8870000-0000-4000-8000-000000000046",
} as const;
const users = [ids.workerUser, ids.kioskOnlyUser, ids.managerUser, ids.foreignUser];
const TOKEN = "z8k_t887-store-kiosk-token";
const PIN = "4711";

describe("kiosk project and work-category selection on PostgreSQL (#887)", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	const admin = integrationAdminPool();
	let now: Instant = parseInstant("2026-07-22T06:00:00Z");

	function newService() {
		const clock = { nowInstant: () => now };
		const clocking = createClocking({
			clock: clock as never,
			transactions: coordinatedTransactions(),
			followUps: recordingFollowUps(),
		});
		return createKioskClockService({
			clocking,
			clock,
			limitPinAttempts: async () => ({ allowed: true, retryAfter: 0 }),
			limitBadgeAttempts: async () => ({ allowed: true, retryAfter: 0 }),
			limitOutcomeLookups: async () => ({ allowed: true, retryAfter: 0 }),
		});
	}

	function kioskRequest(path: string, body: unknown) {
		return new Request(`http://localhost/api/kiosk/${path}`, {
			method: "POST",
			headers: { "content-type": "application/json", [KIOSK_TOKEN_HEADER]: TOKEN },
			body: JSON.stringify(body),
		});
	}

	async function clock(body: Record<string, unknown>) {
		const response = await newService().clock(
			kioskRequest("clock", { employeeId: ids.worker, pin: PIN, ...body }),
		);
		return { status: response.status, body: await response.json() };
	}

	async function status(employeeId: string = ids.worker) {
		const response = await newService().status(
			kioskRequest("employee-status", { employeeId, pin: PIN }),
		);
		return { status: response.status, body: await response.json() };
	}

	async function setAdmission(mode: "active" | "inactive") {
		await admin.query(
			`insert into time_entry_append_control (organization_id, mode) values ($1, $2)
			 on conflict (organization_id) do update set mode = excluded.mode, updated_at = now()`,
			[ids.organization, mode],
		);
	}

	/** The worker's work and, when it has one, its canonical record and project allocation. */
	async function work(employeeId: string = ids.worker) {
		const { rows } = await admin.query<{
			end_time: Date | null;
			project_id: string | null;
			work_category_id: string | null;
			missing_task: boolean;
			record_work_category_id: string | null;
			allocation_project_id: string | null;
		}>(
			`select p.end_time, p.project_id, p.work_category_id, p.missing_task,
			        r.work_category_id as record_work_category_id,
			        a.project_id as allocation_project_id
			 from work_period p
			 left join time_record_work r
			   on r.record_id = p.canonical_record_id and r.organization_id = p.organization_id
			 left join time_record_allocation a
			   on a.record_id = p.canonical_record_id and a.organization_id = p.organization_id
			  and a.allocation_kind = 'project'
			 where p.employee_id = $1 order by p.start_time`,
			[employeeId],
		);
		return rows;
	}

	async function clockOutCount(employeeId: string = ids.worker) {
		const { rows } = await admin.query<{ count: string }>(
			"select count(*) from time_entry where employee_id = $1 and type = 'clock_out'",
			[employeeId],
		);
		return Number(rows[0]?.count);
	}

	/** Clocks the worker in and books the live work to the direct project and travel. */
	async function clockInOnDirectTravel(employeeId: string = ids.worker) {
		const response = await newService().clock(
			kioskRequest("clock", { employeeId, pin: PIN, action: "clock_in" }),
		);
		expect(response.status).toBe(200);
		await admin.query(
			"update work_period set project_id = $2, work_category_id = $3 where employee_id = $1",
			[employeeId, ids.direct, ids.travel],
		);
		now = parseInstant("2026-07-22T10:00:00Z");
	}

	async function cleanup() {
		await admin.query("delete from organization where id in ($1, $2)", [
			ids.organization,
			ids.otherOrganization,
		]);
		await admin.query('delete from "user" where id = any($1::text[])', [users]);
	}

	async function seed() {
		await cleanup();
		const timestamp = new Date("2026-07-01T00:00:00Z");
		await admin.query(
			`insert into organization (id, name, slug, timezone, projects_enabled, created_at) values
			 ($1, 'T887 kiosk', $1, 'Europe/Berlin', true, $3), ($2, 'T887 other', $2, 'UTC', true, $3)`,
			[ids.organization, ids.otherOrganization, timestamp],
		);
		await admin.query(
			`insert into approval_workflow_rollout
			 (organization_id, workflow_type, lifecycle_mode, side_effect_mode, created_at, updated_at)
			 values ($1, 'policy_clock_out', 'legacy', 'legacy', $2, $2)`,
			[ids.organization, timestamp],
		);
		await admin.query(
			`insert into "user" (id, name, email, created_at, updated_at) values
			 ($1, 'Wanda Worker', 't887-worker@example.test', $5, $5),
			 ($2, 'Kim Kiosk', 'kiosk-t887@kiosk.invalid', $5, $5),
			 ($3, 'Mona Manager', 't887-manager@example.test', $5, $5),
			 ($4, 'Fay Foreign', 't887-foreign@example.test', $5, $5)`,
			[...users, timestamp],
		);
		await admin.query(
			`insert into member (id, organization_id, user_id, role, status, created_at) values
			 ('t887-m-worker', $1, $3, 'member', 'approved', $7),
			 ('t887-m-kiosk-only', $1, $4, 'member', 'approved', $7),
			 ('t887-m-manager', $1, $5, 'admin', 'approved', $7),
			 ('t887-m-foreign', $2, $6, 'owner', 'approved', $7)`,
			[
				ids.organization,
				ids.otherOrganization,
				ids.workerUser,
				ids.kioskOnlyUser,
				ids.managerUser,
				ids.foreignUser,
				timestamp,
			],
		);
		await admin.query(
			"insert into team (id, organization_id, name, updated_at) values ($1, $2, 'Crew', $3)",
			[ids.team, ids.organization, timestamp],
		);
		await admin.query(
			`insert into employee (id, user_id, organization_id, team_id, role, is_active, updated_at) values
			 ($1, $2, $9, $11, 'employee', true, $12),
			 ($3, $4, $9, $11, 'employee', true, $12),
			 ($5, $6, $9, null, 'admin', true, $12),
			 ($7, $8, $10, null, 'admin', true, $12)`,
			[
				ids.worker,
				ids.workerUser,
				ids.kioskOnly,
				ids.kioskOnlyUser,
				ids.manager,
				ids.managerUser,
				ids.foreign,
				ids.foreignUser,
				ids.organization,
				ids.otherOrganization,
				ids.team,
				timestamp,
			],
		);
		await admin.query(
			`insert into user_settings (user_id, timezone, updated_at)
			 select user_id, 'UTC', $2 from unnest($1::text[]) as user_id`,
			[users, timestamp],
		);
		await admin.query(
			`insert into location (id, organization_id, name, created_by, updated_at) values
			 ($1, $3, 'Store', $5, $6), ($2, $4, 'Foreign store', $7, $6)`,
			[
				ids.store,
				ids.foreignStore,
				ids.organization,
				ids.otherOrganization,
				ids.managerUser,
				timestamp,
				ids.foreignUser,
			],
		);
		await admin.query(
			`insert into kiosk (id, organization_id, location_id, name, timezone, token_hash, paired_at,
			                    created_by, updated_at)
			 values ($1, $2, $3, 'Store kiosk', 'Europe/Berlin', $4, $5, $6, $5)`,
			[ids.kiosk, ids.organization, ids.store, hashKioskSecret(TOKEN), timestamp, ids.managerUser],
		);
		await admin.query(
			`insert into employee_assigned_location (organization_id, employee_id, location_id) values
			 ($1, $2, $4), ($1, $3, $4)`,
			[ids.organization, ids.worker, ids.kioskOnly, ids.store],
		);
		for (const userId of [ids.workerUser, ids.kioskOnlyUser]) {
			await setOwnKioskPin(db, { organizationId: ids.organization, userId, pin: PIN });
		}

		await admin.query(
			`insert into project (id, organization_id, name, status, is_active, created_by, updated_at) values
			 ($1, $6, 'Shop fitting', 'active', true, $8, $9),
			 ($2, $6, 'Anniversary sale', 'planned', true, $8, $9),
			 ($3, $6, 'Unassigned', 'active', true, $8, $9),
			 ($4, $6, 'Completed', 'completed', true, $8, $9),
			 ($5, $7, 'Foreign', 'active', true, $10, $9)`,
			[
				ids.direct,
				ids.teamProject,
				ids.unassigned,
				ids.completed,
				ids.foreignProject,
				ids.organization,
				ids.otherOrganization,
				ids.managerUser,
				timestamp,
				ids.foreignUser,
			],
		);
		await admin.query(
			`insert into project_assignment (project_id, organization_id, assignment_type, team_id, employee_id, created_by) values
			 ($1, $5, 'employee', null, $7, $9),
			 ($2, $5, 'team', $8, null, $9),
			 ($3, $5, 'employee', null, $7, $9),
			 ($4, $6, 'employee', null, $10, $11)`,
			[
				ids.direct,
				ids.teamProject,
				ids.completed,
				ids.foreignProject,
				ids.organization,
				ids.otherOrganization,
				ids.worker,
				ids.team,
				ids.managerUser,
				ids.foreign,
				ids.foreignUser,
			],
		);
		await admin.query(
			`insert into work_category (id, organization_id, name, is_active, created_by, updated_at) values
			 ($1, $6, 'Travel', true, $8, $9),
			 ($2, $6, 'Training', true, $8, $9),
			 ($3, $6, 'Retired', false, $8, $9),
			 ($4, $6, 'Outside the set', true, $8, $9),
			 ($5, $7, 'Foreign', true, $10, $9)`,
			[
				ids.travel,
				ids.training,
				ids.retired,
				ids.outsideSet,
				ids.foreignCategory,
				ids.organization,
				ids.otherOrganization,
				ids.managerUser,
				timestamp,
				ids.foreignUser,
			],
		);
		await admin.query(
			`insert into work_category_set (id, organization_id, name, created_by, updated_at)
			 values ($1, $2, 'Standard', $3, $4)`,
			[ids.categorySet, ids.organization, ids.managerUser, timestamp],
		);
		await admin.query(
			`insert into work_category_set_category (set_id, category_id, sort_order) values
			 ($1, $2, 0), ($1, $3, 1), ($1, $4, 2)`,
			[ids.categorySet, ids.travel, ids.training, ids.retired],
		);
		await admin.query(
			`insert into work_category_set_assignment
			 (set_id, organization_id, assignment_type, priority, created_by, updated_at)
			 values ($1, $2, 'organization', 0, $3, $4)`,
			[ids.categorySet, ids.organization, ids.managerUser, timestamp],
		);
	}

	beforeEach(async () => {
		now = parseInstant("2026-07-22T06:00:00Z");
		await seed();
	});

	afterAll(async () => {
		await cleanup();
	});

	describe("choices after the PIN", () => {
		it("names the clocked-in employee's bookable projects and categories, and what the work keeps", async () => {
			await clockInOnDirectTravel();

			const answer = await status();

			expect(answer.status).toBe(200);
			expect(answer.body.attribution).toEqual({
				project: {
					current: { id: ids.direct, name: "Shop fitting" },
					// Direct and team assignments, by name; never unassigned, completed or foreign.
					options: [
						{ id: ids.teamProject, name: "Anniversary sale" },
						{ id: ids.direct, name: "Shop fitting" },
					],
				},
				workCategory: {
					current: { id: ids.travel, name: "Travel" },
					// The effective set's active categories, in the set's order.
					options: [
						{ id: ids.travel, name: "Travel" },
						{ id: ids.training, name: "Training" },
					],
				},
			});
		});

		it("offers a kiosk-only employee their own choices", async () => {
			await clockInOnDirectTravel(ids.kioskOnly);

			const answer = await status(ids.kioskOnly);

			// Not assigned the direct project, which the work still keeps.
			expect(answer.body.attribution.project).toEqual({
				current: { id: ids.direct, name: "Shop fitting" },
				options: [{ id: ids.teamProject, name: "Anniversary sale" }],
			});
			expect(answer.body.attribution.workCategory.options).toHaveLength(2);
		});

		it("asks nothing while clocked out or on a break", async () => {
			expect((await status()).body).not.toHaveProperty("attribution");
			await clockInOnDirectTravel();
			await clock({ action: "start_break" });

			const answer = await status();

			expect(answer.body.state.status).toBe("on_break");
			expect(answer.body).not.toHaveProperty("attribution");
		});

		it("asks nothing when the work has no attribution and nothing is offered", async () => {
			await admin.query("delete from project_assignment where organization_id = $1", [
				ids.organization,
			]);
			await admin.query("delete from work_category_set_assignment where organization_id = $1", [
				ids.organization,
			]);
			await clock({ action: "clock_in" });

			expect((await status()).body).not.toHaveProperty("attribution");
		});

		it("asks no project while the organization has projects off", async () => {
			await admin.query("update organization set projects_enabled = false where id = $1", [
				ids.organization,
			]);
			await clockInOnDirectTravel();

			expect((await status()).body.attribution).toEqual({
				workCategory: expect.objectContaining({ current: { id: ids.travel, name: "Travel" } }),
			});
		});
	});

	describe.each([
		["legacy", "inactive"],
		["append", "active"],
	] as const)("clock-out under %s admission", (_admission, mode) => {
		beforeEach(async () => {
			await setAdmission(mode);
		});

		it("books the ended work to the chosen project and category, in its canonical record too", async () => {
			await clockInOnDirectTravel();

			const response = await clock({
				action: "clock_out",
				project: ids.teamProject,
				workCategory: ids.training,
			});

			expect(response).toMatchObject({
				status: 200,
				body: { outcome: "executed", state: { status: "clocked_out" } },
			});
			expect(await work()).toEqual([
				expect.objectContaining({
					end_time: expect.any(Date),
					project_id: ids.teamProject,
					work_category_id: ids.training,
					record_work_category_id: ids.training,
					allocation_project_id: ids.teamProject,
				}),
			]);
		});

		it("clears either field only when asked, and keeps the other", async () => {
			await clockInOnDirectTravel();

			await clock({ action: "clock_out", project: null });

			expect(await work()).toEqual([
				expect.objectContaining({
					project_id: null,
					work_category_id: ids.travel,
					record_work_category_id: ids.travel,
					allocation_project_id: null,
				}),
			]);
		});

		it("keeps attribution that is no longer offered when the clock-out names none", async () => {
			await clockInOnDirectTravel();
			// Neither the project nor the category may be chosen any more.
			await admin.query("update project set status = 'completed' where id = $1", [ids.direct]);
			await admin.query("update work_category set is_active = false where id = $1", [ids.travel]);

			await expect(clock({ action: "clock_out" })).resolves.toMatchObject({ status: 200 });

			expect(await work()).toEqual([
				expect.objectContaining({
					end_time: expect.any(Date),
					project_id: ids.direct,
					work_category_id: ids.travel,
				}),
			]);
		});

		it.each([
			["an unassigned project", { project: ids.unassigned }, "project_not_allowed"],
			["a completed project", { project: ids.completed }, "project_not_allowed"],
			["another organization's project", { project: ids.foreignProject }, "project_not_allowed"],
			["a made-up project", { project: randomUUID() }, "project_not_allowed"],
			["an inactive category", { workCategory: ids.retired }, "work_category_not_allowed"],
			["a category outside the set", { workCategory: ids.outsideSet }, "work_category_not_allowed"],
			[
				"another organization's category",
				{ workCategory: ids.foreignCategory },
				"work_category_not_allowed",
			],
			[
				"a good project beside a refused category",
				{ project: ids.teamProject, workCategory: ids.foreignCategory },
				"work_category_not_allowed",
			],
		])("refuses %s and leaves the work running untouched", async (_case, choice, code) => {
			await clockInOnDirectTravel();

			const response = await clock({ action: "clock_out", ...choice });

			expect(response).toMatchObject({
				status: 409,
				body: { code, state: { status: "clocked_in" } },
			});
			expect(await work()).toEqual([
				expect.objectContaining({
					end_time: null,
					project_id: ids.direct,
					work_category_id: ids.travel,
				}),
			]);
			expect(await clockOutCount()).toBe(0);
		});

		it("refuses a choice that lost its eligibility after the PIN, and keeping then works", async () => {
			await clockInOnDirectTravel();
			const offered = await status();
			expect(offered.body.attribution.project.options).toContainEqual({
				id: ids.teamProject,
				name: "Anniversary sale",
			});
			await admin.query("delete from project_assignment where project_id = $1", [ids.teamProject]);

			const refused = await clock({ action: "clock_out", project: ids.teamProject });
			const kept = await clock({ action: "clock_out" });

			expect(refused).toMatchObject({ status: 409, body: { code: "project_not_allowed" } });
			expect(kept).toMatchObject({ status: 200, body: { outcome: "executed" } });
			expect(await work()).toEqual([
				expect.objectContaining({ end_time: expect.any(Date), project_id: ids.direct }),
			]);
		});

		it("replays a retried clock-out with its choices instead of closing or booking twice", async () => {
			await clockInOnDirectTravel();
			const operationId = randomUUID();
			const choice = { project: ids.teamProject, workCategory: null };

			const first = await clock({ action: "clock_out", operationId, ...choice });
			now = parseInstant("2026-07-22T10:01:00Z");
			const retry = await clock({ action: "clock_out", operationId, ...choice });

			expect(first.body.outcome).toBe("executed");
			expect(retry).toMatchObject({
				status: 200,
				body: {
					outcome: "replayed",
					at: { instant: "2026-07-22T10:00:00Z" },
					state: { status: "clocked_out" },
				},
			});
			expect(await clockOutCount()).toBe(1);
			expect(await work()).toEqual([
				expect.objectContaining({ project_id: ids.teamProject, work_category_id: null }),
			]);
		});

		it("never applies other choices under a committed clock-out's operation", async () => {
			await clockInOnDirectTravel();
			const operationId = randomUUID();
			await clock({ action: "clock_out", operationId, project: ids.teamProject });

			const other = await clock({ action: "clock_out", operationId, project: null });

			expect(other.body.outcome).not.toBe("executed");
			expect(await clockOutCount()).toBe(1);
			expect(await work()).toEqual([expect.objectContaining({ project_id: ids.teamProject })]);
		});

		// Nobody at a kiosk picks a task (#884): the chosen project is booked and the work marked.
		it("books a chosen project that requires a task without one, and marks the work", async () => {
			await admin.query("update project set requires_task = true where id = $1", [ids.teamProject]);
			await admin.query(
				`insert into project_task (id, organization_id, project_id, name, state, created_by, updated_at)
				 values ($1, $2, $3, 'Window display', 'open', $4, now())`,
				[randomUUID(), ids.organization, ids.teamProject, ids.managerUser],
			);
			await clockInOnDirectTravel();

			await expect(clock({ action: "clock_out", project: ids.teamProject })).resolves.toMatchObject(
				{ status: 200, body: { outcome: "executed" } },
			);
			expect(await work()).toEqual([
				expect.objectContaining({
					project_id: ids.teamProject,
					missing_task: true,
					allocation_project_id: ids.teamProject,
				}),
			]);
		});
	});

	describe("requests", () => {
		it.each([
			["clock_in", { project: ids.direct }],
			["start_break", { workCategory: ids.travel }],
			["break", { breakMinutes: 30, project: null }],
			["resume_break", { workCategory: null }],
		])("refuses choices beside %s", async (action, choice) => {
			await clockInOnDirectTravel();

			await expect(clock({ action, ...choice })).resolves.toEqual({
				status: 400,
				body: { code: "invalid_request" },
			});
		});

		it("refuses a choice that is not an ID", async () => {
			await clockInOnDirectTravel();

			await expect(clock({ action: "clock_out", project: "Shop fitting" })).resolves.toEqual({
				status: 400,
				body: { code: "invalid_request" },
			});
			expect(await clockOutCount()).toBe(0);
		});
	});
});
