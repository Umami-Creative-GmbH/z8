/**
 * Local contract: pnpm --filter webapp test:approval-workflow-repository:integration
 * The runner creates, migrates, verifies, and removes a label-owned PostgreSQL 16 database.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Effect } from "effect";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as authSchema from "@/db/auth-schema";
import { configurePostgresUtcTypes } from "@/db/postgres-utc";
import * as schema from "@/db/schema";
import { parseInstant, systemClock } from "@/lib/datetime/temporal-core";
import { calculateHash } from "@/lib/time-tracking/blockchain";
import type { OrdinaryWorkPeriodApprovalKind } from "../domain-adapters/work-period-contract";
import type { ApprovalWorkflowLifecycleMode } from "../workflow/ports";
import type { ApprovalWorkflowDatabase } from "../workflow/repository";
import {
	resolveApprovalWorkflowRepositoryTestConfiguration,
	verifyApprovalWorkflowRepositoryTestDatabase,
} from "../workflow/repository-integration-harness";
import { createProductionApprovalWorkflowRuntime } from "../workflow/runtime";
import type { ApprovalDbService, CurrentApprover } from "./types";
import {
	executeOrdinaryWorkPeriodDecisionInTransaction,
	finalizeOrdinaryWorkPeriodTerminalFromWorkflowTransaction,
} from "./work-period-approvals";
import { executeOrdinaryWorkPeriodSubmissionInTransaction } from "./work-period-submission";

configurePostgresUtcTypes();

const integrationSource = readFileSync(
	join(
		process.cwd(),
		"src/lib/approvals/server/work-period-approvals.integration.test.ts",
	),
	"utf8",
);

describe("ordinary work-period PostgreSQL case registration", () => {
	it("registers the complete Task 11 mode, rollback, race, isolation, and split matrix", () => {
		for (const scenario of [
			"composes submission and terminal decisions in %s mode",
			"rolls back $stage submission stage in $mode mode without residue",
			"requester auto-finalization failure rolls the complete submission back in %s mode",
			"terminal prior history remains immutable while one new conflicting pending submission wins",
			"stale same-organization source link fails generically and rolls back",
			"approve versus reject leaves one coherent terminal graph and a generic conflict loser",
			"duplicate approve replays one coherent terminal graph",
			"Task8A split has exact period, canonical subtype, allocation, workflow, and synthetic-entry parity",
			"forced %s CAS zero row rolls the entire decision back",
			"decision INSERT RETURNING zero rows rolls the complete transaction back",
			"foreign organization rollback snapshots both tenants and every durable graph",
			"exact source advisory lock blocks then commits and replays after release",
			"split races a locked competing employee entry into one reachable hash chain",
		] as const) {
			expect(integrationSource.split(scenario)).toHaveLength(3);
		}
	});
});

const databaseUrl = process.env.APPROVAL_WORKFLOW_REPOSITORY_TEST_DATABASE_URL;
const testSentinel = process.env.APPROVAL_WORKFLOW_REPOSITORY_TEST_SENTINEL;
const integrationRequired =
	process.env.APPROVAL_WORKFLOW_REPOSITORY_TEST_REQUIRED === "1";
const integrationConfiguration =
	resolveApprovalWorkflowRepositoryTestConfiguration({
		databaseUrl,
		required: integrationRequired,
		sentinel: testSentinel,
	});
if (integrationConfiguration.status === "error") {
	throw new Error(
		`Invalid approval workflow repository test configuration: ${integrationConfiguration.reason}`,
	);
}
const describeIntegration =
	integrationConfiguration.status === "enabled" ? describe : describe.skip;
if (integrationConfiguration.status === "unavailable") {
	describe.skip(`ordinary work-period PostgreSQL unavailable: ${integrationConfiguration.reason}`, () => {
		it("requires the label-owned disposable PostgreSQL runner", () => {});
	});
}

const databaseSchema = { ...authSchema, ...schema };
const now = parseInstant("2026-07-22T17:00:00Z");
const startTime = new Date("2026-07-22T08:00:00Z");
const endTime = new Date("2026-07-22T16:00:00Z");
const ids = {
	organization: "task11-ordinary-approval-org",
	foreignOrganization: "task11-ordinary-foreign-org",
	requesterUser: "task11-ordinary-requester-user",
	managerUser: "task11-ordinary-manager-user",
	foreignUser: "task11-ordinary-foreign-user",
	requester: "c1000000-0000-4000-8000-000000000001",
	manager: "c1000000-0000-4000-8000-000000000002",
	foreignEmployee: "c1000000-0000-4000-8000-000000000003",
	managerLink: "c1000000-0000-4000-8000-000000000004",
	clockIn: "c2000000-0000-4000-8000-000000000001",
	clockOut: "c2000000-0000-4000-8000-000000000002",
	competingEntry: "c2000000-0000-4000-8000-000000000003",
	period: "c3000000-0000-4000-8000-000000000001",
	canonical: "c4000000-0000-4000-8000-000000000001",
	submission: "c5000000-0000-4000-8000-000000000001",
	otherSubmission: "c5000000-0000-4000-8000-000000000002",
	policy: "c6000000-0000-4000-8000-000000000001",
	regulation: "c6000000-0000-4000-8000-000000000002",
	breakRule: "c6000000-0000-4000-8000-000000000003",
	policyAssignment: "c6000000-0000-4000-8000-000000000004",
	project: "c7000000-0000-4000-8000-000000000001",
	allocation: "c7000000-0000-4000-8000-000000000002",
	staleWorkflow: "c8000000-0000-4000-8000-000000000001",
	terminalWorkflow: "c8000000-0000-4000-8000-000000000002",
	terminalRequest: "c8000000-0000-4000-8000-000000000003",
	approvalPolicy: "c9000000-0000-4000-8000-000000000001",
	approvalCondition: "c9000000-0000-4000-8000-000000000002",
	approvalStageOne: "c9000000-0000-4000-8000-000000000003",
	approvalStageTwo: "c9000000-0000-4000-8000-000000000004",
} as const;

const modes = ["legacy", "shadow", "ready", "canonical", "complete"] as const;

function dbService(db: unknown): ApprovalDbService {
	return {
		db: db as ApprovalDbService["db"],
		query: <T>(_name: string, operation: () => Promise<T>) =>
			Effect.promise(operation),
	};
}

describeIntegration(
	"ordinary work-period PostgreSQL concurrency and rollback",
	() => {
		const pool = new Pool({ connectionString: databaseUrl, max: 20 });
		const database = drizzle({ client: pool, schema: databaseSchema });
		const manager: CurrentApprover = {
			id: ids.manager,
			userId: ids.managerUser,
			organizationId: ids.organization,
			user: {
				id: ids.managerUser,
				name: "Task 11 Manager",
				email: "task11-manager@example.test",
				image: null,
			},
		};

		function runtime() {
			return createProductionApprovalWorkflowRuntime({
				db: database as unknown as ApprovalWorkflowDatabase,
				adapters: {
					absence: {
						clock: systemClock,
						finalizeAbsenceTerminal: async () => {
							throw new Error("absence is outside Task 11");
						},
						deleteCancelledAbsence: async () => {
							throw new Error("absence is outside Task 11");
						},
					},
					timeCorrection: {
						clock: systemClock,
						finalizeTimeCorrectionTerminal: async () => {
							throw new Error("time correction is outside Task 11");
						},
						deleteCancelledCorrections: async () => {
							throw new Error("time correction is outside Task 11");
						},
					},
					ordinaryWorkPeriod: {
						finalizeTerminal:
							finalizeOrdinaryWorkPeriodTerminalFromWorkflowTransaction,
					},
				},
				canManageApproval: async ({ organizationId, actorEmployeeId }) =>
					organizationId === ids.organization &&
					actorEmployeeId === ids.manager,
				clock: { nowInstant: () => now },
			});
		}

		async function cleanup() {
			await pool.query("delete from organization where id in ($1, $2)", [
				ids.organization,
				ids.foreignOrganization,
			]);
			await pool.query('delete from "user" where id in ($1, $2, $3)', [
				ids.requesterUser,
				ids.managerUser,
				ids.foreignUser,
			]);
		}

		async function seed(
			kind: OrdinaryWorkPeriodApprovalKind = "manual_time_submission",
			withBreakPolicy = false,
			mode: ApprovalWorkflowLifecycleMode = "canonical",
			requesterAutoApproves = false,
			withApprovalChain = false,
		) {
			await cleanup();
			const timestamp = new Date(now.epochMilliseconds);
			await pool.query(
				`insert into organization (id, name, slug, created_at) values
			 ($1, 'Task 11 Ordinary', $1, $3), ($2, 'Task 11 Foreign', $2, $3)`,
				[ids.organization, ids.foreignOrganization, timestamp],
			);
			await pool.query(
				`insert into "user" (id, name, email, created_at, updated_at) values
			 ($1, 'Requester', 'task11-requester@example.test', $4, $4),
			 ($2, 'Manager', 'task11-manager@example.test', $4, $4),
			 ($3, 'Foreign', 'task11-foreign@example.test', $4, $4)`,
				[ids.requesterUser, ids.managerUser, ids.foreignUser, timestamp],
			);
			await pool.query(
				`insert into employee (id, user_id, organization_id, updated_at) values
			 ($1, $2, $6, $8), ($3, $4, $6, $8), ($5, $7, $7, $8)`,
				[
					ids.requester,
					ids.requesterUser,
					ids.manager,
					ids.managerUser,
					ids.foreignEmployee,
					ids.organization,
					ids.foreignOrganization,
					timestamp,
				],
			);
			await pool.query(
				`insert into employee_managers
			 (id, employee_id, manager_id, is_primary, assigned_by, assigned_at, created_at)
			 values ($1, $2, $3, true, $4, $5, $5)`,
				[
					ids.managerLink,
					ids.requester,
					requesterAutoApproves ? ids.requester : ids.manager,
					requesterAutoApproves ? ids.requesterUser : ids.managerUser,
					timestamp,
				],
			);
			await pool.query(
				`insert into user_settings (user_id, timezone, updated_at)
			 values ($1, 'UTC', $2)`,
				[ids.requesterUser, timestamp],
			);
			const clockInHash = calculateHash({
				employeeId: ids.requester,
				type: "clock_in",
				timestamp: startTime.toISOString(),
				previousHash: null,
			});
			const clockOutHash = calculateHash({
				employeeId: ids.requester,
				type: "clock_out",
				timestamp: endTime.toISOString(),
				previousHash: clockInHash,
			});
			await pool.query(
				`insert into time_entry (
			 id, organization_id, employee_id, type, timestamp, utc_offset_minutes,
			 timezone, timezone_source, previous_entry_id, hash, previous_hash,
			 created_by, created_at
			 ) values
			 ($1, $3, $4, 'clock_in', $5, 0, 'UTC', 'backfill', null, $8, null, $7, $5),
			 ($2, $3, $4, 'clock_out', $6, 0, 'UTC', 'backfill', $1, $9, $8, $7, $6)`,
				[
					ids.clockIn,
					ids.clockOut,
					ids.organization,
					ids.requester,
					startTime,
					endTime,
					ids.requesterUser,
					clockInHash,
					clockOutHash,
				],
			);
			await pool.query(
				`insert into project
			 (id, organization_id, name, status, is_active, created_by, updated_at)
			 values ($1, $2, 'Task 11 project', 'active', true, $3, $4)`,
				[ids.project, ids.organization, ids.managerUser, timestamp],
			);
			await pool.query(
				`insert into time_record (
			 id, organization_id, employee_id, record_kind, start_at, end_at,
			 duration_minutes, approval_state, origin, created_at, created_by, updated_at
			 ) values ($1, $2, $3, 'work', $4, $5, 480, 'pending', $6, $7, $8, $7)`,
				[
					ids.canonical,
					ids.organization,
					ids.requester,
					startTime,
					endTime,
					kind === "policy_clock_out" ? "clock" : "manual",
					timestamp,
					ids.requesterUser,
				],
			);
			await pool.query(
				"insert into time_record_work (record_id, organization_id, record_kind) values ($1, $2, 'work')",
				[ids.canonical, ids.organization],
			);
			await pool.query(
				`insert into time_record_allocation
			 (id, organization_id, record_id, allocation_kind, project_id, weight_percent, created_at)
			 values ($1, $2, $3, 'project', $4, 100, $5)`,
				[
					ids.allocation,
					ids.organization,
					ids.canonical,
					ids.project,
					timestamp,
				],
			);
			await pool.query(
				`insert into work_period (
			 id, organization_id, employee_id, clock_in_id, clock_out_id,
			 canonical_record_id, project_id, start_time, end_time, duration_minutes, is_active,
			 approval_status, pending_changes, updated_at
			 ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 480, false, 'pending', $10, $11)`,
				[
					ids.period,
					ids.organization,
					ids.requester,
					ids.clockIn,
					ids.clockOut,
					ids.canonical,
					ids.project,
					startTime,
					endTime,
					JSON.stringify(
						kind === "manual_time_submission"
							? { isManualEntry: true }
							: { isNewClockOut: true },
					),
					timestamp,
				],
			);
			await pool.query(
				`insert into approval_workflow_rollout
			 (organization_id, workflow_type, lifecycle_mode, side_effect_mode, created_at, updated_at)
			 values ($1, $2, $3, $4, $5, $5)`,
				[
					ids.organization,
					kind,
					mode,
					mode === "canonical" || mode === "complete" ? "canonical" : "legacy",
					timestamp,
				],
			);
			if (withApprovalChain) {
				await pool.query(
					`insert into approval_policy
					 (id, organization_id, name, is_active, priority, created_by, updated_at)
					 values ($1, $2, 'Task 11 two-stage', true, 1, $3, $4)`,
					[ids.approvalPolicy, ids.organization, ids.managerUser, timestamp],
				);
				await pool.query(
					`insert into approval_policy_condition
					 (id, organization_id, policy_id, condition_type, operator, value_json, updated_at)
					 values ($1, $2, $3, 'approval_type', 'in', $4::jsonb, $5)`,
					[
						ids.approvalCondition,
						ids.organization,
						ids.approvalPolicy,
						JSON.stringify(["time_entry"]),
						timestamp,
					],
				);
				await pool.query(
					`insert into approval_policy_stage
					 (id, organization_id, policy_id, step_order, label, approver_type,
					  fallback_behavior, updated_at)
					 values
					 ($1, $3, $4, 1, 'Manager one', 'direct_manager', 'fail', $5),
					 ($2, $3, $4, 2, 'Manager two', 'direct_manager', 'fail', $5)`,
					[
						ids.approvalStageOne,
						ids.approvalStageTwo,
						ids.organization,
						ids.approvalPolicy,
						timestamp,
					],
				);
			}
			if (withBreakPolicy) {
				await pool.query(
					`insert into work_policy
				 (id, organization_id, name, schedule_enabled, regulation_enabled,
				  is_active, created_by, updated_at)
				 values ($1, $2, 'Task 11 break', false, true, true, $3, $4)`,
					[ids.policy, ids.organization, ids.managerUser, timestamp],
				);
				await pool.query(
					`insert into work_policy_regulation
				 (id, policy_id, max_uninterrupted_minutes, updated_at)
				 values ($1, $2, 360, $3)`,
					[ids.regulation, ids.policy, timestamp],
				);
				await pool.query(
					`insert into work_policy_break_rule
				 (id, regulation_id, working_minutes_threshold, required_break_minutes, updated_at)
				 values ($1, $2, 360, 30, $3)`,
					[ids.breakRule, ids.regulation, timestamp],
				);
				await pool.query(
					`insert into work_policy_assignment
				 (id, policy_id, organization_id, assignment_type, employee_id,
				  priority, is_active, created_by, updated_at)
				 values ($1, $2, $3, 'employee', $4, 2, true, $5, $6)`,
					[
						ids.policyAssignment,
						ids.policy,
						ids.organization,
						ids.requester,
						ids.managerUser,
						timestamp,
					],
				);
			}
		}

		async function submit(
			kind: OrdinaryWorkPeriodApprovalKind,
			submissionId = ids.submission,
			applicationName?: string,
		) {
			const productionRuntime = runtime();
			return productionRuntime.repository.withTransaction(async (context) => {
				if (applicationName) {
					await context.dbService.db.execute(
						sql`select set_config('application_name', ${applicationName}, true), set_config('lock_timeout', '5s', true)`,
					);
				}
				return executeOrdinaryWorkPeriodSubmissionInTransaction({
					dbService: dbService(context.dbService.db),
					context,
					organizationId: ids.organization,
					workPeriodId: ids.period,
					submissionId,
					requesterEmployeeId: ids.requester,
					requesterUserId: ids.requesterUser,
					teamId: null,
					defaultApproverId: ids.manager,
					reason:
						kind === "policy_clock_out"
							? "Clock-out requires approval (0-day policy)"
							: "Manual time entry: Task 11",
					overtimeRisk: null,
					kind,
					metadata: {},
				});
			});
		}

		async function decide(
			approvalRequestId: string,
			decision:
				| { kind: "approve"; reason: string | null }
				| { kind: "reject"; reason: string },
		) {
			return executeOrdinaryWorkPeriodDecisionInTransaction({
				dbService: dbService(database),
				runtime: runtime(),
				organizationId: ids.organization,
				approvalRequestId,
				workPeriodId: ids.period,
				actor: manager,
				allowAnyApprover: true,
				decision,
			});
		}

		async function snapshot() {
			const tables = [
				"employee",
				"approval_workflow",
				"approval_workflow_stage",
				"approval_stage_assignment",
				"approval_workflow_event",
				"approval_workflow_command",
				"approval_requester_projection",
				"approval_inbox_projection",
				"approval_outbox",
				"approval_request",
				"approval_chain_instance",
				"approval_chain_stage_instance",
				"time_entry",
				"work_period",
				"time_record",
				"time_record_work",
				"time_record_allocation",
				"time_record_approval_decision",
			] as const;
			const tenantIds = [ids.organization, ids.foreignOrganization];
			const durable = Object.fromEntries(
				await Promise.all(
					tables.map(async (table) => [
						table,
						(
							await pool.query<{ row: unknown }>(
								`select to_jsonb(row) as row from ${table} row where organization_id = any($1::text[]) order by 1`,
								[tenantIds],
							)
						).rows.map(({ row }) => row),
					]),
				),
			);
			const organizations = await pool.query<{ row: unknown }>(
				"select to_jsonb(row) as row from organization row where id = any($1::text[]) order by id",
				[tenantIds],
			);
			return {
				organization: organizations.rows.map(({ row }) => row),
				...durable,
			};
		}

		async function withFailureTrigger<T>(input: {
			table: string;
			operation: "insert" | "update";
			name: string;
			run: () => Promise<T>;
		}) {
			const functionName = `task11_fail_${input.name.replaceAll("-", "_")}`;
			const triggerName = `${functionName}_trigger`;
			await pool.query(`create or replace function ${functionName}() returns trigger as $$
		begin raise exception 'task11 failpoint: ${input.name}'; end;
		$$ language plpgsql`);
			await pool.query(
				`create trigger ${triggerName} after ${input.operation} on ${input.table} for each row execute function ${functionName}()`,
			);
			try {
				return await input.run();
			} finally {
				await pool.query(
					`drop trigger if exists ${triggerName} on ${input.table}`,
				);
				await pool.query(`drop function if exists ${functionName}()`);
			}
		}

		async function insertWorkflowHistory(input: {
			id: string;
			status: "pending" | "approved";
			sourceId?: string;
		}) {
			const timestamp = new Date(now.epochMilliseconds);
			await pool.query(
				`insert into approval_workflow (
				 id, organization_id, workflow_type, source_type, source_id,
				 requester_employee_id, status, current_stage_order, version,
				 policy_snapshot, context_snapshot, display_snapshot, submitted_at,
				 completed_at, created_at, updated_at
				 ) values ($1, $2, 'manual_time_submission', 'time_entry', $3, $4,
				 $5, $6, $7, '{}', $8, '{}', $9, $10, $9, $9)`,
				[
					input.id,
					ids.organization,
					input.sourceId ?? ids.period,
					ids.requester,
					input.status,
					input.status === "pending" ? 1 : null,
					input.status === "pending" ? 1 : 2,
					JSON.stringify({ timeRequest: { kind: "manual_time_submission" } }),
					timestamp,
					input.status === "approved" ? timestamp : null,
				],
			);
		}

		async function waitForObservedLock(
			applicationName: string,
			blockingPid: number,
		) {
			const deadline = Date.now() + 5_000;
			while (Date.now() < deadline) {
				const result = await pool.query<{
					wait_event_type: string | null;
					blocking_pids: number[];
				}>(
					`select wait_event_type, pg_blocking_pids(pid) as blocking_pids
					 from pg_stat_activity
					 where datname = current_database() and application_name = $1`,
					[applicationName],
				);
				const row = result.rows[0];
				if (
					row?.wait_event_type === "Lock" &&
					row.blocking_pids.includes(blockingPid)
				) {
					return row;
				}
				await new Promise<void>((resolve) => setTimeout(resolve, 20));
			}
			throw new Error(
				`Timed out observing Task 11 lock for ${applicationName}`,
			);
		}

		async function waitForBlocker(blockingPid: number) {
			const deadline = Date.now() + 5_000;
			while (Date.now() < deadline) {
				const result = await pool.query<{
					pid: number;
					wait_event_type: string | null;
					blocking_pids: number[];
				}>(
					`select pid, wait_event_type, pg_blocking_pids(pid) as blocking_pids
					 from pg_stat_activity
					 where datname = current_database() and wait_event_type = 'Lock'`,
				);
				const row = result.rows.find(({ blocking_pids }) =>
					blocking_pids.includes(blockingPid),
				);
				if (row) return row;
				await new Promise<void>((resolve) => setTimeout(resolve, 20));
			}
			throw new Error("Timed out observing Task 11 employee advisory lock");
		}

		beforeAll(async () => {
			const enabled = await verifyApprovalWorkflowRepositoryTestDatabase({
				databaseUrl,
				required: integrationRequired,
				sentinel: testSentinel,
				currentDatabase: async () => {
					const result = await pool.query<{ database_name: string }>(
						"select current_database() as database_name",
					);
					return result.rows[0]?.database_name ?? "";
				},
			});
			if (enabled.status !== "enabled") {
				throw new Error("Ordinary work-period PostgreSQL is disabled");
			}
		});

		beforeEach(() => seed());

		afterAll(async () => {
			await cleanup();
			await pool.end();
		});

		it.each(
			modes,
		)("composes submission and terminal decisions in %s mode", async (mode) => {
			await seed("manual_time_submission", false, mode);
			const submitted = await submit("manual_time_submission");
			expect(submitted.disposition).toBe("executed");
			await expect(
				decide(submitted.result.approvalRequestId, {
					kind: "approve",
					reason: null,
				}),
			).resolves.toMatchObject({ result: { action: "approve" } });
			const graph = await snapshot();
			const periods = graph.work_period as Array<Record<string, unknown>>;
			const records = graph.time_record as Array<Record<string, unknown>>;
			const workflows = graph.approval_workflow as Array<
				Record<string, unknown>
			>;
			const requests = graph.approval_request as Array<Record<string, unknown>>;
			expect(periods).toHaveLength(1);
			expect(periods[0]).toMatchObject({
				organization_id: ids.organization,
				employee_id: ids.requester,
				approval_status: "approved",
			});
			expect(records[0]).toMatchObject({
				id: ids.canonical,
				organization_id: ids.organization,
				employee_id: ids.requester,
				approval_state: "approved",
			});
			expect(graph.time_record_approval_decision).toHaveLength(1);
			if (mode === "legacy") {
				expect(workflows).toEqual([]);
				expect(periods[0]?.approval_workflow_id).toBeNull();
			} else {
				expect(workflows).toHaveLength(1);
				expect(workflows[0]).toMatchObject({ status: "approved", version: 2 });
				expect(periods[0]?.approval_workflow_id).toBe(workflows[0]?.id);
			}
			if (mode === "complete") {
				expect(requests).toEqual([]);
			} else {
				expect(requests).toHaveLength(1);
				expect(requests[0]).toMatchObject({ status: "approved" });
			}
		});

		const submissionRollbackCases = [
			...["legacy", "shadow", "ready"].map((mode) => ({
				mode: mode as ApprovalWorkflowLifecycleMode,
				stage: "legacy request/chain",
				table: "approval_request",
				operation: "insert" as const,
				chain: false,
			})),
			...["legacy", "shadow", "ready"].map((mode) => ({
				mode: mode as ApprovalWorkflowLifecycleMode,
				stage: "legacy chain",
				table: "approval_chain_stage_instance",
				operation: "insert" as const,
				chain: true,
			})),
			...["shadow", "ready", "canonical", "complete"].flatMap((mode) =>
				[
					["workflow", "approval_workflow", "insert"],
					["projection", "approval_requester_projection", "insert"],
					["outbox", "approval_outbox", "insert"],
					["source binding", "work_period", "update"],
				].map(([stage, table, operation]) => ({
					mode: mode as ApprovalWorkflowLifecycleMode,
					stage,
					table,
					operation: operation as "insert" | "update",
					chain: false,
				})),
			),
			{
				mode: "canonical" as const,
				stage: "compatibility",
				table: "approval_request",
				operation: "insert" as const,
				chain: false,
			},
		];

		it.each(
			submissionRollbackCases,
		)("rolls back $stage submission stage in $mode mode without residue", async ({
			mode,
			stage,
			table,
			operation,
			chain,
		}) => {
			await seed("manual_time_submission", false, mode, false, chain);
			const before = await snapshot();
			await expect(
				withFailureTrigger({
					table,
					operation,
					name: `submission-${mode}-${stage.replaceAll(" ", "-")}`,
					run: () => submit("manual_time_submission"),
				}),
			).rejects.toThrow("Ordinary work-period submission failed");
			expect(await snapshot()).toEqual(before);
		});

		it.each(
			modes,
		)("requester auto-finalization failure rolls the complete submission back in %s mode", async (mode) => {
			await seed("manual_time_submission", false, mode, true);
			const before = await snapshot();
			await expect(
				withFailureTrigger({
					table: "time_record_approval_decision",
					operation: "insert",
					name: `auto-finalization-${mode}`,
					run: () => submit("manual_time_submission"),
				}),
			).rejects.toThrow("Ordinary work-period submission failed");
			expect(await snapshot()).toEqual(before);
		});

		it("exact duplicate retry commits once and replays while distinct same-kind submissions commit one conflicting pending workflow", async () => {
			const [left, right] = await Promise.all([submitting(), submitting()]);
			expect([left.disposition, right.disposition].sort()).toEqual([
				"executed",
				"replayed",
			]);
			const retry = await submit("manual_time_submission");
			expect(retry.disposition).toBe("replayed");
			expect(
				await pool.query(
					"select count(*)::int as count from approval_workflow where organization_id = $1 and status = 'pending'",
					[ids.organization],
				),
			).toMatchObject({ rows: [{ count: 1 }] });

			await seed();
			const distinct = await Promise.allSettled([
				submit("manual_time_submission"),
				submit("manual_time_submission", ids.otherSubmission),
			]);
			expect(
				distinct.filter(({ status }) => status === "fulfilled"),
			).toHaveLength(1);
			expect(
				distinct.filter(({ status }) => status === "rejected"),
			).toHaveLength(1);
		});

		it("exact source advisory lock blocks then commits and replays after release", async () => {
			const blocker = await pool.connect();
			const applicationName = `task11-source-lock-${process.pid}`;
			let released = false;
			try {
				await blocker.query("begin");
				await blocker.query(
					"set local idle_in_transaction_session_timeout = '10s'",
				);
				const pidResult = await blocker.query<{ pid: number }>(
					"select pg_backend_pid() as pid",
				);
				const blockingPid = pidResult.rows[0]?.pid;
				if (!blockingPid) throw new Error("Task 11 blocker has no backend pid");
				const exactLockKey = JSON.stringify([
					ids.organization,
					"manual_time_submission",
					"time_entry",
					ids.period,
				]);
				await blocker.query(
					"select pg_advisory_xact_lock(hashtextextended($1, 0))",
					[exactLockKey],
				);
				const waiting = submit(
					"manual_time_submission",
					ids.submission,
					applicationName,
				);
				await expect(
					waitForObservedLock(applicationName, blockingPid),
				).resolves.toMatchObject({ wait_event_type: "Lock" });
				await blocker.query("commit");
				released = true;
				await expect(waiting).resolves.toMatchObject({
					disposition: "executed",
				});
				await expect(submit("manual_time_submission")).resolves.toMatchObject({
					disposition: "replayed",
				});
			} finally {
				if (!released) await blocker.query("rollback");
				blocker.release();
			}
		});

		async function submitting() {
			return submit("manual_time_submission");
		}

		it("manual versus policy-clockout competition uses exact source advisory locks", async () => {
			const results = await Promise.allSettled([
				submit("manual_time_submission"),
				submit("policy_clock_out", ids.otherSubmission),
			]);
			expect(
				results.filter(({ status }) => status === "fulfilled"),
			).toHaveLength(1);
			expect(
				results.filter(({ status }) => status === "rejected"),
			).toHaveLength(1);
			const rows = await pool.query<{ workflow_type: string; status: string }>(
				"select workflow_type, status from approval_workflow where organization_id = $1",
				[ids.organization],
			);
			expect(rows.rows).toHaveLength(1);
			expect(rows.rows[0]?.status).toBe("pending");
		});

		it("terminal prior history remains immutable while one new conflicting pending submission wins", async () => {
			await insertWorkflowHistory({
				id: ids.terminalWorkflow,
				status: "approved",
			});
			await pool.query(
				`insert into approval_request (
				 id, organization_id, entity_type, entity_id, canonical_record_id,
				 requested_by, approver_id, status, reason, metadata, approved_at, updated_at
				 ) values ($1, $2, 'time_entry', $3, $4, $5, $6, 'approved',
				 'Task 11 terminal history', $7, $8, $8)`,
				[
					ids.terminalRequest,
					ids.organization,
					ids.period,
					ids.canonical,
					ids.requester,
					ids.manager,
					JSON.stringify({ timeRequest: { kind: "manual_time_submission" } }),
					new Date(now.epochMilliseconds),
				],
			);
			const beforeHistory = await pool.query(
				"select to_jsonb(history) as row from approval_workflow history where id = $1 and organization_id = $2",
				[ids.terminalWorkflow, ids.organization],
			);
			const competing = await Promise.allSettled([
				submit("manual_time_submission"),
				submit("manual_time_submission", ids.otherSubmission),
			]);
			expect(
				competing.filter(({ status }) => status === "fulfilled"),
			).toHaveLength(1);
			expect(
				competing.filter(({ status }) => status === "rejected"),
			).toHaveLength(1);
			const workflows = await pool.query(
				"select to_jsonb(workflow) as row from approval_workflow workflow where organization_id = $1 order by id",
				[ids.organization],
			);
			expect(workflows.rows).toHaveLength(2);
			expect(workflows.rows).toContainEqual(beforeHistory.rows[0]);
			expect(
				workflows.rows.filter(
					({ row }: { row: { status?: string } }) => row.status === "pending",
				),
			).toHaveLength(1);
		});

		it("stale same-organization source link fails generically and rolls back", async () => {
			await insertWorkflowHistory({
				id: ids.staleWorkflow,
				status: "pending",
				sourceId: ids.clockIn,
			});
			await pool.query(
				"update work_period set approval_workflow_id = $1 where id = $2 and organization_id = $3 and employee_id = $4",
				[ids.staleWorkflow, ids.period, ids.organization, ids.requester],
			);
			const before = await snapshot();
			await expect(submit("manual_time_submission")).rejects.toThrow(
				"Ordinary work-period submission failed",
			);
			expect(await snapshot()).toEqual(before);
		});

		it("foreign organization rollback snapshots both tenants and every durable graph", async () => {
			const before = await snapshot();
			expect(
				(before.organization as Array<{ id: string }>).map(({ id }) => id),
			).toEqual([ids.foreignOrganization, ids.organization].sort());
			expect(
				(before.employee as Array<{ id: string }>).map(({ id }) => id).sort(),
			).toEqual([ids.foreignEmployee, ids.manager, ids.requester].sort());
			await expect(
				runtime().repository.withTransaction((context) =>
					executeOrdinaryWorkPeriodSubmissionInTransaction({
						dbService: dbService(context.dbService.db),
						context,
						organizationId: ids.foreignOrganization,
						workPeriodId: ids.period,
						submissionId: ids.submission,
						requesterEmployeeId: ids.requester,
						requesterUserId: ids.requesterUser,
						teamId: null,
						defaultApproverId: ids.manager,
						reason: "Manual time entry: foreign",
						overtimeRisk: null,
						kind: "manual_time_submission",
						metadata: {},
					}),
				),
			).rejects.toThrow("Ordinary work-period submission failed");
			const after = await snapshot();
			expect(after).toEqual(before);
			for (const table of [
				"approval_workflow",
				"approval_workflow_stage",
				"approval_stage_assignment",
				"approval_workflow_event",
				"approval_workflow_command",
				"approval_requester_projection",
				"approval_inbox_projection",
				"approval_outbox",
				"approval_request",
				"approval_chain_instance",
				"approval_chain_stage_instance",
				"time_entry",
				"work_period",
				"time_record",
				"time_record_work",
				"time_record_allocation",
				"time_record_approval_decision",
			] as const) {
				expect(
					(after[table] as Array<{ organization_id?: string }>).filter(
						({ organization_id }) =>
							organization_id === ids.foreignOrganization,
					),
				).toEqual([]);
			}
		});

		it("foreign employee ownership fails without revealing or mutating the source", async () => {
			const before = await snapshot();
			await expect(
				runtime().repository.withTransaction((context) =>
					executeOrdinaryWorkPeriodSubmissionInTransaction({
						dbService: dbService(context.dbService.db),
						context,
						organizationId: ids.organization,
						workPeriodId: ids.period,
						submissionId: ids.submission,
						requesterEmployeeId: ids.foreignEmployee,
						requesterUserId: ids.foreignUser,
						teamId: null,
						defaultApproverId: ids.manager,
						reason: "Manual time entry: foreign employee",
						overtimeRisk: null,
						kind: "manual_time_submission",
						metadata: {},
					}),
				),
			).rejects.toThrow("Ordinary work-period submission failed");
			expect(await snapshot()).toEqual(before);
		});

		async function assertTerminalGraph(
			expectedStatus: "approved" | "rejected",
		) {
			const graph = await snapshot();
			const period = (graph.work_period as Array<Record<string, unknown>>)[0];
			const canonical = (
				graph.time_record as Array<Record<string, unknown>>
			)[0];
			const workflow = (
				graph.approval_workflow as Array<Record<string, unknown>>
			)[0];
			const requests = graph.approval_request as Array<Record<string, unknown>>;
			const decisions = graph.time_record_approval_decision as Array<
				Record<string, unknown>
			>;
			const receipts = graph.approval_workflow_command as Array<
				Record<string, unknown>
			>;
			const requesterProjection = graph.approval_requester_projection as Array<
				Record<string, unknown>
			>;
			const outbox = graph.approval_outbox as Array<Record<string, unknown>>;
			expect(period).toMatchObject({
				id: ids.period,
				organization_id: ids.organization,
				employee_id: ids.requester,
				canonical_record_id: ids.canonical,
				approval_status: expectedStatus,
			});
			expect(canonical).toMatchObject({
				id: ids.canonical,
				organization_id: ids.organization,
				employee_id: ids.requester,
				approval_state: expectedStatus,
				start_at: period?.start_time,
				end_at: period?.end_time,
				duration_minutes: period?.duration_minutes,
			});
			expect(workflow).toMatchObject({
				id: period?.approval_workflow_id,
				status: expectedStatus,
				version: 2,
			});
			expect(requests).toHaveLength(1);
			expect(requests[0]).toMatchObject({
				status: expectedStatus,
				entity_id: ids.period,
				canonical_record_id: ids.canonical,
				metadata: {
					workflow: { id: workflow?.id, organizationId: ids.organization },
					timeRequest: { kind: "manual_time_submission" },
				},
			});
			expect(decisions).toHaveLength(1);
			expect(decisions[0]).toMatchObject({ action: expectedStatus });
			expect(receipts).toHaveLength(1);
			expect(receipts[0]).toMatchObject({ state: "completed" });
			expect(requesterProjection).toHaveLength(1);
			expect(requesterProjection[0]).toMatchObject({
				workflow_id: workflow?.id,
				status: expectedStatus,
			});
			expect(graph.approval_inbox_projection).toEqual([]);
			expect(outbox.length).toBeGreaterThanOrEqual(2);
			expect(outbox).toContainEqual(
				expect.objectContaining({
					workflow_id: workflow?.id,
					event_type: `workflow.${expectedStatus}`,
					disposition: "observe",
				}),
			);
			for (const row of outbox) {
				expect(row.workflow_id).toBe(workflow?.id);
				expect(row.disposition).toBe("observe");
			}
			for (const row of [...requests, ...decisions, ...receipts, ...outbox]) {
				expect(row.organization_id).toBe(ids.organization);
			}
		}

		it("approve versus reject leaves one coherent terminal graph and a generic conflict loser", async () => {
			const submitted = await submit("manual_time_submission");
			const target = submitted.result.approvalRequestId;
			const competing = await Promise.allSettled([
				decide(target, { kind: "approve", reason: null }),
				decide(target, { kind: "reject", reason: "reject" }),
			]);
			expect(
				competing.filter(({ status }) => status === "fulfilled"),
			).toHaveLength(1);
			expect(
				competing.filter(({ status }) => status === "rejected"),
			).toHaveLength(1);
			const winner = competing.find(({ status }) => status === "fulfilled");
			const loser = competing.find(({ status }) => status === "rejected");
			if (winner?.status !== "fulfilled" || loser?.status !== "rejected") {
				throw new Error("Task 11 terminal race did not produce one winner");
			}
			expect(loser.reason).toMatchObject({
				message: "Ordinary work-period decision failed",
			});
			await assertTerminalGraph(
				winner.value.result.action === "approve" ? "approved" : "rejected",
			);
		});

		it("duplicate approve replays one coherent terminal graph", async () => {
			const duplicateTarget = (await submit("manual_time_submission")).result
				.approvalRequestId;
			const duplicate = await Promise.allSettled([
				decide(duplicateTarget, { kind: "approve", reason: null }),
				decide(duplicateTarget, { kind: "approve", reason: null }),
			]);
			expect(
				duplicate.filter(({ status }) => status === "fulfilled"),
			).toHaveLength(2);
			await assertTerminalGraph("approved");
		});

		it("Task8A split has exact period, canonical subtype, allocation, workflow, and synthetic-entry parity", async () => {
			await seed("policy_clock_out", true);
			const target = (await submit("policy_clock_out")).result
				.approvalRequestId;
			const beforeEntries = await pool.query(
				"select id from time_entry where organization_id = $1",
				[ids.organization],
			);
			const decisions = await Promise.allSettled([
				decide(target, { kind: "approve", reason: null }),
				decide(target, { kind: "approve", reason: null }),
			]);
			expect(
				decisions.filter(({ status }) => status === "fulfilled"),
			).toHaveLength(2);
			const periods = await pool.query<Record<string, unknown>>(
				`select id, organization_id, employee_id, clock_in_id, clock_out_id,
				 canonical_record_id, approval_workflow_id, approval_status,
				 start_time, end_time, duration_minutes
				 from work_period where organization_id = $1 order by start_time, id`,
				[ids.organization],
			);
			const records = await pool.query<Record<string, unknown>>(
				`select record.id, record.organization_id, record.employee_id,
				 record.approval_state, record.start_at, record.end_at,
				 record.duration_minutes, work.record_id as work_record_id,
				 work.work_category_id, work.work_location_type, work.computation_metadata
				 from time_record record
				 join time_record_work work on work.record_id = record.id and work.organization_id = record.organization_id
				 where record.organization_id = $1 and record.record_kind = 'work'
				 order by record.start_at, record.id`,
				[ids.organization],
			);
			const allocations = await pool.query<Record<string, unknown>>(
				`select allocation.record_id, allocation.organization_id,
				 allocation.allocation_kind, allocation.project_id, allocation.weight_percent
				 from time_record_allocation allocation
				 where allocation.organization_id = $1 order by allocation.record_id`,
				[ids.organization],
			);
			const synthetic = await pool.query<Record<string, unknown>>(
				`select id, organization_id, employee_id, type, timestamp,
				 utc_offset_minutes, timezone, timezone_source, previous_entry_id,
				 hash, previous_hash
				 from time_entry where organization_id = $1 and notes = 'Auto-adjusted: break enforcement'
				 order by timestamp, id`,
				[ids.organization],
			);
			expect(periods.rows).toHaveLength(2);
			expect(records.rows).toHaveLength(2);
			expect(allocations.rows).toHaveLength(2);
			expect(synthetic.rows).toHaveLength(2);
			expect(beforeEntries.rows).toHaveLength(2);
			for (const period of periods.rows) {
				expect(period).toMatchObject({
					organization_id: ids.organization,
					employee_id: ids.requester,
					approval_status: "approved",
				});
				const record = records.rows.find(
					(candidate) => candidate.id === period.canonical_record_id,
				);
				expect(record).toMatchObject({
					work_record_id: period.canonical_record_id,
					organization_id: period.organization_id,
					employee_id: period.employee_id,
					approval_state: "approved",
					work_category_id: null,
					work_location_type: null,
					computation_metadata: null,
					start_at: period.start_time,
					end_at: period.end_time,
					duration_minutes: period.duration_minutes,
				});
			}
			expect(periods.rows[0]).toMatchObject({
				id: ids.period,
				canonical_record_id: ids.canonical,
				clock_in_id: ids.clockIn,
				clock_out_id: synthetic.rows[0]?.id,
				start_time: startTime,
				end_time: new Date("2026-07-22T14:00:00Z"),
				duration_minutes: 360,
			});
			expect(typeof periods.rows[0]?.approval_workflow_id).toBe("string");
			expect(periods.rows[1]).toMatchObject({
				clock_in_id: synthetic.rows[1]?.id,
				clock_out_id: ids.clockOut,
				approval_workflow_id: null,
				start_time: new Date("2026-07-22T14:30:00Z"),
				end_time: endTime,
				duration_minutes: 90,
			});
			expect(
				allocations.rows.map(
					({ allocation_kind, project_id, weight_percent }) => ({
						allocation_kind,
						project_id,
						weight_percent,
					}),
				),
			).toEqual([
				{
					allocation_kind: "project",
					project_id: ids.project,
					weight_percent: 100,
				},
				{
					allocation_kind: "project",
					project_id: ids.project,
					weight_percent: 100,
				},
			]);
			expect(synthetic.rows).toMatchObject([
				{
					organization_id: ids.organization,
					employee_id: ids.requester,
					type: "clock_out",
					timestamp: new Date("2026-07-22T14:00:00Z"),
					utc_offset_minutes: 0,
					timezone: "UTC",
				},
				{
					organization_id: ids.organization,
					employee_id: ids.requester,
					type: "clock_in",
					timestamp: new Date("2026-07-22T14:30:00Z"),
					utc_offset_minutes: 0,
					timezone: "UTC",
					previous_entry_id: synthetic.rows[0]?.id,
				},
			]);
			expect(
				await pool.query(
					"select count(*)::int as count from approval_workflow where organization_id = $1",
					[ids.organization],
				),
			).toMatchObject({ rows: [{ count: 1 }] });
		});

		it.each([
			"first entry",
			"second entry",
			"original period",
			"original canonical",
			"new canonical base",
			"new canonical work",
			"new canonical allocation",
			"second period",
			"decision",
		] as const)("injected failure after %s restores the original pending graph and time-entry chain", async (stage) => {
			await seed("policy_clock_out", true);
			const target = (await submit("policy_clock_out")).result
				.approvalRequestId;
			const before = await snapshot();
			await pool.query(
				"create table task11_split_failpoint (stage text primary key)",
			);
			await pool.query(
				"insert into task11_split_failpoint (stage) values ($1)",
				[stage],
			);
			await pool.query(`create or replace function task11_fail_split_stage() returns trigger as $$
		declare selected_stage text;
		begin
			select failpoint.stage into selected_stage from task11_split_failpoint failpoint limit 1;
			if (selected_stage = 'first entry' and TG_TABLE_NAME = 'time_entry' and NEW.notes = 'Auto-adjusted: break enforcement' and NEW.type = 'clock_out')
				or (selected_stage = 'second entry' and TG_TABLE_NAME = 'time_entry' and NEW.notes = 'Auto-adjusted: break enforcement' and NEW.type = 'clock_in')
				or (selected_stage = 'original period' and TG_TABLE_NAME = 'work_period' and TG_OP = 'UPDATE' and OLD.id = '${ids.period}' and NEW.was_auto_adjusted = true)
				or (selected_stage = 'original canonical' and TG_TABLE_NAME = 'time_record' and TG_OP = 'UPDATE' and OLD.id = '${ids.canonical}' and NEW.end_at is distinct from OLD.end_at)
				or (selected_stage = 'new canonical base' and TG_TABLE_NAME = 'time_record' and TG_OP = 'INSERT')
				or (selected_stage = 'new canonical work' and TG_TABLE_NAME = 'time_record_work' and TG_OP = 'INSERT' and NEW.record_id <> '${ids.canonical}'::uuid)
				or (selected_stage = 'new canonical allocation' and TG_TABLE_NAME = 'time_record_allocation' and TG_OP = 'INSERT' and NEW.record_id <> '${ids.canonical}'::uuid)
				or (selected_stage = 'second period' and TG_TABLE_NAME = 'work_period' and TG_OP = 'INSERT')
				or (selected_stage = 'decision' and TG_TABLE_NAME = 'time_record_approval_decision') then
				raise exception 'task11 split failpoint: %', selected_stage;
			end if;
			return NEW;
		end;
		$$ language plpgsql`);
			const triggerTables = [
				"time_entry",
				"work_period",
				"time_record",
				"time_record_work",
				"time_record_allocation",
				"time_record_approval_decision",
			] as const;
			for (const table of triggerTables) {
				await pool.query(
					`create trigger task11_split_failure after insert or update on ${table} for each row execute function task11_fail_split_stage()`,
				);
			}
			try {
				await expect(
					decide(target, { kind: "approve", reason: null }),
				).rejects.toThrow("Ordinary work-period decision failed");
			} finally {
				for (const table of triggerTables) {
					await pool.query(
						`drop trigger if exists task11_split_failure on ${table}`,
					);
				}
				await pool.query("drop function if exists task11_fail_split_stage()");
				await pool.query("drop table if exists task11_split_failpoint");
			}
			expect(await snapshot()).toEqual(before);
		});

		it.each([
			["workflow", "approval_workflow", "insert"],
			["projection", "approval_requester_projection", "insert"],
			["outbox", "approval_outbox", "insert"],
			["compatibility", "approval_request", "insert"],
			["binding", "work_period", "update"],
		] as const)("rollback after %s submission failure leaves no workflow graph", async (_stage, table, operation) => {
			const before = await snapshot();
			await pool.query(`create or replace function task11_fail_submission() returns trigger as $$
		begin raise exception 'task11 submission failpoint'; end;
		$$ language plpgsql`);
			await pool.query(
				`create trigger task11_submission_failure before ${operation} on ${table} for each row execute function task11_fail_submission()`,
			);
			try {
				await expect(submit("manual_time_submission")).rejects.toThrow(
					"Ordinary work-period submission failed",
				);
			} finally {
				await pool.query(
					`drop trigger if exists task11_submission_failure on ${table}`,
				);
				await pool.query("drop function if exists task11_fail_submission()");
			}
			expect(await snapshot()).toEqual(before);
		});

		it.each([
			["generic work-period", "work_period", "true", false],
			["generic canonical-record", "time_record", "true", false],
			[
				"source-link binding",
				"work_period",
				"OLD.approval_workflow_id is null and NEW.approval_workflow_id is not null",
				true,
			],
			[
				"split-sensitive work-period",
				"work_period",
				"OLD.was_auto_adjusted = false and NEW.was_auto_adjusted = true",
				false,
			],
			[
				"split-sensitive canonical-record",
				"time_record",
				"NEW.end_at is distinct from OLD.end_at",
				false,
			],
		] as const)("forced %s CAS zero row rolls the entire decision back", async (scenario, table, predicate, submissionCas) => {
			if (scenario.startsWith("split-sensitive")) {
				await seed("policy_clock_out", true);
			}
			const target = submissionCas
				? null
				: (
						await submit(
							scenario.startsWith("split-sensitive")
								? "policy_clock_out"
								: "manual_time_submission",
						)
					).result.approvalRequestId;
			const before = await snapshot();
			await pool.query(
				`create or replace function task11_zero_row() returns trigger as $$
				begin
					if ${predicate} then return null; end if;
					return NEW;
				end;
				$$ language plpgsql`,
			);
			await pool.query(
				`create trigger task11_zero_row before update on ${table} for each row execute function task11_zero_row()`,
			);
			try {
				if (submissionCas) {
					await expect(submit("manual_time_submission")).rejects.toThrow(
						"Ordinary work-period submission failed",
					);
				} else {
					await expect(
						decide(target ?? "", { kind: "approve", reason: null }),
					).rejects.toThrow("Ordinary work-period decision failed");
				}
			} finally {
				await pool.query(`drop trigger if exists task11_zero_row on ${table}`);
				await pool.query("drop function if exists task11_zero_row()");
			}
			expect(await snapshot()).toEqual(before);
		});

		it("decision INSERT RETURNING zero rows rolls the complete transaction back", async () => {
			const target = (await submit("manual_time_submission")).result
				.approvalRequestId;
			const before = await snapshot();
			await pool.query(`create or replace function task11_zero_decision_insert() returns trigger as $$
		begin
			return null;
		end;
		$$ language plpgsql`);
			await pool.query(
				`create trigger task11_zero_decision_insert
				 before insert on time_record_approval_decision
				 for each row execute function task11_zero_decision_insert()`,
			);
			try {
				await expect(
					decide(target, { kind: "approve", reason: null }),
				).rejects.toThrow("Ordinary work-period decision failed");
			} finally {
				await pool.query(
					"drop trigger if exists task11_zero_decision_insert on time_record_approval_decision",
				);
				await pool.query(
					"drop function if exists task11_zero_decision_insert()",
				);
			}
			expect(await snapshot()).toEqual(before);
		});

		it("split races a locked competing employee entry into one reachable hash chain", async () => {
			await seed("policy_clock_out", true);
			const target = (await submit("policy_clock_out")).result
				.approvalRequestId;
			const blocker = await pool.connect();
			await blocker.query("begin");
			await blocker.query(
				"select pg_advisory_xact_lock(hashtextextended($1, 0))",
				[ids.requester],
			);
			const blockerPid = await blocker.query<{ pid: number }>(
				"select pg_backend_pid() as pid",
			);
			const latest = await blocker.query<{ hash: string }>(
				"select hash from time_entry where id = $1 and organization_id = $2 and employee_id = $3",
				[ids.clockOut, ids.organization, ids.requester],
			);
			const previousHash = latest.rows[0]?.hash;
			if (!previousHash || !blockerPid.rows[0]?.pid) {
				throw new Error("Task 11 competing entry prerequisite is missing");
			}
			const competingHash = calculateHash({
				employeeId: ids.requester,
				type: "correction",
				timestamp: endTime.toISOString(),
				previousHash,
			});
			const approval = decide(target, { kind: "approve", reason: null });
			await expect(
				waitForBlocker(blockerPid.rows[0].pid),
			).resolves.toMatchObject({ wait_event_type: "Lock" });
			await blocker.query(
				`insert into time_entry (
			 id, organization_id, employee_id, type, timestamp, utc_offset_minutes,
			 timezone, timezone_source, previous_entry_id, hash, previous_hash,
			 created_by, created_at
			 ) values ($1, $2, $3, 'correction', $4, 0, 'UTC', 'backfill', $5,
			 $6, $7, $8, $9)`,
				[
					ids.competingEntry,
					ids.organization,
					ids.requester,
					endTime,
					ids.clockOut,
					competingHash,
					previousHash,
					ids.managerUser,
					new Date(now.epochMilliseconds),
				],
			);
			await blocker.query("commit");
			blocker.release();
			await expect(approval).resolves.toBeDefined();
			const chain = await pool.query<{
				id: string;
				employee_id: string;
				type: string;
				timestamp: Date;
				created_at: Date;
				previous_entry_id: string | null;
				hash: string;
				previous_hash: string | null;
			}>(
				`select id, employee_id, type, timestamp, created_at,
				 previous_entry_id, hash, previous_hash
				 from time_entry where organization_id = $1 and employee_id = $2
				 order by created_at, id`,
				[ids.organization, ids.requester],
			);
			expect(chain.rows).toHaveLength(5);
			const byId = new Map(chain.rows.map((entry) => [entry.id, entry]));
			const roots = chain.rows.filter(
				({ previous_entry_id }) => previous_entry_id === null,
			);
			expect(roots).toHaveLength(1);
			const successors = new Map<string, string[]>();
			for (const entry of chain.rows) {
				const predecessor = entry.previous_entry_id
					? byId.get(entry.previous_entry_id)
					: null;
				if (entry.previous_entry_id !== null) expect(predecessor).toBeDefined();
				if (predecessor) {
					expect(entry.previous_hash).toBe(predecessor.hash);
					expect(entry.created_at.getTime()).toBeGreaterThanOrEqual(
						predecessor.created_at.getTime(),
					);
					successors.set(entry.previous_entry_id, [
						...(successors.get(entry.previous_entry_id) ?? []),
						entry.id,
					]);
				} else {
					expect(entry.previous_hash).toBeNull();
				}
				expect(entry.hash).toBe(
					calculateHash({
						employeeId: entry.employee_id,
						type: entry.type,
						timestamp: entry.timestamp.toISOString(),
						previousHash: entry.previous_hash,
					}),
				);
			}
			for (const children of successors.values())
				expect(children).toHaveLength(1);
			const reached = new Set<string>();
			let cursor = roots[0]?.id;
			while (cursor) {
				expect(reached.has(cursor)).toBe(false);
				reached.add(cursor);
				cursor = successors.get(cursor)?.[0];
			}
			expect(reached.size).toBe(chain.rows.length);
			expect(byId.get(ids.competingEntry)?.previous_entry_id).toBe(
				ids.clockOut,
			);
		});
	},
);
