/**
 * PostgreSQL contract: pnpm --filter webapp test:approval-workflow-repository:integration
 * Approval duties are captured when a departure takes effect and transferred
 * by the worker through the narrow offboarding principal.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { ApprovalWorkflowDatabase } from "@/lib/approvals/workflow/repository";
import { type Instant, parseInstant } from "@/lib/datetime/temporal-core";
import {
	assignDepartureReplacement,
	createApprovalHandoverHandler,
	createApprovalHandoverRuntime,
} from "./approval-handover";
import { createDepartureCommands } from "./commands";
import { runDepartureTaskDelivery } from "./delivery";
import { createDepartureTaskOutbox, type DepartureTaskClaim } from "./outbox";
import {
	absenceApprovalRuntime,
	enableCanonicalAbsences,
	type SeededAbsenceWorkflow,
	seedPendingAbsenceWorkflow,
} from "./testing/approval-workflow.test.fixture";
import {
	createLifecycleDatabaseFixture,
	describeLifecycleDatabase,
	type LifecycleDatabaseFixture,
	type SeededEmployee,
} from "./testing/database.test.fixture";

const SUBMITTED_AT = parseInstant("2026-09-14T08:00:00Z");
const SCHEDULED_AT = parseInstant("2026-09-15T08:00:00Z");
/** After the Europe/Berlin end of 2026-09-30. */
const AFTER_CUTOFF = parseInstant("2026-09-30T23:00:00Z");

describeLifecycleDatabase("approval handover", () => {
	let fixture: LifecycleDatabaseFixture;
	let now: Instant = SUBMITTED_AT;
	const clock = { nowInstant: () => now };
	let requester: SeededEmployee;
	let replacement: SeededEmployee;

	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();
		await fixture.pool.query(`update organization set timezone = 'Europe/Berlin' where id = $1`, [
			fixture.organizationId,
		]);
		await enableCanonicalAbsences(fixture, new Date(SUBMITTED_AT.epochMilliseconds));
		requester = await fixture.seedEmployee();
		// An organization admin may decide any in-organization approval.
		replacement = await fixture.seedEmployee({ role: "admin" });
	});

	afterAll(async () => {
		await fixture?.close();
	});

	beforeEach(() => {
		now = SUBMITTED_AT;
	});

	const owner = () => ({ userId: fixture.ownerUserId, organizationId: fixture.organizationId });

	function commands() {
		return createDepartureCommands({
			db: fixture.db,
			clock,
			clockOut: { close: async () => ({ kind: "not_running" }) },
		});
	}

	function handoverRuntime() {
		return createApprovalHandoverRuntime(fixture.db as unknown as ApprovalWorkflowDatabase, clock);
	}

	async function seedDuty(approver: SeededEmployee): Promise<SeededAbsenceWorkflow> {
		return seedPendingAbsenceWorkflow(fixture, {
			requester,
			approverEmployeeIds: [approver.employeeId],
			at: new Date(now.epochMilliseconds),
		});
	}

	/** Offboards now with the given replacement (null acknowledges unassigned duties). */
	async function offboard(employee: SeededEmployee, replacementEmployeeId: string | null) {
		const result = await commands().offboardNow(owner(), {
			employeeId: employee.employeeId,
			requestId: randomUUID(),
			replacementEmployeeId,
			acknowledgeUnassignedDuties: replacementEmployeeId === null,
		});
		if (result.status !== "effective") throw new Error(`departure ${result.status}`);
		return result.departureId;
	}

	async function handoverTasks(departureId: string) {
		const result = await fixture.pool.query<{
			id: string;
			status: string;
			payload: Record<string, unknown>;
			last_error: string | null;
		}>(
			`select id, status, payload, last_error from employee_departure_task
			 where organization_id = $1 and departure_id = $2 and kind = 'approval_handover'
			 order by payload->>'assignmentId'`,
			[fixture.organizationId, departureId],
		);
		return result.rows;
	}

	async function onlyTask(departureId: string) {
		const [task, ...rest] = await handoverTasks(departureId);
		if (!task || rest.length > 0) throw new Error("expected exactly one handover task");
		return task;
	}

	/** Claims exactly one task with a fresh lease, as the outbox does. */
	async function claim(taskId: string): Promise<DepartureTaskClaim> {
		const claimToken = randomUUID();
		const result = await fixture.pool.query(
			`update employee_departure_task
			 set status = 'processing', claim_token = $3, attempt_count = attempt_count + 1,
				available_at = $4, last_error = null
			 where organization_id = $1 and id = $2
			 returning id, employee_id, employment_period_id, departure_id, kind, payload, attempt_count`,
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
			kind: row.kind,
			payload: row.payload,
			claimToken,
			attemptCount: row.attempt_count,
		};
	}

	/** Delivers one task through the production delivery loop and handler. */
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
					runtime: handoverRuntime(),
				}),
			},
		});
	}

	async function assignments(workflowId: string) {
		const result = await fixture.pool.query<{
			id: string;
			approver_employee_id: string;
			status: string;
			reassigned_from_assignment_id: string | null;
			reassignment_metadata: Record<string, unknown> | null;
		}>(
			`select id, approver_employee_id, status, reassigned_from_assignment_id, reassignment_metadata
			 from approval_stage_assignment where organization_id = $1 and workflow_id = $2
			 order by assignment_sequence`,
			[fixture.organizationId, workflowId],
		);
		return result.rows;
	}

	async function handoverReviews(departureId: string) {
		const result = await fixture.pool.query<{
			subject_id: string;
			status: string;
			metadata: Record<string, unknown>;
		}>(
			`select subject_id, status, metadata from employee_departure_review
			 where organization_id = $1 and departure_id = $2 and kind = 'approval_handover'
			 order by subject_id`,
			[fixture.organizationId, departureId],
		);
		return result.rows;
	}

	describe("capture", () => {
		it("captures duties held at scheduling and those added before the cutoff", async () => {
			const departing = await fixture.seedEmployee({ role: "admin" });
			const early = await seedDuty(departing);
			now = SCHEDULED_AT;
			const scheduled = await commands().scheduleDeparture(owner(), {
				employeeId: departing.employeeId,
				requestId: randomUUID(),
				expectedRevision: null,
				lastWorkingDay: "2026-09-30",
				replacementEmployeeId: replacement.employeeId,
				acknowledgeUnassignedDuties: false,
			});
			const late = await seedDuty(departing);
			const legacyRequestId = randomUUID();
			await fixture.pool.query(
				`insert into approval_request (id, organization_id, entity_type, entity_id, requested_by,
					approver_id, status, created_at, updated_at)
				 values ($1, $2, 'travel_expense_claim', $3, $4, $5, 'pending', now(), now())`,
				[
					legacyRequestId,
					fixture.organizationId,
					randomUUID(),
					requester.employeeId,
					departing.employeeId,
				],
			);

			now = AFTER_CUTOFF;
			await expect(
				commands().executeDeparture({
					organizationId: fixture.organizationId,
					employeeId: departing.employeeId,
					employmentPeriodId: departing.employmentPeriodId,
					departureId: scheduled.departureId,
					revision: scheduled.revision,
				}),
			).resolves.toMatchObject({ status: "effective" });

			const tasks = await handoverTasks(scheduled.departureId);
			expect(
				tasks
					.map((task) => task.payload)
					.sort((a, b) => String(a.assignmentId).localeCompare(String(b.assignmentId))),
			).toEqual(
				[early, late]
					.map((duty) => ({
						workflowId: duty.workflow,
						stageId: duty.firstStage,
						assignmentId: duty.assignments[0],
						fromEmployeeId: departing.employeeId,
						replacementEmployeeId: replacement.employeeId,
					}))
					.sort((a, b) => String(a.assignmentId).localeCompare(String(b.assignmentId))),
			);
			expect(tasks.every((task) => task.status === "pending")).toBe(true);
			expect(await handoverReviews(scheduled.departureId)).toEqual([
				expect.objectContaining({
					subject_id: legacyRequestId,
					status: "open",
					metadata: expect.objectContaining({ reason: "legacy_authority" }),
				}),
			]);
		});
	});

	describe("delivery", () => {
		it("transfers the captured duty to the replacement under the system actor with lineage", async () => {
			const departing = await fixture.seedEmployee({ role: "admin" });
			const duty = await seedDuty(departing);
			now = SCHEDULED_AT;
			const departureId = await offboard(departing, replacement.employeeId);
			const task = await onlyTask(departureId);

			await expect(deliver(task.id)).resolves.toMatchObject({ completed: 1 });

			const rows = await assignments(duty.workflow);
			expect(rows).toEqual([
				expect.objectContaining({
					id: duty.assignments[0],
					approver_employee_id: departing.employeeId,
					status: "cancelled",
				}),
				expect.objectContaining({
					approver_employee_id: replacement.employeeId,
					status: "pending",
					reassigned_from_assignment_id: duty.assignments[0],
					reassignment_metadata: {
						kind: "reassignment",
						offboarding: {
							departureId,
							employmentPeriodId: departing.employmentPeriodId,
							handoverTaskId: task.id,
							sourceAssignmentId: duty.assignments[0],
						},
					},
				}),
			]);
			const event = await fixture.pool.query(
				`select actor_kind, metadata from approval_workflow_event
				 where organization_id = $1 and workflow_id = $2 and event_type = 'assignment.reassigned'`,
				[fixture.organizationId, duty.workflow],
			);
			expect(event.rows).toEqual([
				expect.objectContaining({
					actor_kind: "system",
					metadata: expect.objectContaining({
						offboarding: expect.objectContaining({ departureId, handoverTaskId: task.id }),
					}),
				}),
			]);
			expect(JSON.stringify(event.rows)).not.toContain(departing.userId);
			const completed = await onlyTask(departureId);
			expect(completed.status).toBe("completed");
			expect(completed.payload.outcome).toBe("transferred");
		});

		it("keeps a decision that wins the race and records the handover as a no-op", async () => {
			const departing = await fixture.seedEmployee({ role: "admin" });
			const duty = await seedDuty(departing);
			now = SCHEDULED_AT;
			const departureId = await offboard(departing, replacement.employeeId);
			const task = await onlyTask(departureId);

			await absenceApprovalRuntime(fixture, clock, {
				canManageApproval: true,
			}).transitionEngine.execute({
				organizationId: fixture.organizationId,
				workflowId: duty.workflow,
				expectedVersion: 1,
				idempotencyKey: `admin-approve:${duty.workflow}`,
				principal: { kind: "employee", userId: fixture.ownerUserId },
				command: {
					type: "approve",
					stageId: duty.firstStage,
					assignmentId: duty.assignments[0] ?? "",
				},
			});
			await expect(deliver(task.id)).resolves.toMatchObject({ completed: 1 });

			expect(await assignments(duty.workflow)).toEqual([
				expect.objectContaining({ id: duty.assignments[0], status: "approved" }),
			]);
			expect((await onlyTask(departureId)).payload.outcome).toBe("source_resolved");
		});

		it("settles a concurrent decision and transfer into one coherent history", async () => {
			const departing = await fixture.seedEmployee({ role: "admin" });
			const duty = await seedDuty(departing);
			now = SCHEDULED_AT;
			const departureId = await offboard(departing, replacement.employeeId);
			const task = await onlyTask(departureId);

			const [decision] = await Promise.allSettled([
				absenceApprovalRuntime(fixture, clock, {
					canManageApproval: true,
				}).transitionEngine.execute({
					organizationId: fixture.organizationId,
					workflowId: duty.workflow,
					expectedVersion: 1,
					idempotencyKey: `admin-race:${duty.workflow}`,
					principal: { kind: "employee", userId: fixture.ownerUserId },
					command: {
						type: "approve",
						stageId: duty.firstStage,
						assignmentId: duty.assignments[0] ?? "",
					},
				}),
				deliver(task.id),
			]);

			const rows = await assignments(duty.workflow);
			const outcome = (await onlyTask(departureId)).payload.outcome;
			if (decision.status === "fulfilled") {
				expect(rows).toEqual([expect.objectContaining({ status: "approved" })]);
				expect(outcome).toBe("source_resolved");
			} else {
				expect(rows.map((row) => row.status)).toEqual(["cancelled", "pending"]);
				expect(outcome).toBe("transferred");
			}
		});

		it("replays a transfer committed before a worker crash without a second transfer", async () => {
			const departing = await fixture.seedEmployee({ role: "admin" });
			const duty = await seedDuty(departing);
			now = SCHEDULED_AT;
			const departureId = await offboard(departing, replacement.employeeId);
			const task = await onlyTask(departureId);
			const crashed = await claim(task.id);
			await handoverRuntime().transitionEngine.execute({
				organizationId: fixture.organizationId,
				workflowId: duty.workflow,
				expectedVersion: 1,
				idempotencyKey: `offboarding:${departureId}:${duty.assignments[0]}`,
				principal: {
					kind: "system",
					systemId: "employee-offboarding",
					departureId,
					employmentPeriodId: departing.employmentPeriodId,
					assignmentId: duty.assignments[0] ?? "",
					handoverTaskId: task.id,
					claimToken: crashed.claimToken,
				},
				command: {
					type: "reassign",
					stageId: duty.firstStage,
					fromEmployeeId: departing.employeeId,
					toEmployeeId: replacement.employeeId,
				},
			});

			// The lease expires and a new worker reclaims the task.
			now = now.add({ minutes: 10 });
			await expect(deliver(task.id)).resolves.toMatchObject({ completed: 1 });

			expect((await assignments(duty.workflow)).map((row) => row.status)).toEqual([
				"cancelled",
				"pending",
			]);
			expect((await onlyTask(departureId)).payload.outcome).toBe("transferred");
		});

		it("never touches duties created after a rehire from an old retry", async () => {
			const departing = await fixture.seedEmployee({ role: "admin" });
			const oldDuty = await seedDuty(departing);
			now = SCHEDULED_AT;
			const departureId = await offboard(departing, replacement.employeeId);
			const task = await onlyTask(departureId);
			// A new stint: open period and active again, with a fresh duty.
			await fixture.pool.query(
				`insert into employee_employment_period
				 (organization_id, employee_id, status, started_at, start_provenance)
				 values ($1, $2, 'open', $3, 'recorded')`,
				[fixture.organizationId, departing.employeeId, new Date(now.epochMilliseconds)],
			);
			await fixture.pool.query(
				`update employee set is_active = true where organization_id = $1 and id = $2`,
				[fixture.organizationId, departing.employeeId],
			);
			const newDuty = await seedDuty(departing);

			await expect(deliver(task.id)).resolves.toMatchObject({ completed: 1 });

			expect((await onlyTask(departureId)).payload.outcome).toBe("employee_rehired");
			for (const duty of [oldDuty, newDuty]) {
				expect(await assignments(duty.workflow)).toEqual([
					expect.objectContaining({
						approver_employee_id: departing.employeeId,
						status: "pending",
					}),
				]);
			}
		});
	});

	describe("future stage activation", () => {
		it("routes a later stage for the departed approver to the captured replacement", async () => {
			const departing = await fixture.seedEmployee({ role: "admin" });
			const firstApprover = await fixture.seedEmployee({ role: "admin" });
			const duty = await seedPendingAbsenceWorkflow(fixture, {
				requester,
				approverEmployeeIds: [firstApprover.employeeId],
				at: new Date(now.epochMilliseconds),
				secondStageResolver: {
					approverType: "specific_employee",
					approverEmployeeId: departing.employeeId,
					fallbackBehavior: "fail",
				},
			});
			now = SCHEDULED_AT;
			await offboard(departing, replacement.employeeId);

			const result = await absenceApprovalRuntime(fixture, clock).transitionEngine.execute({
				organizationId: fixture.organizationId,
				workflowId: duty.workflow,
				expectedVersion: 1,
				idempotencyKey: `stage-1:${duty.workflow}`,
				principal: { kind: "employee", userId: firstApprover.userId },
				command: {
					type: "approve",
					stageId: duty.firstStage,
					assignmentId: duty.assignments[0] ?? "",
				},
			});

			expect(result.snapshot.stages.find((stage) => stage.id === duty.secondStage)).toMatchObject({
				status: "pending",
				assignments: [{ approverEmployeeId: replacement.employeeId, status: "pending" }],
			});
		});

		it("records a later stage for the departed approver as review work without a replacement", async () => {
			const departing = await fixture.seedEmployee({ role: "admin" });
			const firstApprover = await fixture.seedEmployee({ role: "admin" });
			const laterStage = {
				approverType: "specific_employee",
				approverEmployeeId: departing.employeeId,
				fallbackBehavior: "fail",
			} as const;
			await seedPendingAbsenceWorkflow(fixture, {
				requester,
				approverEmployeeIds: [firstApprover.employeeId],
				at: new Date(now.epochMilliseconds),
				secondStageResolver: laterStage,
			});
			now = SCHEDULED_AT;
			const coveredDeparture = await offboard(departing, replacement.employeeId);
			// With a replacement, stage activation resolves the later stage; nothing to review.
			expect(await handoverReviews(coveredDeparture)).toEqual([]);

			const uncoveredApprover = await fixture.seedEmployee({ role: "admin" });
			const uncovered = await seedPendingAbsenceWorkflow(fixture, {
				requester,
				approverEmployeeIds: [firstApprover.employeeId],
				at: new Date(now.epochMilliseconds),
				secondStageResolver: { ...laterStage, approverEmployeeId: uncoveredApprover.employeeId },
			});
			const departureId = await offboard(uncoveredApprover, null);

			expect(await handoverTasks(departureId)).toEqual([]);
			expect(await handoverReviews(departureId)).toEqual([
				expect.objectContaining({
					subject_id: uncovered.secondStage,
					status: "open",
					metadata: expect.objectContaining({
						reason: "future_stage_without_replacement",
						source: "approval_workflow_stage",
						workflowId: uncovered.workflow,
						stageId: uncovered.secondStage,
					}),
				}),
			]);
		});
	});

	describe("review and resolution", () => {
		it("turns a missing replacement into review work and retries after an admin assigns one", async () => {
			const departing = await fixture.seedEmployee({ role: "admin" });
			const duty = await seedDuty(departing);
			now = SCHEDULED_AT;
			const departureId = await offboard(departing, null);
			const task = await onlyTask(departureId);

			await expect(deliver(task.id)).resolves.toMatchObject({ failed: 1 });
			expect(await onlyTask(departureId)).toMatchObject({ status: "failed" });
			expect(await handoverReviews(departureId)).toEqual([
				expect.objectContaining({
					subject_id: duty.assignments[0],
					status: "open",
					metadata: expect.objectContaining({ reason: "no_replacement" }),
				}),
			]);
			const departure = await fixture.pool.query(
				`select status from employee_departure where organization_id = $1 and id = $2`,
				[fixture.organizationId, departureId],
			);
			expect(departure.rows).toEqual([{ status: "effective" }]);

			const requestId = randomUUID();
			const assignment = {
				departureId,
				handoverTaskId: task.id,
				replacementEmployeeId: replacement.employeeId,
				requestId,
			};
			await assignDepartureReplacement(fixture.db, owner(), assignment, now);
			// A retried submission of the same request changes nothing.
			await assignDepartureReplacement(fixture.db, owner(), assignment, now);
			await expect(
				assignDepartureReplacement(
					fixture.db,
					owner(),
					{ ...assignment, replacementEmployeeId: requester.employeeId },
					now,
				),
			).rejects.toMatchObject({ code: "request_conflict" });

			await expect(deliver(task.id)).resolves.toMatchObject({ completed: 1 });
			expect((await assignments(duty.workflow)).map((row) => row.status)).toEqual([
				"cancelled",
				"pending",
			]);
			expect(await handoverReviews(departureId)).toEqual([
				expect.objectContaining({ subject_id: duty.assignments[0], status: "resolved" }),
			]);
		});

		it("does not transfer to a replacement without a decision path", async () => {
			const departing = await fixture.seedEmployee({ role: "admin" });
			const plain = await fixture.seedEmployee();
			const duty = await seedDuty(departing);
			now = SCHEDULED_AT;
			const departureId = await offboard(departing, plain.employeeId);
			const task = await onlyTask(departureId);

			await expect(deliver(task.id)).resolves.toMatchObject({ failed: 1 });

			expect(await assignments(duty.workflow)).toEqual([
				expect.objectContaining({ approver_employee_id: departing.employeeId, status: "pending" }),
			]);
			expect(await handoverReviews(departureId)).toEqual([
				expect.objectContaining({
					status: "open",
					metadata: expect.objectContaining({ reason: "target_ineligible" }),
				}),
			]);
		});

		it("only lets an owner or admin assign a replacement", async () => {
			const departing = await fixture.seedEmployee({ role: "admin" });
			await seedDuty(departing);
			now = SCHEDULED_AT;
			const departureId = await offboard(departing, null);
			const task = await onlyTask(departureId);
			const member = await fixture.seedEmployee();

			await expect(
				assignDepartureReplacement(
					fixture.db,
					{ userId: member.userId, organizationId: fixture.organizationId },
					{
						departureId,
						handoverTaskId: task.id,
						replacementEmployeeId: replacement.employeeId,
						requestId: randomUUID(),
					},
					now,
				),
			).rejects.toMatchObject({ code: "actor_not_authorized" });
		});
	});

	describe("authority against persisted evidence", () => {
		async function capturedHandover() {
			const departing = await fixture.seedEmployee({ role: "admin" });
			const duty = await seedDuty(departing);
			now = SCHEDULED_AT;
			const departureId = await offboard(departing, replacement.employeeId);
			const task = await onlyTask(departureId);
			const claimed = await claim(task.id);
			const principal = {
				kind: "system" as const,
				systemId: "employee-offboarding" as const,
				departureId,
				employmentPeriodId: departing.employmentPeriodId,
				assignmentId: duty.assignments[0] ?? "",
				handoverTaskId: task.id,
				claimToken: claimed.claimToken,
			};
			const request = {
				organizationId: fixture.organizationId,
				workflowId: duty.workflow,
				expectedVersion: 1,
				idempotencyKey: `offboarding:${departureId}:${duty.assignments[0]}`,
				principal,
				command: {
					type: "reassign" as const,
					stageId: duty.firstStage,
					fromEmployeeId: departing.employeeId,
					toEmployeeId: replacement.employeeId,
				},
			};
			return { duty, departing, principal, request };
		}

		it("rejects a forged claim token and a principal from another organization", async () => {
			const { request, principal } = await capturedHandover();
			await expect(
				handoverRuntime().transitionEngine.execute({
					...request,
					principal: { ...principal, claimToken: randomUUID() },
				}),
			).rejects.toMatchObject({ reason: "lease_not_owned" });

			const foreignOrganizationId = await fixture.createOrganization();
			await expect(
				handoverRuntime().transitionEngine.execute({
					...request,
					organizationId: foreignOrganizationId,
				}),
			).rejects.toThrow();
			await expect(
				handoverRuntime().transitionEngine.execute({
					...request,
					principal: { ...principal, departureId: randomUUID() },
				}),
			).rejects.toMatchObject({ reason: "departure_mismatch" });
		});

		it("rejects a different target under the same idempotency key", async () => {
			const { request, duty } = await capturedHandover();
			await handoverRuntime().transitionEngine.execute(request);
			const other = await fixture.seedEmployee({ role: "admin" });

			await expect(
				handoverRuntime().transitionEngine.execute({
					...request,
					expectedVersion: 2,
					command: { ...request.command, toEmployeeId: other.employeeId },
				}),
			).rejects.toMatchObject({ code: "idempotency_mismatch" });
			expect(
				(await assignments(duty.workflow)).map((row) => row.approver_employee_id),
			).not.toContain(other.employeeId);
		});

		it("cannot approve, even as the captured principal", async () => {
			const { request, duty } = await capturedHandover();
			await expect(
				handoverRuntime().transitionEngine.execute({
					...request,
					idempotencyKey: `forged-approve:${duty.workflow}`,
					command: {
						type: "approve",
						stageId: duty.firstStage,
						assignmentId: duty.assignments[0] ?? "",
					},
				}),
			).rejects.toThrow();
			expect((await assignments(duty.workflow)).map((row) => row.status)).toEqual(["pending"]);
		});
	});
});
