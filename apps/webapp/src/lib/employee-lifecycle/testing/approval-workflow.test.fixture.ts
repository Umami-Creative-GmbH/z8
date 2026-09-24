/**
 * Seeds canonical absence approval workflows for employee lifecycle
 * integration tests. Only used against the label-owned disposable database.
 */
import { randomUUID } from "node:crypto";
import { Effect } from "effect";
import { finalizeAbsenceTerminalInTransaction } from "@/lib/approvals/server/absence-approvals";
import type { ApprovalDbService } from "@/lib/approvals/server/types";
import type { ApprovalWorkflowDatabase } from "@/lib/approvals/workflow/repository";
import { createProductionApprovalWorkflowRuntime } from "@/lib/approvals/workflow/runtime";
import type { Clock } from "@/lib/datetime/temporal-core";
import type { LifecycleDatabaseFixture, SeededEmployee } from "./database.test.fixture";

export type SeededAbsenceWorkflow = {
	category: string;
	record: string;
	absence: string;
	workflow: string;
	firstStage: string;
	secondStage: string | null;
	assignments: string[];
};

/** Canonical absence decisions without a legacy mirror. */
export async function enableCanonicalAbsences(fixture: LifecycleDatabaseFixture, at: Date) {
	await fixture.pool.query(
		`insert into approval_workflow_rollout
		 (organization_id, workflow_type, lifecycle_mode, side_effect_mode, created_at, updated_at)
		 values ($1, 'absence', 'complete', 'canonical', $2, $2)
		 on conflict do nothing`,
		[fixture.organizationId, at],
	);
}

/**
 * A submitted absence with its canonical record whose first stage is pending
 * with the given approvers (one assignment each). An optional second stage
 * waits with the given resolver snapshot.
 */
export async function seedPendingAbsenceWorkflow(
	fixture: LifecycleDatabaseFixture,
	input: {
		requester: SeededEmployee;
		approverEmployeeIds: string[];
		at: Date;
		secondStageResolver?: Record<string, unknown>;
	},
): Promise<SeededAbsenceWorkflow> {
	const ids = {
		category: randomUUID(),
		record: randomUUID(),
		absence: randomUUID(),
		workflow: randomUUID(),
		firstStage: randomUUID(),
		secondStage: input.secondStageResolver ? randomUUID() : null,
		assignments: input.approverEmployeeIds.map(() => randomUUID()),
	};
	const org = fixture.organizationId;
	const { at, requester } = input;
	await fixture.pool.query(
		`insert into absence_category (id, organization_id, type, name, requires_work_time,
			requires_approval, counts_against_vacation, is_active, created_at, updated_at)
		 values ($1, $2, 'vacation', 'Vacation', false, true, true, true, $3, $3)`,
		[ids.category, org, at],
	);
	await fixture.pool.query(
		`insert into time_record (id, organization_id, employee_id, record_kind, start_at, end_at,
			approval_state, origin, created_at, created_by, updated_at)
		 values ($1, $2, $3, 'absence', '2026-10-05T00:00:00Z', '2026-10-06T00:00:00Z',
			'pending', 'manual', $4, $5, $4)`,
		[ids.record, org, requester.employeeId, at, requester.userId],
	);
	await fixture.pool.query(
		`insert into time_record_absence (record_id, organization_id, record_kind, absence_category_id)
		 values ($1, $2, 'absence', $3)`,
		[ids.record, org, ids.category],
	);
	await fixture.pool.query(
		`insert into absence_entry (id, employee_id, category_id, start_date, end_date, status,
			organization_id, canonical_record_id, created_at, updated_at)
		 values ($1, $2, $3, '2026-10-05', '2026-10-05', 'pending', $4, $5, $6, $6)`,
		[ids.absence, requester.employeeId, ids.category, org, ids.record, at],
	);
	await fixture.pool.query(
		`insert into approval_workflow (id, organization_id, workflow_type, source_type, source_id,
			requester_employee_id, status, current_stage_order, version, policy_snapshot,
			context_snapshot, display_snapshot, submitted_at, created_at, updated_at)
		 values ($1, $2, 'absence', 'absence_entry', $3, $4, 'pending', 1, 1, '{}', '{}', '{}', $5, $5, $5)`,
		[ids.workflow, org, ids.absence, requester.employeeId, at],
	);
	await fixture.pool.query(
		`update absence_entry set approval_workflow_id = $1 where organization_id = $2 and id = $3`,
		[ids.workflow, org, ids.absence],
	);
	await fixture.pool.query(
		`insert into approval_workflow_stage (id, organization_id, workflow_id, stage_order, label,
			resolver_snapshot, activation_mode, status, activated_at, created_at, updated_at)
		 values ($1, $2, $3, 1, 'Manager', $4, 'human', 'pending', $5, $5, $5)`,
		[
			ids.firstStage,
			org,
			ids.workflow,
			JSON.stringify({ approverType: "direct_manager", fallbackBehavior: "fail" }),
			at,
		],
	);
	if (ids.secondStage) {
		await fixture.pool.query(
			`insert into approval_workflow_stage (id, organization_id, workflow_id, stage_order, label,
				resolver_snapshot, activation_mode, status, activated_at, created_at, updated_at)
			 values ($1, $2, $3, 2, 'Second review', $4, 'human', 'waiting', null, $5, $5)`,
			[ids.secondStage, org, ids.workflow, JSON.stringify(input.secondStageResolver), at],
		);
	}
	for (const [index, approverEmployeeId] of input.approverEmployeeIds.entries()) {
		await fixture.pool.query(
			`insert into approval_stage_assignment (id, organization_id, workflow_id, stage_id,
				assignment_sequence, approver_employee_id, status, assigned_at, created_at, updated_at)
			 values ($1, $2, $3, $4, $5, $6, 'pending', $7, $7, $7)`,
			[
				ids.assignments[index],
				org,
				ids.workflow,
				ids.firstStage,
				index + 1,
				approverEmployeeId,
				at,
			],
		);
	}
	return ids;
}

/** Production approval runtime with the real absence finalizer. */
export function absenceApprovalRuntime(
	fixture: LifecycleDatabaseFixture,
	clock: Clock,
	options: { canManageApproval?: boolean } = {},
) {
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
					throw new Error("cancellation is outside lifecycle suites");
				},
			},
			timeCorrection: {
				clock,
				finalizeTimeCorrectionTerminal: async () => {
					throw new Error("time correction is outside lifecycle suites");
				},
				deleteCancelledCorrections: async () => {
					throw new Error("time correction is outside lifecycle suites");
				},
			},
			ordinaryWorkPeriod: {
				finalizeTerminal: async () => {
					throw new Error("ordinary work periods are outside lifecycle suites");
				},
			},
		},
		canManageApproval: async () => options.canManageApproval === true,
		clock,
	});
}
