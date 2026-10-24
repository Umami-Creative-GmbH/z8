/**
 * PostgreSQL contract (#1440): a deactivation hands the person's approval
 * duties over through the departure's handover. Current-stage duties go to the
 * replacement chosen for that requester, otherwise to the stage's reviewers
 * re-resolved without the person (D2), otherwise they become reviews. Later
 * stages naming only the person, and legacy duties, become reviews. Their own
 * submitted requests are untouched.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ApprovalWorkflowDatabase } from "@/lib/approvals/workflow/repository";
import { AuditTrail } from "@/lib/audit-trail";
import { dateFromInstant, type Instant, parseInstant } from "@/lib/datetime/temporal-core";
import { createApprovalHandoverHandler, createApprovalHandoverRuntime } from "../approval-handover";
import { runDepartureTaskDelivery } from "../delivery";
import { createDepartureTaskOutbox, type DepartureTaskClaim } from "../outbox";
import { getDeactivationFollowUp } from "../queries";
import { insertDeactivation, markDeactivationReactivated } from "../receipts";
import {
	absenceApprovalRuntime,
	enableCanonicalAbsences,
	type SeededAbsenceWorkflow,
	seedPendingAbsenceWorkflow,
} from "../testing/approval-workflow.test.fixture";
import {
	createLifecycleDatabaseFixture,
	type LifecycleDatabaseFixture,
	type SeededEmployee,
} from "../testing/database.test.fixture";
import { applyApprovalDuties, planApprovalDuties } from "./approval-duties";
import type { ApprovalDutiesPlan, DeactivationPlanContext } from "./types";

const SUBMITTED_AT = parseInstant("2026-10-20T08:00:00Z");
const DEACTIVATED_AT = parseInstant("2026-10-24T09:00:00Z");
const FUTURE_STAGE = { approverType: "specific_employee", fallbackBehavior: "fail" } as const;

describe("deactivation approval duties", () => {
	let fixture: LifecycleDatabaseFixture;
	let now: Instant = SUBMITTED_AT;
	const clock = { nowInstant: () => now };

	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();
		await fixture.pool.query(`update organization set timezone = 'Europe/Berlin' where id = $1`, [
			fixture.organizationId,
		]);
		await enableCanonicalAbsences(fixture, new Date(SUBMITTED_AT.epochMilliseconds));
	});

	afterAll(async () => {
		await fixture?.close();
	});

	async function link(report: SeededEmployee, manager: SeededEmployee, isPrimary: boolean) {
		await fixture.pool.query(
			`insert into employee_managers (id, employee_id, manager_id, is_primary, assigned_by, assigned_at, created_at)
			 values ($1, $2, $3, $4, $5, $6, $6)`,
			[
				randomUUID(),
				report.employeeId,
				manager.employeeId,
				isPrimary,
				fixture.ownerUserId,
				new Date(SUBMITTED_AT.epochMilliseconds),
			],
		);
	}

	function seedDuty(
		requester: SeededEmployee,
		approver: SeededEmployee,
		secondStageResolver?: Record<string, unknown>,
	): Promise<SeededAbsenceWorkflow> {
		return seedPendingAbsenceWorkflow(fixture, {
			requester,
			approverEmployeeIds: [approver.employeeId],
			at: new Date(SUBMITTED_AT.epochMilliseconds),
			secondStageResolver,
		});
	}

	async function seedLegacyDuty(requester: SeededEmployee, approver: SeededEmployee) {
		const id = randomUUID();
		await fixture.pool.query(
			`insert into approval_request (id, organization_id, entity_type, entity_id, requested_by,
				approver_id, status, created_at, updated_at)
			 values ($1, $2, 'travel_expense_claim', $3, $4, $5, 'pending', now(), now())`,
			[id, fixture.organizationId, randomUUID(), requester.employeeId, approver.employeeId],
		);
		return id;
	}

	/** Records the deactivation the way the action does: row, then the employee switched off. */
	async function deactivate(
		leaving: SeededEmployee,
		replacementManagers: Record<string, string>,
	): Promise<string> {
		const { id } = await fixture.db.transaction((tx) =>
			insertDeactivation(tx, {
				organizationId: fixture.organizationId,
				employeeId: leaving.employeeId,
				employmentPeriodId: leaving.employmentPeriodId,
				deactivatedAt: DEACTIVATED_AT,
				createdBy: fixture.ownerUserId,
				reason: "employee_deactivated",
				requestId: randomUUID(),
				requestFingerprint: "fingerprint",
				replacementManagers,
			}),
		);
		await fixture.pool.query(
			`update employee set is_active = false, deactivated_at = $3
			 where organization_id = $1 and id = $2`,
			[fixture.organizationId, leaving.employeeId, dateFromInstant(DEACTIVATED_AT)],
		);
		return id;
	}

	function planContext(
		leaving: SeededEmployee,
		replacementManagers: Record<string, string>,
	): DeactivationPlanContext {
		return {
			organizationId: fixture.organizationId,
			employeeId: leaving.employeeId,
			at: DEACTIVATED_AT,
			organizationTimeZone: "Europe/Berlin",
			employmentPeriodId: leaving.employmentPeriodId,
			replacementManagers,
			replaceManagers: true,
		};
	}

	async function planAndApply(
		leaving: SeededEmployee,
		replacementManagers: Record<string, string>,
	) {
		now = DEACTIVATED_AT;
		const context = planContext(leaving, replacementManagers);
		const plan = await planApprovalDuties(fixture.db, context);
		const deactivationId = await deactivate(leaving, replacementManagers);
		const result = await fixture.db.transaction((tx) =>
			applyApprovalDuties(
				tx,
				{
					...context,
					actorUserId: fixture.ownerUserId,
					deactivationId,
					reason: "employee_deactivated",
					audit: new AuditTrail(),
				},
				plan,
			),
		);
		return { plan, deactivationId, result };
	}

	async function handoverTasks(deactivationId: string) {
		const result = await fixture.pool.query<{
			id: string;
			status: string;
			departure_id: string | null;
			payload: Record<string, unknown>;
		}>(
			`select id, status, departure_id, payload from employee_departure_task
			 where organization_id = $1 and deactivation_id = $2 and kind = 'approval_handover'`,
			[fixture.organizationId, deactivationId],
		);
		return result.rows;
	}

	async function reviews(deactivationId: string) {
		const result = await fixture.pool.query<{
			id: string;
			subject_id: string | null;
			status: string;
			metadata: Record<string, unknown>;
		}>(
			`select id, subject_id, status, metadata from employee_departure_review
			 where organization_id = $1 and deactivation_id = $2 and kind = 'approval_handover'`,
			[fixture.organizationId, deactivationId],
		);
		return result.rows;
	}

	async function claim(taskId: string): Promise<DepartureTaskClaim> {
		const claimToken = randomUUID();
		const result = await fixture.pool.query(
			`update employee_departure_task
			 set status = 'processing', claim_token = $3, attempt_count = attempt_count + 1,
				available_at = $4, last_error = null
			 where organization_id = $1 and id = $2
			 returning id, employee_id, employment_period_id, departure_id, deactivation_id, kind, payload,
				attempt_count`,
			[
				fixture.organizationId,
				taskId,
				claimToken,
				new Date(now.add({ minutes: 5 }).epochMilliseconds),
			],
		);
		const row = result.rows[0];
		return {
			id: row.id,
			organizationId: fixture.organizationId,
			employeeId: row.employee_id,
			employmentPeriodId: row.employment_period_id,
			departureId: row.departure_id,
			deactivationId: row.deactivation_id,
			kind: row.kind,
			payload: row.payload,
			claimToken,
			attemptCount: row.attempt_count,
		};
	}

	async function deliver(taskId: string) {
		const claimed = await claim(taskId);
		const outbox = createDepartureTaskOutbox(fixture.db);
		return runDepartureTaskDelivery({
			outbox: { ...outbox, claimDue: async () => [claimed] },
			now,
			handlers: {
				approval_handover: createApprovalHandoverHandler({
					database: fixture.db,
					clock,
					runtime: createApprovalHandoverRuntime(
						fixture.db as unknown as ApprovalWorkflowDatabase,
						clock,
					),
				}),
			},
		});
	}

	async function pendingApprovers(workflowId: string) {
		const result = await fixture.pool.query<{
			approver_employee_id: string;
			reassignment_metadata: Record<string, unknown> | null;
		}>(
			`select approver_employee_id, reassignment_metadata from approval_stage_assignment
			 where organization_id = $1 and workflow_id = $2 and status = 'pending'`,
			[fixture.organizationId, workflowId],
		);
		return result.rows;
	}

	function byAssignment(plan: ApprovalDutiesPlan) {
		return Object.fromEntries(
			plan.handovers.map((handover) => [handover.assignmentId, handover.targetEmployeeId]),
		);
	}

	it("routes each duty to the requester's replacement, else the stage's reviewers without the person, else a review", async () => {
		const leaving = await fixture.seedEmployee({ role: "admin" });
		const replacement = await fixture.seedEmployee({ role: "admin" });
		const otherManager = await fixture.seedEmployee({ role: "admin" });
		const approver = await fixture.seedEmployee({ role: "admin" });
		const orphan = await fixture.seedEmployee();
		const keepsManager = await fixture.seedEmployee();
		const unmanaged = await fixture.seedEmployee();
		await link(orphan, leaving, true);
		await link(keepsManager, leaving, true);
		await link(keepsManager, otherManager, false);

		const toReplacement = await seedDuty(orphan, leaving);
		const toOtherManager = await seedDuty(keepsManager, leaving);
		const toReview = await seedDuty(unmanaged, leaving);
		const laterStageReview = await seedDuty(unmanaged, approver, {
			...FUTURE_STAGE,
			approverEmployeeId: leaving.employeeId,
		});
		const laterStageReplaced = await seedDuty(orphan, approver, {
			...FUTURE_STAGE,
			approverEmployeeId: leaving.employeeId,
		});
		const ownRequest = await seedDuty(leaving, approver);
		const legacyRequestId = await seedLegacyDuty(unmanaged, leaving);

		const replacementManagers = { [orphan.employeeId]: replacement.employeeId };
		const { plan, deactivationId, result } = await planAndApply(leaving, replacementManagers);

		expect(byAssignment(plan)).toEqual({
			[toReplacement.assignments[0] as string]: replacement.employeeId,
			[toOtherManager.assignments[0] as string]: otherManager.employeeId,
			[toReview.assignments[0] as string]: null,
		});
		expect(
			plan.handovers.every((handover) => handover.requesterEmployeeId !== leaving.employeeId),
		).toBe(true);
		expect(plan.reviews.map((review) => review.stageId ?? review.approvalRequestId).sort()).toEqual(
			[laterStageReview.secondStage as string, legacyRequestId].sort(),
		);

		// Apply writes exactly what the plan lists.
		const tasks = await handoverTasks(deactivationId);
		expect(tasks.map((task) => task.payload.assignmentId).sort()).toEqual(
			plan.handovers.map((handover) => handover.assignmentId).sort(),
		);
		expect(
			Object.fromEntries(
				tasks.map((task) => [task.payload.assignmentId, task.payload.replacementEmployeeId]),
			),
		).toEqual(byAssignment(plan));
		expect(tasks.every((task) => task.departure_id === null && task.status === "pending")).toBe(
			true,
		);
		expect(result.applied.handoverTaskIds.sort()).toEqual(tasks.map((task) => task.id).sort());
		const raised = await reviews(deactivationId);
		expect(result.applied.reviewIds.sort()).toEqual(raised.map((review) => review.id).sort());
		expect(raised.map((review) => review.subject_id).sort()).toEqual(
			[laterStageReview.secondStage as string, legacyRequestId].sort(),
		);
		expect(result.afterCommit).toEqual([]);

		// Their own submitted request is untouched.
		expect(await pendingApprovers(ownRequest.workflow)).toEqual([
			expect.objectContaining({ approver_employee_id: approver.employeeId }),
		]);

		// The worker transfers the duty under the deactivation's lineage.
		const replacementTask = tasks.find(
			(task) => task.payload.assignmentId === toReplacement.assignments[0],
		);
		await deliver(replacementTask?.id as string);
		expect(await pendingApprovers(toReplacement.workflow)).toEqual([
			expect.objectContaining({
				approver_employee_id: replacement.employeeId,
				reassignment_metadata: expect.objectContaining({
					offboarding: expect.objectContaining({ deactivationId }),
				}),
			}),
		]);

		// A duty with no target becomes a review under the deactivation.
		const reviewTask = tasks.find((task) => task.payload.assignmentId === toReview.assignments[0]);
		await deliver(reviewTask?.id as string);
		expect(await reviews(deactivationId)).toContainEqual(
			expect.objectContaining({
				subject_id: toReview.assignments[0],
				status: "open",
				metadata: expect.objectContaining({ reason: "no_replacement" }),
			}),
		);

		// A later stage naming the person activates with the requester's replacement.
		const first = await absenceApprovalRuntime(fixture, clock).transitionEngine.execute({
			organizationId: fixture.organizationId,
			workflowId: laterStageReplaced.workflow,
			expectedVersion: 1,
			idempotencyKey: `stage-1:${laterStageReplaced.workflow}`,
			principal: { kind: "employee", userId: approver.userId },
			command: {
				type: "approve",
				stageId: laterStageReplaced.firstStage,
				assignmentId: laterStageReplaced.assignments[0] as string,
			},
		});
		expect(
			first.snapshot.stages.find((stage) => stage.id === laterStageReplaced.secondStage),
		).toMatchObject({
			status: "pending",
			assignments: [{ approverEmployeeId: replacement.employeeId, status: "pending" }],
		});

		// The follow-up is listed by the deactivation.
		const followUp = await getDeactivationFollowUp(fixture.db, {
			organizationId: fixture.organizationId,
			employeeId: leaving.employeeId,
			deactivationId,
		});
		expect(followUp?.reviews.map((review) => review.id).sort()).toEqual(
			(await reviews(deactivationId)).map((review) => review.id).sort(),
		);
		expect(followUp?.followUp.openReviews).toBe(3);
	});

	it("stops handing over once the person is reactivated", async () => {
		const leaving = await fixture.seedEmployee({ role: "admin" });
		const otherManager = await fixture.seedEmployee({ role: "admin" });
		const report = await fixture.seedEmployee();
		await link(report, leaving, true);
		await link(report, otherManager, false);
		const duty = await seedDuty(report, leaving);

		const { deactivationId } = await planAndApply(leaving, {});
		await fixture.db.transaction((tx) =>
			markDeactivationReactivated(tx, {
				organizationId: fixture.organizationId,
				employeeId: leaving.employeeId,
				reactivatedAt: DEACTIVATED_AT.add({ hours: 1 }),
				reactivatedBy: fixture.ownerUserId,
				reactivationRequestId: randomUUID(),
			}),
		);
		await fixture.pool.query(
			`update employee set is_active = true where organization_id = $1 and id = $2`,
			[fixture.organizationId, leaving.employeeId],
		);

		const [task] = await handoverTasks(deactivationId);
		await deliver(task?.id as string);
		const [after] = await handoverTasks(deactivationId);
		expect(after).toMatchObject({
			status: "completed",
			payload: expect.objectContaining({ outcome: "employee_rehired" }),
		});
		expect(await pendingApprovers(duty.workflow)).toEqual([
			expect.objectContaining({ approver_employee_id: leaving.employeeId }),
		]);
	});

	it("never plans another organization's duties", async () => {
		const leaving = await fixture.seedEmployee({ role: "admin" });
		const foreignOrganizationId = await fixture.createOrganization();
		const foreignRequester = await fixture.seedEmployee({ organizationId: foreignOrganizationId });
		await fixture.pool.query(
			`insert into approval_request (id, organization_id, entity_type, entity_id, requested_by,
				approver_id, status, created_at, updated_at)
			 values ($1, $2, 'travel_expense_claim', $3, $4, $5, 'pending', now(), now())`,
			[
				randomUUID(),
				foreignOrganizationId,
				randomUUID(),
				foreignRequester.employeeId,
				leaving.employeeId,
			],
		);
		const plan = await planApprovalDuties(fixture.db, planContext(leaving, {}));
		expect(plan).toEqual({ handovers: [], reviews: [] });
	});
});
