/**
 * #1440 (spec #1437, Organization ADR 0006): a deactivation cancels the
 * person's pending and approved absences that start after the day they left,
 * through the normal cancellation path inside the deactivation transaction, and
 * keeps (and lists) the absences spanning that day.
 */
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { Effect } from "effect";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createAbsenceCancellationRuntime } from "@/app/[locale]/(app)/absences/cancel-absence-core";
import { db } from "@/db";
import { finalizeAbsenceTerminalInTransaction } from "@/lib/approvals/server/absence-approvals";
import type { ApprovalDbService } from "@/lib/approvals/server/types";
import {
	EMPLOYEE_DEACTIVATION_CANCEL_REASON,
	EMPLOYEE_DEACTIVATION_SYSTEM_ID,
} from "@/lib/approvals/workflow/ports";
import type { ApprovalWorkflowDatabase } from "@/lib/approvals/workflow/repository";
import { createProductionApprovalWorkflowRuntime } from "@/lib/approvals/workflow/runtime";
import { AuditTrail } from "@/lib/audit-trail";
import { protectAuthorizationMutation } from "@/lib/authorization/authorization-mutation";
import { type Instant, parseInstant } from "@/lib/datetime/temporal-core";
import {
	createLifecycleDatabaseFixture,
	type LifecycleDatabaseFixture,
	type SeededEmployee,
} from "../testing/database.test.fixture";
import {
	acquireAbsenceCancellationGuards,
	applyAbsenceCancellations,
	planAbsences,
} from "./absences";
import type { DeactivationApplyContext, DeactivationPlanContext } from "./types";

const kicks = vi.hoisted(() => [] as { organizationId: string; workflowId?: string | null }[]);
vi.mock("@/lib/queue", async (original) =>
	(await import("@/test/integration-harness")).calendarSyncQueue(original),
);
vi.mock("@/lib/approvals/delivery/kick", async () =>
	(await import("@/test/integration-harness")).deliveryKick(kicks),
);

const SEEDED_AT = new Date("2026-10-01T08:00:00Z");
const REFUSED = /Employee deactivation cancellation refused/;

describe("deactivation cancels later absences (#1440)", () => {
	let fixture: LifecycleDatabaseFixture;
	let approver: SeededEmployee;
	let vacation: string;
	let mode: "canonical" | "legacy" = "canonical";

	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();
		await fixture.pool.query(`update organization set timezone = 'Europe/Berlin' where id = $1`, [
			fixture.organizationId,
		]);
		approver = await fixture.seedEmployee({ role: "admin" });
		vacation = await seedCategory(fixture.organizationId);
	});

	afterAll(async () => {
		await fixture?.close();
	});

	async function seedCategory(organizationId: string) {
		const result = await fixture.pool.query<{ id: string }>(
			`insert into absence_category
			 (organization_id, type, name, requires_approval, counts_against_vacation, is_active, updated_at)
			 values ($1, 'vacation', $2, true, true, true, $3) returning id`,
			[organizationId, `Vacation ${randomUUID().slice(0, 8)}`, SEEDED_AT],
		);
		return result.rows[0]?.id ?? "";
	}

	async function setMode(organizationId: string, lifecycle: "canonical" | "legacy") {
		mode = lifecycle;
		await fixture.pool.query(
			`insert into approval_workflow_rollout
			 (organization_id, workflow_type, lifecycle_mode, side_effect_mode, created_at, updated_at)
			 values ($1, 'absence', $2, $3, $4, $4)
			 on conflict (organization_id, workflow_type)
			 do update set lifecycle_mode = excluded.lifecycle_mode, side_effect_mode = excluded.side_effect_mode`,
			[organizationId, lifecycle === "canonical" ? "complete" : "legacy", lifecycle, SEEDED_AT],
		);
	}

	function runtime(clockAt: Instant) {
		const clock = { nowInstant: () => clockAt };
		return createProductionApprovalWorkflowRuntime({
			db: fixture.db as unknown as ApprovalWorkflowDatabase,
			adapters: {
				absence: {
					clock,
					finalizeAbsenceTerminal: (input) =>
						finalizeAbsenceTerminalInTransaction({
							...input,
							dbService: {
								db: input.dbService.db as ApprovalDbService["db"],
								query: (_name, operation) => Effect.promise(operation),
							},
						}),
					deleteCancelledAbsence: async () => {
						throw new Error("seeding never cancels");
					},
				},
				timeCorrection: {
					clock,
					finalizeTimeCorrectionTerminal: async () => {
						throw new Error("unused");
					},
					deleteCancelledCorrections: async () => {
						throw new Error("unused");
					},
				},
				ordinaryWorkPeriod: {
					finalizeTerminal: async () => {
						throw new Error("unused");
					},
				},
			},
			canManageApproval: async () => false,
			clock,
		});
	}

	/** A submitted absence with its canonical record; canonical mode adds its workflow. */
	async function seedAbsence(input: {
		employee: SeededEmployee;
		startDate: string;
		endDate: string;
		status?: "pending" | "approved" | "rejected";
		organizationId?: string;
		categoryId?: string;
	}): Promise<string> {
		const organizationId = input.organizationId ?? fixture.organizationId;
		const categoryId = input.categoryId ?? vacation;
		const status = input.status ?? "pending";
		const record = randomUUID();
		const absence = randomUUID();
		await fixture.pool.query(
			`insert into time_record (id, organization_id, employee_id, record_kind, start_at, end_at,
				approval_state, origin, created_at, created_by, updated_at)
			 values ($1, $2, $3, 'absence', $4::date, ($5::date + 1), 'pending', 'manual', $6, $7, $6)`,
			[
				record,
				organizationId,
				input.employee.employeeId,
				input.startDate,
				input.endDate,
				SEEDED_AT,
				input.employee.userId,
			],
		);
		await fixture.pool.query(
			`insert into time_record_absence (record_id, organization_id, record_kind, absence_category_id)
			 values ($1, $2, 'absence', $3)`,
			[record, organizationId, categoryId],
		);
		await fixture.pool.query(
			`insert into absence_entry (id, employee_id, category_id, start_date, end_date, status,
				organization_id, canonical_record_id, created_at, updated_at)
			 values ($1, $2, $3, $4, $5, 'pending', $6, $7, $8, $8)`,
			[
				absence,
				input.employee.employeeId,
				categoryId,
				input.startDate,
				input.endDate,
				organizationId,
				record,
				SEEDED_AT,
			],
		);
		if (mode === "legacy") {
			if (status !== "pending") {
				await fixture.pool.query(`update absence_entry set status = $1 where id = $2;`, [
					status,
					absence,
				]);
				await fixture.pool.query(`update time_record set approval_state = $1 where id = $2`, [
					status,
					record,
				]);
			}
			return absence;
		}
		const workflow = randomUUID();
		const stage = randomUUID();
		const assignment = randomUUID();
		await fixture.pool.query(
			`insert into approval_workflow (id, organization_id, workflow_type, source_type, source_id,
				requester_employee_id, status, current_stage_order, version, policy_snapshot,
				context_snapshot, display_snapshot, submitted_at, created_at, updated_at)
			 values ($1, $2, 'absence', 'absence_entry', $3, $4, 'pending', 1, 1, '{}', '{}', '{}', $5, $5, $5)`,
			[workflow, organizationId, absence, input.employee.employeeId, SEEDED_AT],
		);
		await fixture.pool.query(
			`update absence_entry set approval_workflow_id = $1 where organization_id = $2 and id = $3`,
			[workflow, organizationId, absence],
		);
		await fixture.pool.query(
			`insert into approval_workflow_stage (id, organization_id, workflow_id, stage_order, label,
				resolver_snapshot, activation_mode, status, activated_at, created_at, updated_at)
			 values ($1, $2, $3, 1, 'Manager', $4, 'human', 'pending', $5, $5, $5)`,
			[
				stage,
				organizationId,
				workflow,
				JSON.stringify({ approverType: "direct_manager", fallbackBehavior: "fail" }),
				SEEDED_AT,
			],
		);
		await fixture.pool.query(
			`insert into approval_stage_assignment (id, organization_id, workflow_id, stage_id,
				assignment_sequence, approver_employee_id, status, assigned_at, created_at, updated_at)
			 values ($1, $2, $3, $4, 1, $5, 'pending', $6, $6, $6)`,
			[assignment, organizationId, workflow, stage, approver.employeeId, SEEDED_AT],
		);
		if (status !== "pending") {
			const decider = runtime(parseInstant("2026-10-02T09:00:00Z"));
			await decider.transitionEngine.execute({
				organizationId,
				workflowId: workflow,
				expectedVersion: 1,
				idempotencyKey: `seed:${workflow}`,
				principal: { kind: "employee", userId: approver.userId },
				command:
					status === "approved"
						? { type: "approve", stageId: stage, assignmentId: assignment }
						: { type: "reject", stageId: stage, assignmentId: assignment, reason: "No" },
			});
		}
		return absence;
	}

	function planContext(
		employee: SeededEmployee,
		at: Instant,
		organizationTimeZone = "Europe/Berlin",
	): DeactivationPlanContext {
		return {
			organizationId: fixture.organizationId,
			employeeId: employee.employeeId,
			at,
			organizationTimeZone,
			employmentPeriodId: employee.employmentPeriodId,
			replacementManagers: {},
			replaceManagers: true,
		};
	}

	async function deactivate(employee: SeededEmployee, at: Instant) {
		await fixture.pool.query(
			`update employee set is_active = false, deactivated_at = $1 where organization_id = $2 and id = $3`,
			[at.toString(), fixture.organizationId, employee.employeeId],
		);
	}

	it("lists pending and approved absences starting after the day they left, and those spanning it", async () => {
		await setMode(fixture.organizationId, "canonical");
		const person = await fixture.seedEmployee();
		const at = parseInstant("2026-10-24T10:00:00Z");
		await seedAbsence({
			employee: person,
			startDate: "2026-10-01",
			endDate: "2026-10-02",
			status: "approved",
		});
		const spanning = await seedAbsence({
			employee: person,
			startDate: "2026-10-23",
			endDate: "2026-10-27",
			status: "approved",
		});
		const pending = await seedAbsence({
			employee: person,
			startDate: "2026-11-02",
			endDate: "2026-11-03",
		});
		const approved = await seedAbsence({
			employee: person,
			startDate: "2026-11-09",
			endDate: "2026-11-10",
			status: "approved",
		});
		await seedAbsence({
			employee: person,
			startDate: "2026-11-16",
			endDate: "2026-11-16",
			status: "rejected",
		});
		const someoneElse = await fixture.seedEmployee();
		await seedAbsence({ employee: someoneElse, startDate: "2026-11-02", endDate: "2026-11-03" });

		const plan = await planAbsences(fixture.db, planContext(person, at));

		expect(
			plan.absencesToCancel.map(({ absenceId, startDate, endDate, status }) => ({
				absenceId,
				startDate,
				endDate,
				status,
			})),
		).toEqual([
			{ absenceId: pending, startDate: "2026-11-02", endDate: "2026-11-03", status: "pending" },
			{ absenceId: approved, startDate: "2026-11-09", endDate: "2026-11-10", status: "approved" },
		]);
		expect(plan.absencesSpanning.map(({ absenceId, status }) => ({ absenceId, status }))).toEqual([
			{ absenceId: spanning, status: "approved" },
		]);
		expect(plan.absencesToCancel[0]?.categoryName).toMatch(/^Vacation /);
	});

	it("keeps and lists an absence touching a closed month, so the dry run matches what is applied", async () => {
		await setMode(fixture.organizationId, "canonical");
		const person = await fixture.seedEmployee();
		const at = parseInstant("2026-10-24T10:00:00Z");
		const inClosedMonth = await seedAbsence({
			employee: person,
			startDate: "2026-10-29",
			endDate: "2026-11-02",
			status: "approved",
		});
		const later = await seedAbsence({
			employee: person,
			startDate: "2026-11-09",
			endDate: "2026-11-10",
			status: "approved",
		});
		await fixture.pool.query(
			`with closed as (
				insert into closed_month (organization_id, month, scope, actor_kind, closed_by)
				values ($1, '2026-10-01', 'organization', 'user', $3) returning id
			)
			insert into closed_month_employee
				(organization_id, closed_month_id, employee_id, month, range_start, range_end, timezone)
			select $1, id, $2, '2026-10-01', '2026-09-30T22:00:00Z', '2026-10-31T23:00:00Z', 'Europe/Berlin'
			from closed`,
			[fixture.organizationId, person.employeeId, fixture.ownerUserId],
		);
		await deactivate(person, at);
		const ctx = applyContext(person, at);

		const planned = await planAbsences(fixture.db, ctx);
		const result = await fixture.db.transaction(async (tx) => {
			const plan = await planAbsences(tx, ctx);
			return applyAbsenceCancellations(tx, plan, ctx, { database: db });
		});

		expect(planned.absencesToCancel.map((item) => item.absenceId)).toEqual([later]);
		expect(planned.absencesInClosedMonths.map((item) => item.absenceId)).toEqual([inClosedMonth]);
		expect(result.applied.cancelledAbsenceIds).toEqual([later]);
		expect(await absenceState(inClosedMonth)).toMatchObject({ status: "approved" });
	});

	function applyContext(employee: SeededEmployee, at: Instant): DeactivationApplyContext {
		return {
			...planContext(employee, at),
			actorUserId: fixture.ownerUserId,
			deactivationId: randomUUID(),
			reason: "employee_deactivated",
			audit: new AuditTrail(),
		};
	}

	async function absenceState(absenceId: string) {
		const result = await fixture.pool.query<{
			status: string | null;
			record: string | null;
			workflow_status: string | null;
		}>(
			`select a.status, r.id as record, w.status as workflow_status
			 from (select $1::uuid as id) as probe
			 left join absence_entry a on a.id = probe.id
			 left join time_record r on r.id = a.canonical_record_id
			 left join approval_workflow w on w.source_type = 'absence_entry' and w.source_id = probe.id`,
			[absenceId],
		);
		return result.rows[0];
	}

	async function cancellationAudits(absenceId: string) {
		const result = await fixture.pool.query<{
			performed_by: string;
			employee_id: string | null;
			metadata: string | null;
		}>(
			`select performed_by, employee_id, metadata from audit_log
			 where organization_id = $1 and action = 'absence.cancelled' and entity_id = $2`,
			[fixture.organizationId, absenceId],
		);
		return result.rows.map((row) => ({
			...row,
			metadata: row.metadata ? JSON.parse(row.metadata) : null,
		}));
	}

	it("cancels the planned absences through the normal path in the deactivation transaction", async () => {
		await setMode(fixture.organizationId, "canonical");
		const person = await fixture.seedEmployee();
		const at = parseInstant("2026-10-24T10:00:00Z");
		const spanning = await seedAbsence({
			employee: person,
			startDate: "2026-10-23",
			endDate: "2026-10-27",
			status: "approved",
		});
		const pending = await seedAbsence({
			employee: person,
			startDate: "2026-11-02",
			endDate: "2026-11-03",
		});
		const approved = await seedAbsence({
			employee: person,
			startDate: "2026-11-09",
			endDate: "2026-11-10",
			status: "approved",
		});
		await deactivate(person, at);
		const ctx = applyContext(person, at);

		const result = await fixture.db.transaction(async (tx) => {
			const plan = await planAbsences(tx, ctx);
			return applyAbsenceCancellations(tx, plan, ctx, { database: db });
		});

		expect(result.applied.cancelledAbsenceIds).toEqual([pending, approved]);
		// The absence and its canonical record go, so the allowance is back; the workflow is cancelled.
		for (const absenceId of [pending, approved]) {
			expect(await absenceState(absenceId)).toEqual({
				status: null,
				record: null,
				workflow_status: "cancelled",
			});
			expect(await cancellationAudits(absenceId)).toEqual([
				{
					performed_by: fixture.ownerUserId,
					employee_id: person.employeeId,
					metadata: expect.objectContaining({
						reason: "employee_deactivated",
						deactivationId: ctx.deactivationId,
					}),
				},
			]);
		}
		expect(await absenceState(spanning)).toMatchObject({
			status: "approved",
			workflow_status: "approved",
		});
		expect(await cancellationAudits(spanning)).toEqual([]);
	});

	async function workflowOf(absenceId: string) {
		const result = await fixture.pool.query<{ id: string; version: number }>(
			`select id, version from approval_workflow where source_type = 'absence_entry' and source_id = $1`,
			[absenceId],
		);
		const row = result.rows[0];
		if (!row) throw new Error("absence has no workflow");
		return row;
	}

	async function systemCancel(absenceId: string, reason = EMPLOYEE_DEACTIVATION_CANCEL_REASON) {
		const workflow = await workflowOf(absenceId);
		const { runtime: cancelling } = createAbsenceCancellationRuntime({
			db: fixture.db as unknown as ApprovalWorkflowDatabase,
			actor: { kind: "employee_deactivation", actorUserId: fixture.ownerUserId },
			canManageApproval: async () => false,
		});
		return cancelling.transitionEngine.execute({
			organizationId: fixture.organizationId,
			workflowId: workflow.id,
			expectedVersion: workflow.version,
			idempotencyKey: `test:${randomUUID()}`,
			principal: { kind: "system", systemId: EMPLOYEE_DEACTIVATION_SYSTEM_ID },
			command: { type: "cancel", reason },
		});
	}

	it("admits the deactivation's capability only for a former employee's absence after the day they left", async () => {
		await setMode(fixture.organizationId, "canonical");
		const person = await fixture.seedEmployee();
		const at = parseInstant("2026-10-24T10:00:00Z");
		const spanning = await seedAbsence({
			employee: person,
			startDate: "2026-10-24",
			endDate: "2026-10-26",
			status: "approved",
		});
		const later = await seedAbsence({
			employee: person,
			startDate: "2026-11-09",
			endDate: "2026-11-10",
			status: "approved",
		});

		// Still a current employee: nothing to cancel on their behalf.
		await expect(systemCancel(later)).rejects.toThrow(REFUSED);
		await deactivate(person, at);
		// Spanning the day they left, or with another reason: refused.
		await expect(systemCancel(spanning)).rejects.toThrow(REFUSED);
		await expect(systemCancel(later, "Absence cancelled")).rejects.toThrow(REFUSED);
		expect(await absenceState(spanning)).toMatchObject({ status: "approved" });
		expect(await absenceState(later)).toMatchObject({ status: "approved" });

		await systemCancel(later);
		expect(await absenceState(later)).toEqual({
			status: null,
			record: null,
			workflow_status: "cancelled",
		});
	});

	it("reads the day they left in the organization's zone", async () => {
		await setMode(fixture.organizationId, "canonical");
		const person = await fixture.seedEmployee();
		// 23:30 UTC is already the 25th in Berlin, so an absence from the 25th spans it.
		const at = parseInstant("2026-10-24T23:30:00Z");
		const fromThe25th = await seedAbsence({
			employee: person,
			startDate: "2026-10-25",
			endDate: "2026-10-26",
		});
		const fromThe26th = await seedAbsence({
			employee: person,
			startDate: "2026-10-26",
			endDate: "2026-10-26",
		});
		await deactivate(person, at);

		const plan = await planAbsences(fixture.db, planContext(person, at, "Europe/Berlin"));

		expect(plan.absencesSpanning.map((item) => item.absenceId)).toEqual([fromThe25th]);
		expect(plan.absencesToCancel.map((item) => item.absenceId)).toEqual([fromThe26th]);
		await expect(systemCancel(fromThe25th)).rejects.toThrow(REFUSED);
		await systemCancel(fromThe26th);
		expect(await absenceState(fromThe26th)).toMatchObject({ status: null });
	});

	it("runs in a transaction holding the deactivation's locks, taken in protocol order", async () => {
		await setMode(fixture.organizationId, "canonical");
		const person = await fixture.seedEmployee();
		const at = parseInstant("2026-10-24T10:00:00Z");
		const later = await seedAbsence({
			employee: person,
			startDate: "2026-11-02",
			endDate: "2026-11-02",
		});
		const ctx = applyContext(person, at);

		const result = await fixture.db.transaction(async (tx) => {
			// The approval write gates (rank 2) first, then the exclusive organization configuration
			// guard (rank 3) and the user's exclusive access guard (rank 4), then the organization
			// row, as the deactivation's own transaction takes them.
			await acquireAbsenceCancellationGuards(tx, fixture.organizationId);
			await protectAuthorizationMutation(tx, {
				organizationId: fixture.organizationId,
				organizationWide: true,
				employeeIds: [person.employeeId],
			});
			await tx.execute(
				sql`select id from organization where id = ${fixture.organizationId} for update`,
			);
			await tx.execute(sql`
				update employee set is_active = false, deactivated_at = ${at.toString()}::timestamptz
				where organization_id = ${fixture.organizationId} and id = ${person.employeeId}::uuid
			`);
			return applyAbsenceCancellations(tx, await planAbsences(tx, ctx), ctx, { database: db });
		});

		expect(result.applied.cancelledAbsenceIds).toEqual([later]);
		expect(await absenceState(later)).toMatchObject({ status: null, workflow_status: "cancelled" });
	});

	it("skips a planned absence that was cancelled meanwhile and runs its after-commit steps once", async () => {
		await setMode(fixture.organizationId, "canonical");
		const person = await fixture.seedEmployee();
		const at = parseInstant("2026-10-24T10:00:00Z");
		const gone = await seedAbsence({
			employee: person,
			startDate: "2026-11-02",
			endDate: "2026-11-02",
		});
		const later = await seedAbsence({
			employee: person,
			startDate: "2026-11-09",
			endDate: "2026-11-09",
		});
		await deactivate(person, at);
		const ctx = applyContext(person, at);
		const plan = await planAbsences(fixture.db, ctx);
		await systemCancel(gone);

		const result = await fixture.db.transaction((tx) =>
			applyAbsenceCancellations(tx, plan, ctx, { database: db }),
		);

		expect(result.applied.cancelledAbsenceIds).toEqual([later]);
		expect(result.afterCommit).toHaveLength(1);
		await Promise.all(result.afterCommit.map((step) => step()));
	});

	it("cancels through the legacy rows when the organization is not on canonical approvals", async () => {
		await setMode(fixture.organizationId, "legacy");
		const person = await fixture.seedEmployee();
		const at = parseInstant("2026-10-24T10:00:00Z");
		const pending = await seedAbsence({
			employee: person,
			startDate: "2026-11-02",
			endDate: "2026-11-03",
		});
		const approved = await seedAbsence({
			employee: person,
			startDate: "2026-11-09",
			endDate: "2026-11-09",
			status: "approved",
		});
		await deactivate(person, at);
		const ctx = applyContext(person, at);

		const result = await fixture.db.transaction(async (tx) =>
			applyAbsenceCancellations(tx, await planAbsences(tx, ctx), ctx, { database: db }),
		);

		expect(result.applied.cancelledAbsenceIds).toEqual([pending, approved]);
		for (const absenceId of [pending, approved]) {
			expect(await absenceState(absenceId)).toEqual({
				status: null,
				record: null,
				workflow_status: null,
			});
			expect(await cancellationAudits(absenceId)).toHaveLength(1);
		}
	});
});
