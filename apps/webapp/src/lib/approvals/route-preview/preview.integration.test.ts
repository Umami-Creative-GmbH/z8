/**
 * #1600: the approval route preview's snapshot loader on real rows. It reads each organization's
 * inputs once at an explicit instant, decides departures at that instant rather than at the
 * database's current time, reads a departed named approver's stand-in per requester, and writes
 * nothing (Organization ADR 0007).
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { readOnlyTransaction } from "@/db/read-only-transaction";
import { systemClock } from "@/lib/datetime/temporal-core";
import type { DatabaseClient } from "@/lib/effect/services/database.service";
import {
	createLifecycleDatabaseFixture,
	type LifecycleDatabaseFixture,
} from "@/lib/employee-lifecycle/testing/database.test.fixture";
import { previewApprovalRoutes } from "./preview";
import { loadApprovalRouteSnapshot } from "./snapshot";
import type { ApprovalRouteRequester } from "./types";

describe("approval route preview (PostgreSQL)", () => {
	let fixture: LifecycleDatabaseFixture;
	let db: DatabaseClient;
	let organizationId: string;
	let owner: { employeeId: string; userId: string };

	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();
		db = fixture.db as unknown as DatabaseClient;
	});

	afterAll(async () => {
		await fixture?.close();
	});

	beforeEach(async () => {
		organizationId = await fixture.createOrganization();
		owner = await fixture.seedEmployee({ organizationId, role: "owner" });
	});

	const sql = (text: string, values: unknown[] = []) => fixture.pool.query(text, values);

	async function seed(role: "employee" | "manager" | "admin" = "employee") {
		const seeded = await fixture.seedEmployee({ organizationId });
		await sql(`update employee set role = $1 where id = $2`, [role, seeded.employeeId]);
		return seeded;
	}

	async function managedBy(employeeId: string, managerId: string) {
		await sql(
			`insert into employee_managers (employee_id, manager_id, is_primary, assigned_by)
			 values ($1, $2, true, $3)`,
			[employeeId, managerId, owner.userId],
		);
	}

	async function canonicalAbsences() {
		await sql(
			`insert into approval_workflow_rollout (organization_id, workflow_type, lifecycle_mode, side_effect_mode, updated_at)
			 values ($1, 'absence', 'canonical', 'canonical', now())`,
			[organizationId],
		);
		await sql(
			`insert into absence_category (organization_id, type, name, requires_approval, updated_at)
			 values ($1, 'vacation', $2, true, now())`,
			[organizationId, `Category ${randomUUID()}`],
		);
	}

	const employee = (employeeId: string): ApprovalRouteRequester => ({
		kind: "employee",
		employeeId,
	});

	it("decides a departure at the given instant, though the database's clock is still before it", async () => {
		await canonicalAbsences();
		await sql(`update organization set shifts_enabled = true where id = $1`, [organizationId]);
		await sql(`update employee set role = 'employee' where id = $1`, [owner.employeeId]);
		const manager = await seed("manager");
		const subject = await seed();
		await managedBy(subject.employeeId, manager.employeeId);
		const now = systemClock.nowInstant();
		const cutoff = now.add({ hours: 24 * 10 });
		const later = now.add({ hours: 24 * 20 });
		const { rows: periods } = await sql(
			"select id from employee_employment_period where employee_id = $1 limit 1",
			[manager.employeeId],
		);
		// Pending, cut off ten days from now: the manager still works here today.
		await sql(
			`insert into employee_departure
			 (organization_id, employee_id, employment_period_id, mode, last_working_day, timezone,
			  cutoff_at, revision, status, created_by, request_id, request_fingerprint)
			 values ($1, $2, $3, 'scheduled', ($4::timestamptz - interval '1 day')::date, 'UTC', $4,
			  1, 'pending', $5, $6, 'fp')`,
			[
				organizationId,
				manager.employeeId,
				periods[0]?.id,
				cutoff.toString(),
				owner.userId,
				randomUUID(),
			],
		);

		const today = await readOnlyTransaction(db, (reader) =>
			loadApprovalRouteSnapshot(reader, { organizationId, at: now }),
		);
		const afterCutoff = await readOnlyTransaction(db, (reader) =>
			loadApprovalRouteSnapshot(reader, { organizationId, at: later }),
		);

		const activeIn = (snapshot: typeof today) =>
			snapshot.stageDirectory.employees.find((row) => row.id === manager.employeeId)?.isActive;
		expect(activeIn(today)).toBe(true);
		expect(activeIn(afterCutoff)).toBe(false);
		expect(today.roster.map((row) => row.id)).toContain(manager.employeeId);
		expect(afterCutoff.roster.map((row) => row.id)).not.toContain(manager.employeeId);

		const routeAt = async (at: typeof now) =>
			(
				await previewApprovalRoutes(db, {
					organizationId,
					at,
					requesters: [employee(subject.employeeId)],
				})
			).routes.get(`employee:${subject.employeeId}`);
		const routesToday = await routeAt(now);
		expect(routesToday?.get("absence")).toMatchObject({ kind: "routed" });
		expect(routesToday?.get("shift_request")).toMatchObject({ kind: "routed" });
		const routesLater = await routeAt(later);
		expect(routesLater?.get("absence")).toMatchObject({
			kind: "unroutable",
			reason: { code: "default_approver_departed" },
		});
		expect(routesLater?.get("shift_request")).toMatchObject({
			kind: "unroutable",
			reason: { code: "no_decider" },
		});
	});

	it("reads only the organization's own rows", async () => {
		const elsewhere = await fixture.createOrganization();
		const stranger = await fixture.seedEmployee({ organizationId: elsewhere, role: "admin" });
		await sql(
			`insert into approval_policy (organization_id, name, is_active, priority, created_by, updated_at)
			 values ($1, 'Elsewhere', true, 0, $2, now())`,
			[elsewhere, owner.userId],
		);
		const subject = await seed();

		const snapshot = await readOnlyTransaction(db, (reader) =>
			loadApprovalRouteSnapshot(reader, { organizationId, at: systemClock.nowInstant() }),
		);

		expect(snapshot.legacyPolicies).toEqual([]);
		const ids = snapshot.employees.map((row) => row.id);
		expect(ids).toContain(subject.employeeId);
		expect(ids).not.toContain(stranger.employeeId);
		expect(snapshot.stageDirectory.employees.map((row) => row.id)).not.toContain(
			stranger.employeeId,
		);
		await expect(
			previewApprovalRoutes(db, {
				organizationId,
				at: systemClock.nowInstant(),
				requesters: [employee(stranger.employeeId)],
			}),
		).rejects.toThrow(/not an employee/);
	});

	it("routes a departed named approver's stage to the stand-in chosen for the requester", async () => {
		await canonicalAbsences();
		const manager = await seed("manager");
		const named = await seed("manager");
		const subject = await seed();
		await managedBy(subject.employeeId, manager.employeeId);
		const { rows } = await sql(
			`insert into approval_policy (organization_id, name, is_active, priority, created_by, updated_at)
			 values ($1, 'Named', true, 1, $2, now()) returning id`,
			[organizationId, owner.userId],
		);
		await sql(
			`insert into approval_policy_condition (organization_id, policy_id, condition_type, operator, value_json, updated_at)
			 values ($1, $2, 'approval_type', 'equals', $3, now())`,
			[organizationId, rows[0].id, JSON.stringify({ value: "absence" })],
		);
		await sql(
			`insert into approval_policy_stage
			 (organization_id, policy_id, step_order, label, approver_type, approver_employee_id, fallback_behavior, updated_at)
			 values ($1, $2, 1, 'Stage', 'specific_employee', $3, 'fail', now())`,
			[organizationId, rows[0].id, named.employeeId],
		);
		await sql("update employee set is_active = false, end_date = '2026-05-29' where id = $1", [
			named.employeeId,
		]);
		const { rows: periods } = await sql(
			"select id from employee_employment_period where employee_id = $1 limit 1",
			[named.employeeId],
		);
		await sql(
			`insert into employee_departure
			 (organization_id, employee_id, employment_period_id, mode, last_working_day, timezone,
			  cutoff_at, replacement_employee_id, revision, status, created_by, request_id,
			  request_fingerprint, effective_at)
			 values ($1, $2, $3, 'scheduled', '2026-05-29', 'Europe/Berlin', '2026-05-29T22:00:00Z',
			  $4, 1, 'effective', $5, $6, 'fingerprint', '2026-05-29T22:00:00Z')`,
			[
				organizationId,
				named.employeeId,
				periods[0]?.id,
				manager.employeeId,
				owner.userId,
				randomUUID(),
			],
		);

		const preview = await previewApprovalRoutes(db, {
			organizationId,
			at: systemClock.nowInstant(),
			requesters: [employee(subject.employeeId)],
		});

		const absence = preview.routes.get(`employee:${subject.employeeId}`)?.get("absence");
		expect(absence).toMatchObject({ kind: "routed" });
		expect(absence?.variants[0]?.outcome).toMatchObject({
			kind: "routed",
			stages: [{ approverEmployeeIds: [manager.employeeId], activation: "human" }],
		});
	});

	it("starts no workflow and writes no row", async () => {
		await canonicalAbsences();
		await sql(`update organization set shifts_enabled = true where id = $1`, [organizationId]);
		await sql(
			`insert into period_submission_cadence_change (id, organization_id, cadence, week_start_day, changed_at)
			 values ($1, $2, 'weekly', 'monday', '2026-01-01T00:00:00Z')`,
			[randomUUID(), organizationId],
		);
		const manager = await seed("manager");
		const subject = await seed();
		await managedBy(subject.employeeId, manager.employeeId);
		const tables = [
			"approval_request",
			"approval_chain_instance",
			"approval_chain_stage_instance",
			"approval_workflow",
			"approval_stage_assignment",
			"approval_workflow_event",
			"approval_outbox",
			"approval_workflow_rollout",
			"audit_log",
			"notification",
		];
		const counts = async () => {
			const found: Record<string, number> = {};
			for (const table of tables) {
				const { rows } = await sql(
					`select count(*)::int as count from ${table} where organization_id = $1`,
					[organizationId],
				);
				found[table] = rows[0].count;
			}
			return found;
		};
		const before = await counts();

		// Not inside a read-only transaction: the preview itself must not write.
		const preview = await previewApprovalRoutes(db, {
			organizationId,
			at: systemClock.nowInstant(),
			requesters: [
				employee(subject.employeeId),
				{ kind: "prospective", key: "invitee", teamId: null },
			],
			traceStages: true,
		});

		expect(preview.kinds).toContain("period_submission");
		expect(preview.routes.get(`employee:${subject.employeeId}`)?.get("absence")?.kind).toBe(
			"routed",
		);
		expect(await counts()).toEqual(before);
	});
});
