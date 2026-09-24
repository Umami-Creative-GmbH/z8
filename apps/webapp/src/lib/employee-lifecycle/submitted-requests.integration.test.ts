/**
 * PostgreSQL contract: pnpm --filter webapp test:approval-workflow-repository:integration
 * Claims an employee submitted before departure stay decidable by their
 * current approvers, keep their requester identity, and cannot be acted on by
 * the departed employee. Time-correction and ordinary work-period decisions
 * after departure are covered in their own approval integration suites.
 */
import { randomUUID } from "node:crypto";
import { Effect } from "effect";
import { afterAll, beforeAll, expect, it } from "vitest";
import {
	ApprovalAuditLogger,
	createApprovalAuditLogger,
} from "@/lib/approvals/infrastructure/audit-logger";
import { getPrimaryEligibleManagerIdForRequester } from "@/lib/approvals/policies/manager-eligibility-db";
import { processApprovalWithCurrentEmployee } from "@/lib/approvals/server/shared";
import {
	persistTravelExpenseDecision,
	preflightTravelExpenseDecision,
} from "@/lib/approvals/server/travel-expense-approvals";
import type { ApprovalDbService, CurrentApprover } from "@/lib/approvals/server/types";
import { type Instant, parseInstant } from "@/lib/datetime/temporal-core";
import { resolveEmployeeOrganizationAccess } from "./access";
import { createDepartureCommands } from "./commands";
import {
	absenceApprovalRuntime,
	enableCanonicalAbsences,
	seedPendingAbsenceWorkflow,
} from "./testing/approval-workflow.test.fixture";
import {
	createLifecycleDatabaseFixture,
	describeLifecycleDatabase,
	type LifecycleDatabaseFixture,
	type SeededEmployee,
} from "./testing/database.test.fixture";

const SUBMITTED_AT = parseInstant("2026-09-14T08:00:00Z");
const DEPARTED_AT = parseInstant("2026-09-15T08:00:00Z");

describeLifecycleDatabase("submitted requests after departure", () => {
	let fixture: LifecycleDatabaseFixture;
	let now: Instant = SUBMITTED_AT;
	let requester: SeededEmployee;
	let firstApprover: SeededEmployee;
	let secondApprover: SeededEmployee;

	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();
		requester = await fixture.seedEmployee();
		firstApprover = await fixture.seedEmployee();
		secondApprover = await fixture.seedEmployee();
		await fixture.pool.query(
			`update employee set role = 'manager' where organization_id = $1 and id = any($2::uuid[])`,
			[fixture.organizationId, [firstApprover.employeeId, secondApprover.employeeId]],
		);
		await fixture.pool.query(
			`insert into employee_managers (id, employee_id, manager_id, is_primary, assigned_by, assigned_at, created_at)
			 values ($1, $2, $3, true, $4, $5, $5)`,
			[
				randomUUID(),
				requester.employeeId,
				firstApprover.employeeId,
				fixture.ownerUserId,
				new Date(SUBMITTED_AT.epochMilliseconds),
			],
		);
		await enableCanonicalAbsences(fixture, new Date(SUBMITTED_AT.epochMilliseconds));
	});

	afterAll(async () => {
		await fixture?.close();
	});

	function runtime() {
		return absenceApprovalRuntime(fixture, { nowInstant: () => now });
	}

	async function depart(employee: SeededEmployee) {
		now = DEPARTED_AT;
		const result = await createDepartureCommands({
			db: fixture.db,
			clock: { nowInstant: () => now },
			clockOut: { close: async () => ({ kind: "not_running" }) },
		}).offboardNow(
			{ userId: fixture.ownerUserId, organizationId: fixture.organizationId },
			{
				employeeId: employee.employeeId,
				requestId: randomUUID(),
				replacementEmployeeId: null,
				acknowledgeUnassignedDuties: true,
			},
		);
		expect(result.status).toBe("effective");
	}

	/** First stage pending with the requester's manager, second stage waiting. */
	async function seedTwoStageAbsence() {
		const seeded = await seedPendingAbsenceWorkflow(fixture, {
			requester,
			approverEmployeeIds: [firstApprover.employeeId],
			at: new Date(SUBMITTED_AT.epochMilliseconds),
			secondStageResolver: {
				approverType: "specific_employee",
				approverEmployeeId: secondApprover.employeeId,
				fallbackBehavior: "fail",
			},
		});
		const [assignment] = seeded.assignments;
		if (!assignment || !seeded.secondStage) throw new Error("absence not seeded");
		return { ...seeded, assignment, secondStage: seeded.secondStage };
	}

	async function seedSubmittedExpense() {
		const claimId = randomUUID();
		const requestId = randomUUID();
		const at = new Date(SUBMITTED_AT.epochMilliseconds);
		await fixture.pool.query(
			`insert into travel_expense_claim (id, organization_id, employee_id, approver_id, type, status,
				trip_start, trip_end, original_currency, original_amount, calculated_currency,
				calculated_amount, submitted_at, created_by, created_at, updated_at)
			 values ($1, $2, $3, $4, 'receipt', 'submitted', '2026-09-01', '2026-09-02', 'EUR', 42,
				'EUR', 42, $5, $6, $5, $5)`,
			[
				claimId,
				fixture.organizationId,
				requester.employeeId,
				firstApprover.employeeId,
				at,
				requester.userId,
			],
		);
		await fixture.pool.query(
			`insert into approval_request (id, organization_id, entity_type, entity_id, requested_by,
				approver_id, status, created_at, updated_at)
			 values ($1, $2, 'travel_expense_claim', $3, $4, $5, 'pending', $6, $6)`,
			[
				requestId,
				fixture.organizationId,
				claimId,
				requester.employeeId,
				firstApprover.employeeId,
				at,
			],
		);
		return { claimId, requestId };
	}

	async function currentApprover(employee: SeededEmployee): Promise<CurrentApprover> {
		const loaded = await fixture.db.query.employee.findFirst({
			where: (row, { and, eq }) =>
				and(eq(row.organizationId, fixture.organizationId), eq(row.id, employee.employeeId)),
			with: { user: true },
		});
		if (!loaded) throw new Error("approver not seeded");
		return loaded as CurrentApprover;
	}

	it("keeps a departed employee's multi-stage absence decidable and its identity intact", async () => {
		now = SUBMITTED_AT;
		const absence = await seedTwoStageAbsence();
		await depart(requester);

		const first = await runtime().transitionEngine.execute({
			organizationId: fixture.organizationId,
			workflowId: absence.workflow,
			expectedVersion: 1,
			idempotencyKey: `stage-1:${absence.workflow}`,
			principal: { kind: "employee", userId: firstApprover.userId },
			command: { type: "approve", stageId: absence.firstStage, assignmentId: absence.assignment },
		});
		const secondStage = first.snapshot.stages.find((stage) => stage.id === absence.secondStage);
		expect(secondStage).toMatchObject({
			status: "pending",
			assignments: [{ approverEmployeeId: secondApprover.employeeId, status: "pending" }],
		});

		const second = await runtime().transitionEngine.execute({
			organizationId: fixture.organizationId,
			workflowId: absence.workflow,
			expectedVersion: first.snapshot.version,
			idempotencyKey: `stage-2:${absence.workflow}`,
			principal: { kind: "employee", userId: secondApprover.userId },
			command: {
				type: "approve",
				stageId: absence.secondStage,
				assignmentId: secondStage?.assignments[0]?.id ?? "",
			},
		});

		expect(second.snapshot).toMatchObject({
			status: "approved",
			requesterEmployeeId: requester.employeeId,
			sourceId: absence.absence,
		});
		const source = await fixture.pool.query<{ status: string; employee_id: string }>(
			`select status, employee_id from absence_entry where organization_id = $1 and id = $2`,
			[fixture.organizationId, absence.absence],
		);
		expect(source.rows).toEqual([{ status: "approved", employee_id: requester.employeeId }]);
	});

	it("keeps a departed employee's submitted expense decidable by the assigned approver", async () => {
		const expense = await seedSubmittedExpense();
		const approver = await currentApprover(firstApprover);
		const dbService: ApprovalDbService = {
			db: fixture.db as unknown as ApprovalDbService["db"],
			query: (_name, operation) => Effect.promise(operation),
		};

		await Effect.runPromise(
			processApprovalWithCurrentEmployee(
				dbService,
				approver,
				"travel_expense_claim",
				expense.claimId,
				"approve",
				undefined,
				(service, claimId, current) =>
					persistTravelExpenseDecision(service, claimId, current, "approve"),
				(service, claimId, current) =>
					preflightTravelExpenseDecision(service, claimId, current, "approve"),
				{ transactional: true },
			).pipe(
				Effect.provideService(ApprovalAuditLogger, createApprovalAuditLogger(dbService)),
			) as Effect.Effect<unknown, unknown, never>,
		);

		const claim = await fixture.pool.query<{ status: string; employee_id: string }>(
			`select status, employee_id from travel_expense_claim where organization_id = $1 and id = $2`,
			[fixture.organizationId, expense.claimId],
		);
		expect(claim.rows).toEqual([{ status: "approved", employee_id: requester.employeeId }]);
	});

	it("denies the departed employee new submissions, access and approvals with a stale session", async () => {
		await expect(
			getPrimaryEligibleManagerIdForRequester({
				db: fixture.db as never,
				requesterEmployeeId: requester.employeeId,
				organizationId: fixture.organizationId,
			}),
		).resolves.toBeNull();
		await expect(
			resolveEmployeeOrganizationAccess(fixture.db, {
				organizationId: fixture.organizationId,
				userId: requester.userId,
				now,
			}),
		).resolves.toMatchObject({ allowed: false });

		// A duty left with the departed employee cannot be exercised by them.
		now = SUBMITTED_AT;
		const absence = await seedTwoStageAbsence();
		await fixture.pool.query(
			`update approval_stage_assignment set approver_employee_id = $1
			 where organization_id = $2 and id = $3`,
			[requester.employeeId, fixture.organizationId, absence.assignment],
		);
		now = DEPARTED_AT;
		await expect(
			runtime().transitionEngine.execute({
				organizationId: fixture.organizationId,
				workflowId: absence.workflow,
				expectedVersion: 1,
				idempotencyKey: `stale:${absence.workflow}`,
				principal: { kind: "employee", userId: requester.userId },
				command: {
					type: "approve",
					stageId: absence.firstStage,
					assignmentId: absence.assignment,
				},
			}),
		).rejects.toThrow(/employee actor lookup/);
	});

	it("never resolves a historical requester from another organization", async () => {
		const foreignOrganizationId = await fixture.createOrganization();
		const foreign = await fixture.seedEmployee({ organizationId: foreignOrganizationId });
		const requestId = randomUUID();
		await fixture.pool.query(
			`insert into approval_request (id, organization_id, entity_type, entity_id, requested_by,
				approver_id, status, created_at, updated_at)
			 values ($1, $2, 'travel_expense_claim', $3, $4, $5, 'pending', now(), now())`,
			[
				requestId,
				fixture.organizationId,
				randomUUID(),
				foreign.employeeId,
				firstApprover.employeeId,
			],
		);
		const { isEligibleManagerForApprovalRequest } = await import(
			"@/lib/approvals/policies/manager-eligibility-db"
		);

		await expect(
			isEligibleManagerForApprovalRequest({
				db: fixture.db as never,
				approvalRequestId: requestId,
				managerEmployeeId: firstApprover.employeeId,
				organizationId: fixture.organizationId,
			}),
		).resolves.toBe(false);
	});
});
