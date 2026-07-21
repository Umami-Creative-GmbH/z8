import { PgDialect, type SQL } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import type { ApprovalDomainAdapterRegistry } from "../domain-adapters/registry";
import type {
	ApprovalTerminalFinalizationResult,
	ApprovalWorkflowTransactionContext,
} from "../domain-adapters/types";
import { getCutoverBehavior } from "./cutover";
import type {
	ApprovalCommandResult,
	ApprovalDbService,
	ApprovalMaterializedTransitionPlan,
	ApprovalWorkflowSnapshot,
} from "./ports";
import {
	createApprovalTransitionResultBuilder,
	createApprovalWorkflowAuthorization,
	createApprovalWorkflowRuntime,
	createDatabaseApprovalCommandActorResolver,
	createProductionApprovalWorkflowRuntime,
	createRegistryApprovalSourceLoader,
} from "./runtime";

const dialect = new PgDialect();
const now = parseInstant("2026-07-19T09:00:00Z");
const ids = {
	workflow: "10000000-0000-4000-8000-000000000001",
	source: "20000000-0000-4000-8000-000000000001",
	requester: "30000000-0000-4000-8000-000000000001",
	approver: "40000000-0000-4000-8000-000000000001",
	stage: "50000000-0000-4000-8000-000000000001",
	assignment: "60000000-0000-4000-8000-000000000001",
	event: "70000000-0000-4000-8000-000000000001",
} as const;

function dbService(rows: unknown[] = [], subsequentRows: unknown[][] = []) {
	const calls: SQL[] = [];
	const service: ApprovalDbService = {
		db: {
			execute: async (statement) => {
				calls.push(statement);
				return {
					rows: calls.length === 1 ? rows : (subsequentRows.shift() ?? []),
				};
			},
		},
	};
	return { calls, service };
}

function snapshot(
	overrides: Partial<ApprovalWorkflowSnapshot> = {},
): ApprovalWorkflowSnapshot {
	return {
		id: ids.workflow,
		organizationId: "org-1",
		workflowType: "absence",
		sourceType: "absence_entry",
		sourceId: ids.source,
		requesterEmployeeId: ids.requester,
		status: "pending",
		currentStageOrder: 1,
		version: 2,
		policySnapshot: {},
		contextSnapshot: {},
		displaySnapshot: {
			displayPayload: { title: "Vacation" },
			searchText: "vacation",
		},
		submittedAt: now,
		completedAt: null,
		cancelledAt: null,
		decisionReason: null,
		stages: [
			{
				id: ids.stage,
				organizationId: "org-1",
				workflowId: ids.workflow,
				sequence: 1,
				label: "Manager",
				resolverSnapshot: {},
				activationMode: "human",
				status: "pending",
				activatedAt: now,
				decidedAt: null,
				decisionReason: null,
				legacyApprovalRequestId: null,
				assignments: [
					{
						id: ids.assignment,
						organizationId: "org-1",
						workflowId: ids.workflow,
						stageId: ids.stage,
						sequence: 1,
						approverEmployeeId: ids.approver,
						status: "pending",
						assignedAt: now,
						resolvedAt: null,
						resolvedBy: null,
						reassignedByEmployeeId: null,
						reassignedFromAssignmentId: null,
						reassignmentMetadata: null,
					},
				],
			},
		],
		...overrides,
	};
}

function pass(
	resultingSnapshot: ApprovalWorkflowSnapshot,
	eventId = ids.event,
): ApprovalMaterializedTransitionPlan {
	return {
		expectedVersion: resultingSnapshot.version - 1,
		resultingSnapshot,
		changes: {} as never,
		events: [
			{
				id: eventId,
				organizationId: resultingSnapshot.organizationId,
				workflowId: resultingSnapshot.id,
				version: resultingSnapshot.version,
				eventIndex: 0,
				eventType:
					resultingSnapshot.status === "approved"
						? "workflow.approved"
						: "assignment.approved",
				actor: {
					kind: "employee",
					employeeId: ids.approver,
					userId: "user-1",
				},
				previousState: { status: "pending" },
				resultingState: { status: resultingSnapshot.status },
				reason: null,
				metadata: null,
				references: {},
				persistenceMetadata: null,
				idempotencyKey: "command-1",
				occurredAt: now,
			},
		],
		nextAction: { kind: "none" },
	};
}

function firstPassEvent(passes: ApprovalMaterializedTransitionPlan[]) {
	const event = passes[0]?.events[0];
	if (!event) throw new Error("Invalid test fixture");
	return event;
}

describe("approval workflow runtime", () => {
	it("exports the production runtime dependency factories", () => {
		expect(createDatabaseApprovalCommandActorResolver).toBeTypeOf("function");
		expect(createApprovalWorkflowAuthorization).toBeTypeOf("function");
		expect(createRegistryApprovalSourceLoader).toBeTypeOf("function");
		expect(createApprovalTransitionResultBuilder).toBeTypeOf("function");
		expect(createApprovalWorkflowRuntime).toBeTypeOf("function");
		expect(createProductionApprovalWorkflowRuntime).toBeTypeOf("function");
	});

	it("composes both migrated production adapters without server imports", async () => {
		let registered: ApprovalDomainAdapterRegistry | undefined;
		const runtime = createProductionApprovalWorkflowRuntime({
			db: {
				transaction: async (operation) =>
					operation({ execute: async () => ({ rows: [] }) }),
			},
			adapters: {
				absence: {
					clock: { nowInstant: () => now },
					finalizeAbsenceTerminal: async () => ({}),
					deleteCancelledAbsence: async () => undefined,
				},
				timeCorrection: {
					clock: { nowInstant: () => now },
					finalizeTimeCorrectionTerminal: async () => ({
						transition: "approved",
						requesterEmployeeId: ids.requester,
						dirtyFromDate: null,
					}),
					deleteCancelledCorrections: async () => undefined,
				},
			},
			canManageApproval: async () => false,
			clock: { nowInstant: () => now },
		});
		await runtime.repository.withTransaction(async (context) => {
			registered = context.adapterRegistry;
		});

		expect(registered?.get("absence")).toMatchObject({
			workflowType: "absence",
			sourceType: "absence_entry",
		});
		expect(registered?.get("time_correction")).toMatchObject({
			workflowType: "time_correction",
			sourceType: "time_entry",
		});
		await expect(
			registered?.get("manual_time_submission").loadSource({} as never),
		).rejects.toMatchObject({ name: "ApprovalDomainNotMigratedError" });
	});

	it("composes one repository runtime with the production transaction-bound dependencies", async () => {
		let transactions = 0;
		const registry = {} as ApprovalDomainAdapterRegistry;
		const runtime = createApprovalWorkflowRuntime({
			db: {
				transaction: async (operation) => {
					transactions += 1;
					return operation({ execute: async () => ({ rows: [] }) });
				},
			},
			adapterRegistry: registry,
			canManageApproval: async () => false,
			clock: { nowInstant: () => now },
		});
		expect(runtime.transitionEngine.execute).toBeTypeOf("function");
		expect(runtime.transitionEngine.executeInTransaction).toBeTypeOf(
			"function",
		);
		expect(
			runtime.transitionEngine.executeInTransactionWithDisposition,
		).toBeTypeOf("function");
		await runtime.repository.withTransaction(async (context) => {
			expect(context.adapterRegistry).toBe(registry);
		});
		expect(transactions).toBe(1);
	});

	it("composes the real observation planner and transaction-bound legacy row writer", async () => {
		const statements: Array<{ sql: string; params: unknown[] }> = [];
		const workflow = snapshot();
		const result: ApprovalCommandResult = {
			snapshot: workflow,
			events: [],
			projection: {
				organizationId: workflow.organizationId,
				workflowId: workflow.id,
				workflowType: workflow.workflowType,
				sourceType: workflow.sourceType,
				sourceId: workflow.sourceId,
				status: workflow.status,
				currentStageOrder: workflow.currentStageOrder,
				requesterEmployeeId: workflow.requesterEmployeeId,
				displayPayload: workflow.displaySnapshot,
				searchText: "vacation",
				activeInboxStage: { stageId: ids.stage, stageOrder: 1 },
				updatedAt: now,
			},
			outbox: [],
		};
		const registry = {} as ApprovalDomainAdapterRegistry;
		const runtime = createApprovalWorkflowRuntime({
			db: {
				transaction: async (operation) =>
					operation({
						execute: async (statement) => {
							const compiled = dialect.sqlToQuery(statement);
							statements.push(compiled);
							if (/approval_workflow_rollout/i.test(compiled.sql)) {
								return { rows: [{ lifecycle_mode: "canonical" }] };
							}
							if (/from approval_workflow_stage/i.test(compiled.sql)) {
								return {
									rows: [
										{
											id: ids.stage,
											organization_id: "org-1",
											workflow_id: ids.workflow,
											legacy_approval_request_id: ids.stage,
										},
									],
								};
							}
							if (/from approval_request/i.test(compiled.sql)) {
								return { rows: [] };
							}
							if (/insert into approval_request/i.test(compiled.sql)) {
								return {
									rows: [
										{
											id: ids.stage,
											organization_id: "org-1",
											entity_type: "absence_entry",
											entity_id: ids.source,
										},
									],
								};
							}
							return { rows: [] };
						},
					}),
			},
			adapterRegistry: registry,
			canManageApproval: async () => false,
			clock: { nowInstant: () => now },
		});
		await runtime.repository.withTransaction(async (context) => {
			expect(context.adapterRegistry).toBe(registry);
			await expect(
				context.repository.applyObservedLegacyTransition({
					organizationId: "org-1",
					source: {
						organizationId: "org-1",
						workflowType: "absence",
						sourceType: "absence_entry",
						sourceId: ids.source,
					},
					before: {
						organizationId: "org-1",
						source: {
							organizationId: "org-1",
							workflowType: "absence",
							sourceType: "absence_entry",
							sourceId: ids.source,
						},
						approvalRequest: null,
						chain: null,
						chainRows: [],
						sourceSnapshot: { status: "submitted" },
						capturedAt: now,
					},
					after: {
						organizationId: "org-1",
						source: {
							organizationId: "org-1",
							workflowType: "absence",
							sourceType: "absence_entry",
							sourceId: ids.source,
						},
						approvalRequest: null,
						chain: null,
						chainRows: [],
						sourceSnapshot: { status: "submitted" },
						capturedAt: now,
					},
					actor: { kind: "legacy_unknown", employeeId: null, userId: null },
					idempotencyKey: "no-transition",
					expectedVersion: null,
				}),
			).rejects.toMatchObject({
				name: "LegacyApprovalObservationPlannerError",
			});
			await context.compatibilityWriter.mirrorCanonicalToLegacy({ result });
		});
		expect(
			statements.some((statement) =>
				/insert into approval_request/i.test(statement.sql),
			),
		).toBe(true);
	});

	it("runs the runtime-composed command dependencies with one transaction identity and injected clock", async () => {
		const workflow = snapshot();
		let loadedDbService: unknown;
		let finalized = 0;
		const source = { id: ids.source };
		const adapter = {
			workflowType: "absence" as const,
			sourceType: "absence_entry",
			loadSource: async (input: { dbService: unknown }) => {
				loadedDbService = input.dbService;
				return source;
			},
			getTrustedCapabilities: async () => ({ canCancelAfterApproval: false }),
			produceRoutingContext: async () => ({}),
			preflightCommand: async () => undefined,
			preflightTerminal: async () => undefined,
			finalizeTerminal: async () => {
				finalized += 1;
				return {
					organizationId: "org-1",
					workflowId: ids.workflow,
					sourceIdentity: workflow,
					transitionKind: "approve" as const,
					terminalStatus: "approved" as const,
					sourceSnapshot: { status: "approved" },
					eventPayload: { status: "approved" },
					compatibilityPayload: {},
					finalizedAt: now,
				};
			},
			projectDisplay: async () => ({ displayPayload: {}, searchText: "" }),
		};
		const registry = {
			get: () => adapter,
			authorizeApprovedCancellation: async () => {
				throw new Error("not used");
			},
		} as unknown as ApprovalDomainAdapterRegistry;
		const runtime = createApprovalWorkflowRuntime({
			db: {
				transaction: async () => {
					throw new Error("not used");
				},
			},
			adapterRegistry: registry,
			canManageApproval: async () => false,
			clock: { nowInstant: () => now },
		});
		const transactionService: ApprovalDbService = {
			db: {
				execute: async (statement) => ({
					rows: /from employee/i.test(dialect.sqlToQuery(statement).sql)
						? [
								{
									id: ids.approver,
									organization_id: "org-1",
									user_id: "approver-user",
								},
							]
						: [
								{
									organization_id: "org-1",
									user_id: "approver-user",
									status: "approved",
								},
							],
				}),
			},
		};
		let applied: ApprovalMaterializedTransitionPlan | undefined;
		const context = {
			dbService: transactionService,
			writeGate: {
				acquire: async () => ({
					mode: "canonical" as const,
					behavior: getCutoverBehavior("canonical"),
				}),
			},
			repository: {
				loadSnapshot: async () => workflow,
				claimCommand: async () => ({ kind: "reserved" as const }),
				allocateTransitionIdentities: async (input: {
					identityAllocations: Array<{
						allocationKey: string;
						entityKind: "assignment" | "event";
					}>;
				}) =>
					input.identityAllocations.map((allocation, index) => ({
						...allocation,
						id: `70000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
					})),
				tryAdvanceVersion: async () => ({
					kind: "advanced" as const,
					version: 3,
				}),
				applyMaterializedTransition: async (
					plan: ApprovalMaterializedTransitionPlan,
				) => {
					applied = plan;
				},
				completeCommand: async () => undefined,
			},
			adapterRegistry: registry,
			activationResolver: {
				resolve: async () => {
					throw new Error("not used");
				},
			},
			compatibilityWriter: {
				withWriteGate() {
					return this;
				},
				mirrorCanonicalToLegacy: async () => undefined,
			},
			projectionWriter: { write: async () => undefined },
			outboxWriter: {
				write: async () => ({ kind: "inserted" as const, id: ids.event }),
			},
		} as unknown as ApprovalWorkflowTransactionContext;

		const result = await runtime.transitionEngine.executeInTransaction(
			context,
			{
				organizationId: "org-1",
				workflowId: ids.workflow,
				expectedVersion: 2,
				idempotencyKey: "runtime-approve",
				principal: { kind: "employee", userId: "approver-user" },
				command: {
					type: "approve",
					stageId: ids.stage,
					assignmentId: ids.assignment,
				},
			},
		);

		expect(loadedDbService).toBe(transactionService);
		expect(finalized).toBe(1);
		expect(applied?.events.every((event) => event.occurredAt === now)).toBe(
			true,
		);
		expect(result.snapshot.status).toBe("approved");
		expect(result.outbox.at(-1)?.payload).toEqual({ status: "approved" });
	});

	it.each([
		[[], "missing"],
		[
			[
				{ id: ids.approver, organization_id: "org-1", user_id: "user-1" },
				{ id: ids.requester, organization_id: "org-1", user_id: "user-1" },
			],
			"multiple",
		],
		[
			[{ id: ids.approver, organization_id: "org-2", user_id: "user-1" }],
			"foreign",
		],
	] as const)("rejects %s employee actor resolution", async (rows) => {
		const transaction = dbService([...rows]);
		await expect(
			createDatabaseApprovalCommandActorResolver().resolve({
				dbService: transaction.service,
				organizationId: "org-1",
				principal: { kind: "employee", userId: "user-1" },
			}),
		).rejects.toThrow(/employee actor/i);
		expect(transaction.calls).toHaveLength(1);
		const compiled = dialect.sqlToQuery(transaction.calls[0] as SQL);
		expect(compiled.sql).toMatch(
			/from employee[\s\S]*organization_id[\s\S]*user_id[\s\S]*is_active/i,
		);
		expect(compiled.params).toEqual(
			expect.arrayContaining(["org-1", "user-1"]),
		);
	});

	it("binds one active organization employee to the exact principal user", async () => {
		const transaction = dbService(
			[{ id: ids.approver, organization_id: "org-1", user_id: "user-1" }],
			[[{ organization_id: "org-1", user_id: "user-1", status: "approved" }]],
		);
		await expect(
			createDatabaseApprovalCommandActorResolver().resolve({
				dbService: transaction.service,
				organizationId: "org-1",
				principal: { kind: "employee", userId: "user-1" },
			}),
		).resolves.toEqual({
			kind: "employee",
			employeeId: ids.approver,
			userId: "user-1",
		});
		expect(transaction.calls).toHaveLength(2);
		const membershipQuery = dialect.sqlToQuery(transaction.calls[1] as SQL);
		expect(membershipQuery.sql).toMatch(
			/select organization_id, user_id, status/i,
		);
		expect(membershipQuery.sql).toMatch(
			/from member[\s\S]*organization_id[\s\S]*user_id[\s\S]*limit/i,
		);
		expect(membershipQuery.sql).not.toMatch(/and\s+status\s*=/i);
		expect(membershipQuery.params).toEqual(
			expect.arrayContaining(["org-1", "user-1", 2]),
		);
		expect(membershipQuery.params).not.toContain("approved");
	});

	it.each([
		["missing", []],
		[
			"duplicate",
			[
				{ organization_id: "org-1", user_id: "user-1", status: "approved" },
				{ organization_id: "org-1", user_id: "user-1", status: "approved" },
			],
		],
		[
			"duplicate mixed status",
			[
				{ organization_id: "org-1", user_id: "user-1", status: "approved" },
				{ organization_id: "org-1", user_id: "user-1", status: "suspended" },
			],
		],
		[
			"foreign organization",
			[{ organization_id: "org-2", user_id: "user-1", status: "approved" }],
		],
		[
			"different user",
			[{ organization_id: "org-1", user_id: "user-2", status: "approved" }],
		],
		[
			"null status",
			[{ organization_id: "org-1", user_id: "user-1", status: null }],
		],
		[
			"pending status",
			[{ organization_id: "org-1", user_id: "user-1", status: "pending" }],
		],
		[
			"suspended status",
			[{ organization_id: "org-1", user_id: "user-1", status: "suspended" }],
		],
	] as const)("rejects %s organization membership for a human actor", async (_label, memberships) => {
		const transaction = dbService(
			[{ id: ids.approver, organization_id: "org-1", user_id: "user-1" }],
			[[...memberships]],
		);
		await expect(
			createDatabaseApprovalCommandActorResolver().resolve({
				dbService: transaction.service,
				organizationId: "org-1",
				principal: { kind: "employee", userId: "user-1" },
			}),
		).rejects.toThrow(/member/i);
		expect(transaction.calls).toHaveLength(2);
	});

	it("accepts only established system principals without querying employees", async () => {
		const transaction = dbService();
		await expect(
			createDatabaseApprovalCommandActorResolver().resolve({
				dbService: transaction.service,
				organizationId: "org-1",
				principal: { kind: "system", systemId: "approval-expiry" },
			}),
		).resolves.toEqual({ kind: "system", employeeId: null, userId: null });
		await expect(
			createDatabaseApprovalCommandActorResolver().resolve({
				dbService: transaction.service,
				organizationId: "org-1",
				principal: { kind: "system", systemId: "forged" } as never,
			}),
		).rejects.toThrow(/system/i);
		expect(transaction.calls).toHaveLength(0);
	});

	it("authorizes assignment, requester cancel, management, and system without escalation", async () => {
		const transaction = dbService();
		const managementChecks: unknown[] = [];
		const authorization = createApprovalWorkflowAuthorization({
			canManageApproval: async (input) => {
				managementChecks.push(input);
				return input.actorEmployeeId === ids.requester;
			},
		});
		const workflow = snapshot();
		await expect(
			authorization.authorize({
				dbService: transaction.service,
				organizationId: "org-1",
				workflow,
				actor: {
					kind: "employee",
					employeeId: ids.approver,
					userId: "approver-user",
				},
				command: {
					type: "approve",
					stageId: ids.stage,
					assignmentId: ids.assignment,
				},
			}),
		).resolves.toBe("active_assignment");
		await expect(
			authorization.authorize({
				dbService: transaction.service,
				organizationId: "org-1",
				workflow,
				actor: {
					kind: "employee",
					employeeId: ids.requester,
					userId: "requester-user",
				},
				command: { type: "cancel", reason: "withdrawn" },
			}),
		).resolves.toBe("requester");
		await expect(
			authorization.authorize({
				dbService: transaction.service,
				organizationId: "org-1",
				workflow,
				actor: {
					kind: "employee",
					employeeId: ids.requester,
					userId: "requester-user",
				},
				command: {
					type: "reassign",
					stageId: ids.stage,
					fromEmployeeId: ids.approver,
					toEmployeeId: ids.requester,
				},
			}),
		).resolves.toBe("manage_approval");
		await expect(
			authorization.authorize({
				dbService: transaction.service,
				organizationId: "org-1",
				workflow,
				actor: { kind: "system", employeeId: null, userId: null },
				command: { type: "expire", reason: "deadline" },
			}),
		).resolves.toBe("system");
		expect(managementChecks).toEqual([
			{
				dbService: transaction.service,
				organizationId: "org-1",
				actorEmployeeId: ids.requester,
				workflow,
				command: {
					type: "reassign",
					stageId: ids.stage,
					fromEmployeeId: ids.approver,
					toEmployeeId: ids.requester,
				},
			},
		]);
	});

	it("allows only a transaction-scoped eligible fallback manager decision", async () => {
		const transaction = dbService();
		let eligible = true;
		const checks: unknown[] = [];
		const workflow = snapshot();
		const authorization = createApprovalWorkflowAuthorization({
			canManageApproval: async (input) => {
				checks.push(input);
				return (
					eligible &&
					input.organizationId === "org-1" &&
					input.workflow === workflow &&
					input.command.type === "approve" &&
					input.command.stageId === ids.stage
				);
			},
		});
		const request = {
			dbService: transaction.service,
			organizationId: "org-1",
			workflow,
			actor: {
				kind: "employee" as const,
				employeeId: ids.requester,
				userId: "fallback-user",
			},
			command: {
				type: "approve" as const,
				stageId: ids.stage,
				assignmentId: ids.assignment,
			},
		};

		await expect(authorization.authorize(request)).resolves.toBe(
			"manage_approval",
		);
		eligible = false;
		await expect(authorization.authorize(request)).rejects.toThrow(
			/forbidden/i,
		);
		expect(checks).toEqual([
			expect.objectContaining({
				dbService: transaction.service,
				workflow,
				command: request.command,
			}),
			expect.objectContaining({
				dbService: transaction.service,
				workflow,
				command: request.command,
			}),
		]);
	});

	it("denies foreign scope, unrelated employees, and requester non-cancel commands", async () => {
		const authorization = createApprovalWorkflowAuthorization({
			canManageApproval: async () => false,
		});
		const base = {
			dbService: dbService().service,
			organizationId: "org-1",
			workflow: snapshot(),
			actor: {
				kind: "employee" as const,
				employeeId: ids.requester,
				userId: "requester-user",
			},
		};
		await expect(
			authorization.authorize({
				...base,
				workflow: snapshot({ organizationId: "org-2" }),
				command: { type: "cancel", reason: "withdrawn" },
			}),
		).rejects.toThrow(/scope/i);
		await expect(
			authorization.authorize({
				...base,
				command: {
					type: "approve",
					stageId: ids.stage,
					assignmentId: ids.assignment,
				},
			}),
		).rejects.toThrow(/forbidden/i);
	});

	it("loads the exact workflow source through the registered adapter and transaction", async () => {
		const transaction = dbService();
		const inputs: unknown[] = [];
		const source = { id: ids.source };
		const registry = {
			get: () => ({
				workflowType: "absence",
				sourceType: "absence_entry",
				loadSource: async (input: unknown) => {
					inputs.push(input);
					return source;
				},
			}),
		} as unknown as ApprovalDomainAdapterRegistry;
		const workflow = snapshot();
		await expect(
			createRegistryApprovalSourceLoader(registry).load({
				dbService: transaction.service,
				organizationId: "org-1",
				workflow,
				actor: {
					kind: "employee",
					employeeId: ids.approver,
					userId: "user-1",
				},
			}),
		).resolves.toBe(source);
		expect(inputs).toEqual([
			expect.objectContaining({
				dbService: transaction.service,
				organizationId: "org-1",
				sourceIdentity: {
					organizationId: "org-1",
					workflowType: "absence",
					sourceType: "absence_entry",
					sourceId: ids.source,
				},
			}),
		]);
	});

	it("builds an isolated observe-only result from all passes in exact order", () => {
		const firstSnapshot = snapshot();
		const terminal = snapshot({
			status: "approved",
			currentStageOrder: null,
			version: 3,
			completedAt: now,
			stages: firstSnapshot.stages.map((stage) => ({
				...stage,
				status: "approved",
				decidedAt: now,
			})),
		});
		const first = pass(firstSnapshot);
		const second = pass(terminal, "70000000-0000-4000-8000-000000000002");
		const finalization: ApprovalTerminalFinalizationResult = {
			organizationId: "org-1",
			workflowId: ids.workflow,
			sourceIdentity: snapshot(),
			transitionKind: "approve",
			terminalStatus: "approved",
			sourceSnapshot: { status: "approved" },
			eventPayload: { status: "approved" },
			compatibilityPayload: {},
			finalizedAt: now,
		};
		const result = createApprovalTransitionResultBuilder().build({
			materializedBatch: [first, second],
			finalization,
		});
		expect(result.snapshot).toEqual(terminal);
		expect(result.events.map((event) => event.id)).toEqual([
			ids.event,
			"70000000-0000-4000-8000-000000000002",
		]);
		expect(result.projection).toMatchObject({
			organizationId: "org-1",
			workflowId: ids.workflow,
			sourceId: ids.source,
			status: "approved",
			requesterEmployeeId: ids.requester,
			activeInboxStage: null,
			displayPayload: { title: "Vacation" },
			searchText: "vacation",
		});
		expect(result.outbox).toHaveLength(2);
		expect(result.outbox.every((item) => item.disposition === "observe")).toBe(
			true,
		);
		expect(result.outbox.at(-1)?.payload).toEqual({ status: "approved" });
		first.resultingSnapshot.displaySnapshot.displayPayload = {
			title: "forged",
		};
		expect(result.projection.displayPayload).toEqual({
			title: "Vacation",
		});
		expect(Object.isFrozen(result)).toBe(true);
	});

	it("preserves a legacy flat display snapshot and its known search text", () => {
		const legacy = snapshot({
			displaySnapshot: {
				title: "Legacy vacation",
				searchText: "legacy vacation",
			},
		});
		const result = createApprovalTransitionResultBuilder().build({
			materializedBatch: [pass(legacy)],
			finalization: null,
		});

		expect(result.projection).toMatchObject({
			displayPayload: {
				title: "Legacy vacation",
				searchText: "legacy vacation",
			},
			searchText: "legacy vacation",
		});
	});

	it.each([
		[
			"duplicate events",
			(passes: ApprovalMaterializedTransitionPlan[]) => {
				passes.push(passes[0] as ApprovalMaterializedTransitionPlan);
			},
		],
		[
			"reordered versions",
			(passes: ApprovalMaterializedTransitionPlan[]) => {
				passes.reverse();
			},
		],
		[
			"foreign event",
			(passes: ApprovalMaterializedTransitionPlan[]) => {
				firstPassEvent(passes).organizationId = "org-2";
			},
		],
		[
			"missing event ID",
			(passes: ApprovalMaterializedTransitionPlan[]) => {
				firstPassEvent(passes).id = "";
			},
		],
	] as const)("rejects %s in a materialized batch", (_name, mutate) => {
		const first = pass(snapshot());
		const second = pass(
			snapshot({ version: 3 }),
			"70000000-0000-4000-8000-000000000002",
		);
		const passes = [first, second];
		mutate(passes);
		expect(() =>
			createApprovalTransitionResultBuilder().build({
				materializedBatch: passes as [
					ApprovalMaterializedTransitionPlan,
					...ApprovalMaterializedTransitionPlan[],
				],
				finalization: null,
			}),
		).toThrow(/result builder/i);
	});
});
