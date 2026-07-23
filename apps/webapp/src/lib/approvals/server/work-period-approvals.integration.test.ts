/**
 * Local contract: pnpm --filter webapp test:approval-workflow-repository:integration
 * The runner creates, migrates, verifies, and removes a label-owned PostgreSQL 16 database.
 */
import { drizzle } from "drizzle-orm/node-postgres";
import { Effect } from "effect";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as authSchema from "@/db/auth-schema";
import { configurePostgresUtcTypes } from "@/db/postgres-utc";
import * as schema from "@/db/schema";
import { parseInstant, systemClock } from "@/lib/datetime/temporal-core";
import type { OrdinaryWorkPeriodApprovalKind } from "../domain-adapters/work-period-contract";
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
} as const;

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
					ids.manager,
					ids.managerUser,
					timestamp,
				],
			);
			await pool.query(
				`insert into user_settings (user_id, timezone, updated_at)
			 values ($1, 'UTC', $2)`,
				[ids.requesterUser, timestamp],
			);
			await pool.query(
				`insert into time_entry (
			 id, organization_id, employee_id, type, timestamp, utc_offset_minutes,
			 timezone, timezone_source, previous_entry_id, hash, previous_hash,
			 created_by, created_at
			 ) values
			 ($1, $3, $4, 'clock_in', $5, 0, 'UTC', 'backfill', null, 'task11-in', null, $7, $8),
			 ($2, $3, $4, 'clock_out', $6, 0, 'UTC', 'backfill', $1, 'task11-out', 'task11-in', $7, $8)`,
				[
					ids.clockIn,
					ids.clockOut,
					ids.organization,
					ids.requester,
					startTime,
					endTime,
					ids.requesterUser,
					timestamp,
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
			 values ($1, $2, 'canonical', 'canonical', $3, $3)`,
				[ids.organization, kind, timestamp],
			);
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
		) {
			const productionRuntime = runtime();
			return productionRuntime.repository.withTransaction((context) =>
				executeOrdinaryWorkPeriodSubmissionInTransaction({
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
				}),
			);
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
				"approval_workflow",
				"approval_workflow_stage",
				"approval_stage_assignment",
				"approval_workflow_event",
				"approval_workflow_command",
				"approval_requester_projection",
				"approval_inbox_projection",
				"approval_outbox",
				"approval_request",
				"time_entry",
				"work_period",
				"time_record",
				"time_record_work",
				"time_record_allocation",
				"time_record_approval_decision",
			] as const;
			return Object.fromEntries(
				await Promise.all(
					tables.map(async (table) => [
						table,
						(
							await pool.query<{ row: unknown }>(
								`select to_jsonb(row) as row from ${table} row where organization_id = $1 order by 1`,
								[ids.organization],
							)
						).rows.map(({ row }) => row),
					]),
				),
			);
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

		async function submitting() {
			return submit("manual_time_submission");
		}

		it("manual versus policy-clockout competition uses exact source advisory locks and preserves terminal history", async () => {
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

		it("stale link and foreign organization or employee fail generically with total rollback", async () => {
			const before = await snapshot();
			await pool
				.query(
					"update work_period set employee_id = $1 where id = $2 and organization_id = $3",
					[ids.foreignEmployee, ids.period, ids.organization],
				)
				.catch(() => undefined);
			await expect(submit("manual_time_submission")).rejects.toThrow(
				"Ordinary work-period submission failed",
			);
			await seed();
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
			expect(await snapshot()).toEqual(before);
		});

		it("approve versus reject and duplicate approve produce one terminal source mutation, decision, completed receipt, and generic loser conflict", async () => {
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
			const state = await pool.query<{
				approval_status: string;
				decision_count: number;
				completed_receipts: number;
			}>(
				`select period.approval_status,
			 (select count(*)::int from time_record_approval_decision decision where decision.organization_id = period.organization_id and decision.record_id = period.canonical_record_id) as decision_count,
			 (select count(*)::int from approval_workflow_command command where command.organization_id = period.organization_id and command.state = 'completed') as completed_receipts
			 from work_period period where period.id = $1 and period.organization_id = $2`,
				[ids.period, ids.organization],
			);
			expect(state.rows[0]?.decision_count).toBe(1);
			expect(state.rows[0]?.completed_receipts).toBe(1);

			await seed();
			const duplicateTarget = (await submit("manual_time_submission")).result
				.approvalRequestId;
			const duplicate = await Promise.allSettled([
				decide(duplicateTarget, { kind: "approve", reason: null }),
				decide(duplicateTarget, { kind: "approve", reason: null }),
			]);
			expect(
				duplicate.filter(({ status }) => status === "fulfilled"),
			).toHaveLength(2);
			expect(
				await pool.query(
					"select count(*)::int as count from time_record_approval_decision where organization_id = $1",
					[ids.organization],
				),
			).toMatchObject({ rows: [{ count: 1 }] });
		});

		it("Task8A enforced policy split creates exactly two entries, approved periods, and canonical work records only once", async () => {
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
			const graph = await pool.query<{
				periods: number;
				records: number;
				workflow_owned: number;
				entries: number;
			}>(
				`select
			 (select count(*)::int from work_period where organization_id = $1 and approval_status = 'approved') periods,
			 (select count(*)::int from time_record where organization_id = $1 and record_kind = 'work' and approval_state = 'approved') records,
			 (select count(*)::int from work_period where organization_id = $1 and approval_workflow_id is not null) workflow_owned,
			 (select count(*)::int from time_entry where organization_id = $1) entries`,
				[ids.organization],
			);
			expect(graph.rows).toEqual([
				{
					periods: 2,
					records: 2,
					workflow_owned: 1,
					entries: beforeEntries.rows.length + 2,
				},
			]);
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
			["work_period", "work-period"],
			["time_record", "canonical record"],
			["time_record_approval_decision", "decision/source link"],
		] as const)("forced zero-row CAS at %s rolls the canonical decision and source graph back", async (table) => {
			const target = (await submit("manual_time_submission")).result
				.approvalRequestId;
			const before = await snapshot();
			await pool.query(
				`create or replace function task11_zero_row() returns trigger as $$ begin return null; end; $$ language plpgsql`,
			);
			await pool.query(
				`create trigger task11_zero_row before ${table === "time_record_approval_decision" ? "insert" : "update"} on ${table} for each row execute function task11_zero_row()`,
			);
			try {
				await expect(
					decide(target, { kind: "approve", reason: null }),
				).rejects.toThrow("Ordinary work-period decision failed");
			} finally {
				await pool.query(`drop trigger if exists task11_zero_row on ${table}`);
				await pool.query("drop function if exists task11_zero_row()");
			}
			expect(await snapshot()).toEqual(before);
		});

		it("split races another employee entry insertion under the employee advisory lock and leaves one valid hash chain", async () => {
			await seed("policy_clock_out", true);
			const target = (await submit("policy_clock_out")).result
				.approvalRequestId;
			const blocker = await pool.connect();
			await blocker.query("begin");
			await blocker.query(
				"select pg_advisory_xact_lock(hashtextextended($1, 0))",
				[ids.requester],
			);
			const approval = decide(target, { kind: "approve", reason: null });
			await new Promise<void>((resolve) => setTimeout(resolve, 50));
			await blocker.query(
				`insert into time_entry (
			 id, organization_id, employee_id, type, timestamp, utc_offset_minutes,
			 timezone, timezone_source, previous_entry_id, hash, previous_hash,
			 created_by, created_at
			 ) values ($1, $2, $3, 'correction', $4, 0, 'UTC', 'backfill', $5,
			 'task11-race', 'task11-out', $6, $7)`,
				[
					ids.competingEntry,
					ids.organization,
					ids.requester,
					endTime,
					ids.clockOut,
					ids.managerUser,
					new Date(now.epochMilliseconds),
				],
			);
			await blocker.query("commit");
			blocker.release();
			await expect(approval).resolves.toBeDefined();
			const chain = await pool.query<{
				id: string;
				previous_entry_id: string | null;
			}>(
				"select id, previous_entry_id from time_entry where organization_id = $1 and employee_id = $2 order by created_at, id",
				[ids.organization, ids.requester],
			);
			expect(chain.rows).toHaveLength(5);
			const byId = new Map(chain.rows.map((entry) => [entry.id, entry]));
			expect(
				chain.rows.filter(
					({ previous_entry_id }) => previous_entry_id === null,
				),
			).toHaveLength(1);
			for (const entry of chain.rows) {
				if (entry.previous_entry_id !== null) {
					expect(byId.has(entry.previous_entry_id)).toBe(true);
				}
			}
			expect(byId.get(ids.competingEntry)?.previous_entry_id).toBe(
				ids.clockOut,
			);
		});
	},
);
