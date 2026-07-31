/**
 * Local contract: pnpm --filter webapp test:approval-workflow-repository:integration
 * The runner owns the disposable PostgreSQL 16 database used by this suite.
 */

import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import type { ApprovalTerminalAdapterInput } from "../domain-adapters/types";
import type {
	ApprovalCommandResult,
	ApprovalWorkflowCommandRequest,
} from "./ports";
import {
	type ApprovalWorkflowDatabase,
	type ApprovalWorkflowRepository,
	createApprovalWorkflowRepository,
} from "./repository";
import {
	resolveApprovalWorkflowRepositoryTestConfiguration,
	verifyApprovalWorkflowRepositoryTestDatabase,
} from "./repository-integration-harness";
import { createApprovalTransitionEngine } from "./transition-engine";

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
	describe.skip(`approval transition engine PostgreSQL unavailable: ${integrationConfiguration.reason}`, () => {
		it("requires the label-owned disposable PostgreSQL runner", () => {});
	});
}

const ids = {
	organizationOne: "engine-integration-org-1",
	organizationTwo: "engine-integration-org-2",
	userOne: "engine-integration-user-1",
	userTwo: "engine-integration-user-2",
	userManager: "engine-integration-user-manager",
	employeeOne: "31000000-0000-4000-8000-000000000011",
	employeeTwo: "31000000-0000-4000-8000-000000000012",
	employeeManager: "31000000-0000-4000-8000-000000000013",
	categoryOne: "32000000-0000-4000-8000-000000000011",
	categoryTwo: "32000000-0000-4000-8000-000000000012",
	sourceOne: "33000000-0000-4000-8000-000000000011",
	sourceTwo: "33000000-0000-4000-8000-000000000012",
	workflowOne: "34000000-0000-4000-8000-000000000011",
	workflowTwo: "34000000-0000-4000-8000-000000000012",
	stageOne: "35000000-0000-4000-8000-000000000011",
	stageTwo: "35000000-0000-4000-8000-000000000012",
	assignmentOne: "36000000-0000-4000-8000-000000000011",
	legacyRequestOne: "37000000-0000-4000-8000-000000000011",
} as const;
const now = parseInstant("2026-07-17T16:00:00Z");

type FailurePoint = "finalizer" | "projection" | "outbox" | undefined;

function normalize(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(normalize);
	if (value !== null && typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value)
				.sort(([left], [right]) => left.localeCompare(right))
				.map(([key, child]) => [key, normalize(child)]),
		);
	}
	return value;
}

describeIntegration("approval transition engine PostgreSQL contract", () => {
	const pool = new Pool({ connectionString: databaseUrl, max: 12 });
	const database = drizzle({ client: pool });

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
			throw new Error(
				"Approval workflow engine integration test is not enabled",
			);
		}
	});

	beforeEach(async () => {
		await pool.query(`
			delete from approval_outbox_delivery where organization_id like 'engine-integration-org-%';
			delete from approval_outbox where organization_id like 'engine-integration-org-%';
			delete from approval_inbox_projection where organization_id like 'engine-integration-org-%';
			delete from approval_requester_projection where organization_id like 'engine-integration-org-%';
			delete from approval_workflow_command where organization_id like 'engine-integration-org-%';
			delete from approval_workflow_event where organization_id like 'engine-integration-org-%';
			delete from approval_stage_assignment where organization_id like 'engine-integration-org-%';
			delete from approval_workflow_stage where organization_id like 'engine-integration-org-%';
			delete from absence_entry where organization_id like 'engine-integration-org-%';
			delete from approval_request where organization_id like 'engine-integration-org-%';
			delete from approval_workflow_rollout where organization_id like 'engine-integration-org-%';
			delete from approval_workflow where organization_id like 'engine-integration-org-%';
			delete from absence_category where organization_id like 'engine-integration-org-%';
			delete from employee where id in ('${ids.employeeOne}', '${ids.employeeTwo}', '${ids.employeeManager}');
			delete from member where id in ('member-${ids.organizationOne}', 'member-${ids.organizationTwo}', 'member-${ids.organizationOne}-manager');
			delete from "user" where id in ('${ids.userOne}', '${ids.userTwo}', '${ids.userManager}');
			delete from organization where id in ('${ids.organizationOne}', '${ids.organizationTwo}');
		`);
		await seed();
	});

	afterAll(async () => {
		await pool.end();
	});

	async function seedOrganization(
		organizationId: string,
		userId: string,
		employeeId: string,
		categoryId: string,
	) {
		const timestamp = new Date(now.epochMilliseconds);
		await pool.query(
			`insert into organization (id, name, slug, created_at)
			 values ($1, $2, $3, $4)`,
			[organizationId, organizationId, organizationId, timestamp],
		);
		await pool.query(
			`insert into "user" (id, name, email, created_at, updated_at)
			 values ($1, $2, $3, $4, $4)`,
			[userId, userId, `${userId}@example.test`, timestamp],
		);
		await pool.query(
			`insert into member (id, organization_id, user_id, role, created_at)
			 values ($1, $2, $3, 'member', $4)`,
			[`member-${organizationId}`, organizationId, userId, timestamp],
		);
		await pool.query(
			`insert into employee (id, user_id, organization_id, updated_at)
			 values ($1, $2, $3, $4)`,
			[employeeId, userId, organizationId, timestamp],
		);
		await pool.query(
			`insert into absence_category (
				id, organization_id, type, name, requires_work_time, requires_approval,
				counts_against_vacation, is_active, created_at, updated_at
			) values ($1, $2, 'vacation', 'Integration', false, true, true, true, $3, $3)`,
			[categoryId, organizationId, timestamp],
		);
	}

	async function seed() {
		const timestamp = new Date(now.epochMilliseconds);
		await seedOrganization(
			ids.organizationOne,
			ids.userOne,
			ids.employeeOne,
			ids.categoryOne,
		);
		await seedOrganization(
			ids.organizationTwo,
			ids.userTwo,
			ids.employeeTwo,
			ids.categoryTwo,
		);
		await pool.query(
			`insert into "user" (id, name, email, created_at, updated_at)
			 values ($1, $2, $3, $4, $4)`,
			[
				ids.userManager,
				"Integration manager",
				`${ids.userManager}@example.test`,
				timestamp,
			],
		);
		await pool.query(
			`insert into member (id, organization_id, user_id, role, created_at)
			 values ($1, $2, $3, 'member', $4)`,
			[
				`member-${ids.organizationOne}-manager`,
				ids.organizationOne,
				ids.userManager,
				timestamp,
			],
		);
		await pool.query(
			`insert into employee (id, user_id, organization_id, updated_at)
			 values ($1, $2, $3, $4)`,
			[ids.employeeManager, ids.userManager, ids.organizationOne, timestamp],
		);
		for (const [
			organizationId,
			employeeId,
			categoryId,
			sourceId,
			workflowId,
		] of [
			[
				ids.organizationOne,
				ids.employeeOne,
				ids.categoryOne,
				ids.sourceOne,
				ids.workflowOne,
			],
			[
				ids.organizationTwo,
				ids.employeeTwo,
				ids.categoryTwo,
				ids.sourceTwo,
				ids.workflowTwo,
			],
		] as const) {
			await pool.query(
				`insert into absence_entry (
					id, employee_id, category_id, start_date, end_date, status,
					organization_id, notes, created_at, updated_at
				) values ($1, $2, $3, '2026-07-20', '2026-07-20', 'pending', $4, 'finalizer:0', $5, $5)`,
				[sourceId, employeeId, categoryId, organizationId, timestamp],
			);
			await pool.query(
				`insert into approval_workflow (
					id, organization_id, workflow_type, source_type, source_id,
					requester_employee_id, status, current_stage_order, version,
					policy_snapshot, context_snapshot, display_snapshot, submitted_at,
					created_at, updated_at
				) values ($1, $2, 'absence', 'absence_entry', $3, $4, 'pending', 1, 1,
					'{}', '{}', '{}', $5, $5, $5)`,
				[workflowId, organizationId, sourceId, employeeId, timestamp],
			);
			await pool.query(
				`update absence_entry set approval_workflow_id = $1
				 where organization_id = $2 and id = $3`,
				[workflowId, organizationId, sourceId],
			);
			await pool.query(
				`insert into approval_workflow_rollout (
					organization_id, workflow_type, lifecycle_mode, side_effect_mode, created_at, updated_at
				) values ($1, 'absence', 'canonical', 'canonical', $2, $2)`,
				[organizationId, timestamp],
			);
		}
		await pool.query(
			`insert into approval_workflow_stage (
				id, organization_id, workflow_id, stage_order, label, resolver_snapshot,
				activation_mode, status, activated_at, created_at, updated_at
			) values ($1, $2, $3, 1, 'Review', '{}', 'human', 'pending', $4, $4, $4)`,
			[ids.stageOne, ids.organizationOne, ids.workflowOne, timestamp],
		);
		await pool.query(
			`insert into approval_stage_assignment (
				id, organization_id, workflow_id, stage_id, assignment_sequence,
				approver_employee_id, status, assigned_at, created_at, updated_at
			) values ($1, $2, $3, $4, 1, $5, 'pending', $6, $6, $6)`,
			[
				ids.assignmentOne,
				ids.organizationOne,
				ids.workflowOne,
				ids.stageOne,
				ids.employeeOne,
				timestamp,
			],
		);
		await pool.query(
			`insert into approval_request (
				id, organization_id, entity_type, entity_id, requested_by, approver_id,
				status, created_at, updated_at
			) values ($1, $2, 'absence_entry', $3, $4, $4, 'pending', $5, $5)`,
			[
				ids.legacyRequestOne,
				ids.organizationOne,
				ids.sourceOne,
				ids.employeeOne,
				timestamp,
			],
		);
	}

	async function seedRequesterAutoApproveStage() {
		const timestamp = new Date(now.epochMilliseconds);
		await pool.query(
			`insert into approval_workflow_stage (
				id, organization_id, workflow_id, stage_order, label, resolver_snapshot,
				activation_mode, status, created_at, updated_at
			) values ($1, $2, $3, 2, 'Requester auto-approval', '{}',
				'requester_auto_approve', 'waiting', $4, $4)`,
			[ids.stageTwo, ids.organizationOne, ids.workflowOne, timestamp],
		);
	}

	async function persistedRows() {
		const query = async (statement: string, values: string[] = []) =>
			(await pool.query<{ row: unknown }>(statement, values)).rows.map(
				({ row }) => normalize(row),
			);
		return {
			workflow: await query(
				"select to_jsonb(row) as row from approval_workflow row where organization_id = $1 and id = $2",
				[ids.organizationOne, ids.workflowOne],
			),
			stage: await query(
				"select to_jsonb(row) as row from approval_workflow_stage row where organization_id = $1 and workflow_id = $2",
				[ids.organizationOne, ids.workflowOne],
			),
			assignment: await query(
				"select to_jsonb(row) as row from approval_stage_assignment row where organization_id = $1 and workflow_id = $2",
				[ids.organizationOne, ids.workflowOne],
			),
			event: await query(
				"select to_jsonb(row) as row from approval_workflow_event row where organization_id = $1 and workflow_id = $2 order by version, event_index",
				[ids.organizationOne, ids.workflowOne],
			),
			receipt: await query(
				"select to_jsonb(row) as row from approval_workflow_command row where organization_id = $1 and workflow_id = $2 order by idempotency_key",
				[ids.organizationOne, ids.workflowOne],
			),
			projection: await query(
				"select to_jsonb(row) as row from approval_requester_projection row where organization_id = $1 and workflow_id = $2",
				[ids.organizationOne, ids.workflowOne],
			),
			outbox: await query(
				"select to_jsonb(row) as row from approval_outbox row where organization_id = $1 and workflow_id = $2",
				[ids.organizationOne, ids.workflowOne],
			),
			source: await query(
				"select to_jsonb(row) as row from absence_entry row where organization_id = $1 and id = $2",
				[ids.organizationOne, ids.sourceOne],
			),
			legacy: await query(
				"select to_jsonb(row) as row from approval_request row where organization_id = $1 and id = $2",
				[ids.organizationOne, ids.legacyRequestOne],
			),
		};
	}

	function sortedEventReferences(
		references: Array<{ eventId: string; eventType: string }>,
	) {
		return references.sort((left, right) =>
			`${left.eventId}:${left.eventType}`.localeCompare(
				`${right.eventId}:${right.eventType}`,
			),
		);
	}

	function expectOutboxMatchesResult(
		rows: unknown[],
		result: ApprovalCommandResult,
	): void {
		const eventReferences = sortedEventReferences(
			result.events.map((event) => ({
				eventId: event.id,
				eventType: event.eventType,
			})),
		);
		expect(
			sortedEventReferences(
				result.outbox.map((outbox) => ({
					eventId: outbox.eventId,
					eventType: outbox.eventType,
				})),
			),
		).toEqual(eventReferences);
		expect(
			sortedEventReferences(
				rows.map((row) => ({
					eventId: (row as { event_id: string }).event_id,
					eventType: (row as { event_type: string }).event_type,
				})),
			),
		).toEqual(eventReferences);
	}

	function request(
		overrides: Partial<ApprovalWorkflowCommandRequest> = {},
	): ApprovalWorkflowCommandRequest {
		return {
			organizationId: ids.organizationOne,
			workflowId: ids.workflowOne,
			expectedVersion: 1,
			idempotencyKey: "engine-command",
			principal: { kind: "employee", userId: ids.userOne },
			command: {
				type: "approve",
				stageId: ids.stageOne,
				assignmentId: ids.assignmentOne,
			},
			...overrides,
		};
	}

	function expectedEventTypes(status: "approved" | "rejected" | "cancelled") {
		return [`assignment.${status}`, `stage.${status}`, `workflow.${status}`];
	}

	function terminalResult(
		results: readonly PromiseSettledResult<ApprovalCommandResult>[],
	): ApprovalCommandResult {
		const winner = results.find(
			(result): result is PromiseFulfilledResult<ApprovalCommandResult> =>
				result.status === "fulfilled",
		);
		if (!winner) throw new Error("expected one terminal winner");
		return winner.value;
	}

	function engine(
		options: {
			failAt?: FailurePoint;
			foreignResult?: boolean;
			requesterAutoApprove?: boolean;
			deleteCancelledSource?: boolean;
			sourceContexts?: unknown[];
		} = {},
	) {
		const adapter = {
			workflowType: "absence" as const,
			sourceType: "absence_entry",
			loadSource: async () => {
				throw new Error("engine must use its trusted source loader");
			},
			getTrustedCapabilities: async () => ({ canCancelAfterApproval: false }),
			produceRoutingContext: async () => ({}),
			preflightCommand: async () => undefined,
			preflightTerminal: async () => undefined,
			finalizeTerminal: async (
				input: ApprovalTerminalAdapterInput<unknown>,
			) => {
				if (
					input.organizationId !== ids.organizationOne ||
					input.workflow.id !== ids.workflowOne ||
					input.sourceIdentity.organizationId !== ids.organizationOne ||
					input.sourceIdentity.sourceId !== ids.sourceOne ||
					(input.source as { organizationId?: string }).organizationId !==
						ids.organizationOne
				) {
					throw new Error("terminal source context escaped organization scope");
				}
				if (
					input.transition.to === "cancelled" &&
					options.deleteCancelledSource
				) {
					await input.dbService.db.execute(sql`
						delete from absence_entry
						where organization_id = ${ids.organizationOne}
							and id = ${ids.sourceOne}
							and approval_workflow_id = ${ids.workflowOne}
					`);
				} else {
					const sourceStatus =
						input.transition.to === "approved" ? "approved" : "rejected";
					await input.dbService.db.execute(sql`
						update absence_entry set status = ${sourceStatus}, notes = notes || ':finalized', updated_at = now()
						where organization_id = ${ids.organizationOne}
							and id = ${ids.sourceOne}
							and approval_workflow_id = ${ids.workflowOne}
					`);
				}
				if (options.failAt === "finalizer")
					throw new Error("finalizer failure");
				return {
					organizationId: input.organizationId,
					workflowId: input.workflow.id,
					sourceIdentity: input.sourceIdentity,
					transitionKind: input.transition.kind,
					terminalStatus: input.transition.to,
					sourceSnapshot: {},
					eventPayload: {},
					compatibilityPayload: {},
					finalizedAt: now,
				};
			},
			projectDisplay: async () => ({ displayPayload: {}, searchText: "" }),
		};
		const repository = createApprovalWorkflowRepository({
			db: database as unknown as ApprovalWorkflowDatabase,
			adapterRegistry: {
				get: () => adapter,
				authorizeApprovedCancellation: async () => {
					throw new Error("approved cancellation is not used by this fixture");
				},
			} as never,
			activationResolver: {
				resolve: async (input) => {
					if (!options.requesterAutoApprove) {
						throw new Error("terminal fixture must not activate another stage");
					}
					if (
						input.organizationId !== ids.organizationOne ||
						input.workflow.id !== ids.workflowOne ||
						input.stage.id !== ids.stageTwo ||
						input.stage.activationMode !== "requester_auto_approve"
					) {
						throw new Error("activation context escaped fixture scope");
					}
					return {
						organizationId: ids.organizationOne,
						workflowId: ids.workflowOne,
						stageId: ids.stageTwo,
						activationMode: "requester_auto_approve",
						assignments: [],
					};
				},
			},
			createLegacyRowWriter: () => ({
				writeLegacyRows: async () => {
					throw new Error(
						"test compatibility writer is transaction-bound below",
					);
				},
			}),
			observationPlanner: {
				plan: async () => {
					throw new Error("legacy observation is not part of this fixture");
				},
			},
			clock: { nowInstant: () => now },
		});
		const transactionRepository: ApprovalWorkflowRepository = {
			withTransaction: (operation) =>
				repository.withTransaction(async (context) =>
					operation({
						...context,
						compatibilityWriter: {
							...context.compatibilityWriter,
							withWriteGate() {
								return this;
							},
							mirrorCanonicalToLegacy: async ({ result }) => {
								const legacyStatus =
									result.snapshot.status === "approved"
										? "approved"
										: "rejected";
								await context.dbService.db.execute(sql`
									update approval_request set status = ${legacyStatus}, notes = ${`compatibility-written:${result.snapshot.status}`}, updated_at = now()
									where organization_id = ${ids.organizationOne}
										and id = ${ids.legacyRequestOne}
										and entity_type = 'absence_entry'
										and entity_id = ${ids.sourceOne}
								`);
							},
						},
						projectionWriter:
							options.failAt === "projection"
								? {
										write: async (input) => {
											await context.projectionWriter.write(input);
											throw new Error("projection failure");
										},
									}
								: context.projectionWriter,
						outboxWriter:
							options.failAt === "outbox"
								? {
										write: async (input) => {
											await context.outboxWriter.write(input);
											throw new Error("outbox failure");
										},
									}
								: context.outboxWriter,
					}),
				),
		};
		return createApprovalTransitionEngine({
			repository: transactionRepository,
			actorResolver: {
				resolve: async ({ organizationId, principal }) => {
					if (principal.kind !== "employee") {
						throw new Error("actor resolution escaped organization scope");
					}
					if (
						organizationId === ids.organizationOne &&
						principal.userId === ids.userOne
					) {
						return {
							kind: "employee" as const,
							employeeId: ids.employeeOne,
							userId: ids.userOne,
						};
					}
					if (
						organizationId === ids.organizationOne &&
						principal.userId === ids.userManager
					) {
						return {
							kind: "employee" as const,
							employeeId: ids.employeeManager,
							userId: ids.userManager,
						};
					}
					if (
						organizationId === ids.organizationTwo &&
						principal.userId === ids.userTwo
					) {
						return {
							kind: "employee" as const,
							employeeId: ids.employeeTwo,
							userId: ids.userTwo,
						};
					}
					throw new Error("actor resolution escaped organization scope");
				},
			},
			authorization: {
				authorize: async ({ organizationId, workflow, actor, command }) => {
					if (
						organizationId !== ids.organizationOne ||
						workflow.organizationId !== ids.organizationOne ||
						actor.kind !== "employee"
					) {
						throw new Error("authorization escaped organization scope");
					}
					if (
						actor.employeeId === ids.employeeOne &&
						(command.type === "approve" || command.type === "reject")
					) {
						return "active_assignment";
					}
					if (
						actor.employeeId === ids.employeeManager &&
						command.type === "cancel"
					) {
						return "manage_approval";
					}
					throw new Error("authorization grant is not trusted");
				},
			},
			sourceLoader: {
				load: async (input) => {
					options.sourceContexts?.push(input);
					if (
						input.organizationId !== ids.organizationOne ||
						input.workflow.organizationId !== ids.organizationOne ||
						input.workflow.id !== ids.workflowOne ||
						input.workflow.sourceId !== ids.sourceOne
					) {
						throw new Error("source route context escaped organization scope");
					}
					return {
						organizationId: input.organizationId,
						sourceId: input.workflow.sourceId,
					};
				},
			},
			resultBuilder: {
				build: ({ materializedBatch }): ApprovalCommandResult => {
					const materialized = materializedBatch.at(-1);
					if (!materialized) throw new Error("missing materialized pass");
					const events = materializedBatch.flatMap((pass) =>
						pass.events.map(
							({ persistenceMetadata: _persistenceMetadata, ...event }) =>
								event,
						),
					);
					const snapshot = options.foreignResult
						? {
								...materialized.resultingSnapshot,
								organizationId: ids.organizationTwo,
							}
						: materialized.resultingSnapshot;
					if (events.length === 0)
						throw new Error("terminal transition did not materialize an event");
					return {
						snapshot,
						events,
						projection: {
							organizationId: snapshot.organizationId,
							workflowId: snapshot.id,
							workflowType: snapshot.workflowType,
							sourceType: snapshot.sourceType,
							sourceId: snapshot.sourceId,
							status: snapshot.status,
							currentStageOrder: snapshot.currentStageOrder,
							requesterEmployeeId: snapshot.requesterEmployeeId,
							displayPayload: {},
							searchText: "integration",
							activeInboxStage: null,
							updatedAt: now,
						},
						outbox: events.map((event) => ({
							organizationId: snapshot.organizationId,
							workflowId: snapshot.id,
							eventId: event.id,
							eventType: event.eventType,
							dedupeKey: `integration:${event.id}`,
							payload: { eventId: event.id },
							disposition: "deliver",
							createdAt: now,
						})),
					};
				},
			},
			clock: { nowInstant: () => now },
		});
	}

	it("allows exactly one distinct concurrent decision and leaves no loser side effects", async () => {
		const engineInstance = engine();
		const approve = request({ idempotencyKey: "distinct-approve" });
		const reject = request({
			idempotencyKey: "distinct-reject",
			command: {
				type: "reject",
				stageId: ids.stageOne,
				assignmentId: ids.assignmentOne,
				reason: "conflict",
			},
		});
		const [first, second] = await Promise.allSettled([
			engineInstance.execute(approve),
			engineInstance.execute(reject),
		]);
		const fulfilled = [first, second].filter(
			(result) => result.status === "fulfilled",
		);
		const rejected = [first, second].filter(
			(result) => result.status === "rejected",
		);
		expect(fulfilled).toHaveLength(1);
		expect(rejected).toHaveLength(1);
		expect(rejected[0]).toMatchObject({ reason: { code: "version_conflict" } });
		const winner = terminalResult([first, second]);
		const status = winner.snapshot.status;
		if (status !== "approved" && status !== "rejected") {
			throw new Error("unexpected winner status");
		}
		expect(winner.events.map((event) => event.eventType)).toEqual(
			expectedEventTypes(status),
		);
		const rows = await persistedRows();
		expect(rows.workflow).toEqual([expect.objectContaining({ version: 2 })]);
		expect(
			rows.event.map((row) => (row as { event_type: string }).event_type),
		).toEqual(expectedEventTypes(status));
		expect(rows.receipt).toHaveLength(1);
		expect(rows.projection).toHaveLength(1);
		expectOutboxMatchesResult(rows.outbox, winner);
		expect(rows.source).toEqual([
			expect.objectContaining({ notes: "finalizer:0:finalized" }),
		]);
		expect(rows.legacy).toEqual([
			expect.objectContaining({
				status,
				notes: `compatibility-written:${status}`,
			}),
		]);
		const losingKey =
			first.status === "fulfilled" ? "distinct-reject" : "distinct-approve";
		expect(rows.receipt).not.toContainEqual(
			expect.objectContaining({ idempotency_key: losingKey }),
		);
	});

	it("reuses a concurrent completed receipt without executing canonical writes twice", async () => {
		const engineInstance = engine();
		const command = request({ idempotencyKey: "same-command" });
		const [first, second] = await Promise.all([
			engineInstance.execute(command),
			engineInstance.execute(command),
		]);
		expect(second).toEqual(first);
		const rows = await persistedRows();
		expect(rows.workflow).toEqual([expect.objectContaining({ version: 2 })]);
		expect(first.events.map((event) => event.eventType)).toEqual(
			expectedEventTypes("approved"),
		);
		expect(
			rows.event.map((row) => (row as { event_type: string }).event_type),
		).toEqual(expectedEventTypes("approved"));
		expect(rows.receipt).toEqual([
			expect.objectContaining({
				idempotency_key: "same-command",
				state: "completed",
			}),
		]);
		expect(rows.projection).toHaveLength(1);
		expectOutboxMatchesResult(rows.outbox, first);
		expect(rows.source).toEqual([
			expect.objectContaining({ notes: "finalizer:0:finalized" }),
		]);
		expect(rows.legacy).toEqual([
			expect.objectContaining({
				status: "approved",
				notes: "compatibility-written:approved",
			}),
		]);
	});

	it("replays one receipt containing the decision and requester auto-approval passes", async () => {
		await seedRequesterAutoApproveStage();
		const engineInstance = engine({ requesterAutoApprove: true });
		const command = request({ idempotencyKey: "multi-pass-replay" });

		const first = await engineInstance.execute(command);
		const replay = await engineInstance.execute(command);

		expect(replay).toEqual(first);
		expect(first.snapshot).toMatchObject({
			status: "approved",
			currentStageOrder: null,
			version: 3,
		});
		const rows = await persistedRows();
		expect(rows.workflow).toEqual([
			expect.objectContaining({ status: "approved", version: 3 }),
		]);
		expect(
			rows.event.map((row) => {
				const event = row as {
					version: number;
					event_index: number;
					event_type: string;
				};
				return [event.version, event.event_index, event.event_type];
			}),
		).toEqual([
			[2, 0, "assignment.approved"],
			[2, 1, "stage.approved"],
			[2, 2, "workflow.activation_requested"],
			[3, 0, "stage.auto_approved"],
			[3, 1, "workflow.approved"],
		]);
		expectOutboxMatchesResult(rows.outbox, first);
		expect(rows.outbox).toHaveLength(5);
		expect(rows.receipt).toEqual([
			expect.objectContaining({
				idempotency_key: "multi-pass-replay",
				state: "completed",
			}),
		]);
		expect(rows.source).toEqual([
			expect.objectContaining({
				status: "approved",
				notes: "finalizer:0:finalized",
			}),
		]);
	});

	it("allows only one of a manager cancellation and active assignment approval", async () => {
		const engineInstance = engine({ deleteCancelledSource: true });
		const approve = request({ idempotencyKey: "manager-race-approve" });
		const cancel = request({
			idempotencyKey: "manager-race-cancel",
			principal: { kind: "employee", userId: ids.userManager },
			command: { type: "cancel", reason: "manager cancellation" },
		});
		const [first, second] = await Promise.allSettled([
			engineInstance.execute(approve),
			engineInstance.execute(cancel),
		]);
		const fulfilled = [first, second].filter(
			(result) => result.status === "fulfilled",
		);
		const rejected = [first, second].filter(
			(result) => result.status === "rejected",
		);
		expect(fulfilled).toHaveLength(1);
		expect(rejected).toHaveLength(1);
		expect(rejected[0]).toMatchObject({ reason: { code: "version_conflict" } });
		const winner = terminalResult([first, second]);
		const status = winner.snapshot.status;
		if (status !== "approved" && status !== "cancelled") {
			throw new Error("unexpected manager-race winner status");
		}
		expect(winner.events.map((event) => event.eventType)).toEqual(
			expectedEventTypes(status),
		);
		const rows = await persistedRows();
		expect(rows.workflow).toEqual([
			expect.objectContaining({ version: 2, status }),
		]);
		expect(
			rows.event.map((row) => (row as { event_type: string }).event_type),
		).toEqual(expectedEventTypes(status));
		expect(rows.receipt).toHaveLength(1);
		expect(rows.receipt).toEqual([
			expect.objectContaining({ state: "completed" }),
		]);
		expect(rows.projection).toHaveLength(1);
		expectOutboxMatchesResult(rows.outbox, winner);
		expect(rows.source).toEqual(
			status === "cancelled"
				? []
				: [expect.objectContaining({ notes: "finalizer:0:finalized" })],
		);
		expect(rows.legacy).toEqual([
			expect.objectContaining({
				status: status === "approved" ? "approved" : "rejected",
				notes: `compatibility-written:${status}`,
			}),
		]);
		const losingKey =
			first.status === "fulfilled"
				? "manager-race-cancel"
				: "manager-race-approve";
		expect(rows.receipt).not.toContainEqual(
			expect.objectContaining({ idempotency_key: losingKey }),
		);
	});

	it("rolls back canonical cancellation source deletion when later persistence fails", async () => {
		const before = await persistedRows();
		const cancel = request({
			idempotencyKey: "cancel-rollback",
			principal: { kind: "employee", userId: ids.userManager },
			command: { type: "cancel", reason: "rollback cancellation" },
		});

		await expect(
			engine({ deleteCancelledSource: true, failAt: "projection" }).execute(
				cancel,
			),
		).rejects.toThrow("projection failure");
		expect(await persistedRows()).toEqual(before);
	});

	it.each([
		"finalizer",
		"projection",
		"outbox",
	] as const)("rolls back every durable write when %s persistence fails", async (failAt) => {
		const before = await persistedRows();
		await expect(engine({ failAt }).execute(request())).rejects.toThrow(
			`${failAt} failure`,
		);
		expect(await persistedRows()).toEqual(before);
	});

	it("enforces organization scope for source routing and result writes", async () => {
		const sourceContexts: unknown[] = [];
		await expect(
			engine({ sourceContexts }).execute(
				request({
					organizationId: ids.organizationTwo,
					idempotencyKey: "foreign-workflow",
					principal: { kind: "employee", userId: ids.userTwo },
				}),
			),
		).rejects.toMatchObject({ code: "not_found" });
		expect(sourceContexts).toEqual([]);
		const before = await persistedRows();
		await expect(
			engine({ foreignResult: true, sourceContexts }).execute(
				request({ idempotencyKey: "foreign-result" }),
			),
		).rejects.toMatchObject({ code: "result_scope" });
		expect(sourceContexts).toHaveLength(1);
		expect(await persistedRows()).toEqual(before);
	});
});
