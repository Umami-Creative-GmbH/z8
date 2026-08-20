import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PgDialect, type SQL } from "drizzle-orm/pg-core";
import { Effect } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	approvalChainInstance,
	approvalChainStageInstance,
	approvalRequest,
	employee,
	team,
	teamMembership,
	timeEntry,
	timeRecord,
	timeRecordWork,
	workCategory,
	workCategorySet,
	workCategorySetAssignment,
	workCategorySetCategory,
	workPeriod,
} from "@/db/schema";

const source = readFileSync(
	fileURLToPath(new URL("./time-correction-approvals.ts", import.meta.url)),
	"utf8",
);

const {
	markEmployeeWorkBalanceDirty,
	onTimeCorrectionApproved,
	onTimeCorrectionRejected,
} = vi.hoisted(() => ({
	markEmployeeWorkBalanceDirty: vi.fn().mockResolvedValue(undefined),
	onTimeCorrectionApproved: vi.fn(),
	onTimeCorrectionRejected: vi.fn(),
}));

vi.mock("@/env", () => ({
	env: {
		BETTER_AUTH_SECRET: "test-secret",
		S3_PUBLIC_BUCKET: "test-bucket",
		S3_PUBLIC_ACCESS_KEY_ID: "test-access-key",
		S3_PUBLIC_SECRET_ACCESS_KEY: "test-secret-key",
		S3_PUBLIC_ENDPOINT: "https://example.com",
		S3_PUBLIC_URL: "https://example.com",
		S3_PUBLIC_REGION: "us-east-1",
		S3_PUBLIC_FORCE_PATH_STYLE: "true",
		NODE_ENV: "test",
	},
}));

vi.mock("@/lib/notifications/triggers", () => ({
	onTimeCorrectionApproved,
	onTimeCorrectionRejected,
}));

vi.mock("@/lib/work-balance/service", () => ({
	markEmployeeWorkBalanceDirty,
}));

import { db as globalDb } from "@/db";
import { createTimeCorrectionApprovalAdapter } from "@/lib/approvals/domain-adapters/time-correction.adapter";
import type { TimeCorrectionWorkflowPayload } from "@/lib/approvals/domain-adapters/time-correction-contract";
import { normalizeTimeCorrectionOriginalWorkMetadata } from "@/lib/approvals/domain-adapters/time-correction-contract";
import { captureTimeCorrectionLegacyApprovalState } from "@/lib/approvals/domain-adapters/time-correction-legacy-state";
import { ApprovalAuditLogger } from "@/lib/approvals/infrastructure/audit-logger";
import { resolvePolicyAndCreateApproval } from "@/lib/approvals/policies/chain-service";
import { processApprovalWithCurrentEmployee } from "@/lib/approvals/server/shared";
import {
	approveTimeCorrectionWithCurrentApproverEffect,
	bindTimeCorrectionWorkflowToWorkPeriod,
	buildTimeCorrectionApprovalPolicyContext,
	calculateCorrectedDurationMinutes,
	completeTimeCorrectionDecisionAfterCommit,
	createTimeCorrectionApprovalWorkflow,
	decideTimeCorrectionWithStableTargetEffect,
	deleteCancelledTimeCorrectionsInTransaction,
	executeTimeCorrectionDecisionInTransaction,
	executeTimeCorrectionSubmissionInTransaction,
	type FinalizeTimeCorrectionTerminalInput,
	finalizeTimeCorrectionTerminalInTransaction,
	rejectTimeCorrectionWithCurrentApproverEffect,
	resolveTimeCorrectionCompatibilityApprovalId,
	translateTimeCorrectionDecisionError,
	verifyTimeCorrectionWorkflowBinding,
} from "@/lib/approvals/server/time-correction-approvals";
import type {
	ApprovalDbService,
	CurrentApprover,
	PendingApprovalRequest,
} from "@/lib/approvals/server/types";
import { createApprovalCompatibilityWriter } from "@/lib/approvals/workflow/compatibility-writer";
import {
	deriveApprovalAssignmentId,
	deriveApprovalEventId,
} from "@/lib/approvals/workflow/identity";
import { createLegacyApprovalObservationPlanner } from "@/lib/approvals/workflow/legacy-observation-planner";
import type {
	ApprovalCommandResult,
	ApprovalMaterializedTransitionPlan,
	ApprovalWorkflowSnapshot,
	TransactionalWorkflowRepository,
} from "@/lib/approvals/workflow/ports";
import { encodeApprovalCommandResult } from "@/lib/approvals/workflow/repository";
import {
	createApprovalTransitionResultBuilder,
	createApprovalWorkflowAuthorization,
	createDatabaseApprovalCommandActorResolver,
	createRegistryApprovalSourceLoader,
} from "@/lib/approvals/workflow/runtime";
import {
	ApprovalTransitionEngineError,
	createApprovalTransitionEngine,
} from "@/lib/approvals/workflow/transition-engine";
import { parseInstant, systemClock } from "@/lib/datetime/temporal-core";
import {
	AuthorizationError,
	ConflictError,
	ValidationError,
} from "@/lib/effect/errors";

beforeEach(() => {
	markEmployeeWorkBalanceDirty.mockClear();
	onTimeCorrectionApproved.mockClear();
	onTimeCorrectionRejected.mockClear();
});

function requiredValue<T>(value: T | undefined): T {
	if (value === undefined) throw new Error("Expected fixture value");
	return value;
}

describe("time correction canonical decision error translation", () => {
	it.each([
		["forbidden", AuthorizationError],
		["version_conflict", ConflictError],
		["idempotency_mismatch", ConflictError],
		["malformed_command", ValidationError],
	] as const)("translates %s to a typed application error", (code, Expected) => {
		const translated = translateTimeCorrectionDecisionError(
			new ApprovalTransitionEngineError(code, { private: "do-not-leak" }),
		);

		expect(translated).toBeInstanceOf(Expected);
		expect(translated).not.toHaveProperty("details.private");
		if (translated instanceof ConflictError) {
			expect(translated).toMatchObject({
				conflictType: "approval_transition",
				details: { code },
			});
		}
	});

	it.each([
		"result_scope",
		"invariant",
		"activation_cycle",
	] as const)("preserves internal %s engine errors", (code) => {
		const error = new ApprovalTransitionEngineError(code);
		expect(translateTimeCorrectionDecisionError(error)).toBe(error);
	});

	it("preserves unknown internal errors", () => {
		const error = new Error("internal");
		expect(translateTimeCorrectionDecisionError(error)).toBe(error);
	});
});

function restoreRecord(
	target: Record<string, unknown>,
	snapshot: Record<string, unknown>,
) {
	for (const key of Object.keys(target)) {
		if (!Object.hasOwn(snapshot, key)) delete target[key];
	}
	Object.assign(target, snapshot);
}

type RollbackFailurePoint =
	| "legacy_mutation"
	| "chain_status"
	| "capture_after"
	| "observed_root"
	| "observed_event"
	| "projection"
	| "outbox"
	| "source_binding"
	| "canonical_root"
	| "canonical_event"
	| "receipt_claim"
	| "compatibility"
	| "finalizer";

describe("time correction transaction boundaries", () => {
	it("classifies a complete ordinary assignment before applying a workflow-type-specific loader", async () => {
		let canonicalWorkflowQueryParams: unknown[] = [];
		const transactionDb = {
			query: {
				employee: {
					findMany: vi.fn().mockResolvedValue([
						{
							id: "manager-1",
							organizationId: "org-1",
							userId: "user-manager",
							isActive: true,
							user: { id: "user-manager", name: "Manager" },
						},
					]),
				},
				member: {
					findMany: vi.fn().mockResolvedValue([
						{
							organizationId: "org-1",
							userId: "user-manager",
							status: "approved",
						},
					]),
				},
				approvalRequest: { findFirst: vi.fn().mockResolvedValue(null) },
				approvalStageAssignment: {
					findFirst: vi.fn().mockResolvedValue({
						id: "assignment-1",
						workflowId: "workflow-1",
						stageId: "stage-1",
					}),
				},
				approvalWorkflowStage: {
					findFirst: vi
						.fn()
						.mockResolvedValue({ id: "stage-1", workflowId: "workflow-1" }),
				},
				approvalWorkflow: {
					findFirst: vi.fn().mockImplementation((options: { where: SQL }) => {
						canonicalWorkflowQueryParams = new PgDialect().sqlToQuery(
							options.where,
						).params;
						return Promise.resolve({
							id: "workflow-1",
							organizationId: "org-1",
							workflowType: "manual_time_submission",
							sourceType: "time_entry",
							sourceId: "period-1",
							requesterEmployeeId: "employee-1",
							status: "pending",
							contextSnapshot: {
								timeRequest: { kind: "manual_time_submission" },
							},
						});
					}),
				},
				workPeriod: {
					findFirst: vi.fn().mockResolvedValue({
						id: "period-1",
						organizationId: "org-1",
						employeeId: "employee-1",
						pendingChanges: { isManualEntry: true },
						clockInId: "clock-in-1",
						clockOutId: "clock-out-1",
						approvalWorkflowId: "workflow-1",
					}),
				},
			},
		};
		const processOrdinary = vi.fn().mockResolvedValue({ committed: true });
		const context = { dbService: { db: transactionDb } } as never;
		const runtime = {
			repository: {
				withTransaction: vi.fn(async (operation) => operation(context)),
			},
			transitionEngine: { executeInTransaction: vi.fn() },
		};

		const result = await executeTimeCorrectionDecisionInTransaction({
			runtime: runtime as never,
			organizationId: "org-1",
			actorEmployeeId: "manager-1",
			actorUserId: "user-manager",
			approvalRequestId: "assignment-1",
			action: "approve",
			processLegacy: vi.fn(),
			processOrdinary,
		});

		expect(result.kind).toBe("manual_time_submission");
		expect(canonicalWorkflowQueryParams).not.toContain("time_correction");
		expect(processOrdinary).toHaveBeenCalledWith(
			expect.objectContaining({
				workPeriodId: "period-1",
				kind: "manual_time_submission",
			}),
		);
	});

	it("classifies and dispatches ordinary time approvals inside the repository transaction", async () => {
		const transactionDb = {
			query: {
				employee: {
					findMany: vi.fn().mockResolvedValue([
						{
							id: "manager-1",
							organizationId: "org-1",
							userId: "user-manager",
							isActive: true,
							user: { id: "user-manager", name: "Manager" },
						},
					]),
				},
				member: {
					findMany: vi.fn().mockResolvedValue([
						{
							organizationId: "org-1",
							userId: "user-manager",
							status: "approved",
						},
					]),
				},
				approvalRequest: {
					findFirst: vi.fn().mockResolvedValue({
						id: "request-1",
						organizationId: "org-1",
						entityType: "time_entry",
						entityId: "period-1",
						requestedBy: "employee-1",
						status: "pending",
						reason: null,
						metadata: { timeRequest: { kind: "manual_time_submission" } },
					}),
				},
				workPeriod: {
					findFirst: vi.fn().mockResolvedValue({
						id: "period-1",
						organizationId: "org-1",
						employeeId: "employee-1",
						pendingChanges: { isManualEntry: true },
						clockInId: "clock-in-1",
						clockOutId: "clock-out-1",
						approvalWorkflowId: null,
					}),
				},
			},
		};
		const acquire = vi.fn();
		const processOrdinary = vi.fn().mockResolvedValue({ committed: true });
		const context = {
			dbService: { db: transactionDb },
			writeGate: { acquire },
		} as never;
		const runtime = {
			repository: {
				withTransaction: vi.fn(async (operation) => await operation(context)),
			},
			transitionEngine: { executeInTransaction: vi.fn() },
		};

		const result = await executeTimeCorrectionDecisionInTransaction({
			runtime: runtime as never,
			organizationId: "org-1",
			actorEmployeeId: "manager-1",
			actorUserId: "user-manager",
			approvalRequestId: "request-1",
			action: "approve",
			processLegacy: vi.fn(),
			processOrdinary,
		});

		expect(result).toMatchObject({
			kind: "manual_time_submission",
			domainResult: { committed: true },
		});
		expect(processOrdinary).toHaveBeenCalledWith(
			expect.objectContaining({
				dbService: expect.objectContaining({ db: transactionDb }),
				workPeriodId: "period-1",
				kind: "manual_time_submission",
			}),
		);
		expect(acquire).not.toHaveBeenCalled();
		expect(onTimeCorrectionApproved).not.toHaveBeenCalled();
		expect(onTimeCorrectionRejected).not.toHaveBeenCalled();
		expect(markEmployeeWorkBalanceDirty).not.toHaveBeenCalled();
	});

	function canonicalSubmissionHarness(input: {
		mode: "canonical" | "complete";
		policies?: unknown[];
		reviewersByStage?: string[][];
		autoApprove?: boolean;
		tamperTerminalActivationMode?: string;
		transitionError?: Error;
	}) {
		const ids = {
			period: "21000000-0000-4000-8000-000000000801",
			requester: "31000000-0000-4000-8000-000000000801",
			manager: "31000000-0000-4000-8000-000000000802",
			second: "31000000-0000-4000-8000-000000000803",
			correction: "61000000-0000-4000-8000-000000000801",
			original: "61000000-0000-4000-8000-000000000802",
			canonical: "71000000-0000-4000-8000-000000000801",
		};
		const originalRow = {
			id: ids.original,
			organizationId: "org-1",
			employeeId: ids.requester,
			type: "clock_in",
			timestamp: new Date("2026-07-20T06:00:00.000Z"),
			utcOffsetMinutes: 120,
			timezone: "Europe/Berlin",
			timezoneSource: "browser",
			replacesEntryId: null,
			isSuperseded: false,
			supersededById: null,
		};
		const correctionRow = {
			...originalRow,
			id: ids.correction,
			type: "correction",
			timestamp: new Date("2026-07-20T05:30:00.000Z"),
			replacesEntryId: ids.original,
			isSuperseded: true,
		};
		const sourceRow = {
			id: ids.period,
			organizationId: "org-1",
			employeeId: ids.requester,
			clockInId: ids.original,
			clockOutId: null,
			canonicalRecordId: ids.canonical,
			approvalWorkflowId: null as string | null,
			startTime: originalRow.timestamp,
			endTime: null,
			durationMinutes: null,
			isActive: true,
			approvalStatus: "approved",
			pendingChanges: null,
			workLocationType: "office",
			workCategoryId: "71000000-0000-4000-8000-000000000802",
			deletedAt: null,
		};
		const canonicalRecord = {
			id: ids.canonical,
			organizationId: "org-1",
			employeeId: ids.requester,
			recordKind: "work",
			startAt: originalRow.timestamp,
			endAt: null,
			durationMinutes: null,
			approvalState: "approved",
		};
		const canonicalWork = {
			recordId: ids.canonical,
			organizationId: "org-1",
			recordKind: "work",
			workLocationType: "office",
			workCategoryId: "71000000-0000-4000-8000-000000000802",
		};
		const authority = {
			mode: input.mode,
			behavior: {
				serveFrom: "canonical" as const,
				writeLegacy: input.mode === "canonical",
				writeCanonical: true,
				decideCanonical: true,
				mirror:
					input.mode === "canonical"
						? ("canonical_to_legacy" as const)
						: ("none" as const),
			},
		};
		const snapshots = new Map<string, ApprovalWorkflowSnapshot>();
		const submissionWorkflows = new Map<string, string>();
		const compatibilityRows: Array<Record<string, unknown>> = [];
		const compatibilityChains: Array<Record<string, unknown>> = [];
		const compatibilityStages: Array<Record<string, unknown>> = [];
		const projections: unknown[] = [];
		const outbox: unknown[] = [];
		const legacyWrites: unknown[] = [];
		const canonicalEvents: unknown[] = [];
		const receipts = new Map<
			string,
			{
				actorFingerprint: string;
				commandFingerprint: string;
				result?: ApprovalCommandResult;
			}
		>();
		let sourceWorkflowId: string | null = null;
		let nextBindingWorkflowLoaded = false;
		let correctionRead = true;
		let submittedCorrection: TimeCorrectionWorkflowPayload["timeCorrection"] = {
			action: "edit",
			clockInCorrectionId: ids.correction,
		};
		let decisionReads = false;
		let decisionApprovalRequestId: string | null = null;
		let employeeRead = 0;
		let memberRead = 0;
		let terminalFinalizations = 0;
		let failAt: RollbackFailurePoint | null = null;
		let failureEvidence: Record<string, unknown> | null = null;
		const durableSnapshot = () =>
			JSON.parse(
				JSON.stringify({
					roots: [...snapshots.entries()],
					submissions: [...submissionWorkflows.entries()],
					events: canonicalEvents,
					receipts: [...receipts.entries()],
					compatibilityRows,
					compatibilityChains,
					compatibilityStages,
					projections,
					outbox,
					legacyWrites,
					sourceWorkflowId,
					sourceRow,
					originalRow,
					correctionRow,
					canonicalRecord,
					canonicalWork,
					terminalFinalizations,
					effects: {
						dirty: markEmployeeWorkBalanceDirty.mock.calls,
						approved: onTimeCorrectionApproved.mock.calls,
						rejected: onTimeCorrectionRejected.mock.calls,
					},
				}),
			);
		const fail = (
			point: RollbackFailurePoint,
			evidence: Record<string, unknown>,
		) => {
			if (failAt !== point) return;
			failureEvidence = { point, ...evidence, state: durableSnapshot() };
			throw new Error(`injected:${point}`);
		};
		const acquire = vi.fn().mockResolvedValue(authority);
		const repository = {
			findInitialWorkflow: vi.fn(async (candidate) => {
				const exactId = submissionWorkflows.get(candidate.submissionKey);
				if (exactId) {
					return {
						kind: "existing" as const,
						snapshot: requiredValue(snapshots.get(exactId)),
					};
				}
				const pending = [...snapshots.values()].find(
					(snapshot) =>
						snapshot.organizationId === candidate.organizationId &&
						snapshot.workflowType === candidate.workflowType &&
						snapshot.sourceType === candidate.sourceType &&
						snapshot.sourceId === candidate.sourceId &&
						snapshot.status === "pending",
				);
				return pending
					? { kind: "source_conflict" as const }
					: { kind: "none" as const };
			}),
			createInitialWorkflow: vi.fn(
				async ({ snapshot, events, submissionKey }) => {
					const exactId = submissionWorkflows.get(submissionKey);
					if (exactId) {
						return {
							kind: "existing" as const,
							snapshot: requiredValue(snapshots.get(exactId)),
						};
					}
					const pending = [...snapshots.values()].find(
						(candidate) =>
							candidate.sourceId === snapshot.sourceId &&
							candidate.workflowType === snapshot.workflowType &&
							candidate.status === "pending",
					);
					if (pending) return { kind: "source_conflict" as const };
					const persistedSnapshot = input.tamperTerminalActivationMode
						? {
								...snapshot,
								stages: snapshot.stages.map((stage) => ({
									...stage,
									activationMode: input.tamperTerminalActivationMode as never,
								})),
							}
						: snapshot;
					snapshots.set(snapshot.id, persistedSnapshot);
					submissionWorkflows.set(submissionKey, snapshot.id);
					fail("canonical_root", { rootCount: snapshots.size });
					canonicalEvents.push(...events);
					fail("canonical_event", { eventCount: canonicalEvents.length });
					return { kind: "created" as const, snapshot: persistedSnapshot };
				},
			),
			loadSnapshot: vi.fn(async ({ workflowId }) =>
				requiredValue(snapshots.get(workflowId)),
			),
			claimCommand: vi.fn(async (receipt) => {
				const existing = receipts.get(receipt.idempotencyKey);
				if (!existing) {
					receipts.set(receipt.idempotencyKey, {
						actorFingerprint: receipt.actorFingerprint,
						commandFingerprint: receipt.commandFingerprint,
					});
					fail("receipt_claim", { receiptCount: receipts.size });
					return { kind: "reserved" as const };
				}
				if (
					existing.actorFingerprint !== receipt.actorFingerprint ||
					existing.commandFingerprint !== receipt.commandFingerprint
				) {
					return { kind: "fingerprint_mismatch" as const };
				}
				if (!existing.result) throw new Error("Uncompleted command receipt");
				return { kind: "completed" as const, result: existing.result };
			}),
			allocateTransitionIdentities: vi.fn(async (allocation) =>
				allocation.identityAllocations.map((identity) => ({
					...identity,
					id:
						identity.entityKind === "assignment"
							? deriveApprovalAssignmentId({
									organizationId: allocation.organizationId,
									workflowId: allocation.workflowId,
									allocationKey: identity.allocationKey,
								})
							: deriveApprovalEventId({
									organizationId: allocation.organizationId,
									workflowId: allocation.workflowId,
									allocationKey: identity.allocationKey,
								}),
				})),
			),
			tryAdvanceVersion: vi.fn(async ({ workflowId, expectedVersion }) => {
				const snapshot = snapshots.get(workflowId);
				return snapshot?.version === expectedVersion
					? { kind: "advanced" as const, version: expectedVersion + 1 }
					: { kind: "conflict" as const, version: snapshot?.version ?? null };
			}),
			applyMaterializedTransition: vi.fn(
				async (plan: ApprovalMaterializedTransitionPlan) => {
					snapshots.set(plan.resultingSnapshot.id, plan.resultingSnapshot);
					fail("canonical_root", { rootCount: snapshots.size });
					canonicalEvents.push(...plan.events);
					fail("canonical_event", { eventCount: canonicalEvents.length });
				},
			),
			completeCommand: vi.fn(async (receipt) => {
				const existing = requiredValue(receipts.get(receipt.idempotencyKey));
				existing.result = receipt.result;
			}),
			applyObservedLegacyTransition: vi.fn(),
		} as unknown as TransactionalWorkflowRepository;
		const projectionWriter = {
			write: vi.fn(async (projection) => {
				projections.push(projection);
				fail("projection", { projectionCount: projections.length });
			}),
		};
		const outboxWriter = {
			write: vi.fn(async (item) => {
				outbox.push(item);
				fail("outbox", { outboxCount: outbox.length });
				return { kind: "inserted" as const, id: `outbox-${outbox.length}` };
			}),
		};
		const legacyPersistence = {
			resolveOrCreateStableIds: vi.fn(
				async ({ organizationId, workflowId, stageIds }) =>
					stageIds.map((stageId) => ({
						organizationId,
						workflowId,
						stageId,
						legacyApprovalRequestId: stageId,
					})),
			),
			writeLegacyRows: vi.fn(async ({ result, legacyIds }) => {
				legacyWrites.push(result);
				const persisted = snapshots.get(result.snapshot.id);
				if (persisted) {
					snapshots.set(result.snapshot.id, {
						...persisted,
						stages: persisted.stages.map((stage) => ({
							...stage,
							legacyApprovalRequestId:
								legacyIds.find((item) => item.stageId === stage.id)
									?.legacyApprovalRequestId ?? stage.legacyApprovalRequestId,
						})),
					});
				}
				compatibilityRows.splice(0);
				compatibilityChains.splice(0);
				compatibilityStages.splice(0);
				if (result.snapshot.stages.length > 1) {
					compatibilityChains.push({
						id: result.snapshot.id,
						status: result.snapshot.status,
					});
					compatibilityStages.push(
						...result.snapshot.stages.map((stage) => ({
							id: stage.id,
							status: stage.status,
						})),
					);
				}
				for (const stage of result.snapshot.stages) {
					const mapping = legacyIds.find((item) => item.stageId === stage.id);
					if (!mapping || stage.status !== "pending") continue;
					const representative = stage.assignments
						.filter((assignment) => assignment.status === "pending")
						.toSorted(
							(left, right) =>
								left.sequence - right.sequence ||
								left.id.localeCompare(right.id),
						)[0];
					if (!representative) continue;
					compatibilityRows.push({
						id: mapping.legacyApprovalRequestId,
						organizationId: result.snapshot.organizationId,
						approverId: representative.approverEmployeeId,
						status: "pending",
						metadata: {
							workflow: {
								id: result.snapshot.id,
								organizationId: result.snapshot.organizationId,
							},
							stage: {
								id: stage.id,
								sequence: stage.sequence,
								assignmentId: representative.id,
							},
							timeCorrection: result.snapshot.contextSnapshot.timeCorrection,
							...(result.snapshot.contextSnapshot
								.timeCorrectionOriginalWorkMetadata
								? {
										timeCorrectionOriginalWorkMetadata:
											result.snapshot.contextSnapshot
												.timeCorrectionOriginalWorkMetadata,
									}
								: {}),
							submission: result.snapshot.contextSnapshot.submission,
						},
					});
				}
				fail("compatibility", {
					compatibilityCount: compatibilityRows.length,
					compatibilityChainCount: compatibilityChains.length,
					compatibilityStageCount: compatibilityStages.length,
					legacyWriteCount: legacyWrites.length,
				});
			}),
		};
		const compatibilityWriter = createApprovalCompatibilityWriter({
			writeGate: { acquire },
			repository,
			projectionWriter,
			outboxWriter,
			legacyPersistence,
		});
		const bindingRow = (snapshot: ApprovalWorkflowSnapshot) => ({
			...snapshot,
			submittedAt: new Date(snapshot.submittedAt.toString()),
			completedAt: snapshot.completedAt
				? new Date(snapshot.completedAt.toString())
				: null,
			cancelledAt: snapshot.cancelledAt
				? new Date(snapshot.cancelledAt.toString())
				: null,
		});
		const submissionLockTables: unknown[] = [];
		const db = {
			execute: vi.fn(async (query: SQL) => {
				const rendered = new PgDialect().sqlToQuery(query).sql;
				if (rendered.includes("from employee")) {
					return {
						rows: [
							{
								id: ids.manager,
								organization_id: "org-1",
								user_id: "user-manager",
							},
						],
					};
				}
				if (rendered.includes("from member")) {
					return {
						rows: [
							{
								organization_id: "org-1",
								user_id: "user-manager",
								status: "approved",
							},
						],
					};
				}
				return { rows: [{ policies: input.policies ?? [] }] };
			}),
			query: {
				approvalRequest: {
					findMany: vi.fn(async () => [...compatibilityRows]),
					findFirst: vi.fn(async () =>
						compatibilityRows.find(
							(row) => row.id === decisionApprovalRequestId,
						),
					),
				},
				approvalStageAssignment: {
					findFirst: vi.fn(async () => {
						const snapshot = sourceWorkflowId
							? snapshots.get(sourceWorkflowId)
							: undefined;
						const target = snapshot?.stages
							.flatMap((stage) => stage.assignments)
							.find(
								(assignment) => assignment.id === decisionApprovalRequestId,
							);
						return target
							? {
									id: target.id,
									workflowId: sourceWorkflowId,
									stageId: target.stageId,
								}
							: null;
					}),
				},
				approvalWorkflowStage: {
					findFirst: vi.fn(async () => {
						const snapshot = sourceWorkflowId
							? snapshots.get(sourceWorkflowId)
							: undefined;
						const target = snapshot?.stages
							.flatMap((stage) => stage.assignments)
							.find(
								(assignment) => assignment.id === decisionApprovalRequestId,
							);
						return sourceWorkflowId && target
							? { id: target.stageId, workflowId: sourceWorkflowId }
							: null;
					}),
				},
				approvalWorkflow: {
					findFirst: vi.fn(async () => {
						const allSnapshots = [...snapshots.values()];
						const pending = allSnapshots.find(
							(snapshot) => snapshot.status === "pending",
						);
						if (pending && pending.id !== sourceWorkflowId) {
							if (!nextBindingWorkflowLoaded) {
								nextBindingWorkflowLoaded = true;
								return bindingRow(pending);
							}
							nextBindingWorkflowLoaded = false;
						}
						const linked = sourceWorkflowId
							? snapshots.get(sourceWorkflowId)
							: allSnapshots.at(-1);
						return linked ? bindingRow(linked) : null;
					}),
				},
				workPeriod: {
					findFirst: vi.fn(async () => ({
						...sourceRow,
						approvalWorkflowId: sourceWorkflowId,
						employee: {
							userId: "user-requester",
							organizationId: "org-1",
							user: { name: "Requester", email: "requester@example.com" },
						},
					})),
				},
				timeEntry: {
					findMany: vi.fn(async () => {
						if (decisionReads) return [correctionRow, originalRow];
						const rows = correctionRead ? [correctionRow] : [originalRow];
						correctionRead = !correctionRead;
						return rows;
					}),
				},
				employee: {
					findFirst: vi.fn().mockResolvedValue({
						id: ids.requester,
						organizationId: "org-1",
						userId: "user-requester",
						isActive: true,
						user: {
							id: "user-requester",
							name: "Requester",
							email: "requester@example.com",
						},
					}),
					findMany: vi.fn(async () => {
						if (decisionReads && employeeRead++ === 0) {
							return [
								{
									id: ids.manager,
									organizationId: "org-1",
									userId: "user-manager",
									isActive: true,
									user: { id: "user-manager" },
								},
							];
						}
						return [
							{
								id: ids.requester,
								organizationId: "org-1",
								userId: "user-requester",
								isActive: true,
								user: { id: "user-requester" },
							},
							...(decisionReads
								? [
										{
											id: ids.manager,
											organizationId: "org-1",
											userId: "user-manager",
											isActive: true,
											user: { id: "user-manager" },
										},
									]
								: []),
						];
					}),
				},
				member: {
					findMany: vi.fn(async () => {
						const manager = memberRead++ === 0;
						return [
							{
								organizationId: "org-1",
								userId: manager ? "user-manager" : "user-requester",
								status: "approved",
							},
						];
					}),
				},
				teamMembership: { findMany: vi.fn().mockResolvedValue([]) },
				employeeGroupMember: { findMany: vi.fn().mockResolvedValue([]) },
				timeRecord: { findFirst: vi.fn(async () => canonicalRecord) },
			},
			select: vi.fn(() => ({
				from: vi.fn((table: unknown) => ({
					where: vi.fn(() => {
						const finish = vi.fn(async () => {
							submissionLockTables.push(table);
							if (table === employee) {
								return [
									{
										id: ids.requester,
										organizationId: "org-1",
										userId: "user-requester",
										isActive: true,
									},
									...(decisionReads
										? [
												{
													id: ids.manager,
													organizationId: "org-1",
													userId: "user-manager",
													isActive: true,
												},
											]
										: []),
								].sort((left, right) => left.id.localeCompare(right.id));
							}
							if (table === workPeriod)
								return [{ ...sourceRow, approvalWorkflowId: sourceWorkflowId }];
							if (table === timeRecord) return [canonicalRecord];
							if (table === timeRecordWork) return [canonicalWork];
							return [
								...(submittedCorrection.clockInCorrectionId
									? [correctionRow]
									: []),
								originalRow,
							].sort((left, right) => left.id.localeCompare(right.id));
						});
						return {
							for: finish,
							orderBy: vi.fn(() => ({ for: finish })),
						};
					}),
				})),
			})),
			update: vi.fn((table: unknown) => ({
				set: vi.fn((values: Record<string, unknown>) => ({
					where: vi.fn(() => ({
						returning: vi.fn(async () => {
							if (table === timeEntry) {
								const target =
									values.isSuperseded === false ? correctionRow : originalRow;
								Object.assign(target, values);
								return [{ id: target.id }];
							}
							if (table === timeRecord) {
								Object.assign(canonicalRecord, values);
								return [{ id: ids.canonical }];
							}
							if (table === timeRecordWork) {
								Object.assign(canonicalWork, values);
								return [{ recordId: ids.canonical }];
							}
							if (table === workPeriod && "updatedAt" in values) {
								terminalFinalizations += 1;
								Object.assign(sourceRow, values);
								fail("finalizer", {
									terminalFinalizations,
									workPeriodClockInId: sourceRow.clockInId,
									originalSuperseded: originalRow.isSuperseded,
									correctionSuperseded: correctionRow.isSuperseded,
								});
								return [{ id: ids.period }];
							}
							sourceWorkflowId = String(values.approvalWorkflowId);
							sourceRow.approvalWorkflowId = sourceWorkflowId;
							nextBindingWorkflowLoaded = false;
							fail("source_binding", { sourceWorkflowId });
							return [
								{
									id: ids.period,
									organizationId: "org-1",
									employeeId: ids.requester,
									approvalWorkflowId: sourceWorkflowId,
								},
							];
						}),
					})),
				})),
			})),
		};
		const resolve = vi.fn(async ({ organizationId, workflow, stage }) => {
			if (input.autoApprove) {
				return {
					organizationId,
					workflowId: workflow.id,
					stageId: stage.id,
					activationMode: "requester_auto_approve",
					assignments: [],
				};
			}
			const reviewers = input.reviewersByStage?.[stage.sequence - 1] ?? [
				ids.manager,
			];
			return {
				organizationId,
				workflowId: workflow.id,
				stageId: stage.id,
				activationMode: "human",
				assignments: reviewers.map((approverEmployeeId) => ({
					approverEmployeeId,
					metadata: {},
				})),
			};
		});
		const adapter = createTimeCorrectionApprovalAdapter({
			clock: systemClock,
			finalizeTimeCorrectionTerminal:
				finalizeTimeCorrectionTerminalInTransaction,
			deleteCancelledCorrections: async () => {
				throw new Error("Cancellation is outside this decision fixture");
			},
		});
		const adapterRegistry = {
			get: () => adapter,
			authorizeApprovedCancellation: async () => {
				throw new Error(
					"Approved cancellation is outside this decision fixture",
				);
			},
		};
		const context = {
			dbService: { db },
			writeGate: { acquire },
			repository,
			adapterRegistry,
			activationResolver: { resolve },
			projectionWriter,
			outboxWriter,
			compatibilityWriter,
		} as never;
		const workflowRepository = {
			withTransaction: async <T>(
				operation: (transactionContext: typeof context) => Promise<T>,
			) => {
				const priorSnapshots = [...snapshots.entries()];
				const priorSubmissions = [...submissionWorkflows.entries()];
				const priorEventCount = canonicalEvents.length;
				const priorReceipts = [...receipts.entries()].map(
					([key, value]) => [key, { ...value }] as const,
				);
				const priorCompatibility = structuredClone(compatibilityRows);
				const priorCompatibilityChains = structuredClone(compatibilityChains);
				const priorCompatibilityStages = structuredClone(compatibilityStages);
				const priorSource = structuredClone(sourceRow);
				const priorSourceWorkflowId = sourceWorkflowId;
				const priorNextBindingWorkflowLoaded = nextBindingWorkflowLoaded;
				const priorOriginal = structuredClone(originalRow);
				const priorCorrection = structuredClone(correctionRow);
				const priorCanonical = structuredClone(canonicalRecord);
				const priorCanonicalWork = structuredClone(canonicalWork);
				const priorProjectionCount = projections.length;
				const priorOutboxCount = outbox.length;
				const priorLegacyCount = legacyWrites.length;
				const priorFinalizations = terminalFinalizations;
				try {
					return await operation(context);
				} catch (error) {
					snapshots.clear();
					for (const [key, value] of priorSnapshots) snapshots.set(key, value);
					submissionWorkflows.clear();
					for (const [key, value] of priorSubmissions) {
						submissionWorkflows.set(key, value);
					}
					canonicalEvents.splice(priorEventCount);
					receipts.clear();
					for (const [key, value] of priorReceipts) receipts.set(key, value);
					compatibilityRows.splice(
						0,
						compatibilityRows.length,
						...priorCompatibility,
					);
					compatibilityChains.splice(
						0,
						compatibilityChains.length,
						...priorCompatibilityChains,
					);
					compatibilityStages.splice(
						0,
						compatibilityStages.length,
						...priorCompatibilityStages,
					);
					restoreRecord(sourceRow, priorSource);
					sourceWorkflowId = priorSourceWorkflowId;
					nextBindingWorkflowLoaded = priorNextBindingWorkflowLoaded;
					restoreRecord(originalRow, priorOriginal);
					restoreRecord(correctionRow, priorCorrection);
					restoreRecord(canonicalRecord, priorCanonical);
					restoreRecord(canonicalWork, priorCanonicalWork);
					projections.splice(priorProjectionCount);
					outbox.splice(priorOutboxCount);
					legacyWrites.splice(priorLegacyCount);
					terminalFinalizations = priorFinalizations;
					throw error;
				}
			},
		};
		const transitionEngine = createApprovalTransitionEngine({
			repository: workflowRepository,
			actorResolver: createDatabaseApprovalCommandActorResolver(),
			authorization: createApprovalWorkflowAuthorization({
				canManageApproval: async () => false,
			}),
			sourceLoader: createRegistryApprovalSourceLoader(adapterRegistry),
			resultBuilder: createApprovalTransitionResultBuilder(),
			clock: systemClock,
		});
		const runtime = {
			repository: workflowRepository,
			transitionEngine: input.transitionError
				? {
						executeInTransaction: async () => {
							throw input.transitionError;
						},
					}
				: transitionEngine,
		};
		const execute = (
			overrides: {
				submissionKey?: string;
				submissionId?: string;
				defaultApproverId?: string | null;
				correction?: TimeCorrectionWorkflowPayload["timeCorrection"];
			} = {},
		) => {
			decisionReads = false;
			submittedCorrection = overrides.correction ?? {
				action: "edit",
				clockInCorrectionId: ids.correction,
			};
			return executeTimeCorrectionSubmissionInTransaction({
				dbService: { db } as never,
				context,
				organizationId: "org-1",
				requesterEmployeeId: ids.requester,
				teamId: null,
				workPeriodId: ids.period,
				defaultApproverId:
					overrides.defaultApproverId === undefined
						? ids.manager
						: overrides.defaultApproverId,
				reason: "Missed punch",
				overtimeRisk: null,
				submissionKey: overrides.submissionKey ?? "canonical-submission-1",
				...(overrides.submissionId
					? { submissionId: overrides.submissionId }
					: {}),
				correction: submittedCorrection,
			});
		};

		return {
			ids,
			acquire,
			submissionLockTables,
			execute,
			repository,
			snapshots,
			compatibilityRows,
			compatibilityChains,
			compatibilityStages,
			legacyWrites,
			canonicalEvents,
			sourceRow,
			canonicalWork,
			durableSnapshot,
			failureEvidence: () => failureEvidence,
			injectFailure(point: RollbackFailurePoint | null) {
				failAt = point;
				failureEvidence = null;
			},
			async decide(
				approvalRequestId: string,
				action: "approve" | "reject" = "approve",
				reason?: string,
			) {
				decisionReads = true;
				decisionApprovalRequestId = approvalRequestId;
				employeeRead = 0;
				memberRead = 0;
				return executeTimeCorrectionDecisionInTransaction({
					runtime,
					organizationId: "org-1",
					actorEmployeeId: ids.manager,
					actorUserId: "user-manager",
					approvalRequestId,
					action,
					reason,
					processLegacy: async () => {
						throw new Error("Legacy processing is outside canonical authority");
					},
				});
			},
			terminalFinalizations: () => terminalFinalizations,
			requesterIdentityLookup: db.query.employee.findFirst,
			projections,
			outbox,
			failProjection(error = new Error("injected:projection")) {
				projectionWriter.write.mockRejectedValueOnce(error);
			},
			async transaction<T>(operation: () => Promise<T>): Promise<T> {
				const priorSnapshots = [...snapshots.entries()];
				const priorSubmissions = [...submissionWorkflows.entries()];
				const priorEvents = [...canonicalEvents];
				const priorReceipts = [...receipts.entries()].map(
					([key, value]) => [key, { ...value }] as const,
				);
				const priorCompatibility = structuredClone(compatibilityRows);
				const priorCompatibilityChains = structuredClone(compatibilityChains);
				const priorCompatibilityStages = structuredClone(compatibilityStages);
				const priorSourceWorkflowId = sourceWorkflowId;
				const priorSource = structuredClone(sourceRow);
				const priorOriginal = structuredClone(originalRow);
				const priorCorrection = structuredClone(correctionRow);
				const priorCanonical = structuredClone(canonicalRecord);
				const priorCanonicalWork = structuredClone(canonicalWork);
				const priorFinalizations = terminalFinalizations;
				const priorProjectionCount = projections.length;
				const priorOutboxCount = outbox.length;
				const priorLegacyCount = legacyWrites.length;
				try {
					return await operation();
				} catch (error) {
					snapshots.clear();
					for (const [key, value] of priorSnapshots) snapshots.set(key, value);
					submissionWorkflows.clear();
					for (const [key, value] of priorSubmissions) {
						submissionWorkflows.set(key, value);
					}
					canonicalEvents.splice(0, canonicalEvents.length, ...priorEvents);
					receipts.clear();
					for (const [key, value] of priorReceipts) receipts.set(key, value);
					compatibilityRows.splice(
						0,
						compatibilityRows.length,
						...priorCompatibility,
					);
					compatibilityChains.splice(
						0,
						compatibilityChains.length,
						...priorCompatibilityChains,
					);
					compatibilityStages.splice(
						0,
						compatibilityStages.length,
						...priorCompatibilityStages,
					);
					sourceWorkflowId = priorSourceWorkflowId;
					restoreRecord(sourceRow, priorSource);
					restoreRecord(originalRow, priorOriginal);
					restoreRecord(correctionRow, priorCorrection);
					restoreRecord(canonicalRecord, priorCanonical);
					restoreRecord(canonicalWork, priorCanonicalWork);
					terminalFinalizations = priorFinalizations;
					projections.splice(priorProjectionCount);
					outbox.splice(priorOutboxCount);
					legacyWrites.splice(priorLegacyCount);
					throw error;
				}
			},
			setSnapshot(snapshot: ApprovalWorkflowSnapshot) {
				snapshots.set(snapshot.id, snapshot);
			},
			setCompatibilityStage(
				snapshot: ApprovalWorkflowSnapshot,
				stageIndex: number,
			) {
				const stage = requiredValue(snapshot.stages[stageIndex]);
				compatibilityRows.splice(0, compatibilityRows.length, {
					id: stage.id,
					status: "pending",
					metadata: {
						workflow: { id: snapshot.id, organizationId: "org-1" },
						stage: {
							id: stage.id,
							sequence: stageIndex + 1,
						},
					},
				});
			},
		};
	}

	it("locks the requester then exact work period before submission lifecycle reads", async () => {
		const fixture = canonicalSubmissionHarness({ mode: "canonical" });

		await fixture.execute();

		expect(fixture.submissionLockTables.slice(0, 2)).toEqual([
			employee,
			workPeriod,
		]);
	});

	function canonicalPolicy(stageCount: number) {
		return {
			id: "81000000-0000-4000-8000-000000000801",
			organizationId: "org-1",
			name: "Correction policy",
			isActive: true,
			priority: 1,
			conditions: [
				{
					id: "82000000-0000-4000-8000-000000000801",
					organizationId: "org-1",
					policyId: "81000000-0000-4000-8000-000000000801",
					conditionType: "approval_type",
					operator: "equals",
					value: "time_entry",
				},
			],
			stages: Array.from({ length: stageCount }, (_, index) => ({
				id: `83000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
				organizationId: "org-1",
				policyId: "81000000-0000-4000-8000-000000000801",
				stepOrder: index + 1,
				label: `Stage ${index + 1}`,
				approverType: "specific_employee",
				approverEmployeeId: "31000000-0000-4000-8000-000000000802",
				fallbackBehavior: "fail",
			})),
		};
	}

	function observedSubmissionHarness(
		mode: "legacy" | "shadow" | "ready",
		autoApprove = false,
	) {
		const ids = {
			period: "21000000-0000-4000-8000-000000000901",
			requester: "31000000-0000-4000-8000-000000000901",
			manager: "31000000-0000-4000-8000-000000000902",
			request: "41000000-0000-4000-8000-000000000901",
			originalIn: "51000000-0000-4000-8000-000000000901",
			originalOut: "51000000-0000-4000-8000-000000000902",
			correction: "61000000-0000-4000-8000-000000000901",
			canonical: "71000000-0000-4000-8000-000000000901",
		};
		const now = new Date("2026-07-20T10:00:00.000Z");
		const originalIn = {
			id: ids.originalIn,
			organizationId: "org-1",
			employeeId: ids.requester,
			type: "clock_in",
			timestamp: new Date("2026-07-20T06:00:00.000Z"),
			utcOffsetMinutes: 120,
			timezone: "Europe/Berlin",
			timezoneSource: "browser",
			replacesEntryId: null,
			isSuperseded: false,
			supersededById: null,
			isDeleted: false,
		};
		const originalOut = {
			...originalIn,
			id: ids.originalOut,
			type: "clock_out",
			timestamp: new Date("2026-07-20T15:00:00.000Z"),
		};
		const correctionRow = {
			...originalIn,
			id: ids.correction,
			type: "correction",
			endpointType: "clock_in",
			timestamp: new Date("2026-07-20T05:30:00.000Z"),
			replacesEntryId: ids.originalIn,
			isSuperseded: true,
			notes: "private correction note",
		};
		const sourceRow = {
			id: ids.period,
			organizationId: "org-1",
			employeeId: ids.requester,
			clockInId: ids.originalIn,
			clockOutId: ids.originalOut,
			startTime: originalIn.timestamp,
			endTime: originalOut.timestamp,
			durationMinutes: 540,
			isActive: false,
			approvalStatus: "approved",
			pendingChanges: null,
			workLocationType: "office",
			workCategoryId: "71000000-0000-4000-8000-000000000902",
			deletedAt: null,
			canonicalRecordId: ids.canonical,
			approvalWorkflowId: null as string | null,
		};
		const canonicalRecord = {
			id: ids.canonical,
			organizationId: "org-1",
			employeeId: ids.requester,
			recordKind: "work",
			startAt: originalIn.timestamp,
			endAt: originalOut.timestamp,
			durationMinutes: 540,
			approvalState: "approved",
		};
		const canonicalWork = {
			recordId: ids.canonical,
			organizationId: "org-1",
			recordKind: "work",
			workLocationType: "office",
			workCategoryId: "71000000-0000-4000-8000-000000000902",
		};
		const requests: Array<Record<string, unknown>> = [];
		const chains: Array<Record<string, unknown>> = [];
		const chainRows: Array<Record<string, unknown>> = [];
		const workflows = new Map<string, ApprovalWorkflowSnapshot>();
		const observedEvents: unknown[] = [];
		const order: string[] = [];
		const projections: unknown[] = [];
		const outbox: unknown[] = [];
		let terminalFinalizations = 0;
		let decisionMode = false;
		let timeEntryFindManyRead = 0;
		let decisionEmployeeRead = 0;
		let decisionApprovalRequestId = ids.request;
		let chainQueryRead = 0;
		let decisionActorRows: Record<string, unknown>[] | null = null;
		let membershipRows: Record<string, unknown>[] = [
			{
				organizationId: "org-1",
				userId: "user-manager",
				status: "approved",
			},
		];
		let failAt: RollbackFailurePoint | null = null;
		let failureEvidence: Record<string, unknown> | null = null;
		let captureRead = 0;
		let bindingWorkflowRead = 0;
		const durableSnapshot = () =>
			JSON.parse(
				JSON.stringify({
					requests,
					chains,
					chainRows,
					roots: [...workflows.entries()],
					events: observedEvents,
					projections,
					outbox,
					sourceRow,
					originalIn,
					originalOut,
					correctionRow,
					canonicalRecord,
					canonicalWork,
					terminalFinalizations,
					effects: {
						dirty: markEmployeeWorkBalanceDirty.mock.calls,
						approved: onTimeCorrectionApproved.mock.calls,
						rejected: onTimeCorrectionRejected.mock.calls,
					},
				}),
			);
		const fail = (
			point: RollbackFailurePoint,
			evidence: Record<string, unknown>,
		) => {
			if (failAt !== point) return;
			failureEvidence = { point, ...evidence, state: durableSnapshot() };
			throw new Error(`injected:${point}`);
		};
		const authority = {
			mode,
			behavior: {
				serveFrom: "legacy" as const,
				writeLegacy: true,
				writeCanonical: mode !== "legacy",
				decideCanonical: false,
				mirror:
					mode === "legacy"
						? ("none" as const)
						: ("legacy_to_canonical" as const),
			},
		};
		const acquire = vi.fn().mockResolvedValue(authority);
		const captureEnvelope = () => {
			captureRead += 1;
			const request =
				(decisionMode ? requests.at(-1) : undefined) ??
				requests.find((candidate) => candidate.status === "pending") ??
				(autoApprove ? (requests.at(-1) ?? null) : null);
			const applied = sourceRow.clockInId === ids.correction;
			const currentClockIn = applied ? correctionRow : originalIn;
			const pending = request?.status === "pending";
			const approverId =
				typeof request?.approverId === "string" ? request.approverId : null;
			const requestCorrection = (
				request?.metadata as
					| { timeCorrection?: Record<string, unknown> }
					| undefined
			)?.timeCorrection;
			const hasCorrectionEndpoint = Boolean(
				requestCorrection?.clockInCorrectionId ||
					requestCorrection?.clockOutCorrectionId,
			);
			const value = {
				source: sourceRow,
				canonicalRecord,
				canonicalWork,
				currentEndpoints: { clockIn: currentClockIn, clockOut: originalOut },
				currentEndpointPredecessors: applied ? [originalIn] : [],
				approvalRequests: request ? [request] : [],
				chains,
				chainRows,
				correctionEntries:
					request && hasCorrectionEndpoint ? [correctionRow] : [],
				originalEntries: request && hasCorrectionEndpoint ? [originalIn] : [],
				identityEvidence: {
					employees: [
						...new Set([ids.requester, ...(approverId ? [approverId] : [])]),
					].map((id) => ({ id, organizationId: "org-1" })),
				},
				selectionEvidence: {
					pendingRequestCount: pending ? 1 : 0,
					pendingChainCount: chains.some((item) => item.status === "pending")
						? 1
						: 0,
					eligiblePendingDirectRequestCount: pending ? 1 : 0,
					selectedRequestCount: request ? 1 : 0,
					selectedChainCount: 0,
					expectedRequestCount: request ? 1 : 0,
					expectedChainCount: chains.length > 0 ? 1 : 0,
				},
			};
			order.push(request ? "capture-after" : "capture-before");
			if (captureRead % 2 === 0) {
				fail("capture_after", {
					captureCount: captureRead,
					requestCount: requests.length,
					sourceClockInId: sourceRow.clockInId,
				});
			}
			return { rows: [value] };
		};
		const planner = createLegacyApprovalObservationPlanner({
			clock: { nowInstant: () => parseInstant(now.toISOString()) },
		});
		const repository = {
			loadSnapshot: vi.fn(async ({ workflowId }) =>
				requiredValue(workflows.get(workflowId)),
			),
			applyObservedLegacyTransition: vi.fn(async (transition) => {
				order.push("observe");
				const plan = await planner.plan(transition);
				workflows.set(plan.snapshot.id, plan.snapshot);
				fail("observed_root", { rootCount: workflows.size });
				observedEvents.push(...plan.events);
				fail("observed_event", { eventCount: observedEvents.length });
				return {
					...plan,
					eventPersistence: {
						kind: "aggregate_and_events_persisted" as const,
						eventIds: plan.events.map((event) => event.id),
					},
				};
			}),
		} as unknown as TransactionalWorkflowRepository;
		const projectionWriter = {
			write: vi.fn(async (projection) => {
				order.push("projection");
				projections.push(projection);
				fail("projection", { projectionCount: projections.length });
			}),
		};
		const outboxWriter = {
			write: vi.fn(async (item) => {
				order.push("outbox");
				outbox.push(item);
				fail("outbox", { outboxCount: outbox.length });
				return { kind: "inserted" as const, id: `outbox-${outbox.length}` };
			}),
		};
		const compatibilityWriter = createApprovalCompatibilityWriter({
			writeGate: { acquire },
			repository,
			projectionWriter,
			outboxWriter,
			legacyPersistence: {
				resolveOrCreateStableIds: vi.fn(),
				writeLegacyRows: vi.fn(),
			},
		});
		const db = {
			execute: vi.fn(async () => captureEnvelope()),
			query: {
				approvalRequest: {
					findMany: vi.fn(async () => requests),
					findFirst: vi.fn(async () =>
						decisionMode
							? requests.find(
									(request) => request.id === decisionApprovalRequestId,
								)
							: autoApprove
								? requests.at(-1)
								: requests.find((request) => request.status === "pending"),
					),
				},
				approvalPolicy: { findMany: vi.fn().mockResolvedValue([]) },
				employeeGroupMember: { findMany: vi.fn().mockResolvedValue([]) },
				employeeGroup: { findMany: vi.fn().mockResolvedValue([]) },
				employee: {
					findMany: vi.fn(async () => {
						const requester = {
							id: ids.requester,
							userId: "user-requester",
							organizationId: "org-1",
							isActive: true,
							role: "employee",
						};
						const manager = {
							id: ids.manager,
							userId: "user-manager",
							organizationId: "org-1",
							isActive: true,
							role: "manager",
							user: { id: "user-manager" },
						};
						if (decisionMode && decisionEmployeeRead++ === 0) {
							return decisionActorRows ?? [manager];
						}
						return [requester, manager];
					}),
					findFirst: vi.fn().mockResolvedValue({
						id: ids.requester,
						userId: "user-requester",
						organizationId: "org-1",
						isActive: true,
						user: {
							id: "user-requester",
							name: "Requester",
							email: "requester@example.com",
						},
					}),
				},
				member: {
					findMany: vi.fn(async () => membershipRows),
				},
				employeeManagers: {
					findMany: vi.fn().mockResolvedValue([
						{
							employeeId: ids.requester,
							managerId: ids.manager,
							isPrimary: true,
						},
					]),
				},
				teamMembership: { findMany: vi.fn().mockResolvedValue([]) },
				team: { findMany: vi.fn().mockResolvedValue([]) },
				approvalChainStageInstance: {
					findFirst: vi.fn(async () => {
						if (chainRows.length === 0) return null;
						const selected = chainRows.find(
							(row) => row.approvalRequestId === decisionApprovalRequestId,
						);
						chainQueryRead += 1;
						if (chainQueryRead <= 2) return selected ?? null;
						return (
							chainRows.find(
								(row) =>
									Number(row.stepOrder) > Number(selected?.stepOrder ?? 0) &&
									row.status !== "approved",
							) ?? null
						);
					}),
				},
				approvalChainInstance: {
					findFirst: vi.fn(async () => chains[0] ?? null),
				},
				approvalStageAssignment: { findFirst: vi.fn().mockResolvedValue(null) },
				approvalWorkflowStage: { findFirst: vi.fn().mockResolvedValue(null) },
				approvalWorkflow: {
					findFirst: vi.fn(async () => {
						const workflowRows = [...workflows.values()];
						const snapshot =
							!decisionMode &&
							workflowRows.length > 1 &&
							sourceRow.approvalWorkflowId
								? workflowRows[bindingWorkflowRead++ % 2 === 0 ? 1 : 0]
								: workflowRows[0];
						return snapshot
							? {
									...snapshot,
									submittedAt: new Date(snapshot.submittedAt.toString()),
									completedAt: snapshot.completedAt
										? new Date(snapshot.completedAt.toString())
										: null,
									cancelledAt: snapshot.cancelledAt
										? new Date(snapshot.cancelledAt.toString())
										: null,
								}
							: null;
					}),
				},
				timeEntry: {
					findMany: vi.fn(async () => {
						timeEntryFindManyRead += 1;
						return timeEntryFindManyRead === 1 ||
							(decisionMode && timeEntryFindManyRead === 2)
							? [correctionRow]
							: [originalIn];
					}),
				},
				timeRecord: { findFirst: vi.fn(async () => canonicalRecord) },
				workPeriod: { findFirst: vi.fn(async () => sourceRow) },
			},
			insert: vi.fn((table: unknown) => ({
				values: vi.fn((values: Record<string, unknown>) => ({
					returning: vi.fn(async () => {
						if (table === approvalRequest) {
							order.push("mutate");
							const approved = values.status === "approved";
							const requestId =
								requests.length === 0
									? ids.request
									: `${ids.request.slice(0, -1)}${requests.length + 1}`;
							requests.push({
								id: requestId,
								...values,
								metadata:
									typeof values.metadata === "string"
										? JSON.parse(values.metadata)
										: values.metadata,
								rejectionReason: null,
								approvedAt: approved ? now : null,
								updatedAt: now,
							});
							fail("legacy_mutation", { requestCount: requests.length });
							return [{ id: requestId }];
						}
						return [{ id: "audit-1" }];
					}),
				})),
			})),
			select: vi.fn(() => ({
				from: vi.fn((table: unknown) => ({
					where: vi.fn(() => {
						const finish = vi.fn(async () => {
							if (table === employee) {
								return [
									{
										id: ids.requester,
										organizationId: "org-1",
										userId: "user-requester",
										isActive: true,
									},
									...(decisionMode
										? [
												{
													id: ids.manager,
													organizationId: "org-1",
													userId: "user-manager",
													isActive: true,
												},
											]
										: []),
								].sort((left, right) => left.id.localeCompare(right.id));
							}
							if (table === workPeriod) return [sourceRow];
							if (table === timeRecord) return [canonicalRecord];
							if (table === timeRecordWork) return [canonicalWork];
							if (table === teamMembership || table === team) return [];
							if (table === workCategory)
								return [
									{
										id: "71000000-0000-4000-8000-000000000903",
										organizationId: "org-1",
										isActive: true,
									},
								];
							if (table === workCategorySetAssignment)
								return [
									{
										id: "71000000-0000-4000-8000-000000000904",
										organizationId: "org-1",
										assignmentType: "organization",
										employeeId: null,
										teamId: null,
										setId: "71000000-0000-4000-8000-000000000905",
										isActive: true,
										effectiveFrom: null,
										effectiveUntil: null,
									},
								];
							if (table === workCategorySet)
								return [
									{
										id: "71000000-0000-4000-8000-000000000905",
										organizationId: "org-1",
										isActive: true,
									},
								];
							if (table === workCategorySetCategory)
								return [{ id: "71000000-0000-4000-8000-000000000906" }];
							const requestCorrection = (
								requests.at(-1)?.metadata as
									| { timeCorrection?: Record<string, unknown> }
									| undefined
							)?.timeCorrection;
							return [
								...(requestCorrection?.clockInCorrectionId
									? [correctionRow]
									: []),
								originalIn,
								originalOut,
							].sort((left, right) => left.id.localeCompare(right.id));
						});
						return {
							for: finish,
							orderBy: vi.fn(() => ({ for: finish })),
						};
					}),
				})),
			})),
			update: vi.fn((table: unknown) => ({
				set: vi.fn((values: Record<string, unknown>) => ({
					where: vi.fn(() => ({
						returning: vi.fn(async () => {
							if (table === approvalRequest) {
								const request = requests.at(-1);
								if (request?.status !== "pending") return [];
								Object.assign(
									request,
									Object.fromEntries(
										Object.entries(values).filter(
											([, value]) => value !== undefined,
										),
									),
									{
										approvedAt: values.status === "approved" ? now : null,
										updatedAt: now,
									},
								);
								fail("legacy_mutation", {
									requestCount: requests.length,
									requestStatus: request.status,
								});
								return [{ id: request.id }];
							}
							if (table === timeEntry) {
								const target =
									values.isSuperseded === false ? correctionRow : originalIn;
								Object.assign(target, values);
								return [{ id: target.id }];
							}
							if (table === timeRecord) {
								Object.assign(canonicalRecord, values);
								return [{ id: ids.canonical }];
							}
							if (table === timeRecordWork) {
								Object.assign(canonicalWork, values);
								return [{ recordId: ids.canonical }];
							}
							if (table === approvalChainStageInstance) {
								const selected = values.approvalRequestId
									? chainRows.find((row) => row.status === "waiting")
									: chainRows.find(
											(row) =>
												row.approvalRequestId === decisionApprovalRequestId,
										);
								if (!selected) return [];
								Object.assign(selected, values, { updatedAt: now });
								fail("chain_status", {
									chainStageCount: chainRows.length,
									chainStageStatus: selected.status,
								});
								return [{ id: selected.id }];
							}
							if (table === approvalChainInstance) {
								const chain = chains[0];
								if (!chain) return [];
								Object.assign(chain, values, { updatedAt: now });
								fail("chain_status", {
									chainCount: chains.length,
									chainStatus: chain.status,
								});
								return [{ id: chain.id }];
							}
							if (table === workPeriod && "updatedAt" in values) {
								terminalFinalizations += 1;
								Object.assign(sourceRow, values);
								fail("finalizer", {
									terminalFinalizations,
									workPeriodClockInId: sourceRow.clockInId,
									originalSuperseded: originalIn.isSuperseded,
									correctionSuperseded: correctionRow.isSuperseded,
								});
								return [{ id: ids.period }];
							}
							order.push("bind");
							sourceRow.approvalWorkflowId = String(values.approvalWorkflowId);
							fail("source_binding", {
								sourceWorkflowId: sourceRow.approvalWorkflowId,
							});
							return [sourceRow];
						}),
					})),
				})),
			})),
			transaction: async <T>(
				operation: (transactionDb: unknown) => Promise<T>,
			) => operation(db),
		};
		const dbService = {
			db,
			query: <T>(_name: string, operation: () => Promise<T>) =>
				Effect.promise(operation),
		} as unknown as ApprovalDbService;
		const context = {
			dbService,
			writeGate: { acquire },
			repository,
			projectionWriter,
			outboxWriter,
			compatibilityWriter,
		} as never;
		async function runTransaction<T>(operation: () => Promise<T>): Promise<T> {
			const priorRequests = structuredClone(requests);
			const priorChains = structuredClone(chains);
			const priorChainRows = structuredClone(chainRows);
			const priorWorkflows = [...workflows.entries()];
			const priorEvents = [...observedEvents];
			const priorSource = structuredClone(sourceRow);
			const priorOriginalIn = structuredClone(originalIn);
			const priorOriginalOut = structuredClone(originalOut);
			const priorCorrection = structuredClone(correctionRow);
			const priorCanonical = structuredClone(canonicalRecord);
			const priorCanonicalWork = structuredClone(canonicalWork);
			const priorOrderCount = order.length;
			const priorProjectionCount = projections.length;
			const priorOutboxCount = outbox.length;
			const priorFinalizations = terminalFinalizations;
			try {
				return await operation();
			} catch (error) {
				requests.splice(0, requests.length, ...priorRequests);
				chains.splice(0, chains.length, ...priorChains);
				chainRows.splice(0, chainRows.length, ...priorChainRows);
				workflows.clear();
				for (const [key, value] of priorWorkflows) workflows.set(key, value);
				observedEvents.splice(0, observedEvents.length, ...priorEvents);
				restoreRecord(sourceRow, priorSource);
				restoreRecord(originalIn, priorOriginalIn);
				restoreRecord(originalOut, priorOriginalOut);
				restoreRecord(correctionRow, priorCorrection);
				restoreRecord(canonicalRecord, priorCanonical);
				restoreRecord(canonicalWork, priorCanonicalWork);
				order.splice(priorOrderCount);
				projections.splice(priorProjectionCount);
				outbox.splice(priorOutboxCount);
				terminalFinalizations = priorFinalizations;
				throw error;
			}
		}

		return {
			ids,
			order,
			requests,
			chains,
			chainRows,
			workflows,
			observedEvents,
			projections,
			outbox,
			acquire,
			durableSnapshot,
			failureEvidence: () => failureEvidence,
			injectFailure(point: RollbackFailurePoint | null) {
				failAt = point;
				failureEvidence = null;
			},
			terminalFinalizations: () => terminalFinalizations,
			failOutbox(error = new Error("injected:outbox")) {
				outboxWriter.write.mockRejectedValueOnce(error);
			},
			setDecisionActorRows(rows: Record<string, unknown>[]) {
				decisionActorRows = rows;
			},
			setMembershipRows(rows: Record<string, unknown>[]) {
				membershipRows = rows;
			},
			driftWorkMetadata(workLocationType: "office" | "home" | "remote") {
				sourceRow.workLocationType = workLocationType;
				canonicalWork.workLocationType = workLocationType;
			},
			configureSequentialChain() {
				const chainId = "91000000-0000-4000-8000-000000000901";
				chains.splice(0, chains.length, {
					id: chainId,
					organizationId: "org-1",
					policyId: "81000000-0000-4000-8000-000000000901",
					policyNameSnapshot: "Two-stage correction",
					entityType: "time_entry",
					entityId: ids.period,
					requesterEmployeeId: ids.requester,
					currentStageOrder: 1,
					status: "pending",
					createdAt: now,
					updatedAt: now,
					completedAt: null,
				});
				chainRows.splice(
					0,
					chainRows.length,
					...([1, 2] as const).map((stepOrder) => ({
						id: `92000000-0000-4000-8000-${String(stepOrder).padStart(12, "0")}`,
						organizationId: "org-1",
						chainInstanceId: chainId,
						policyStageId: `93000000-0000-4000-8000-${String(stepOrder).padStart(12, "0")}`,
						stepOrder,
						labelSnapshot: `Stage ${stepOrder}`,
						approverTypeSnapshot: "specific_employee",
						resolvedApproverEmployeeId: ids.manager,
						approvalRequestId: stepOrder === 1 ? ids.request : null,
						status: stepOrder === 1 ? "pending" : "waiting",
						decidedBy: null,
						decidedAt: null,
						createdAt: now,
						updatedAt: now,
					})),
				);
			},
			transaction: runTransaction,
			async decide(
				action: "approve" | "reject",
				reason?: string,
				approvalRequestId = ids.request,
			) {
				decisionMode = true;
				decisionEmployeeRead = 0;
				decisionApprovalRequestId = approvalRequestId;
				chainQueryRead = 0;
				captureRead = 0;
				const runtime = {
					repository: {
						withTransaction: async <T>(
							operation: (transactionContext: typeof context) => Promise<T>,
						) => runTransaction(() => operation(context)),
					},
					transitionEngine: {
						executeInTransaction: async () => {
							throw new Error("Canonical decision is outside legacy authority");
						},
					},
				};
				return executeTimeCorrectionDecisionInTransaction({
					runtime,
					organizationId: "org-1",
					actorEmployeeId: ids.manager,
					actorUserId: "user-manager",
					approvalRequestId,
					action,
					reason,
					processLegacy: async (transactionDbService, actor) =>
						runTimeCorrectionDecisionEffect(
							processApprovalWithCurrentEmployee(
								transactionDbService,
								actor,
								"time_entry",
								ids.period,
								action,
								reason,
								(service, _entityId, approver, approval) =>
									Effect.tryPromise({
										try: async () => {
											const correction = (
												approval.metadata as TimeCorrectionWorkflowPayload
											).timeCorrection;
											const originalWorkMetadata = Object.hasOwn(
												correction,
												"workLocationType",
											)
												? normalizeTimeCorrectionOriginalWorkMetadata(
														(approval.metadata as Record<string, unknown>)
															.timeCorrectionOriginalWorkMetadata,
													)
												: undefined;
											const finalized =
												await finalizeTimeCorrectionTerminalInTransaction({
													dbService: service,
													organizationId: "org-1",
													workPeriodId: ids.period,
													expectedApprovalWorkflowId: null,
													expectedApprovalWorkflowVersion: null,
													expectedRequesterEmployeeId: ids.requester,
													actorEmployeeId: approver.id,
													actorUserId: approver.userId,
													correction,
													expectedOriginalWorkMetadata: originalWorkMetadata,
													legacyApprovalRequestId: approval.id,
													transition:
														action === "approve"
															? { kind: "approve", reason: null }
															: {
																	kind: "reject",
																	reason: reason ?? "Rejected",
																},
													finalizedAt: parseInstant(now.toISOString()),
													allowMetadataLessLegacyFallback: false,
												});
											return {
												workBalanceDirtyMark: finalized.dirtyFromDate
													? { dirtyFromDate: finalized.dirtyFromDate }
													: undefined,
											};
										},
										catch: (error) => error as never,
									}),
								undefined,
								{ approvalRequestId, transactional: true },
								undefined,
								"existing",
							),
						),
					captureLegacyState: captureTimeCorrectionLegacyApprovalState,
					nowInstant: () => parseInstant(now.toISOString()),
				});
			},
			execute: (
				submissionKey = `${mode}-submission-1`,
				submissionId?: string,
				correction: TimeCorrectionWorkflowPayload["timeCorrection"] = {
					action: "edit",
					clockInCorrectionId: ids.correction,
				},
			) => {
				decisionMode = false;
				captureRead = 0;
				bindingWorkflowRead = 0;
				return executeTimeCorrectionSubmissionInTransaction({
					dbService,
					context,
					organizationId: "org-1",
					requesterEmployeeId: ids.requester,
					teamId: null,
					workPeriodId: ids.period,
					defaultApproverId: autoApprove ? ids.requester : ids.manager,
					reason: "Missed punch",
					overtimeRisk: null,
					submissionKey,
					...(submissionId ? { submissionId } : {}),
					correction,
					nowInstant: () => parseInstant(now.toISOString()),
					captureLegacyState: captureTimeCorrectionLegacyApprovalState,
				});
			},
		};
	}

	it.each(["canonical", "complete"] as const)(
		"starts a %s submission with strict routing and detached private context",
		async (mode) => {
			const ids = {
				period: "21000000-0000-4000-8000-000000000101",
				requester: "31000000-0000-4000-8000-000000000101",
				approver: "31000000-0000-4000-8000-000000000102",
				correction: "61000000-0000-4000-8000-000000000101",
			};
			const authority = {
				mode,
				behavior: {
					serveFrom: "canonical" as const,
					writeLegacy: mode === "canonical",
					writeCanonical: true,
					decideCanonical: true,
					mirror:
						mode === "canonical"
							? ("canonical_to_legacy" as const)
							: ("none" as const),
				},
			};
			let sourceWorkflowId: string | null = null;
			let persistedSnapshot: ApprovalWorkflowSnapshot | null = null;
			const execute = vi.fn().mockResolvedValue({ rows: [{ policies: [] }] });
			const findMany = vi.fn(async () => {
				if (mode !== "canonical" || !persistedSnapshot) return [];
				const stage = persistedSnapshot.stages[0];
				return [
					{
						id: "71000000-0000-4000-8000-000000000101",
						status: "pending",
						metadata: {
							workflow: { id: persistedSnapshot.id, organizationId: "org-1" },
							stage: { id: stage.id, sequence: stage.sequence },
						},
					},
				];
			});
			const db = {
				execute,
				query: {
					approvalRequest: { findMany },
					approvalWorkflow: {
						findFirst: vi.fn(async () =>
							persistedSnapshot
								? {
										...persistedSnapshot,
										submittedAt: new Date(
											persistedSnapshot.submittedAt.toString(),
										),
										completedAt: null,
										cancelledAt: null,
									}
								: null,
						),
					},
				},
				select: vi.fn(() => ({
					from: vi.fn((table: unknown) => ({
						where: vi.fn(() => ({
							for: vi.fn().mockImplementation(async () =>
								table === employee
									? [
											{
												id: ids.requester,
												organizationId: "org-1",
												userId: "user-requester",
												isActive: true,
											},
										]
									: [
											{
												id: ids.period,
												organizationId: "org-1",
												employeeId: ids.requester,
												approvalWorkflowId: sourceWorkflowId,
											},
										],
							),
						})),
					})),
				})),
			update: vi.fn(() => ({
				set: vi.fn((values: { approvalWorkflowId: string }) => ({
					where: vi.fn(() => ({
						returning: vi.fn(async () => {
							sourceWorkflowId = values.approvalWorkflowId;
							return [
								{
									id: ids.period,
									organizationId: "org-1",
									employeeId: ids.requester,
									approvalWorkflowId: sourceWorkflowId,
								},
							];
						}),
					})),
				})),
			})),
		};
			const acquire = vi.fn().mockResolvedValue(authority);
			const resolve = vi.fn(
				async ({ organizationId, workflow, stage, routingContext }) => {
					expect(Object.keys(routingContext).sort()).toEqual(
						[
							"absenceCategoryId",
							"employeeGroupIds",
							"locationId",
							"organizationId",
							"overtimeRisk",
							"requesterEmployeeId",
							"source",
							"teamIds",
							"travelExpenseAmount",
							"workflowType",
						].sort(),
					);
					return {
						organizationId,
						workflowId: workflow.id,
						stageId: stage.id,
						activationMode: "human",
						assignments: [{ approverEmployeeId: ids.approver, metadata: {} }],
					};
				},
			);
			const mirrorCanonicalToLegacy = vi.fn().mockResolvedValue(undefined);
			const context = {
				dbService: { db },
				writeGate: { acquire },
				repository: {
					findInitialWorkflow: vi.fn().mockResolvedValue({ kind: "none" }),
					createInitialWorkflow: vi.fn(async ({ snapshot }) => {
						persistedSnapshot = snapshot;
						return { kind: "created", snapshot };
					}),
				},
				activationResolver: { resolve },
				projectionWriter: { write: vi.fn() },
				outboxWriter: {
					write: vi
						.fn()
						.mockResolvedValue({ kind: "inserted", id: "outbox-1" }),
				},
				compatibilityWriter: {
					withWriteGate() {
						return this;
					},
					mirrorCanonicalToLegacy,
				},
			} as never;

		const result = await executeTimeCorrectionSubmissionInTransaction({
			dbService: { db } as never,
			context,
			organizationId: "org-1",
			requesterEmployeeId: ids.requester,
			teamId: null,
			workPeriodId: ids.period,
			defaultApproverId: ids.approver,
			reason: "Missed punch",
			overtimeRisk: null,
			submissionKey: "correction-submit-1",
			correction: { action: "edit", clockInCorrectionId: ids.correction },
		});

		expect(result.kind).toBe("default_created");
		expect(persistedSnapshot?.contextSnapshot).toMatchObject({
			timeCorrection: {
				action: "edit",
				clockInCorrectionId: ids.correction,
			},
		});
		expect(JSON.stringify(persistedSnapshot?.displaySnapshot)).not.toContain(
			ids.correction,
		);
		expect(acquire).toHaveBeenCalledOnce();
		expect(mirrorCanonicalToLegacy).toHaveBeenCalledTimes(
			mode === "canonical" ? 1 : 0,
		);
	});

	it.each([
		"canonical",
		"complete",
	] as const)("persists a %s pending default route through start and compatibility ports", async (mode) => {
		const fixture = canonicalSubmissionHarness({ mode });

		const result = await fixture.execute();
		const snapshot = requiredValue([...fixture.snapshots.values()][0]);
		const firstStage = requiredValue(snapshot.stages[0]);

		expect(result).toMatchObject({
			kind: "default_created",
			approvalRequestId:
				mode === "canonical"
					? firstStage.id
					: requiredValue(firstStage.assignments[0]).id,
		});
		expect(fixture.acquire).toHaveBeenCalledOnce();
		expect(fixture.repository.createInitialWorkflow).toHaveBeenCalledOnce();
		expect(fixture.projections).toHaveLength(1);
		expect(fixture.outbox.length).toBeGreaterThan(0);
		expect(fixture.legacyWrites).toHaveLength(mode === "canonical" ? 1 : 0);
		expect(fixture.compatibilityRows).toHaveLength(
			mode === "canonical" ? 1 : 0,
		);
	});

	it.each(["canonical", "complete"] as const)(
		"persists and displays the exact current metadata payload in %s mode",
		async (mode) => {
			const fixture = canonicalSubmissionHarness({ mode });
			const correction = {
				action: "edit" as const,
				workLocationType: "home" as const,
				workCategoryId: null,
			};

			await fixture.execute({ correction });
			const snapshot = requiredValue([...fixture.snapshots.values()][0]);

			expect(snapshot.contextSnapshot.timeCorrection).toEqual(correction);
			expect(
				snapshot.contextSnapshot.timeCorrectionOriginalWorkMetadata,
			).toEqual({
				workLocationType: "office",
				workCategoryId: "71000000-0000-4000-8000-000000000802",
			});
			expect(snapshot.displaySnapshot).toMatchObject({
				displayPayload: {
					workMetadata: {
						original: {
							workLocationType: "office",
							workCategoryId: "71000000-0000-4000-8000-000000000802",
						},
						requested: {
							workLocationType: "home",
							workCategoryId: null,
						},
					},
				},
			});
			if (mode === "canonical") {
				expect(fixture.compatibilityRows[0]?.metadata).toMatchObject({
					timeCorrection: correction,
					timeCorrectionOriginalWorkMetadata: {
						workLocationType: "office",
						workCategoryId: "71000000-0000-4000-8000-000000000802",
					},
				});
			}
		},
	);

	it.each(["legacy", "shadow", "ready"] as const)(
		"persists exact private original work metadata in %s approval evidence",
		async (mode) => {
			const fixture = observedSubmissionHarness(mode);
			const correction = {
				action: "edit" as const,
				workLocationType: "home" as const,
				workCategoryId: null,
			};

			await fixture.execute(
				`${mode}-private-work-metadata`,
				undefined,
				correction,
			);

			expect(fixture.requests[0]?.metadata).toMatchObject({
				timeCorrection: correction,
				timeCorrectionOriginalWorkMetadata: {
					workLocationType: "office",
					workCategoryId: "71000000-0000-4000-8000-000000000902",
				},
			});
		},
	);

	it.each(["legacy", "shadow", "ready"] as const)(
		"rejects parity-preserving stale metadata after %s submission",
		async (mode) => {
			const fixture = observedSubmissionHarness(mode);
			await fixture.execute(`${mode}-stale-work-metadata`, undefined, {
				action: "edit",
				workLocationType: "home",
				workCategoryId: null,
			});
			fixture.driftWorkMetadata("remote");
			const stale = fixture.durableSnapshot();

			await expect(fixture.decide("approve")).rejects.toThrow(
				"Time correction source changed during finalization",
			);
			expect(fixture.durableSnapshot()).toEqual(stale);
		},
	);

	it("replays unchanged current metadata through legacy authority", async () => {
		const fixture = observedSubmissionHarness("legacy");
		const correction = {
			action: "edit" as const,
			workLocationType: "home" as const,
			workCategoryId: null,
		};
		const first = await fixture.execute(
			"legacy-current-metadata-replay",
			undefined,
			correction,
		);
		const durable = fixture.durableSnapshot();

		const replay = await fixture.execute(
			"legacy-current-metadata-replay",
			undefined,
			correction,
		);

		expect(first.disposition).toBe("executed");
		expect(replay.disposition).toBe("replayed");
		expect(fixture.durableSnapshot()).toEqual(durable);
	});

	it("rejects legacy replay when both work metadata rows drift together", async () => {
		const fixture = observedSubmissionHarness("legacy");
		const correction = {
			action: "edit" as const,
			workLocationType: "home" as const,
			workCategoryId: null,
		};
		await fixture.execute(
			"legacy-current-metadata-drift",
			undefined,
			correction,
		);
		fixture.driftWorkMetadata("remote");
		const drifted = fixture.durableSnapshot();

		await expect(
			fixture.execute(
				"legacy-current-metadata-drift",
				undefined,
				correction,
			),
		).rejects.toMatchObject({
			conflictType: "pending_time_correction_approval",
		});
		expect(fixture.durableSnapshot()).toEqual(drifted);
	});

	it.each(["canonical", "complete"] as const)(
		"rejects parity-preserving stale metadata after %s submission",
		async (mode) => {
			const fixture = canonicalSubmissionHarness({ mode });
			await fixture.execute({
				correction: {
					action: "edit",
					workLocationType: "home",
					workCategoryId: null,
				},
			});
			fixture.sourceRow.workLocationType = "remote";
			fixture.canonicalWork.workLocationType = "remote";
			const stale = fixture.durableSnapshot();
			const pending = requiredValue([...fixture.snapshots.values()][0]);
			const target = requiredValue(pending.stages[0]?.assignments[0]);

			await expect(fixture.decide(target.id)).rejects.toThrow();
			expect(fixture.durableSnapshot()).toEqual(stale);
		},
	);

	it.each(["canonical", "complete"] as const)(
		"auto-completes a zero-entry metadata-only edit once and rejects its stale %s replay",
		async (mode) => {
			const fixture = canonicalSubmissionHarness({ mode, autoApprove: true });
			const correction = {
				action: "edit" as const,
				workLocationType: "remote" as const,
				workCategoryId: null,
			};

			const first = await fixture.execute({ correction });
			const writesAfterFirst = fixture.durableSnapshot();
			await expect(fixture.execute({ correction })).rejects.toMatchObject({
				conflictType: "pending_time_correction_approval",
			});

			expect(first).toMatchObject({
				disposition: "executed",
				kind: "auto_completed",
			});
			expect(fixture.terminalFinalizations()).toBe(1);
			expect(fixture.sourceRow).toMatchObject({
				workLocationType: "remote",
				workCategoryId: null,
			});
			expect(fixture.canonicalWork).toMatchObject({
				workLocationType: "remote",
				workCategoryId: null,
			});
			expect(fixture.durableSnapshot()).toEqual(writesAfterFirst);
		},
	);

	it.each(["canonical", "complete"] as const)(
		"conflicts when %s replay metadata changes",
		async (mode) => {
			const fixture = canonicalSubmissionHarness({ mode });
			await fixture.execute({
				correction: {
					action: "edit",
					workLocationType: "home",
					workCategoryId: null,
				},
			});

			await expect(
				fixture.execute({
					correction: {
						action: "edit",
						workLocationType: "remote",
						workCategoryId: null,
					},
				}),
			).rejects.toMatchObject({
				conflictType: "pending_time_correction_approval",
			});
		},
	);

	it("replays unchanged current metadata through canonical authority", async () => {
		const fixture = canonicalSubmissionHarness({ mode: "canonical" });
		const correction = {
			action: "edit" as const,
			workLocationType: "home" as const,
			workCategoryId: null,
		};
		const first = await fixture.execute({ correction });
		const durable = fixture.durableSnapshot();

		const replay = await fixture.execute({ correction });

		expect(first.disposition).toBe("executed");
		expect(replay.disposition).toBe("replayed");
		expect(fixture.durableSnapshot()).toEqual(durable);
	});

	it("rejects canonical replay when both work metadata rows drift together", async () => {
		const fixture = canonicalSubmissionHarness({ mode: "canonical" });
		const correction = {
			action: "edit" as const,
			workLocationType: "home" as const,
			workCategoryId: null,
		};
		await fixture.execute({ correction });
		fixture.sourceRow.workLocationType = "remote";
		fixture.canonicalWork.workLocationType = "remote";
		const drifted = fixture.durableSnapshot();

		await expect(fixture.execute({ correction })).rejects.toMatchObject({
			conflictType: "pending_time_correction_approval",
		});
		expect(fixture.durableSnapshot()).toEqual(drifted);
	});

	it.each(["canonical", "complete"] as const)(
		"runs one actual requester auto-finalizer for %s submission",
		async (mode) => {
			const fixture = canonicalSubmissionHarness({ mode, autoApprove: true });

			const result = await fixture.execute();

			expect(result).toMatchObject({
				kind: "auto_completed",
				reason: "requester_is_approver",
				postCommit: { authority: "canonical", terminal: null },
			});
			expect(fixture.acquire).toHaveBeenCalledOnce();
			expect(fixture.snapshots).toHaveLength(1);
			expect(fixture.legacyWrites).toHaveLength(mode === "canonical" ? 1 : 0);
			expect(fixture.terminalFinalizations()).toBe(1);
		},
	);

	it("uses an actual two-stage policy without a default manager and returns the current stage target", async () => {
		const fixture = canonicalSubmissionHarness({
			mode: "canonical",
			policies: [canonicalPolicy(2)],
			reviewersByStage: [["31000000-0000-4000-8000-000000000802"]],
		});

		const result = await fixture.execute({ defaultApproverId: null });
		const snapshot = requiredValue([...fixture.snapshots.values()][0]);
		const firstStage = requiredValue(snapshot.stages[0]);

		expect(snapshot.stages).toHaveLength(2);
		expect(snapshot.stages.map((stage) => stage.status)).toEqual([
			"pending",
			"waiting",
		]);
		expect(result).toMatchObject({
			kind: "chain_created",
			chainInstanceId: snapshot.id,
			approvalRequestId: firstStage.id,
		});
		expect(fixture.acquire).toHaveBeenCalledOnce();
	});

	it("materializes parallel reviewers and returns the deterministic first assignment in complete mode", async () => {
		const fixture = canonicalSubmissionHarness({
			mode: "complete",
			reviewersByStage: [
				[
					"31000000-0000-4000-8000-000000000802",
					"31000000-0000-4000-8000-000000000803",
				],
			],
		});

		const result = await fixture.execute();
		const snapshot = requiredValue([...fixture.snapshots.values()][0]);
		const firstStage = requiredValue(snapshot.stages[0]);

		expect(firstStage.assignments).toHaveLength(2);
		expect(result.approvalRequestId).toBe(
			requiredValue(firstStage.assignments[0]).id,
		);
		expect(fixture.compatibilityRows).toEqual([]);
		expect(fixture.legacyWrites).toEqual([]);
	});

	it.each(["canonical", "complete"] as const)(
		"executes a terminal %s approval through the actual command stack",
		async (mode) => {
			const fixture = canonicalSubmissionHarness({ mode });
			await fixture.execute();
			const before = requiredValue([...fixture.snapshots.values()][0]);
			const assignment = requiredValue(before.stages[0]?.assignments[0]);

			const decision = await fixture.decide(assignment.id);
			const after = requiredValue(fixture.snapshots.get(before.id));

			expect(decision).toMatchObject({
				kind: "time_correction",
				commandResult: { snapshot: { id: before.id, status: "approved" } },
				postCommit: { authority: "canonical", terminal: null },
			});
			expect(after.status).toBe("approved");
			expect(after.version).toBe(before.version + 1);
			expect(fixture.terminalFinalizations()).toBe(1);
			expect(fixture.repository.claimCommand).toHaveBeenCalledOnce();
			expect(fixture.repository.completeCommand).toHaveBeenCalledOnce();
		},
	);

	it.each(["canonical", "complete"] as const)(
		"executes a terminal %s rejection through the actual command stack",
		async (mode) => {
			const fixture = canonicalSubmissionHarness({ mode });
			await fixture.execute();
			const before = requiredValue([...fixture.snapshots.values()][0]);
			const assignment = requiredValue(before.stages[0]?.assignments[0]);

			const decision = await fixture.decide(
				assignment.id,
				"reject",
				"Correction is not supported by the evidence",
			);
			const after = requiredValue(fixture.snapshots.get(before.id));

			expect(decision.commandResult).toMatchObject({
				snapshot: {
					id: before.id,
					status: "rejected",
					decisionReason: "Correction is not supported by the evidence",
				},
			});
			expect(after.stages[0]?.assignments[0]).toMatchObject({
				status: "rejected",
			});
			expect(fixture.repository.completeCommand).toHaveBeenCalledOnce();
		},
	);

	it.each([
		"canonical",
		"complete",
	] as const)("advances and then completes an actual two-stage %s decision", async (mode) => {
		const fixture = canonicalSubmissionHarness({
			mode,
			policies: [canonicalPolicy(2)],
			reviewersByStage: [
				["31000000-0000-4000-8000-000000000802"],
				["31000000-0000-4000-8000-000000000802"],
			],
		});
		await fixture.execute({ defaultApproverId: null });
		const initial = requiredValue([...fixture.snapshots.values()][0]);
		const firstTarget = requiredValue(initial.stages[0]?.assignments[0]);

		const intermediate = await fixture.decide(firstTarget.id);
		const advanced = requiredValue(fixture.snapshots.get(initial.id));
		const secondTarget = requiredValue(advanced.stages[1]?.assignments[0]);

		expect(intermediate.commandResult?.snapshot).toMatchObject({
			status: "pending",
			currentStageOrder: 2,
			stages: [{ status: "approved" }, { status: "pending" }],
		});
		expect(advanced.version).toBe(initial.version + 2);
		expect(fixture.terminalFinalizations()).toBe(0);

		const terminal = await fixture.decide(secondTarget.id);

		expect(terminal.commandResult?.snapshot).toMatchObject({
			status: "approved",
			currentStageOrder: null,
		});
		expect(fixture.terminalFinalizations()).toBe(1);
		expect(fixture.repository.completeCommand).toHaveBeenCalledTimes(2);
	});

	it("accepts the compatibility stage id as the stable canonical target", async () => {
		const fixture = canonicalSubmissionHarness({ mode: "canonical" });
		await fixture.execute();
		const before = requiredValue([...fixture.snapshots.values()][0]);
		const stage = requiredValue(before.stages[0]);
		const compatibilityTarget = requiredValue(
			stage.legacyApprovalRequestId ?? undefined,
		);

		const decision = await fixture.decide(compatibilityTarget);

		expect(decision.commandResult?.snapshot.status).toBe("approved");
		expect(fixture.repository.claimCommand).toHaveBeenCalledOnce();
	});

	it("resolves a parallel compatibility target to its persisted representative assignment", async () => {
		const fixture = canonicalSubmissionHarness({
			mode: "canonical",
			reviewersByStage: [
				[
					"31000000-0000-4000-8000-000000000802",
					"31000000-0000-4000-8000-000000000803",
				],
			],
		});
		await fixture.execute();
		const before = requiredValue([...fixture.snapshots.values()][0]);
		const stage = requiredValue(before.stages[0]);
		const representative = requiredValue(stage.assignments[0]);
		const compatibilityTarget = requiredValue(
			stage.legacyApprovalRequestId ?? undefined,
		);
		expect(fixture.compatibilityRows[0]).toMatchObject({
			approverId: representative.approverEmployeeId,
			metadata: { stage: { assignmentId: representative.id } },
		});

		const decision = await fixture.decide(compatibilityTarget);

		expect(decision.commandResult?.snapshot.status).toBe("approved");
		expect(fixture.repository.claimCommand).toHaveBeenCalledOnce();
	});

	it("fails closed when compatibility metadata names a foreign assignment", async () => {
		const fixture = canonicalSubmissionHarness({ mode: "canonical" });
		await fixture.execute();
		const row = requiredValue(fixture.compatibilityRows[0]);
		const metadata = row.metadata as Record<string, unknown>;
		metadata.stage = {
			...(metadata.stage as Record<string, unknown>),
			assignmentId: "31000000-0000-4000-8000-000000000999",
		};

		await expect(fixture.decide(String(row.id))).rejects.toMatchObject({
			conflictType: "approval_transition",
		});
		expect(fixture.repository.claimCommand).not.toHaveBeenCalled();
	});

	it.each([
		[
			"workflow",
			{ id: "71000000-0000-4000-8000-000000000999", organizationId: "org-1" },
		],
		[
			"workflow",
			{ id: "71000000-0000-4000-8000-000000000801", organizationId: "org-2" },
		],
		["stage", { id: "71000000-0000-4000-8000-000000000999", sequence: 1 }],
		["stage", { id: "71000000-0000-4000-8000-000000000801", sequence: 99 }],
	] as const)("fails closed on foreign compatibility %s metadata", async (key, value) => {
		const fixture = canonicalSubmissionHarness({ mode: "canonical" });
		await fixture.execute();
		const row = requiredValue(fixture.compatibilityRows[0]);
		const metadata = row.metadata as Record<string, unknown>;
		metadata[key] = value;

		await expect(fixture.decide(String(row.id))).rejects.toMatchObject({
			conflictType: "approval_transition",
		});
		expect(fixture.repository.claimCommand).not.toHaveBeenCalled();
	});

	it("rejects compatibility metadata accessors without reading them during resolution", async () => {
		const fixture = canonicalSubmissionHarness({ mode: "canonical" });
		await fixture.execute();
		const row = requiredValue(fixture.compatibilityRows[0]);
		const metadata = row.metadata as Record<string, unknown>;
		const getter = vi.fn(() => "unexpected");
		metadata.stage = Object.defineProperty({}, "id", {
			enumerable: true,
			get: getter,
		});

		await expect(fixture.decide(String(row.id))).rejects.toMatchObject({
			conflictType: "approval_transition",
		});
		// The rollback harness snapshots the injected row once before resolution.
		expect(getter).toHaveBeenCalledOnce();
		expect(fixture.repository.claimCommand).not.toHaveBeenCalled();
	});

	it("uses an exact active approver match for compatibility rows without assignment metadata", async () => {
		const fixture = canonicalSubmissionHarness({
			mode: "canonical",
			reviewersByStage: [
				[
					"31000000-0000-4000-8000-000000000802",
					"31000000-0000-4000-8000-000000000803",
				],
			],
		});
		await fixture.execute();
		const row = requiredValue(fixture.compatibilityRows[0]);
		const metadata = row.metadata as Record<string, unknown>;
		const stage = metadata.stage as Record<string, unknown>;
		delete stage.assignmentId;

		const decision = await fixture.decide(String(row.id));

		expect(decision.commandResult?.snapshot.status).toBe("approved");
	});

	it("fails closed when a compatibility row approver does not match an active assignment", async () => {
		const fixture = canonicalSubmissionHarness({ mode: "canonical" });
		await fixture.execute();
		const row = requiredValue(fixture.compatibilityRows[0]);
		row.approverId = "31000000-0000-4000-8000-000000000999";
		const metadata = row.metadata as Record<string, unknown>;
		const stage = metadata.stage as Record<string, unknown>;
		delete stage.assignmentId;

		await expect(fixture.decide(String(row.id))).rejects.toMatchObject({
			conflictType: "approval_transition",
		});
		expect(fixture.repository.claimCommand).not.toHaveBeenCalled();
	});

	it("fails closed when legacy fallback matches multiple active assignments", async () => {
		const fixture = canonicalSubmissionHarness({
			mode: "canonical",
			reviewersByStage: [
				[
					"31000000-0000-4000-8000-000000000802",
					"31000000-0000-4000-8000-000000000803",
				],
			],
		});
		await fixture.execute();
		const pending = requiredValue([...fixture.snapshots.values()][0]);
		const stage = requiredValue(pending.stages[0]);
		fixture.snapshots.set(pending.id, {
			...pending,
			stages: [
				{
					...stage,
					assignments: stage.assignments.map((assignment) => ({
						...assignment,
						approverEmployeeId: fixture.ids.manager,
					})),
				},
			],
		});
		const row = requiredValue(fixture.compatibilityRows[0]);
		const metadata = row.metadata as Record<string, unknown>;
		delete (metadata.stage as Record<string, unknown>).assignmentId;

		await expect(fixture.decide(String(row.id))).rejects.toMatchObject({
			conflictType: "approval_transition",
		});
		expect(fixture.repository.claimCommand).not.toHaveBeenCalled();
	});

	it.each([
		"canonical",
		"complete",
	] as const)("replays the exact %s decision receipt without durable side effects", async (mode) => {
		const fixture = canonicalSubmissionHarness({ mode });
		await fixture.execute();
		const before = requiredValue([...fixture.snapshots.values()][0]);
		const assignment = requiredValue(before.stages[0]?.assignments[0]);
		const first = await fixture.decide(assignment.id);
		const durable = {
			version: requiredValue(fixture.snapshots.get(before.id)).version,
			finalizations: fixture.terminalFinalizations(),
			projections: fixture.projections.length,
			outbox: fixture.outbox.length,
			legacy: fixture.legacyWrites.length,
		};

		const replay = await fixture.decide(assignment.id);

		expect(replay.commandResult).toEqual(first.commandResult);
		expect({
			version: requiredValue(fixture.snapshots.get(before.id)).version,
			finalizations: fixture.terminalFinalizations(),
			projections: fixture.projections.length,
			outbox: fixture.outbox.length,
			legacy: fixture.legacyWrites.length,
		}).toEqual(durable);
		expect(fixture.repository.claimCommand).toHaveBeenCalledTimes(2);
		expect(fixture.repository.completeCommand).toHaveBeenCalledOnce();
	});

	it.each(["canonical", "complete"] as const)(
		"replays a %s receipt through the trusted production wrapper without effects",
		async (mode) => {
			const fixture = canonicalSubmissionHarness({ mode });
			await fixture.execute();
			const pending = requiredValue([...fixture.snapshots.values()][0]);
			const assignment = requiredValue(pending.stages[0]?.assignments[0]);
			const executed = await fixture.decide(assignment.id);
			const result = requiredValue(executed.commandResult);
			const snapshot = result.snapshot;
			const stage = requiredValue(snapshot.stages[0]);
			const stableTarget =
				mode === "canonical"
					? requiredValue(stage.legacyApprovalRequestId ?? undefined)
					: assignment.id;
			let actorFingerprint = "";
			let commandFingerprint = "";
			const transactionCommitted = vi.fn();
			const rootRow = {
				id: snapshot.id,
				organization_id: snapshot.organizationId,
				workflow_type: snapshot.workflowType,
				source_type: snapshot.sourceType,
				source_id: snapshot.sourceId,
				requester_employee_id: snapshot.requesterEmployeeId,
				status: snapshot.status,
				current_stage_order: snapshot.currentStageOrder,
				version: snapshot.version,
				policy_snapshot: snapshot.policySnapshot,
				context_snapshot: snapshot.contextSnapshot,
				display_snapshot: snapshot.displaySnapshot,
				submitted_at: new Date(snapshot.submittedAt.toString()),
				completed_at: snapshot.completedAt
					? new Date(snapshot.completedAt.toString())
					: null,
				cancelled_at: snapshot.cancelledAt
					? new Date(snapshot.cancelledAt.toString())
					: null,
				decision_reason: snapshot.decisionReason,
			};
			const stageRows = snapshot.stages.map((item) => ({
				id: item.id,
				organization_id: item.organizationId,
				workflow_id: item.workflowId,
				stage_order: item.sequence,
				label: item.label,
				resolver_snapshot: item.resolverSnapshot,
				activation_mode: item.activationMode,
				status: item.status,
				activated_at: item.activatedAt
					? new Date(item.activatedAt.toString())
					: null,
				decided_at: item.decidedAt ? new Date(item.decidedAt.toString()) : null,
				decision_reason: item.decisionReason,
				legacy_approval_request_id: item.legacyApprovalRequestId,
			}));
			const assignmentRows = snapshot.stages.flatMap((item) =>
				item.assignments.map((child) => ({
					id: child.id,
					organization_id: child.organizationId,
					workflow_id: child.workflowId,
					stage_id: child.stageId,
					assignment_sequence: child.sequence,
					approver_employee_id: child.approverEmployeeId,
					status: child.status,
					assigned_at: new Date(child.assignedAt.toString()),
					resolved_at: child.resolvedAt
						? new Date(child.resolvedAt.toString())
						: null,
					resolved_by_actor_kind: child.resolvedBy?.kind ?? null,
					resolved_by_actor_id:
						child.resolvedBy?.kind === "employee"
							? child.resolvedBy.employeeId
							: child.resolvedBy?.kind === "system"
								? child.resolvedBy.systemId
								: null,
					reassigned_by_employee_id: child.reassignedByEmployeeId,
					reassigned_from_assignment_id: child.reassignedFromAssignmentId,
					reassignment_metadata: child.reassignmentMetadata,
				})),
			);
			const db = {
				execute: vi.fn(async (statement: SQL) => {
					const compiled = new PgDialect().sqlToQuery(statement);
					if (/approval_workflow_rollout/i.test(compiled.sql)) {
						return { rows: [{ lifecycle_mode: mode }] };
					}
					if (/insert into approval_workflow_command/i.test(compiled.sql)) {
						actorFingerprint = String(compiled.params[3]);
						commandFingerprint = String(compiled.params[4]);
						return { rows: [] };
					}
					if (/from approval_workflow_command/i.test(compiled.sql)) {
						return {
							rows: [
								{
									actor_fingerprint: actorFingerprint,
									command_fingerprint: commandFingerprint,
									state: "completed",
									result: encodeApprovalCommandResult(result),
								},
							],
						};
					}
					if (/from approval_workflow_stage/i.test(compiled.sql)) {
						return { rows: stageRows };
					}
					if (/from approval_stage_assignment/i.test(compiled.sql)) {
						return { rows: assignmentRows };
					}
					if (/from approval_workflow\b/i.test(compiled.sql)) {
						return { rows: [rootRow] };
					}
					if (/from employee/i.test(compiled.sql)) {
						return {
							rows: [
								{
									id: fixture.ids.manager,
									organization_id: "org-1",
									user_id: "user-manager",
								},
							],
						};
					}
					if (/from member/i.test(compiled.sql)) {
						return {
							rows: [
								{
									organization_id: "org-1",
									user_id: "user-manager",
									status: "approved",
								},
							],
						};
					}
					return { rows: [] };
				}),
				query: {
					employee: {
						findMany: vi.fn().mockResolvedValue([
							{
								id: fixture.ids.manager,
								organizationId: "org-1",
								userId: "user-manager",
								isActive: true,
								user: { id: "user-manager" },
							},
						]),
					},
					member: {
						findMany: vi.fn().mockResolvedValue([
							{
								organizationId: "org-1",
								userId: "user-manager",
								status: "approved",
							},
						]),
					},
					approvalRequest: {
						findFirst: vi.fn().mockResolvedValue(
							mode === "canonical"
								? {
										id: stableTarget,
										organizationId: "org-1",
										entityType: "time_entry",
										entityId: fixture.ids.period,
										requestedBy: fixture.ids.requester,
										approverId: assignment.approverEmployeeId,
										status: "approved",
										metadata: {
											workflow: {
												id: snapshot.id,
												organizationId: snapshot.organizationId,
											},
											stage: {
												id: stage.id,
												sequence: stage.sequence,
												assignmentId: assignment.id,
											},
											timeCorrection: snapshot.contextSnapshot.timeCorrection,
											submission: snapshot.contextSnapshot.submission,
										},
										reason: null,
									}
								: null,
						),
					},
					approvalStageAssignment: {
						findFirst: vi.fn().mockResolvedValue({
							id: assignment.id,
							workflowId: snapshot.id,
							stageId: stage.id,
						}),
					},
					approvalWorkflowStage: {
						findFirst: vi
							.fn()
							.mockResolvedValue({ id: stage.id, workflowId: snapshot.id }),
					},
					approvalWorkflow: {
						findFirst: vi.fn().mockResolvedValue({
							id: snapshot.id,
							organizationId: snapshot.organizationId,
							workflowType: snapshot.workflowType,
							sourceType: snapshot.sourceType,
							sourceId: snapshot.sourceId,
							requesterEmployeeId: snapshot.requesterEmployeeId,
							status: snapshot.status,
							contextSnapshot: snapshot.contextSnapshot,
						}),
					},
					workPeriod: {
						findFirst: vi.fn().mockResolvedValue({
							id: fixture.ids.period,
							organizationId: "org-1",
							employeeId: fixture.ids.requester,
							pendingChanges: null,
							clockInId: fixture.ids.correction,
							clockOutId: null,
							approvalWorkflowId: snapshot.id,
						}),
					},
					timeEntry: {
						findMany: vi
							.fn()
							.mockResolvedValue([{ id: fixture.ids.correction }]),
					},
				},
				transaction: async <T>(
					operation: (transactionDb: unknown) => Promise<T>,
				) => {
					const value = await operation(db);
					transactionCommitted();
					return value;
				},
			};
			markEmployeeWorkBalanceDirty.mockClear();
			onTimeCorrectionApproved.mockClear();
			onTimeCorrectionRejected.mockClear();

		await Effect.runPromise(
			decideTimeCorrectionWithStableTargetEffect(
				{
					db,
					query: <T>(_name: string, operation: () => Promise<T>) =>
						Effect.promise(operation),
				} as never,
				{
					id: fixture.ids.manager,
					organizationId: "org-1",
					userId: "user-manager",
					user: {
						id: "user-manager",
						name: "Manager",
						email: "manager@example.com",
						image: null,
					},
				},
				stableTarget,
				"approve",
			),
		);

		expect(transactionCommitted).toHaveBeenCalledOnce();
		expect(markEmployeeWorkBalanceDirty).not.toHaveBeenCalled();
		expect(onTimeCorrectionApproved).not.toHaveBeenCalled();
		expect(onTimeCorrectionRejected).not.toHaveBeenCalled();
	});

	it("rejects an unknown canonical stable target before reserving a receipt", async () => {
		const fixture = canonicalSubmissionHarness({ mode: "complete" });
		await fixture.execute();

		await expect(
			fixture.decide("31000000-0000-4000-8000-000000000999"),
		).rejects.toMatchObject({ conflictType: "approval_transition" });
		expect(fixture.repository.claimCommand).not.toHaveBeenCalled();
		expect(requiredValue([...fixture.snapshots.values()][0]).status).toBe(
			"pending",
		);
	});

	it.each([
		"canonical",
		"complete",
	] as const)("rolls back every %s decision write and dispatches no effect", async (mode) => {
		const fixture = canonicalSubmissionHarness({ mode });
		await fixture.execute();
		const before = requiredValue([...fixture.snapshots.values()][0]);
		const target = requiredValue(before.stages[0]?.assignments[0]);
		const durable = {
			compatibility: structuredClone(fixture.compatibilityRows),
			projections: fixture.projections.length,
			outbox: fixture.outbox.length,
			legacy: fixture.legacyWrites.length,
		};
		fixture.failProjection(new Error("injected:decision-projection"));

		await expect(fixture.decide(target.id)).rejects.toThrow(
			"injected:decision-projection",
		);

		expect(requiredValue(fixture.snapshots.get(before.id))).toEqual(before);
		expect(fixture.compatibilityRows).toEqual(durable.compatibility);
		expect(fixture.projections).toHaveLength(durable.projections);
		expect(fixture.outbox).toHaveLength(durable.outbox);
		expect(fixture.legacyWrites).toHaveLength(durable.legacy);
		expect(fixture.terminalFinalizations()).toBe(0);
		expect(fixture.repository.completeCommand).not.toHaveBeenCalled();
		expect(markEmployeeWorkBalanceDirty).not.toHaveBeenCalled();
		expect(onTimeCorrectionApproved).not.toHaveBeenCalled();
		expect(onTimeCorrectionRejected).not.toHaveBeenCalled();
	});

	it.each([
		"canonical",
		"complete",
	] as const)("uses actual assignment authorization for %s decisions", async (mode) => {
		const fixture = canonicalSubmissionHarness({
			mode,
			reviewersByStage: [["31000000-0000-4000-8000-000000000803"]],
		});
		await fixture.execute();
		const before = requiredValue([...fixture.snapshots.values()][0]);
		const target = requiredValue(before.stages[0]?.assignments[0]);

		await expect(fixture.decide(target.id)).rejects.toThrow(
			/forbidden command actor/i,
		);
		expect(requiredValue(fixture.snapshots.get(before.id))).toEqual(before);
		expect(
			fixture.repository.applyMaterializedTransition,
		).not.toHaveBeenCalled();
		expect(fixture.repository.completeCommand).not.toHaveBeenCalled();
	});

	it.each([
		"canonical",
		"complete",
	] as const)("completes a parallel-reviewer %s stage with real sibling semantics", async (mode) => {
		const fixture = canonicalSubmissionHarness({
			mode,
			reviewersByStage: [
				[
					"31000000-0000-4000-8000-000000000802",
					"31000000-0000-4000-8000-000000000803",
				],
			],
		});
		await fixture.execute();
		const before = requiredValue([...fixture.snapshots.values()][0]);
		const target = requiredValue(before.stages[0]?.assignments[0]);

		await fixture.decide(target.id);
		const after = requiredValue(fixture.snapshots.get(before.id));

		expect(after.status).toBe("approved");
		expect(after.stages[0]?.assignments.map(({ status }) => status)).toEqual([
			"approved",
			"cancelled",
		]);
		expect(fixture.terminalFinalizations()).toBe(1);
	});

	it.each(["canonical", "complete"] as const)(
		"replays the exact %s pending workflow without duplicate durable writes",
		async (mode) => {
			const fixture = canonicalSubmissionHarness({ mode });
			const first = await fixture.execute();
			const durable = {
				creates: vi.mocked(fixture.repository.createInitialWorkflow).mock.calls
					.length,
				projections: fixture.projections.length,
				outbox: fixture.outbox.length,
				legacy: fixture.legacyWrites.length,
			};

			const replay = await fixture.execute();

			expect(first.disposition).toBe("executed");
			expect(replay.disposition).toBe("replayed");
			expect(replay.approvalRequestId).toBe(first.approvalRequestId);
			expect({
				creates: vi.mocked(fixture.repository.createInitialWorkflow).mock.calls
					.length,
				projections: fixture.projections.length,
				outbox: fixture.outbox.length,
				legacy: fixture.legacyWrites.length,
			}).toEqual(durable);
			expect(fixture.acquire).toHaveBeenCalledTimes(2);
		},
	);

	it("rejects a different canonical payload while another cycle is pending", async () => {
		const fixture = canonicalSubmissionHarness({ mode: "canonical" });
		await fixture.execute();

		await expect(
			fixture.execute({ submissionKey: "canonical-submission-2" }),
		).rejects.toMatchObject({ code: "SOURCE_CONFLICT" });
		expect(fixture.snapshots).toHaveLength(1);
	});

	it.each([
		"canonical",
		"complete",
	] as const)("allows a later %s cycle after terminal history and rebinds the source", async (mode) => {
		const fixture = canonicalSubmissionHarness({ mode });
		await fixture.execute();
		const first = requiredValue([...fixture.snapshots.values()][0]);
		const firstStage = requiredValue(first.stages[0]);
		fixture.setSnapshot({
			...first,
			status: "approved",
			currentStageOrder: null,
			completedAt: first.submittedAt,
			stages: first.stages.map((stage) => ({
				...stage,
				status: "approved",
				decidedAt: first.submittedAt,
				assignments: stage.assignments.map((assignment) => ({
					...assignment,
					status: "approved",
					resolvedAt: first.submittedAt,
				})),
			})),
		});

		const next = await fixture.execute({
			submissionKey: "canonical-submission-2",
		});

		expect(next.kind).toBe("default_created");
		expect(fixture.snapshots).toHaveLength(2);
		expect(next.approvalRequestId).not.toBe(firstStage.id);
	});

	it("rolls back canonical root, source binding, projection, outbox, and compatibility state together", async () => {
		const fixture = canonicalSubmissionHarness({ mode: "canonical" });
		fixture.failProjection();

		await expect(fixture.transaction(() => fixture.execute())).rejects.toThrow(
			"injected:projection",
		);

		expect(fixture.snapshots).toHaveLength(0);
		expect(fixture.compatibilityRows).toHaveLength(0);
		expect(fixture.projections).toHaveLength(0);
		expect(fixture.outbox).toHaveLength(0);
		expect(fixture.legacyWrites).toHaveLength(0);
	});

	it.each([
		["canonical_root", "rootCount"],
		["canonical_event", "eventCount"],
		["projection", "projectionCount"],
		["outbox", "outboxCount"],
		["source_binding", "sourceWorkflowId"],
		["compatibility", "legacyWriteCount"],
	] as const)("restores the full canonical submission state after %s failure with changed evidence", async (point, evidenceKey) => {
		const fixture = canonicalSubmissionHarness({ mode: "canonical" });
		const before = fixture.durableSnapshot();
		fixture.injectFailure(point);

		await expect(fixture.transaction(() => fixture.execute())).rejects.toThrow(
			point === "capture_after"
				? /legacy approval state capture failed/i
				: `injected:${point}`,
		);

		const evidence = requiredValue(fixture.failureEvidence() ?? undefined);
		expect(evidence[evidenceKey]).toBeTruthy();
		expect(evidence.state).not.toEqual(before);
		expect(fixture.durableSnapshot()).toEqual(before);
		expect(markEmployeeWorkBalanceDirty).not.toHaveBeenCalled();
		expect(onTimeCorrectionApproved).not.toHaveBeenCalled();
		expect(onTimeCorrectionRejected).not.toHaveBeenCalled();
	});

	it("restores all canonical submission stores when the terminal finalizer fails after prior writes", async () => {
		const fixture = canonicalSubmissionHarness({
			mode: "canonical",
			autoApprove: true,
		});
		const before = fixture.durableSnapshot();
		fixture.injectFailure("finalizer");

		await expect(fixture.transaction(() => fixture.execute())).rejects.toThrow(
			"injected:finalizer",
		);

		const evidence = requiredValue(fixture.failureEvidence() ?? undefined);
		expect(evidence).toMatchObject({
			terminalFinalizations: 1,
			originalSuperseded: true,
			correctionSuperseded: false,
		});
		expect(evidence.state).not.toEqual(before);
		expect(fixture.durableSnapshot()).toEqual(before);
		expect(markEmployeeWorkBalanceDirty).not.toHaveBeenCalled();
		expect(onTimeCorrectionApproved).not.toHaveBeenCalled();
		expect(onTimeCorrectionRejected).not.toHaveBeenCalled();
	});

	it("restores canonical compatibility request, chain, and stage writes together", async () => {
		const fixture = canonicalSubmissionHarness({
			mode: "canonical",
			policies: [canonicalPolicy(2)],
		});
		const before = fixture.durableSnapshot();
		fixture.injectFailure("compatibility");

		await expect(
			fixture.transaction(() => fixture.execute({ defaultApproverId: null })),
		).rejects.toThrow("injected:compatibility");

		const evidence = requiredValue(fixture.failureEvidence() ?? undefined);
		expect(evidence).toMatchObject({
			compatibilityCount: 1,
			compatibilityChainCount: 1,
			compatibilityStageCount: 2,
		});
		expect(evidence.state).not.toEqual(before);
		expect(fixture.durableSnapshot()).toEqual(before);
		expect(markEmployeeWorkBalanceDirty).not.toHaveBeenCalled();
		expect(onTimeCorrectionApproved).not.toHaveBeenCalled();
		expect(onTimeCorrectionRejected).not.toHaveBeenCalled();
	});

	it.each([
		["receipt_claim", "receiptCount"],
		["canonical_root", "rootCount"],
		["canonical_event", "eventCount"],
		["finalizer", "terminalFinalizations"],
		["compatibility", "legacyWriteCount"],
		["projection", "projectionCount"],
		["outbox", "outboxCount"],
	] as const)(
		"restores the full canonical decision state after %s failure with changed evidence",
		async (point, evidenceKey) => {
			const fixture = canonicalSubmissionHarness({ mode: "canonical" });
			await fixture.execute();
			const pending = requiredValue([...fixture.snapshots.values()][0]);
			const target = requiredValue(pending.stages[0]?.assignments[0]);
			const before = fixture.durableSnapshot();
			fixture.injectFailure(point);

			await expect(fixture.decide(target.id)).rejects.toThrow(
				`injected:${point}`,
			);

			const evidence = requiredValue(fixture.failureEvidence() ?? undefined);
			expect(evidence[evidenceKey]).toBeTruthy();
			expect(evidence.state).not.toEqual(before);
			expect(fixture.durableSnapshot()).toEqual(before);
			expect(markEmployeeWorkBalanceDirty).not.toHaveBeenCalled();
			expect(onTimeCorrectionApproved).not.toHaveBeenCalled();
			expect(onTimeCorrectionRejected).not.toHaveBeenCalled();
		},
	);

	it.each(["canonical", "complete"] as const)(
		"commits the expected full %s submission and decision state control",
		async (mode) => {
			const fixture = canonicalSubmissionHarness({ mode });
			const empty = fixture.durableSnapshot();
			await fixture.transaction(() => fixture.execute());
			const submitted = fixture.durableSnapshot();
			expect(submitted).not.toEqual(empty);
			expect(fixture.snapshots.size).toBe(1);
			expect(fixture.canonicalEvents.length).toBeGreaterThan(0);
			expect(fixture.projections.length).toBeGreaterThan(0);
			expect(fixture.outbox.length).toBeGreaterThan(0);
			const pending = requiredValue([...fixture.snapshots.values()][0]);
			const target = requiredValue(pending.stages[0]?.assignments[0]);

			await fixture.decide(target.id);

			expect(fixture.durableSnapshot()).not.toEqual(submitted);
			expect(requiredValue(fixture.snapshots.get(pending.id)).status).toBe(
				"approved",
			);
			expect(fixture.terminalFinalizations()).toBe(1);
		},
	);

	it.each(["legacy", "shadow", "ready"] as const)(
		"replays the original pending %s submission after actual terminal rejection without writes",
		async (mode) => {
			const fixture = observedSubmissionHarness(mode);
			const key = `${mode}-rejected-replay`;
			const submitted = await fixture.transaction(() => fixture.execute(key));
			await fixture.decide("reject", "Rejected by manager");
			const beforeReplay = fixture.durableSnapshot();

			const replay = await fixture.transaction(() => fixture.execute(key));

			expect(replay).toMatchObject({
				kind: submitted.kind,
				approvalRequestId: submitted.approvalRequestId,
				postCommit: { terminal: null },
			});
			expect(fixture.durableSnapshot()).toEqual(beforeReplay);
		},
	);

	it.each(["legacy", "shadow", "ready"] as const)(
		"rejects a changed business submission bound to the same %s cycle token",
		async (mode) => {
			const fixture = observedSubmissionHarness(mode);
			const submissionId = "41000000-0000-4000-8000-000000000099";
			await fixture.transaction(() =>
				fixture.execute(`${mode}-business-evidence-1`, submissionId),
			);
			const beforeConflict = fixture.durableSnapshot();

			await expect(
				fixture.transaction(() =>
					fixture.execute(`${mode}-business-evidence-2`, submissionId),
				),
			).rejects.toBeInstanceOf(ConflictError);
			expect(fixture.durableSnapshot()).toEqual(beforeConflict);
		},
	);

	it.each(["canonical", "complete"] as const)(
		"rejects a changed business submission bound to the same %s cycle token",
		async (mode) => {
			const fixture = canonicalSubmissionHarness({ mode });
			const submissionId = "41000000-0000-4000-8000-000000000099";
			await fixture.transaction(() =>
				fixture.execute({
					submissionKey: `${mode}-business-evidence-1`,
					submissionId,
				}),
			);
			const beforeConflict = fixture.durableSnapshot();

			await expect(
				fixture.transaction(() =>
					fixture.execute({
						submissionKey: `${mode}-business-evidence-2`,
						submissionId,
					}),
				),
			).rejects.toBeInstanceOf(ConflictError);
			expect(fixture.durableSnapshot()).toEqual(beforeConflict);
		},
	);

	it.each([
		"canonical",
		"complete",
	] as const)("replays the original pending %s submission after actual terminal rejection without writes", async (mode) => {
		const fixture = canonicalSubmissionHarness({ mode });
		const key = `${mode}-rejected-replay`;
		const submitted = await fixture.transaction(() =>
			fixture.execute({ submissionKey: key }),
		);
		const pending = requiredValue([...fixture.snapshots.values()][0]);
		const target = requiredValue(pending.stages[0]?.assignments[0]);
		await fixture.decide(target.id, "reject", "Rejected by manager");
		const beforeReplay = fixture.durableSnapshot();

		const replay = await fixture.transaction(() =>
			fixture.execute({ submissionKey: key }),
		);

		expect(replay).toMatchObject({
			kind: submitted.kind,
			approvalRequestId: submitted.approvalRequestId,
			postCommit: { terminal: null },
		});
		expect(fixture.durableSnapshot()).toEqual(beforeReplay);
	});

	it("starts a genuine later legacy cycle with a different key after rejection", async () => {
		const fixture = observedSubmissionHarness("legacy");
		const first = await fixture.transaction(() =>
			fixture.execute("legacy-cycle-1", "41000000-0000-4000-8000-000000000101"),
		);
		await fixture.decide("reject", "Rejected by manager");

		const later = await fixture.transaction(() =>
			fixture.execute("legacy-cycle-2", "41000000-0000-4000-8000-000000000102"),
		);

		expect(later.approvalRequestId).not.toBe(first.approvalRequestId);
		expect(fixture.requests).toHaveLength(2);
	});

	it.each([
		"shadow",
		"ready",
	] as const)("starts a genuine later %s cycle with a new token after rejection", async (mode) => {
		const fixture = observedSubmissionHarness(mode);
		const first = await fixture.transaction(() =>
			fixture.execute(
				`${mode}-cycle-1`,
				"41000000-0000-4000-8000-000000000101",
			),
		);
		await fixture.decide("reject", "Rejected by manager");

		const later = await fixture.transaction(() =>
			fixture.execute(
				`${mode}-cycle-2`,
				"41000000-0000-4000-8000-000000000102",
			),
		);

		expect(later.approvalRequestId).not.toBe(first.approvalRequestId);
		expect(fixture.requests).toHaveLength(2);
	});

	it.each(["legacy", "shadow", "ready"] as const)(
		"replays %s chain semantics from a strict cancelled submission tombstone",
		async (mode) => {
			const fixture = observedSubmissionHarness(mode);
			const submissionKey = `${mode}-cancelled-chain-submission`;
			const first = await fixture.execute(submissionKey);
			const request = requiredValue(fixture.requests[0]);
			const chainId = "91000000-0000-4000-8000-000000000909";
			const cancelledAt = new Date("2026-07-20T12:00:00.000Z");
			request.status = "rejected";
			request.rejectionReason = null;
			request.approvedAt = cancelledAt;
			request.metadata = {
				...(request.metadata as Record<string, unknown>),
				submission: {
					...((request.metadata as Record<string, unknown>)
						.submission as Record<string, unknown>),
					resultKind: "chain_created",
				},
				cancellation: {
					kind: "requester",
					organizationId: "org-1",
					requesterEmployeeId: fixture.ids.requester,
					requesterUserId: "user-requester",
					workPeriodId: fixture.ids.period,
					chainInstanceId: chainId,
					cancelledAt: cancelledAt.toISOString(),
				},
			};
			fixture.chains.push({
				id: chainId,
				organizationId: "org-1",
				entityType: "time_entry",
				entityId: fixture.ids.period,
				requesterEmployeeId: fixture.ids.requester,
				status: "cancelled",
				createdAt: cancelledAt,
			});
			fixture.chainRows.push({
				id: "92000000-0000-4000-8000-000000000909",
				organizationId: "org-1",
				chainInstanceId: chainId,
				status: "cancelled",
				approvalRequestId: null,
			});

		const replay = await fixture.execute(submissionKey);

		expect(first.disposition).toBe("executed");
		expect(replay).toMatchObject({
			disposition: "replayed",
			kind: "chain_created",
			chainInstanceId: chainId,
			approvalRequestId: request.id,
		});
		expect(fixture.requests).toHaveLength(1);
	});

	it.each([
		"canonical",
		"complete",
	] as const)("starts a genuine later %s cycle with a different key after rejection", async (mode) => {
		const fixture = canonicalSubmissionHarness({ mode });
		const first = await fixture.transaction(() =>
			fixture.execute({
				submissionKey: `${mode}-cycle-1`,
				submissionId: "41000000-0000-4000-8000-000000000101",
			}),
		);
		const pending = requiredValue([...fixture.snapshots.values()][0]);
		const target = requiredValue(pending.stages[0]?.assignments[0]);
		await fixture.decide(target.id, "reject", "Rejected by manager");

		const later = await fixture.transaction(() =>
			fixture.execute({
				submissionKey: `${mode}-cycle-2`,
				submissionId: "41000000-0000-4000-8000-000000000102",
			}),
		);

		expect(later.approvalRequestId).not.toBe(first.approvalRequestId);
		expect(fixture.snapshots.size).toBe(2);
	});

	it.each(["legacy", "shadow", "ready"] as const)(
		"keeps original pending semantics when replaying a manager-approved %s submission",
		async (mode) => {
			const fixture = observedSubmissionHarness(mode);
			const key = `${mode}-manager-approved-replay`;
			const submitted = await fixture.transaction(() => fixture.execute(key));
			await fixture.decide("approve");
			const beforeReplay = fixture.durableSnapshot();

			const replay = await fixture.transaction(() => fixture.execute(key));

			expect(replay.kind).toBe(submitted.kind);
			expect(replay).not.toHaveProperty("autoCompletion");
			expect(fixture.durableSnapshot()).toEqual(beforeReplay);
		},
	);

	it.each(["canonical", "complete"] as const)(
		"keeps original pending semantics when replaying a manager-approved %s submission",
		async (mode) => {
			const fixture = canonicalSubmissionHarness({ mode });
			const key = `${mode}-manager-approved-replay`;
			const submitted = await fixture.transaction(() =>
				fixture.execute({ submissionKey: key }),
			);
			const pending = requiredValue([...fixture.snapshots.values()][0]);
			const target = requiredValue(pending.stages[0]?.assignments[0]);
			await fixture.decide(target.id);
			const beforeReplay = fixture.durableSnapshot();

			const replay = await fixture.transaction(() =>
				fixture.execute({ submissionKey: key }),
			);

			expect(replay.kind).toBe(submitted.kind);
			expect(replay).not.toHaveProperty("autoCompletion");
			expect(fixture.durableSnapshot()).toEqual(beforeReplay);
		},
	);

	it.each(["legacy", "shadow", "ready"] as const)(
		"keeps requester auto-completed semantics on exact %s replay",
		async (mode) => {
			const fixture = observedSubmissionHarness(mode, true);
			const key = `${mode}-auto-replay`;
			const submitted = await fixture.transaction(() => fixture.execute(key));
			const beforeReplay = fixture.durableSnapshot();

			const replay = await fixture.transaction(() => fixture.execute(key));

			expect(submitted.kind).toBe("auto_completed");
			expect(replay).toMatchObject({
				kind: "auto_completed",
				reason: "requester_is_approver",
				postCommit: { terminal: null },
			});
			expect(fixture.durableSnapshot()).toEqual(beforeReplay);
		},
	);

	it.each([
		"canonical",
		"complete",
	] as const)("keeps requester auto-completed semantics on exact %s replay", async (mode) => {
		const fixture = canonicalSubmissionHarness({ mode, autoApprove: true });
		const key = `${mode}-auto-replay`;
		const submitted = await fixture.transaction(() =>
			fixture.execute({ submissionKey: key }),
		);
		const beforeReplay = fixture.durableSnapshot();

		const replay = await fixture.transaction(() =>
			fixture.execute({ submissionKey: key }),
		);

		expect(submitted.kind).toBe("auto_completed");
		expect(replay).toMatchObject({
			kind: "auto_completed",
			reason: "requester_is_approver",
			postCommit: { terminal: null },
		});
		expect(fixture.durableSnapshot()).toEqual(beforeReplay);
	});

	it("rejects terminal completion without requester auto-approval evidence", async () => {
		const fixture = canonicalSubmissionHarness({
			mode: "canonical",
			autoApprove: true,
			tamperTerminalActivationMode: "human",
		});

		await expect(fixture.transaction(() => fixture.execute())).rejects.toThrow(
			"Time correction submission reached invalid requester auto-completion",
		);
		expect(fixture.terminalFinalizations()).toBe(0);
	});

	it("reuses the locked requester identity for canonical auto-completion", async () => {
		const fixture = canonicalSubmissionHarness({
			mode: "canonical",
			autoApprove: true,
		});

		await expect(
			fixture.transaction(() => fixture.execute()),
		).resolves.toMatchObject({
			kind: "auto_completed",
		});
		expect(fixture.requesterIdentityLookup).not.toHaveBeenCalled();
	});

	it("preserves immutable submission evidence in canonical compatibility metadata", async () => {
		const fixture = canonicalSubmissionHarness({ mode: "canonical" });
		const key = "canonical-compatibility-marker";

		await fixture.transaction(() => fixture.execute({ submissionKey: key }));

		expect(fixture.compatibilityRows[0]?.metadata).toMatchObject({
			submission: {
				key,
				resultKind: "default_created",
				originalStatus: "pending",
			},
		});
	});

	it.each([
		"legacy",
		"shadow",
		"ready",
	] as const)("fails closed on malformed immutable %s submission evidence", async (mode) => {
		const fixture = observedSubmissionHarness(mode);
		const key = `${mode}-malformed-marker`;
		await fixture.transaction(() => fixture.execute(key));
		const request = requiredValue(fixture.requests[0]);
		const metadata = request.metadata as Record<string, unknown>;
		metadata.submission = {
			...(metadata.submission as Record<string, unknown>),
			unknown: true,
		};
		const beforeReplay = fixture.durableSnapshot();

		await expect(
			fixture.transaction(() => fixture.execute(key)),
		).rejects.toBeInstanceOf(ConflictError);
		expect(fixture.durableSnapshot()).toEqual(beforeReplay);
	});

	it("does not invoke submission evidence accessors", async () => {
		const fixture = observedSubmissionHarness("legacy");
		const key = "legacy-accessor-marker";
		await fixture.transaction(() => fixture.execute(key));
		const request = requiredValue(fixture.requests[0]);
		const getter = vi.fn(() => key);
		request.metadata = {
			...(request.metadata as Record<string, unknown>),
			submission: Object.defineProperty({}, "key", {
				enumerable: true,
				get: getter,
			}),
		};

		await expect(fixture.execute(key)).rejects.toBeInstanceOf(ConflictError);
		expect(getter).not.toHaveBeenCalled();
	});

	it.each([
		"canonical",
		"complete",
	] as const)("fails closed on malformed immutable %s canonical submission evidence", async (mode) => {
		const fixture = canonicalSubmissionHarness({ mode });
		const key = `${mode}-malformed-marker`;
		await fixture.transaction(() => fixture.execute({ submissionKey: key }));
		const snapshot = requiredValue([...fixture.snapshots.values()][0]);
		fixture.setSnapshot({
			...snapshot,
			contextSnapshot: {
				...snapshot.contextSnapshot,
				submission: {
					...(snapshot.contextSnapshot.submission as Record<string, unknown>),
					unknown: true,
				},
			},
		});
		const beforeReplay = fixture.durableSnapshot();

		await expect(
			fixture.transaction(() => fixture.execute({ submissionKey: key })),
		).rejects.toBeInstanceOf(ConflictError);
		expect(fixture.durableSnapshot()).toEqual(beforeReplay);
	});

	const malformedHistoricalAutoApproval = (
		kind:
			| "extra_key"
			| "accessor"
			| "inherited"
			| "bad_reason"
			| "bad_type"
			| "null",
	) => {
		switch (kind) {
			case "extra_key":
				return { reason: "requester_is_approver", extra: true };
			case "accessor":
				return Object.defineProperty({}, "reason", {
					enumerable: true,
					get: vi.fn(() => "requester_is_approver"),
				});
			case "inherited":
				return Object.create({ reason: "requester_is_approver" });
			case "bad_reason":
				return { reason: "manager_approved" };
			case "bad_type":
				return "requester_is_approver";
			case "null":
				return null;
		}
	};

	it.each(
		(["legacy", "shadow", "ready"] as const).flatMap((mode) =>
			(
				[
					"extra_key",
					"accessor",
					"inherited",
					"bad_reason",
					"bad_type",
					"null",
				] as const
			).map((shape) => ({ mode, shape })),
		),
	)(
		"fails closed on historical $mode key-only replay with $shape autoApproval",
		async ({ mode, shape }) => {
			const fixture = observedSubmissionHarness(mode);
			const key = `${mode}-historical-${shape}`;
			await fixture.transaction(() => fixture.execute(key));
			const request = requiredValue(fixture.requests[0]);
			request.metadata = {
				...(request.metadata as Record<string, unknown>),
				submission: { key },
				autoApproval: malformedHistoricalAutoApproval(shape),
			};
			const before = {
				requests: fixture.requests.length,
				workflows: fixture.workflows.size,
				events: fixture.observedEvents.length,
				projections: fixture.projections.length,
				outbox: fixture.outbox.length,
				finalizers: fixture.terminalFinalizations(),
				dirty: markEmployeeWorkBalanceDirty.mock.calls.length,
				approved: onTimeCorrectionApproved.mock.calls.length,
				rejected: onTimeCorrectionRejected.mock.calls.length,
			};

			await expect(fixture.execute(key)).rejects.toBeInstanceOf(ConflictError);

			expect({
				requests: fixture.requests.length,
				workflows: fixture.workflows.size,
				events: fixture.observedEvents.length,
				projections: fixture.projections.length,
				outbox: fixture.outbox.length,
				finalizers: fixture.terminalFinalizations(),
				dirty: markEmployeeWorkBalanceDirty.mock.calls.length,
				approved: onTimeCorrectionApproved.mock.calls.length,
				rejected: onTimeCorrectionRejected.mock.calls.length,
			}).toEqual(before);
			if (shape === "accessor") {
				const descriptor = Object.getOwnPropertyDescriptor(
					(request.metadata as Record<string, unknown>).autoApproval as object,
					"reason",
				);
				expect(descriptor?.get).not.toHaveBeenCalled();
			}
		},
	);

	it.each(
		(["canonical", "complete"] as const).flatMap((mode) =>
			(
				[
					"extra_key",
					"accessor",
					"inherited",
					"bad_reason",
					"bad_type",
					"null",
				] as const
			).map((shape) => ({ mode, shape })),
		),
	)(
		"fails closed on historical $mode key-only replay with $shape autoApproval",
		async ({ mode, shape }) => {
			const fixture = canonicalSubmissionHarness({ mode });
			const key = `${mode}-historical-${shape}`;
			await fixture.transaction(() => fixture.execute({ submissionKey: key }));
			const snapshot = requiredValue([...fixture.snapshots.values()][0]);
			const autoApproval = malformedHistoricalAutoApproval(shape);
			fixture.setSnapshot({
				...snapshot,
				contextSnapshot: {
					...snapshot.contextSnapshot,
					submission: { key },
					autoApproval,
				},
			});
			const before = {
				workflows: fixture.snapshots.size,
				events: fixture.canonicalEvents.length,
				projections: fixture.projections.length,
				outbox: fixture.outbox.length,
				legacy: fixture.legacyWrites.length,
				finalizers: fixture.terminalFinalizations(),
				dirty: markEmployeeWorkBalanceDirty.mock.calls.length,
				approved: onTimeCorrectionApproved.mock.calls.length,
				rejected: onTimeCorrectionRejected.mock.calls.length,
			};

			await expect(
				fixture.execute({ submissionKey: key }),
			).rejects.toBeInstanceOf(ConflictError);

			expect({
				workflows: fixture.snapshots.size,
				events: fixture.canonicalEvents.length,
				projections: fixture.projections.length,
				outbox: fixture.outbox.length,
				legacy: fixture.legacyWrites.length,
				finalizers: fixture.terminalFinalizations(),
				dirty: markEmployeeWorkBalanceDirty.mock.calls.length,
				approved: onTimeCorrectionApproved.mock.calls.length,
				rejected: onTimeCorrectionRejected.mock.calls.length,
			}).toEqual(before);
			if (shape === "accessor") {
				const descriptor = Object.getOwnPropertyDescriptor(
					autoApproval as object,
					"reason",
				);
				expect(descriptor?.get).not.toHaveBeenCalled();
			}
		},
	);

	it.each(["legacy", "shadow", "ready"] as const)(
		"rejects historical %s key-only pending evidence when autoApproval is absent",
		async (mode) => {
			const fixture = observedSubmissionHarness(mode);
			const key = `${mode}-historical-absent`;
			const submitted = await fixture.transaction(() => fixture.execute(key));
			const request = requiredValue(fixture.requests[0]);
			request.metadata = {
				...(request.metadata as Record<string, unknown>),
				submission: { key },
			};
			delete (request.metadata as Record<string, unknown>).autoApproval;

			await expect(fixture.execute(key)).rejects.toBeInstanceOf(ConflictError);
			expect(submitted.approvalRequestId).toBe(request.id);
		},
	);

	it.each(["canonical", "complete"] as const)(
		"rejects historical %s key-only pending evidence when autoApproval is absent",
		async (mode) => {
			const fixture = canonicalSubmissionHarness({ mode });
			const key = `${mode}-historical-absent`;
			const submitted = await fixture.execute({ submissionKey: key });
			const snapshot = requiredValue([...fixture.snapshots.values()][0]);
			fixture.setSnapshot({
				...snapshot,
				contextSnapshot: {
					...snapshot.contextSnapshot,
					submission: { key },
				},
			});

			await expect(
				fixture.execute({ submissionKey: key }),
			).rejects.toBeInstanceOf(ConflictError);
			expect(submitted.approvalRequestId).toBeTruthy();
		},
	);

	it.each(["legacy", "shadow", "ready"] as const)(
		"rejects partial historical requester auto-approval evidence in %s mode",
		async (mode) => {
			const fixture = observedSubmissionHarness(mode, true);
			const key = `${mode}-historical-auto`;
			await fixture.transaction(() => fixture.execute(key));
			const request = requiredValue(fixture.requests[0]);
			request.metadata = {
				...(request.metadata as Record<string, unknown>),
				submission: { key },
				autoApproval: { reason: "requester_is_approver" },
			};

			await expect(fixture.execute(key)).rejects.toBeInstanceOf(ConflictError);
		},
	);

	it.each(["canonical", "complete"] as const)(
		"rejects partial historical requester auto-approval evidence in %s mode",
		async (mode) => {
			const fixture = canonicalSubmissionHarness({ mode, autoApprove: true });
			const key = `${mode}-historical-auto`;
			await fixture.execute({ submissionKey: key });
			const snapshot = requiredValue([...fixture.snapshots.values()][0]);
			fixture.setSnapshot({
				...snapshot,
				contextSnapshot: {
					...snapshot.contextSnapshot,
					submission: { key },
					autoApproval: { reason: "requester_is_approver" },
				},
			});

			await expect(
				fixture.execute({ submissionKey: key }),
			).rejects.toBeInstanceOf(ConflictError);
		},
	);

	it.each(["canonical", "complete"] as const)(
		"infers markerless %s replay only from the exact deterministic workflow binding",
		async (mode) => {
			const fixture = canonicalSubmissionHarness({ mode });
			const key = `${mode}-markerless-exact-binding`;
			const submitted = await fixture.execute({ submissionKey: key });
			const snapshot = requiredValue([...fixture.snapshots.values()][0]);
			const { submission: _submission, ...contextSnapshot } =
				snapshot.contextSnapshot;
			fixture.setSnapshot({ ...snapshot, contextSnapshot });

			const replay = await fixture.execute({ submissionKey: key });

			expect(replay).toMatchObject({
				kind: submitted.kind,
				approvalRequestId: submitted.approvalRequestId,
			});
		},
	);

	it.each(
		(["canonical", "complete"] as const).flatMap((mode) =>
			(["cancelled", "expired"] as const).map((status) => ({ mode, status })),
		),
	)("replays original pending $mode semantics from exact $status terminal state", async ({
		mode,
		status,
	}) => {
		const fixture = canonicalSubmissionHarness({ mode });
		const key = `${mode}-${status}-replay`;
		const submitted = await fixture.transaction(() =>
			fixture.execute({ submissionKey: key }),
		);
		const snapshot = requiredValue([...fixture.snapshots.values()][0]);
		fixture.setSnapshot({
			...snapshot,
			status,
			completedAt: parseInstant("2026-07-20T12:00:00Z"),
			cancelledAt:
				status === "cancelled" ? parseInstant("2026-07-20T12:00:00Z") : null,
		});
		const beforeReplay = fixture.durableSnapshot();

		const replay = await fixture.transaction(() =>
			fixture.execute({ submissionKey: key }),
		);

		expect(replay).toMatchObject({
			disposition: "replayed",
			kind: submitted.kind,
			approvalRequestId: submitted.approvalRequestId,
			postCommit: { terminal: null },
		});
		expect(fixture.durableSnapshot()).toEqual(beforeReplay);
	});

	it.each([
		["forbidden", AuthorizationError],
		["version_conflict", ConflictError],
		["idempotency_mismatch", ConflictError],
		["malformed_command", ValidationError],
	] as const)("translates canonical decision engine %s at the transaction boundary", async (code, Expected) => {
		const fixture = canonicalSubmissionHarness({
			mode: "complete",
			transitionError: new ApprovalTransitionEngineError(code),
		});
		await fixture.execute();
		const pending = requiredValue([...fixture.snapshots.values()][0]);
		const target = requiredValue(pending.stages[0]?.assignments[0]);

		await expect(fixture.decide(target.id)).rejects.toBeInstanceOf(Expected);
	});

	it("does not cast unknown canonical decision failures as application errors", async () => {
		const internal = new Error("internal transition failure");
		const fixture = canonicalSubmissionHarness({
			mode: "complete",
			transitionError: internal,
		});
		await fixture.execute();
		const pending = requiredValue([...fixture.snapshots.values()][0]);
		const target = requiredValue(pending.stages[0]?.assignments[0]);

		await expect(fixture.decide(target.id)).rejects.toBe(internal);
	});

	it.each(["canonical", "complete"] as const)(
		"returns the original submission target through advanced and terminal %s replay",
		async (mode) => {
			const fixture = canonicalSubmissionHarness({
				mode,
				policies: [canonicalPolicy(2)],
			});
			const submitted = await fixture.execute({ defaultApproverId: null });
			const first = requiredValue([...fixture.snapshots.values()][0]);
			const firstStage = requiredValue(first.stages[0]);
			const stageTwo = {
				...first,
				version: first.version + 1,
				currentStageOrder: 2,
				stages: first.stages.map((stage) =>
					stage.sequence === 1
						? {
								...stage,
								status: "approved" as const,
								decidedAt: parseInstant("2026-07-20T11:00:00Z"),
								assignments: stage.assignments.map((assignment) => ({
									...assignment,
									status: "approved" as const,
									resolvedAt: parseInstant("2026-07-20T11:00:00Z"),
								})),
							}
						: {
								...stage,
								status: "pending" as const,
								activatedAt: parseInstant("2026-07-20T11:00:00Z"),
								assignments: firstStage.assignments.map((assignment) => ({
									...assignment,
									id: `${assignment.id.slice(0, -1)}9`,
									status: "pending" as const,
									resolvedAt: null,
								})),
							},
				),
			} satisfies ApprovalWorkflowSnapshot;
			fixture.setSnapshot(stageTwo);
			fixture.setCompatibilityStage(stageTwo, 1);
			const activeReplay = await fixture.execute({ defaultApproverId: null });
			expect(activeReplay).toMatchObject({
				kind: submitted.kind,
				approvalRequestId: submitted.approvalRequestId,
			});

			const terminal = {
				...stageTwo,
				status: "approved" as const,
				currentStageOrder: null,
				completedAt: parseInstant("2026-07-20T12:00:00Z"),
				stages: stageTwo.stages.map((stage) => ({
					...stage,
					status: "approved" as const,
					decidedAt: parseInstant("2026-07-20T12:00:00Z"),
					assignments: stage.assignments.map((assignment) => ({
						...assignment,
						status: "approved" as const,
					resolvedAt: parseInstant("2026-07-20T12:00:00Z"),
				})),
			})),
			} satisfies ApprovalWorkflowSnapshot;
			fixture.setSnapshot(terminal);

			const terminalReplay = await fixture.execute({ defaultApproverId: null });
			expect(terminalReplay).toMatchObject({
				kind: submitted.kind,
				approvalRequestId: submitted.approvalRequestId,
			});
		},
	);

	it.each(["shadow", "ready"] as const)(
		"runs actual capture, planner, projection, outbox, and binding for %s submission",
		async (mode) => {
			const fixture = observedSubmissionHarness(mode);

			const result = await fixture.execute();

			expect(result).toMatchObject({
				kind: "default_created",
				approvalRequestId: fixture.ids.request,
				postCommit: {
					authority: "legacy",
					submittedToEmployeeId: fixture.ids.manager,
				},
			});
			expect(fixture.acquire).toHaveBeenCalledOnce();
			expect(fixture.requests).toHaveLength(1);
			expect(fixture.workflows).toHaveLength(1);
			expect(fixture.projections).toHaveLength(1);
			expect(fixture.outbox.length).toBeGreaterThan(0);
			expect(fixture.order).toEqual([
				"capture-before",
				"mutate",
				"capture-after",
				"observe",
				"projection",
				...fixture.outbox.map(() => "outbox"),
				"bind",
			]);
		},
	);

	it.each(["shadow", "ready"] as const)(
		"replays the exact %s legacy cycle and rejects a different pending key",
		async (mode) => {
			const fixture = observedSubmissionHarness(mode);
			const first = await fixture.execute();
			const durableOrder = [...fixture.order];

			const replay = await fixture.execute();
			expect(first.disposition).toBe("executed");
			expect(replay.disposition).toBe("replayed");
			expect(replay.approvalRequestId).toBe(first.approvalRequestId);
			expect(fixture.order).toEqual(durableOrder);

			await expect(fixture.execute(`${mode}-submission-2`)).rejects.toThrow(
				/time correction approval.*pending/i,
			);
			expect(fixture.requests).toHaveLength(1);
			expect(fixture.workflows).toHaveLength(1);
		},
	);

	it.each([
		"shadow",
		"ready",
	] as const)("rolls back %s legacy, observed, projection, outbox, and binding state together", async (mode) => {
		const fixture = observedSubmissionHarness(mode);
		fixture.failOutbox();

		await expect(fixture.transaction(() => fixture.execute())).rejects.toThrow(
			"injected:outbox",
		);

		expect(fixture.requests).toHaveLength(0);
		expect(fixture.workflows).toHaveLength(0);
		expect(fixture.projections).toHaveLength(0);
		expect(fixture.outbox).toHaveLength(0);
		expect(fixture.order).toHaveLength(0);
	});

	it.each(
		(["shadow", "ready"] as const).flatMap((mode) =>
			(
				[
					["legacy_mutation", "requestCount"],
					["capture_after", "captureCount"],
					["observed_root", "rootCount"],
					["observed_event", "eventCount"],
					["projection", "projectionCount"],
					["outbox", "outboxCount"],
					["source_binding", "sourceWorkflowId"],
				] as const
			).map(([point, evidenceKey]) => ({ mode, point, evidenceKey })),
		),
	)(
		"restores full $mode submission state after $point with nonempty failure evidence",
		async ({ mode, point, evidenceKey }) => {
			const fixture = observedSubmissionHarness(mode);
			const before = fixture.durableSnapshot();
			fixture.injectFailure(point);

			await expect(
				fixture.transaction(() => fixture.execute()),
			).rejects.toThrow(
				point === "capture_after"
					? /legacy approval state capture failed/i
					: `injected:${point}`,
			);

			const evidence = requiredValue(fixture.failureEvidence() ?? undefined);
			expect(evidence[evidenceKey]).toBeTruthy();
			expect(evidence.state).not.toEqual(before);
			expect(fixture.durableSnapshot()).toEqual(before);
			expect(markEmployeeWorkBalanceDirty).not.toHaveBeenCalled();
			expect(onTimeCorrectionApproved).not.toHaveBeenCalled();
			expect(onTimeCorrectionRejected).not.toHaveBeenCalled();
		},
	);

	it.each(["shadow", "ready"] as const)(
		"restores full %s auto-terminal submission state after finalizer mutation",
		async (mode) => {
			const fixture = observedSubmissionHarness(mode, true);
			const before = fixture.durableSnapshot();
			fixture.injectFailure("finalizer");

			await expect(
				fixture.transaction(() => fixture.execute()),
			).rejects.toThrow("injected:finalizer");

			const evidence = requiredValue(fixture.failureEvidence() ?? undefined);
			expect(evidence).toMatchObject({
				terminalFinalizations: 1,
				originalSuperseded: true,
				correctionSuperseded: false,
			});
			expect(evidence.state).not.toEqual(before);
			expect(fixture.durableSnapshot()).toEqual(before);
			expect(markEmployeeWorkBalanceDirty).not.toHaveBeenCalled();
			expect(onTimeCorrectionApproved).not.toHaveBeenCalled();
			expect(onTimeCorrectionRejected).not.toHaveBeenCalled();
		},
	);

	it.each(
		(["shadow", "ready"] as const).flatMap((mode) =>
			(
				[
					["legacy_mutation", "requestCount"],
					["capture_after", "captureCount"],
					["observed_root", "rootCount"],
					["observed_event", "eventCount"],
					["projection", "projectionCount"],
					["outbox", "outboxCount"],
					["finalizer", "terminalFinalizations"],
				] as const
			).map(([point, evidenceKey]) => ({ mode, point, evidenceKey })),
		),
	)("restores full $mode decision state after $point with nonempty failure evidence", async ({
		mode,
		point,
		evidenceKey,
	}) => {
		const fixture = observedSubmissionHarness(mode);
		await fixture.transaction(() => fixture.execute());
		const before = fixture.durableSnapshot();
		fixture.injectFailure(point);

		await expect(fixture.decide("approve")).rejects.toThrow(
			point === "capture_after"
				? /legacy approval state capture failed/i
				: `injected:${point}`,
		);

		const evidence = requiredValue(fixture.failureEvidence() ?? undefined);
		expect(evidence[evidenceKey]).toBeTruthy();
		expect(evidence.state).not.toEqual(before);
		expect(fixture.durableSnapshot()).toEqual(before);
		expect(markEmployeeWorkBalanceDirty).not.toHaveBeenCalled();
		expect(onTimeCorrectionApproved).not.toHaveBeenCalled();
		expect(onTimeCorrectionRejected).not.toHaveBeenCalled();
	});

	it("restores request, chain, and stage stores after an actual intermediate chain-status failure", async () => {
		const fixture = observedSubmissionHarness("legacy");
		await fixture.transaction(() => fixture.execute());
		fixture.configureSequentialChain();
		const before = fixture.durableSnapshot();
		fixture.injectFailure("chain_status");

		await expect(fixture.decide("approve")).rejects.toThrow(
			"injected:chain_status",
		);

		const evidence = requiredValue(fixture.failureEvidence() ?? undefined);
		expect(evidence.chainStageCount).toBe(2);
		expect(evidence.chainStageStatus).toBe("approved");
		expect(evidence.state).not.toEqual(before);
		expect(fixture.durableSnapshot()).toEqual(before);
		expect(markEmployeeWorkBalanceDirty).not.toHaveBeenCalled();
		expect(onTimeCorrectionApproved).not.toHaveBeenCalled();
		expect(onTimeCorrectionRejected).not.toHaveBeenCalled();
	});

	it.each([
		"shadow",
		"ready",
	] as const)("commits expected full %s observed submission and decision state control", async (mode) => {
		const fixture = observedSubmissionHarness(mode);
		const empty = fixture.durableSnapshot();
		await fixture.transaction(() => fixture.execute());
		const submitted = fixture.durableSnapshot();
		expect(submitted).not.toEqual(empty);
		expect(fixture.requests).toHaveLength(1);
		expect(fixture.workflows.size).toBe(1);
		expect(fixture.observedEvents.length).toBeGreaterThan(0);
		expect(fixture.projections.length).toBeGreaterThan(0);
		expect(fixture.outbox.length).toBeGreaterThan(0);

		await fixture.decide("approve");

		expect(fixture.durableSnapshot()).not.toEqual(submitted);
		expect(fixture.requests[0]?.status).toBe("approved");
		expect([...fixture.workflows.values()][0]?.status).toBe("approved");
		expect(fixture.terminalFinalizations()).toBe(1);
	});

	it.each([
		"shadow",
		"ready",
	] as const)("observes one actual requester auto-finalization in %s mode", async (mode) => {
		const fixture = observedSubmissionHarness(mode, true);

		const result = await fixture.execute();

		expect(result).toMatchObject({
			kind: "auto_completed",
			reason: "requester_is_approver",
			postCommit: {
				authority: "legacy",
				terminal: {
					kind: "approved",
					requesterEmployeeId: fixture.ids.requester,
				},
			},
		});
		expect(fixture.acquire).toHaveBeenCalledOnce();
		expect(fixture.requests).toHaveLength(1);
		expect(fixture.workflows).toHaveLength(1);
		expect(fixture.order.filter((entry) => entry === "mutate")).toHaveLength(1);
		expect(
			fixture.order.filter((entry) => entry === "capture-before"),
		).toHaveLength(1);
		expect(
			fixture.order.filter((entry) => entry === "capture-after"),
		).toHaveLength(1);
		expect(fixture.order.filter((entry) => entry === "observe")).toHaveLength(
			1,
		);
		expect(
			fixture.order.filter((entry) => entry === "projection"),
		).toHaveLength(1);
		expect(fixture.order.filter((entry) => entry === "bind")).toHaveLength(1);
		expect(fixture.outbox.length).toBeGreaterThan(0);
		expect(fixture.terminalFinalizations()).toBe(1);
	});

	it.each(
		(["legacy", "shadow", "ready"] as const).flatMap((mode) => [
			{ mode, action: "approve" as const, reason: undefined },
			{
				mode,
				action: "reject" as const,
				reason: "Correction evidence is insufficient",
			},
		]),
	)("executes an actual $mode $action decision through shared mutation and finalization", async ({
		mode,
		action,
		reason,
	}) => {
		const fixture = observedSubmissionHarness(mode);
		await fixture.execute();
		expect(fixture.requests.at(-1)?.metadata).toMatchObject({
			timeCorrection: {
				action: "edit",
				clockInCorrectionId: fixture.ids.correction,
			},
		});
		const observationsBefore = fixture.order.filter(
			(entry) => entry === "observe",
		).length;

		const decision = await fixture.decide(action, reason);
		const request = requiredValue(fixture.requests.at(-1));

			expect(request.status).toBe(
				action === "approve" ? "approved" : "rejected",
			);
			expect(decision).toMatchObject({
				kind: "time_correction",
				postCommit: {
					authority: "legacy",
					terminal: {
						kind: action === "approve" ? "approved" : "rejected",
						requesterEmployeeId: fixture.ids.requester,
					},
				},
			});
			if (mode === "legacy") {
				expect(fixture.workflows).toHaveLength(0);
				expect(
					fixture.order.filter((entry) => entry === "observe"),
				).toHaveLength(0);
			} else {
				expect(
					fixture.order.filter((entry) => entry === "observe"),
				).toHaveLength(observationsBefore + 1);
				expect([...fixture.workflows.values()][0]?.status).toBe(
					action === "approve" ? "approved" : "rejected",
				);
				expect(fixture.order.filter((entry) => entry === "bind")).toHaveLength(
					1,
				);
			}
			expect(fixture.terminalFinalizations()).toBe(
				action === "approve" ? 1 : 0,
			);
		},
	);

	it.each([
		"legacy",
		"shadow",
		"ready",
	] as const)("rejects a missing transactional member before %s decision mutation", async (mode) => {
		const fixture = observedSubmissionHarness(mode);
		await fixture.execute();
		fixture.setMembershipRows([]);
		const before = structuredClone(fixture.requests);

		await expect(fixture.decide("approve")).rejects.toMatchObject({
			_tag: "NotFoundError",
		});
		expect(fixture.requests).toEqual(before);
		expect(fixture.terminalFinalizations()).toBe(0);
	});

	it.each(["legacy", "shadow", "ready"] as const)(
		"rejects a changed transactional actor before %s decision mutation",
		async (mode) => {
			const fixture = observedSubmissionHarness(mode);
			await fixture.execute();
			fixture.setDecisionActorRows([
				{
					id: "31000000-0000-4000-8000-000000000999",
					organizationId: "org-1",
					userId: "user-manager",
					isActive: true,
					user: { id: "user-manager" },
				},
			]);
			const before = structuredClone(fixture.requests);

			await expect(fixture.decide("approve")).rejects.toMatchObject({
				_tag: "NotFoundError",
			});
			expect(fixture.requests).toEqual(before);
			expect(fixture.terminalFinalizations()).toBe(0);
		},
	);

	it.each(["legacy", "shadow", "ready"] as const)(
		"rejects a stale selected request before %s decision mutation",
		async (mode) => {
			const fixture = observedSubmissionHarness(mode);
			await fixture.execute();
			const request = requiredValue(fixture.requests.at(-1));
			request.status = "approved";
			request.approvedAt = new Date("2026-07-20T11:00:00.000Z");

			await expect(fixture.decide("approve")).rejects.toMatchObject({
				conflictType: "approval_status",
			});
			expect(fixture.terminalFinalizations()).toBe(0);
		},
	);

	it("runs actual sequential legacy request-chain mutation and finalizes only the terminal stage", async () => {
		const fixture = observedSubmissionHarness("legacy");
		await fixture.execute();
		fixture.configureSequentialChain();
		markEmployeeWorkBalanceDirty.mockClear();
		onTimeCorrectionApproved.mockClear();

		const intermediate = await fixture.decide("approve");
		const nextRequest = requiredValue(fixture.requests.at(-1));

		expect(intermediate.domainResult).toBeUndefined();
		expect(fixture.requests[0]?.status).toBe("approved");
		expect(nextRequest).toMatchObject({
			status: "pending",
			approverId: fixture.ids.manager,
			entityId: fixture.ids.period,
		});
		expect(fixture.chains[0]).toMatchObject({
			status: "pending",
			currentStageOrder: 2,
		});
		expect(fixture.terminalFinalizations()).toBe(0);
		expect(markEmployeeWorkBalanceDirty).not.toHaveBeenCalled();
		expect(onTimeCorrectionApproved).not.toHaveBeenCalled();

		const terminal = await fixture.decide(
			"approve",
			undefined,
			String(nextRequest.id),
		);

		expect(terminal.kind).toBe("time_correction");
		expect(fixture.chains[0]?.status).toBe("approved");
		expect(fixture.chainRows.map((row) => row.status)).toEqual([
			"approved",
			"approved",
		]);
		expect(fixture.terminalFinalizations()).toBe(1);
	});

	it.each(["legacy", "shadow", "ready"] as const)(
		"persists strict current correction metadata through the %s boundary",
		async (mode) => {
			const fixture = observedSubmissionHarness(mode);
			await fixture.execute(undefined, undefined, {
				action: "edit",
				clockInCorrectionId: fixture.ids.correction,
				workLocationType: "home",
				workCategoryId: null,
			});

			expect(fixture.requests.at(-1)?.metadata).toMatchObject({
				timeCorrection: {
					action: "edit",
					clockInCorrectionId: fixture.ids.correction,
					workLocationType: "home",
					workCategoryId: null,
				},
			});
		},
	);

	it.each(["shadow", "ready"] as const)(
		"preserves initial work metadata display evidence after %s approval",
		async (mode) => {
			const fixture = observedSubmissionHarness(mode);
			const correction = {
				action: "edit" as const,
				workLocationType: "home" as const,
				workCategoryId: "71000000-0000-4000-8000-000000000903",
			};
			await fixture.execute(undefined, undefined, correction);
			const pending = [...fixture.workflows.values()][0];

			expect(pending?.displaySnapshot).toMatchObject({
				status: "pending",
				workMetadata: {
					original: {
						workLocationType: "office",
						workCategoryId: "71000000-0000-4000-8000-000000000902",
					},
					requested: {
						workLocationType: "home",
						workCategoryId: correction.workCategoryId,
					},
				},
			});

			await fixture.decide("approve");
			const terminal = [...fixture.workflows.values()][0];
			const terminalProjection = fixture.projections.at(-1) as {
				status?: string;
				displayPayload?: unknown;
			};

			expect(terminal?.status).toBe("approved");
			expect(terminal?.displaySnapshot).toEqual({
				...pending?.displaySnapshot,
				status: "approved",
			});
			expect(terminalProjection).toMatchObject({
				status: "approved",
				displayPayload: terminal?.displaySnapshot,
			});
		},
	);

	it.each(["legacy", "shadow", "ready"] as const)(
		"creates and replays a strict metadata-only edit through the %s boundary",
		async (mode) => {
			const fixture = observedSubmissionHarness(mode);
			const correction = {
				action: "edit",
				workLocationType: "remote" as const,
				workCategoryId: null,
			};
			const first = await fixture.execute(undefined, undefined, correction);
			const replay = await fixture.execute(undefined, undefined, correction);

			expect(first.disposition).toBe("executed");
			expect(replay.disposition).toBe("replayed");
			expect(fixture.requests).toHaveLength(1);
			expect(fixture.requests.at(-1)?.metadata).toMatchObject({
				timeCorrection: correction,
			});
			await expect(
				fixture.execute(undefined, undefined, {
					...correction,
					workLocationType: "home",
				}),
			).rejects.toMatchObject({
				conflictType: "pending_time_correction_approval",
			});
		},
	);

	it.each(["legacy", "shadow", "ready"] as const)(
		"auto-completes metadata-only edits once and rejects their stale %s replay",
		async (mode) => {
			const fixture = observedSubmissionHarness(mode, true);
			const correction = {
				action: "edit" as const,
				workLocationType: "remote" as const,
				workCategoryId: null,
			};

			const first = await fixture.execute(undefined, undefined, correction);
			await expect(
				fixture.execute(undefined, undefined, correction),
			).rejects.toMatchObject({
				conflictType: "pending_time_correction_approval",
			});

			expect(first).toMatchObject({
				disposition: "executed",
				kind: "auto_completed",
			});
			expect(fixture.requests).toHaveLength(1);
			expect(fixture.terminalFinalizations()).toBe(1);
		},
	);

	it.each(["shadow", "ready"] as const)(
		"keeps verified original work metadata in the initial terminal display in %s mode",
		async (mode) => {
			const fixture = observedSubmissionHarness(mode, true);
			const correction = {
				action: "edit" as const,
				workLocationType: "home" as const,
				workCategoryId: "71000000-0000-4000-8000-000000000903",
			};

			const result = await fixture.execute(undefined, undefined, correction);
			const terminal = [...fixture.workflows.values()][0];

			expect(result.kind).toBe("auto_completed");
			expect(fixture.terminalFinalizations()).toBe(1);
			expect(terminal?.displaySnapshot).toMatchObject({
				status: "approved",
				workMetadata: {
					original: {
						workLocationType: "office",
						workCategoryId: "71000000-0000-4000-8000-000000000902",
					},
					requested: {
						workLocationType: "home",
						workCategoryId: correction.workCategoryId,
					},
				},
			});
		},
	);

	it("creates a legacy-authoritative submission through the real policy resolver", async () => {
		const { dbService, inserts } = createPolicyResolutionDbService([]);
		const findFirst = dbService.db.query.approvalRequest
			.findFirst as ReturnType<typeof vi.fn>;
		findFirst
			.mockResolvedValueOnce(null)
			.mockResolvedValue({ approverId: "emp-manager" });
		dbService.db.query.approvalRequest.findMany = vi.fn().mockResolvedValue([]);
		const acquire = vi.fn().mockResolvedValue({
			mode: "legacy",
			behavior: {
				serveFrom: "legacy",
				writeLegacy: true,
				writeCanonical: false,
				decideCanonical: false,
				mirror: "none",
			},
		});
		const context = {
			dbService,
			writeGate: { acquire },
			compatibilityWriter: {
				withWriteGate() {
					return this;
				},
				mirrorLegacyToCanonical: vi.fn(),
				mirrorCanonicalToLegacy: vi.fn(),
			},
		} as never;

		const result = await executeTimeCorrectionSubmissionInTransaction({
			dbService,
			context,
			organizationId: "org-1",
			requesterEmployeeId: "emp-requester",
			teamId: "team-1",
			workPeriodId: "period-1",
			defaultApproverId: "emp-manager",
			reason: "Missed punch",
			overtimeRisk: null,
			submissionKey: "legacy-submission-1",
			correction: {
				action: "edit",
				clockInCorrectionId: correction.id,
			},
		});

		expect(result).toMatchObject({
			kind: "default_created",
			postCommit: {
				authority: "legacy",
				submittedToEmployeeId: "emp-manager",
			},
		});
		expect(acquire).toHaveBeenCalledOnce();
		expect(inserts).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					values: expect.objectContaining({
						organizationId: "org-1",
						entityId: "period-1",
						metadata: expect.objectContaining({
							submission: {
								key: "legacy-submission-1",
								resultKind: "default_created",
								originalStatus: "pending",
							},
							timeCorrection: {
								action: "edit",
								clockInCorrectionId: correction.id,
							},
						}),
					}),
				}),
			]),
		);
	});

	it("auto-approves a legacy requester submission through the actual finalizer once", async () => {
		const { dbService, inserts, updates } = createPolicyResolutionDbService([]);
		dbService.db.query.approvalRequest.findMany = vi.fn().mockResolvedValue([]);
		vi.mocked(dbService.db.query.approvalRequest.findFirst)
			.mockResolvedValueOnce(null)
			.mockResolvedValue({
				id: "insert-1",
				organizationId: "org-1",
				entityType: "time_entry",
				entityId: "period-1",
				requestedBy: "emp-requester",
				approverId: "emp-requester",
				status: "approved",
				reason: "Missed punch",
				approvedAt: new Date("2026-07-20T10:00:00.000Z"),
				rejectionReason: null,
				metadata: {
					timeCorrection: {
						action: "edit",
						clockInCorrectionId: correction.id,
					},
					submission: { key: "legacy-auto-submission-1" },
				},
				updatedAt: new Date("2026-07-20T10:00:00.000Z"),
			});
		const acquire = vi.fn().mockResolvedValue({
			mode: "legacy",
			behavior: {
				serveFrom: "legacy",
				writeLegacy: true,
				writeCanonical: false,
				decideCanonical: false,
				mirror: "none",
			},
		});
		const context = {
			dbService,
			writeGate: { acquire },
			compatibilityWriter: {
				withWriteGate() {
					return this;
				},
				mirrorLegacyToCanonical: vi.fn(),
				mirrorCanonicalToLegacy: vi.fn(),
			},
		} as never;

		const result = await executeTimeCorrectionSubmissionInTransaction({
			dbService,
			context,
			organizationId: "org-1",
			requesterEmployeeId: "emp-requester",
			teamId: "team-1",
			workPeriodId: "period-1",
			defaultApproverId: "emp-requester",
			reason: "Missed punch",
			overtimeRisk: null,
			submissionKey: "legacy-auto-submission-1",
			correction: {
				action: "edit",
				clockInCorrectionId: correction.id,
			},
		});

		expect(result).toMatchObject({
			kind: "auto_completed",
			reason: "requester_is_approver",
			postCommit: {
				authority: "legacy",
				terminal: {
					kind: "approved",
					dirtyFromDate: "2026-05-11",
				},
			},
		});
		expect(acquire).toHaveBeenCalledOnce();
		expect(requiredValue(inserts[0]).values).toMatchObject({
			approverId: "emp-requester",
			status: "approved",
		});
		expect(
			updates.filter((values) => values.clockInId === correction.id),
		).toHaveLength(1);
	});
});

describe("canonical time correction compatibility targets", () => {
	const workflow = {
		id: "40000000-0000-4000-8000-000000000001",
		organizationId: "org-1",
		workflowType: "time_correction",
		sourceType: "time_entry",
		sourceId: "20000000-0000-4000-8000-000000000001",
		requesterEmployeeId: "30000000-0000-4000-8000-000000000001",
		status: "pending",
		currentStageOrder: 2,
		stages: [
			{
				id: "50000000-0000-4000-8000-000000000001",
				sequence: 1,
				status: "approved",
			},
			{
				id: "50000000-0000-4000-8000-000000000002",
				sequence: 2,
				status: "pending",
			},
		],
	} as never;

	it("returns only the active current-stage compatibility request", async () => {
		const findMany = vi.fn().mockResolvedValue([
			{
				id: "legacy-stage-1",
				status: "approved",
				metadata: {
					workflow: { id: workflow.id, organizationId: "org-1" },
					stage: { id: workflow.stages[0].id, sequence: 1 },
				},
			},
			{
				id: "legacy-stage-2",
				status: "pending",
				metadata: {
					workflow: { id: workflow.id, organizationId: "org-1" },
					stage: { id: workflow.stages[1].id, sequence: 2 },
				},
			},
		]);

		await expect(
			resolveTimeCorrectionCompatibilityApprovalId({
				dbService: {
					db: { query: { approvalRequest: { findMany } } },
				} as never,
				organizationId: "org-1",
				workPeriodId: workflow.sourceId,
				workflow,
			}),
		).resolves.toBe("legacy-stage-2");
		expect(findMany).toHaveBeenCalledWith(
			expect.objectContaining({ limit: 2 }),
		);
	});

	it("rejects duplicate active current-stage compatibility rows", async () => {
		const active = {
			status: "pending",
			metadata: {
				workflow: { id: workflow.id, organizationId: "org-1" },
				stage: { id: workflow.stages[1].id, sequence: 2 },
			},
		};
		await expect(
			resolveTimeCorrectionCompatibilityApprovalId({
				dbService: {
					db: {
						query: {
							approvalRequest: {
								findMany: vi.fn().mockResolvedValue([
									{ ...active, id: "duplicate-1" },
									{ ...active, id: "duplicate-2" },
								]),
							},
						},
					},
				} as never,
				organizationId: "org-1",
				workPeriodId: workflow.sourceId,
				workflow,
			}),
		).rejects.toThrow(/active compatibility target/i);
	});

	it("uses the workflow ID for deterministic terminal replay", async () => {
		const findMany = vi.fn();
		await expect(
			resolveTimeCorrectionCompatibilityApprovalId({
				dbService: {
					db: { query: { approvalRequest: { findMany } } },
				} as never,
				organizationId: "org-1",
				workPeriodId: workflow.sourceId,
				workflow: { ...workflow, status: "approved", currentStageOrder: null },
			}),
		).resolves.toBe(workflow.id);
		expect(findMany).not.toHaveBeenCalled();
	});
});

describe("time correction decision post-commit ordering", () => {
	it.each([
		"approved",
		"rejected",
	] as const)("dispatches one legacy %s effect only after execution commits", async (kind) => {
		const calls: string[] = [];
		const effects = {
			authority: "legacy" as const,
			submittedToEmployeeId: null,
			terminal:
				kind === "approved"
					? {
							kind,
							dirtyFromDate: "2026-07-20",
							requesterEmployeeId: "employee-1",
						}
					: { kind, requesterEmployeeId: "employee-1" },
		};
		const dispatch = vi.fn(async () => {
			calls.push("effect");
		});

		await completeTimeCorrectionDecisionAfterCommit({
			execute: async () => {
				calls.push("transaction");
				calls.push("commit");
				return { postCommit: effects };
			},
			dispatch,
		});

		expect(calls).toEqual(["transaction", "commit", "effect"]);
		expect(dispatch).toHaveBeenCalledOnce();
	});

	it("does not dispatch after rollback or for canonical authority", async () => {
		const dispatch = vi.fn();
		await expect(
			completeTimeCorrectionDecisionAfterCommit({
				execute: async () => {
					throw new Error("rollback");
				},
				dispatch,
			}),
		).rejects.toThrow("rollback");
		await completeTimeCorrectionDecisionAfterCommit({
			execute: async () => ({
				postCommit: {
					authority: "canonical" as const,
					submittedToEmployeeId: null,
					terminal: null,
				},
			}),
			dispatch,
		});
		expect(dispatch).not.toHaveBeenCalled();
	});

	it("keeps a committed decision successful when best-effort delivery fails", async () => {
		const onDispatchError = vi.fn();
		const result = await completeTimeCorrectionDecisionAfterCommit({
			execute: async () => ({
				value: "committed",
				postCommit: {
					authority: "legacy" as const,
					submittedToEmployeeId: null,
					terminal: {
						kind: "rejected" as const,
						requesterEmployeeId: "employee-1",
					},
				},
			}),
			dispatch: async () => {
				throw new Error("notification unavailable");
			},
			onDispatchError,
		});
		expect(result.value).toBe("committed");
		expect(onDispatchError).toHaveBeenCalledOnce();
	});
});

describe("time correction workflow source binding", () => {
	const bindingIds = {
		period: "21000000-0000-4000-8000-000000000001",
		employee: "31000000-0000-4000-8000-000000000001",
		oldWorkflow: "41000000-0000-4000-8000-000000000001",
		newWorkflow: "41000000-0000-4000-8000-000000000002",
	};

	function collectTestBoundValues(value: unknown): unknown[] {
		if (!value || typeof value !== "object") return [];
		const candidate = value as { value?: unknown; queryChunks?: unknown[] };
		return [
			...(Object.hasOwn(candidate, "value") ? [candidate.value] : []),
			...(candidate.queryChunks?.flatMap(collectTestBoundValues) ?? []),
		];
	}

	function bindingDb(input: {
		linkedWorkflowId: string | null;
		oldStatus?: string;
		oldVersion?: number;
		oldCompletedAt?: Date | null;
		oldCancelledAt?: Date | null;
		oldCurrentStageOrder?: number | null;
		newStatus?: string;
		oldOrganizationId?: string;
		newOrganizationId?: string;
		oldSourceId?: string;
		newSourceId?: string;
		oldWorkflowType?: string;
		newWorkflowType?: string;
		oldSourceType?: string;
		newSourceType?: string;
		oldSubmittedAt?: Date;
		newSubmittedAt?: Date;
		updatedRows?: Array<Record<string, unknown>>;
	}) {
		const period = {
			id: bindingIds.period,
			organizationId: "org-1",
			employeeId: bindingIds.employee,
			approvalWorkflowId: input.linkedWorkflowId,
		};
		const workflows = new Map([
			[
				bindingIds.oldWorkflow,
				{
					id: bindingIds.oldWorkflow,
					organizationId: input.oldOrganizationId ?? "org-1",
					workflowType: input.oldWorkflowType ?? "time_correction",
					sourceType: input.oldSourceType ?? "time_entry",
					sourceId: input.oldSourceId ?? bindingIds.period,
					requesterEmployeeId: bindingIds.employee,
					status: input.oldStatus ?? "approved",
					version: input.oldVersion ?? 2,
					submittedAt: input.oldSubmittedAt ?? new Date("2026-07-18T09:00:00Z"),
					completedAt:
						input.oldCompletedAt === undefined
							? new Date("2026-07-18T10:00:00Z")
							: input.oldCompletedAt,
					cancelledAt:
						input.oldCancelledAt === undefined
							? input.oldStatus === "cancelled"
								? new Date("2026-07-18T10:00:00Z")
								: null
							: input.oldCancelledAt,
					currentStageOrder:
						input.oldCurrentStageOrder === undefined
							? null
							: input.oldCurrentStageOrder,
				},
			],
			[
				bindingIds.newWorkflow,
				{
					id: bindingIds.newWorkflow,
					organizationId: input.newOrganizationId ?? "org-1",
					workflowType: input.newWorkflowType ?? "time_correction",
					sourceType: input.newSourceType ?? "time_entry",
					sourceId: input.newSourceId ?? bindingIds.period,
					requesterEmployeeId: bindingIds.employee,
					status: input.newStatus ?? "pending",
					version: 1,
					submittedAt: input.newSubmittedAt ?? new Date("2026-07-20T09:00:00Z"),
					completedAt: null,
					cancelledAt: null,
					currentStageOrder: 1,
				},
			],
		]);
		const updates: Array<{ values: unknown; where: unknown }> = [];
		const locks: unknown[] = [];
		const db = {
			select: vi.fn(() => ({
				from: vi.fn(() => ({
					where: vi.fn((where) => ({
						for: vi.fn(() => {
							locks.push(where);
							return [period];
						}),
					})),
				})),
			})),
			query: {
				approvalWorkflow: {
					findFirst: vi.fn(async (queryInput: unknown) => {
						const values = collectTestBoundValues(
							(queryInput as { where?: unknown }).where,
						);
						return [...workflows.values()].find((row) =>
							values.includes(row.id),
						);
					}),
				},
			},
			update: vi.fn(() => ({
				set: vi.fn((values) => ({
					where: vi.fn((where) => {
						updates.push({ values, where });
						return {
							returning: vi.fn().mockResolvedValue(
								input.updatedRows ?? [
									{
										...period,
										approvalWorkflowId: bindingIds.newWorkflow,
									},
								],
							),
						};
					}),
				})),
			})),
		};
		return {
			dbService: { db } as unknown as ApprovalDbService,
			locks,
			updates,
		};
	}

	const bindingInput = (dbService: ApprovalDbService, workflowId: string) => ({
		dbService,
		organizationId: "org-1",
		workPeriodId: bindingIds.period,
		employeeId: bindingIds.employee,
		workflowId,
	});

	it("binds an exact new workflow to a locked null source with one CAS row", async () => {
		const fixture = bindingDb({ linkedWorkflowId: null });
		await bindTimeCorrectionWorkflowToWorkPeriod(
			bindingInput(fixture.dbService, bindingIds.newWorkflow),
		);
		expect(fixture.locks).toHaveLength(1);
		expect(fixture.updates).toHaveLength(1);
		expect(fixture.updates[0]?.values).toEqual({
			approvalWorkflowId: bindingIds.newWorkflow,
		});
	});

	it("verifies exact replay without updating the source", async () => {
		const fixture = bindingDb({ linkedWorkflowId: bindingIds.newWorkflow });
		await verifyTimeCorrectionWorkflowBinding(
			bindingInput(fixture.dbService, bindingIds.newWorkflow),
		);
		await bindTimeCorrectionWorkflowToWorkPeriod(
			bindingInput(fixture.dbService, bindingIds.newWorkflow),
		);
		expect(fixture.updates).toEqual([]);
	});

	it.each([
		"approved",
		"rejected",
		"cancelled",
		"expired",
	])("replaces an exact %s prior workflow and preserves its history row", async (oldStatus) => {
		const fixture = bindingDb({
			linkedWorkflowId: bindingIds.oldWorkflow,
			oldStatus,
		});
		await bindTimeCorrectionWorkflowToWorkPeriod(
			bindingInput(fixture.dbService, bindingIds.newWorkflow),
		);
		expect(fixture.updates).toHaveLength(1);
	});

	it.each([
		["nonpositive version", { oldVersion: 0 }],
		["unsafe version", { oldVersion: Number.MAX_SAFE_INTEGER + 1 }],
		["missing completion", { oldCompletedAt: null }],
		["retained current stage", { oldCurrentStageOrder: 1 }],
		[
			"cancelled status without cancellation timestamp",
			{ oldStatus: "cancelled", oldCancelledAt: null },
		],
		[
			"non-cancelled status with cancellation timestamp",
			{ oldCancelledAt: new Date("2026-07-18T10:00:00Z") },
		],
		[
			"completion before submission",
			{ oldCompletedAt: new Date("2026-07-18T08:59:59Z") },
		],
		[
			"new submission before prior completion",
			{ newSubmittedAt: new Date("2026-07-18T09:30:00Z") },
		],
		[
			"cancellation before submission",
			{
				oldStatus: "cancelled",
				oldCancelledAt: new Date("2026-07-18T08:59:59Z"),
			},
		],
	] as const)("rejects a linked terminal root with %s", async (_label, malformed) => {
		const fixture = bindingDb({
			linkedWorkflowId: bindingIds.oldWorkflow,
			...malformed,
		});
		await expect(
			bindTimeCorrectionWorkflowToWorkPeriod(
				bindingInput(fixture.dbService, bindingIds.newWorkflow),
			),
		).rejects.toThrow(/binding/i);
		expect(fixture.updates).toEqual([]);
	});

	it("accepts a new cycle submitted exactly when the prior cycle completed", async () => {
		const boundary = new Date("2026-07-18T10:00:00Z");
		const fixture = bindingDb({
			linkedWorkflowId: bindingIds.oldWorkflow,
			oldCompletedAt: boundary,
			newSubmittedAt: boundary,
		});
		await bindTimeCorrectionWorkflowToWorkPeriod(
			bindingInput(fixture.dbService, bindingIds.newWorkflow),
		);
		expect(fixture.updates).toHaveLength(1);
	});

	it.each([
		[
			"different pending link",
			{ linkedWorkflowId: bindingIds.oldWorkflow, oldStatus: "pending" },
		],
		[
			"foreign prior workflow",
			{ linkedWorkflowId: bindingIds.oldWorkflow, oldOrganizationId: "org-2" },
		],
		[
			"wrong prior type",
			{ linkedWorkflowId: bindingIds.oldWorkflow, oldWorkflowType: "absence" },
		],
		[
			"wrong prior source",
			{
				linkedWorkflowId: bindingIds.oldWorkflow,
				oldSourceId: "21000000-0000-4000-8000-000000000099",
			},
		],
		[
			"foreign new workflow",
			{ linkedWorkflowId: null, newOrganizationId: "org-2" },
		],
		[
			"wrong new type",
			{ linkedWorkflowId: null, newWorkflowType: "manual_time_submission" },
		],
		[
			"wrong new alias",
			{ linkedWorkflowId: null, newSourceType: "work_period" },
		],
		[
			"wrong new source",
			{
				linkedWorkflowId: null,
				newSourceId: "21000000-0000-4000-8000-000000000099",
			},
		],
		[
			"stale old terminal replay",
			{
				linkedWorkflowId: bindingIds.newWorkflow,
				oldSubmittedAt: new Date("2026-07-18T09:00:00Z"),
				newSubmittedAt: new Date("2026-07-20T09:00:00Z"),
			},
			bindingIds.oldWorkflow,
		],
	] as const)("rejects %s", async (_label, options, requestedWorkflow = bindingIds.newWorkflow) => {
		const fixture = bindingDb(options);
		await expect(
			bindTimeCorrectionWorkflowToWorkPeriod(
				bindingInput(fixture.dbService, requestedWorkflow),
			),
		).rejects.toThrow(/binding/i);
		expect(fixture.updates).toEqual([]);
	});

	it.each([
		{ updatedRows: [] },
		{ updatedRows: [{ id: bindingIds.period }, { id: bindingIds.period }] },
	])("rejects a source-binding CAS returning %# rows", async ({
		updatedRows,
	}) => {
		const fixture = bindingDb({ linkedWorkflowId: null, updatedRows });
		await expect(
			bindTimeCorrectionWorkflowToWorkPeriod(
				bindingInput(fixture.dbService, bindingIds.newWorkflow),
			),
		).rejects.toThrow(/binding/i);
	});

	it("fails stale verification after the source link has moved", async () => {
		const fixture = bindingDb({ linkedWorkflowId: bindingIds.newWorkflow });
		await expect(
			verifyTimeCorrectionWorkflowBinding(
				bindingInput(fixture.dbService, bindingIds.oldWorkflow),
			),
		).rejects.toThrow(/binding/i);
		expect(fixture.updates).toEqual([]);
	});
});

describe("deleteCancelledTimeCorrectionsInTransaction", () => {
	const cancellationIds = {
		period: "22000000-0000-4000-8000-000000000001",
		employee: "32000000-0000-4000-8000-000000000001",
		workflow: "42000000-0000-4000-8000-000000000001",
		canonical: "52000000-0000-4000-8000-000000000001",
		originalIn: "62000000-0000-4000-8000-000000000001",
		originalOut: "62000000-0000-4000-8000-000000000002",
		correctionIn: "72000000-0000-4000-8000-000000000001",
		correctionOut: "72000000-0000-4000-8000-000000000002",
		priorIn: "72000000-0000-4000-8000-000000000003",
		priorOut: "72000000-0000-4000-8000-000000000004",
	};
	const originalIn = {
		id: cancellationIds.originalIn,
		organizationId: "org-1",
		employeeId: cancellationIds.employee,
		type: "clock_in",
		timestamp: new Date("2026-07-19T06:00:00.000Z"),
		utcOffsetMinutes: 120,
		timezone: "Europe/Berlin",
		timezoneSource: "browser",
		replacesEntryId: null,
		isSuperseded: false,
		supersededById: null,
	};
	const originalOut = {
		...originalIn,
		id: cancellationIds.originalOut,
		type: "clock_out",
		timestamp: new Date("2026-07-19T14:00:00.000Z"),
	};
	const correctionIn = {
		...originalIn,
		id: cancellationIds.correctionIn,
		type: "correction",
		replacesEntryId: cancellationIds.originalIn,
		isSuperseded: true,
	};
	const correctionOut = {
		...originalOut,
		id: cancellationIds.correctionOut,
		type: "correction",
		replacesEntryId: cancellationIds.originalOut,
		isSuperseded: true,
	};
	const cancellationCorrection = {
		action: "edit" as const,
		clockInCorrectionId: cancellationIds.correctionIn,
		clockOutCorrectionId: cancellationIds.correctionOut,
	};
	const cancellationCanonical = {
		id: cancellationIds.canonical,
		organizationId: "org-1",
		employeeId: cancellationIds.employee,
		recordKind: "work",
		startAt: originalIn.timestamp,
		endAt: originalOut.timestamp,
		durationMinutes: 480,
		approvalState: "approved",
	};
	const cancellationCanonicalWork = {
		recordId: cancellationIds.canonical,
		organizationId: "org-1",
		recordKind: "work",
		workLocationType: "office",
		workCategoryId: null,
	};
	function cancellationEntryEvidence(
		entry: typeof originalIn,
		logicalRole: "clock_in" | "clock_out",
	) {
		return {
			id: entry.id,
			organizationId: entry.organizationId,
			employeeId: entry.employeeId,
			logicalRole,
			type: entry.type as "clock_in" | "clock_out" | "correction",
			replacesEntryId: entry.replacesEntryId,
			timestamp: parseInstant(entry.timestamp.toISOString()),
			utcOffsetMinutes: entry.utcOffsetMinutes,
			timezone: entry.timezone,
			timezoneSource: entry.timezoneSource,
			isSuperseded: entry.isSuperseded,
			supersededById: entry.supersededById,
		};
	}
	const cancellationExpectedSource = {
		employeeId: cancellationIds.employee,
		approvalWorkflowId: cancellationIds.workflow,
		canonicalRecordId: cancellationIds.canonical,
		workLocationType: "office" as const,
		workCategoryId: null,
		clockInId: cancellationIds.originalIn,
		clockOutId: cancellationIds.originalOut,
		startTime: parseInstant("2026-07-19T06:00:00Z"),
		endTime: parseInstant("2026-07-19T14:00:00Z"),
		durationMinutes: 480,
		isActive: false,
		approvalStatus: "approved" as const,
		pendingChanges: null,
		canonicalRecord: {
			id: cancellationIds.canonical,
			employeeId: cancellationIds.employee,
			recordKind: "work" as const,
			startAt: parseInstant("2026-07-19T06:00:00Z"),
			endAt: parseInstant("2026-07-19T14:00:00Z"),
			durationMinutes: 480,
			approvalState: "approved" as const,
		},
		canonicalWork: cancellationCanonicalWork,
		currentEndpoints: {
			clockIn: cancellationEntryEvidence(originalIn, "clock_in"),
			clockOut: cancellationEntryEvidence(originalOut, "clock_out"),
		},
		pendingCorrections: {
			clockIn: cancellationEntryEvidence(correctionIn, "clock_in"),
			clockOut: cancellationEntryEvidence(correctionOut, "clock_out"),
		},
	};

	function collectCancellationBoundValues(value: unknown): unknown[] {
		if (!value || typeof value !== "object") return [];
		const candidate = value as { value?: unknown; queryChunks?: unknown[] };
		return [
			...(Object.hasOwn(candidate, "value") ? [candidate.value] : []),
			...(candidate.queryChunks?.flatMap(collectCancellationBoundValues) ?? []),
		];
	}

	function cancellationDb(
		options: {
			employee?: Record<string, unknown>;
			period?: Record<string, unknown>;
			canonical?: Record<string, unknown>;
			canonicalWork?: Record<string, unknown>;
			entries?: Array<Record<string, unknown>>;
			historicalEntries?: Array<Record<string, unknown>>;
			deleteRows?: Array<Record<string, unknown>>;
		} = {},
	) {
		const lockedEmployee = options.employee ?? {
			id: cancellationIds.employee,
			organizationId: "org-1",
			isActive: true,
		};
		const period = options.period ?? {
			id: cancellationIds.period,
			organizationId: "org-1",
			employeeId: cancellationIds.employee,
			clockInId: cancellationIds.originalIn,
			clockOutId: cancellationIds.originalOut,
			canonicalRecordId: cancellationIds.canonical,
			approvalWorkflowId: cancellationIds.workflow,
			startTime: originalIn.timestamp,
			endTime: originalOut.timestamp,
			durationMinutes: 480,
			isActive: false,
			approvalStatus: "approved",
			pendingChanges: null,
			workLocationType: "office",
			workCategoryId: null,
			deletedAt: null,
		};
		const canonical = options.canonical ?? cancellationCanonical;
		const canonicalWork = options.canonicalWork ?? cancellationCanonicalWork;
		const entries = options.entries ?? [
			originalIn,
			originalOut,
			correctionIn,
			correctionOut,
		];
		const deleteRows = options.deleteRows ?? [
			{ id: cancellationIds.correctionIn },
			{ id: cancellationIds.correctionOut },
		];
		const locks: Array<{ table: unknown; where: unknown }> = [];
		const deletes: Array<{ table: unknown; where: unknown }> = [];
		const transaction = vi.fn();
		const update = vi.fn();
		let timeEntryLockCount = 0;
		const db = {
			transaction,
			update,
			select: vi.fn(() => ({
				from: vi.fn((table: unknown) => ({
					where: vi.fn((where: unknown) => {
						const finish = vi.fn(async () => {
							locks.push({ table, where });
							if (table === employee) return [lockedEmployee];
							if (table === workPeriod) return [period];
							if (table === timeRecord) return [canonical];
							if (table === timeRecordWork) return [canonicalWork];
							const rows =
								timeEntryLockCount === 0
									? entries
									: (options.historicalEntries ?? []);
							timeEntryLockCount += 1;
							return rows;
						});
						return {
							for: finish,
							orderBy: vi.fn(() => ({ for: finish })),
						};
					}),
				})),
			})),
			delete: vi.fn((table: unknown) => ({
				where: vi.fn((where: unknown) => {
					deletes.push({ table, where });
					return {
						returning: vi.fn().mockResolvedValue(deleteRows),
					};
				}),
			})),
		};
		return {
			dbService: { db } as unknown as ApprovalDbService,
			locks,
			deletes,
			transaction,
			update,
		};
	}

	function cancellationInput(
		dbService: ApprovalDbService,
		correction = cancellationCorrection,
		expectedSource = cancellationExpectedSource,
	) {
		return {
			dbService,
			organizationId: "org-1",
			workPeriodId: cancellationIds.period,
			expectedSource,
			correction,
		};
	}

	it("deletes the exact pending correction set with one scoped mutation", async () => {
		const fixture = cancellationDb();
		await deleteCancelledTimeCorrectionsInTransaction(
			cancellationInput(fixture.dbService),
		);

		expect(fixture.locks.map((item) => item.table)).toEqual([
			employee,
			workPeriod,
			timeEntry,
			timeRecord,
			timeRecordWork,
		]);
		expect(fixture.deletes.map((item) => item.table)).toEqual([timeEntry]);
		const deletion = new PgDialect().sqlToQuery(
			fixture.deletes[0]?.where as SQL,
		);
		expect(deletion.sql).toContain('"time_entry"."organization_id" = $1');
		expect(deletion.sql).toContain('"time_entry"."employee_id" = $2');
		expect(deletion.sql).toContain('"time_entry"."type" = $3');
		expect(deletion.sql).toContain('"time_entry"."is_superseded" = $4');
		expect(deletion.sql).toContain(
			'"time_entry"."superseded_by_id" is null',
		);
		expect(deletion.sql).toContain(
			'("time_entry"."id" = $5 and "time_entry"."replaces_entry_id" = $6) or ("time_entry"."id" = $7 and "time_entry"."replaces_entry_id" = $8)',
		);
		expect(deletion.params).toEqual([
			"org-1",
			cancellationIds.employee,
			"correction",
			true,
			cancellationIds.correctionIn,
			cancellationIds.originalIn,
			cancellationIds.correctionOut,
			cancellationIds.originalOut,
		]);
		expect(fixture.update).not.toHaveBeenCalled();
		expect(fixture.transaction).not.toHaveBeenCalled();
	});

	it("verifies unchanged metadata and skips deletion for metadata-only cancellation", async () => {
		const period = {
			id: cancellationIds.period,
			organizationId: "org-1",
			employeeId: cancellationIds.employee,
			clockInId: cancellationIds.originalIn,
			clockOutId: cancellationIds.originalOut,
			canonicalRecordId: cancellationIds.canonical,
			approvalWorkflowId: cancellationIds.workflow,
			startTime: originalIn.timestamp,
			endTime: originalOut.timestamp,
			durationMinutes: 480,
			isActive: false,
			approvalStatus: "approved",
			pendingChanges: null,
			workLocationType: "office",
			workCategoryId: null,
			deletedAt: null,
		};
		const canonicalWork = { ...cancellationCanonicalWork };
		const fixture = cancellationDb({
			period,
			canonicalWork,
			entries: [originalIn, originalOut],
		});

		await deleteCancelledTimeCorrectionsInTransaction(
			cancellationInput(
				fixture.dbService,
				{
					action: "edit",
					workLocationType: "remote",
					workCategoryId: null,
				},
				{
					...cancellationExpectedSource,
					pendingCorrections: { clockIn: null, clockOut: null },
				},
			),
		);

		expect(fixture.deletes).toEqual([]);
		expect(period).toMatchObject({
			workLocationType: "office",
			workCategoryId: null,
		});
		expect(canonicalWork).toMatchObject({
			workLocationType: "office",
			workCategoryId: null,
		});
	});

	it.each(["work period", "canonical work"] as const)(
		"fails metadata-only cancellation when %s metadata diverges",
		async (target) => {
			const fixture = cancellationDb({
				...(target === "work period"
					? {
							period: {
								id: cancellationIds.period,
								organizationId: "org-1",
								employeeId: cancellationIds.employee,
								clockInId: cancellationIds.originalIn,
								clockOutId: cancellationIds.originalOut,
								canonicalRecordId: cancellationIds.canonical,
								approvalWorkflowId: cancellationIds.workflow,
								startTime: originalIn.timestamp,
								endTime: originalOut.timestamp,
								durationMinutes: 480,
								isActive: false,
								approvalStatus: "approved",
								pendingChanges: null,
								workLocationType: "home",
								workCategoryId: null,
								deletedAt: null,
							},
						}
					: {
							canonicalWork: {
								...cancellationCanonicalWork,
								workLocationType: "home",
							},
						}),
				entries: [originalIn, originalOut],
			});

			await expect(
				deleteCancelledTimeCorrectionsInTransaction(
					cancellationInput(
						fixture.dbService,
						{
							action: "edit",
							workLocationType: "remote",
							workCategoryId: null,
						},
						{
							...cancellationExpectedSource,
							pendingCorrections: { clockIn: null, clockOut: null },
						},
					),
				),
			).rejects.toThrow(/source/i);
			expect(fixture.deletes).toEqual([]);
		},
	);

	it("rejects a current endpoint evidence race in a repeated correction cycle", async () => {
		const priorIn = {
			...correctionIn,
			id: cancellationIds.priorIn,
			replacesEntryId: cancellationIds.originalIn,
			isSuperseded: false,
		};
		const priorOut = {
			...correctionOut,
			id: cancellationIds.priorOut,
			replacesEntryId: cancellationIds.originalOut,
			isSuperseded: false,
		};
		const pendingIn = {
			...correctionIn,
			replacesEntryId: cancellationIds.priorIn,
		};
		const pendingOut = {
			...correctionOut,
			replacesEntryId: cancellationIds.priorOut,
		};
		const fixture = cancellationDb({
			period: {
				id: cancellationIds.period,
				organizationId: "org-1",
				employeeId: cancellationIds.employee,
				clockInId: cancellationIds.priorIn,
				clockOutId: cancellationIds.priorOut,
				canonicalRecordId: cancellationIds.canonical,
				approvalWorkflowId: cancellationIds.workflow,
				startTime: priorIn.timestamp,
				endTime: priorOut.timestamp,
				durationMinutes: 480,
				isActive: false,
				approvalStatus: "approved",
				pendingChanges: null,
				workLocationType: "office",
				workCategoryId: null,
				deletedAt: null,
			},
			entries: [
				{ ...priorIn, timestamp: new Date("2025-04-10T06:01:00Z") },
				priorOut,
				pendingIn,
				pendingOut,
			],
		});

		await expect(
			deleteCancelledTimeCorrectionsInTransaction(
				cancellationInput(fixture.dbService, cancellationCorrection, {
					...cancellationExpectedSource,
					clockInId: cancellationIds.priorIn,
					clockOutId: cancellationIds.priorOut,
					currentEndpoints: {
						clockIn: cancellationEntryEvidence(priorIn, "clock_in"),
						clockOut: cancellationEntryEvidence(priorOut, "clock_out"),
					},
					pendingCorrections: {
						clockIn: cancellationEntryEvidence(pendingIn, "clock_in"),
						clockOut: cancellationEntryEvidence(pendingOut, "clock_out"),
					},
				}),
			),
		).rejects.toThrow(/cancel/i);
		expect(fixture.deletes).toEqual([]);
	});

	it.each([
		[
			"work-period timestamp",
			{ period: { startTime: new Date("2026-07-19T06:01:00Z") } },
		],
		[
			"malformed work-period timestamp",
			{ period: { startTime: new Date(Number.NaN) } },
		],
		["work-period duration", { period: { durationMinutes: 479 } }],
		["work-period status", { period: { approvalStatus: "rejected" } }],
		[
			"work-period pending changes",
			{ period: { pendingChanges: { isManualEntry: true } } },
		],
		[
			"work-period canonical link",
			{ period: { canonicalRecordId: cancellationIds.originalIn } },
		],
		["canonical id", { canonical: { id: cancellationIds.originalIn } }],
		["canonical kind", { canonical: { recordKind: "absence" } }],
		[
			"canonical employee",
			{ canonical: { employeeId: cancellationIds.originalIn } },
		],
		[
			"canonical timestamps",
			{ canonical: { endAt: new Date("2026-07-19T14:01:00Z") } },
		],
		["canonical duration", { canonical: { durationMinutes: 479 } }],
		["canonical status", { canonical: { approvalState: "rejected" } }],
	] as const)("rejects a post-load %s race before deleting", async (_label, changes) => {
		const basePeriod = {
			id: cancellationIds.period,
			organizationId: "org-1",
			employeeId: cancellationIds.employee,
			clockInId: cancellationIds.originalIn,
			clockOutId: cancellationIds.originalOut,
			canonicalRecordId: cancellationIds.canonical,
			approvalWorkflowId: cancellationIds.workflow,
			startTime: originalIn.timestamp,
			endTime: originalOut.timestamp,
			durationMinutes: 480,
			isActive: false,
			approvalStatus: "approved",
			pendingChanges: null,
			deletedAt: null,
		};
		const fixture = cancellationDb({
			period: { ...basePeriod, ...changes.period },
			canonical: { ...cancellationCanonical, ...changes.canonical },
		});
		await expect(
			deleteCancelledTimeCorrectionsInTransaction(
				cancellationInput(fixture.dbService),
			),
		).rejects.toThrow(/cancel/i);
		expect(fixture.deletes).toEqual([]);
	});

	it.each([
		[
			"current endpoint timestamp",
			(entries: Array<Record<string, unknown>>) => {
				entries[0] = {
					...entries[0],
					timestamp: new Date("2026-07-19T06:01:00Z"),
				};
			},
		],
		[
			"current endpoint offset and zone",
			(entries: Array<Record<string, unknown>>) => {
				entries[0] = {
					...entries[0],
					utcOffsetMinutes: 0,
					timezone: "UTC",
				};
			},
		],
		[
			"current endpoint timezone source",
			(entries: Array<Record<string, unknown>>) => {
				entries[0] = { ...entries[0], timezoneSource: "backfill" };
			},
		],
		[
			"pending correction timestamp",
			(entries: Array<Record<string, unknown>>) => {
				entries[2] = {
					...entries[2],
					timestamp: new Date("2026-07-19T06:01:00Z"),
				};
			},
		],
		[
			"pending correction offset",
			(entries: Array<Record<string, unknown>>) => {
				entries[2] = { ...entries[2], utcOffsetMinutes: 60 };
			},
		],
		[
			"pending correction timezone",
			(entries: Array<Record<string, unknown>>) => {
				entries[2] = { ...entries[2], timezone: "UTC" };
			},
		],
		[
			"pending correction timezone source",
			(entries: Array<Record<string, unknown>>) => {
				entries[2] = { ...entries[2], timezoneSource: "backfill" };
			},
		],
		[
			"current endpoint id",
			(entries: Array<Record<string, unknown>>) => {
				entries[0] = { ...entries[0], id: cancellationIds.priorIn };
			},
		],
		[
			"current endpoint organization",
			(entries: Array<Record<string, unknown>>) => {
				entries[0] = { ...entries[0], organizationId: "org-2" };
			},
		],
		[
			"current endpoint employee",
			(entries: Array<Record<string, unknown>>) => {
				entries[0] = { ...entries[0], employeeId: cancellationIds.originalIn };
			},
		],
		[
			"current endpoint type",
			(entries: Array<Record<string, unknown>>) => {
				entries[0] = { ...entries[0], type: "clock_out" };
			},
		],
		[
			"current endpoint lineage",
			(entries: Array<Record<string, unknown>>) => {
				entries[0] = {
					...entries[0],
					replacesEntryId: cancellationIds.priorIn,
				};
			},
		],
		[
			"current endpoint state",
			(entries: Array<Record<string, unknown>>) => {
				entries[0] = {
					...entries[0],
					supersededById: cancellationIds.correctionIn,
				};
			},
		],
		[
			"pending correction id",
			(entries: Array<Record<string, unknown>>) => {
				entries[2] = { ...entries[2], id: cancellationIds.priorIn };
			},
		],
		[
			"pending correction organization",
			(entries: Array<Record<string, unknown>>) => {
				entries[2] = { ...entries[2], organizationId: "org-2" };
			},
		],
		[
			"pending correction employee",
			(entries: Array<Record<string, unknown>>) => {
				entries[2] = { ...entries[2], employeeId: cancellationIds.originalIn };
			},
		],
		[
			"pending correction type",
			(entries: Array<Record<string, unknown>>) => {
				entries[2] = { ...entries[2], type: "clock_in" };
			},
		],
		[
			"pending correction lineage",
			(entries: Array<Record<string, unknown>>) => {
				entries[2] = {
					...entries[2],
					replacesEntryId: cancellationIds.originalOut,
				};
			},
		],
		[
			"pending correction state",
			(entries: Array<Record<string, unknown>>) => {
				entries[2] = { ...entries[2], isSuperseded: false };
			},
		],
	] as const)("rejects a post-load %s evidence race before deleting", async (_label, mutate) => {
		const entries: Array<Record<string, unknown>> = [
			{ ...originalIn },
			{ ...originalOut },
			{ ...correctionIn },
			{ ...correctionOut },
		];
		mutate(entries);
		const fixture = cancellationDb({ entries });
		await expect(
			deleteCancelledTimeCorrectionsInTransaction(
				cancellationInput(fixture.dbService),
			),
		).rejects.toThrow(/cancel/i);
		expect(fixture.deletes).toEqual([]);
	});

	it("rejects an untouched endpoint timestamp race in a partial correction", async () => {
		const fixture = cancellationDb({
			entries: [
				originalIn,
				{ ...originalOut, timestamp: new Date("2026-07-19T14:01:00Z") },
				correctionIn,
			],
		});
		await expect(
			deleteCancelledTimeCorrectionsInTransaction(
				cancellationInput(
					fixture.dbService,
					{ action: "edit", clockInCorrectionId: cancellationIds.correctionIn },
					{
						...cancellationExpectedSource,
						pendingCorrections: {
							clockIn: cancellationExpectedSource.pendingCorrections.clockIn,
							clockOut: null,
						},
					},
				),
			),
		).rejects.toThrow(/cancel/i);
		expect(fixture.deletes).toEqual([]);
	});

	it.each([
		[
			"foreign source",
			{
				period: {
					id: cancellationIds.period,
					organizationId: "org-2",
					employeeId: cancellationIds.employee,
					approvalWorkflowId: cancellationIds.workflow,
				},
			},
		],
		[
			"different workflow link",
			{
				period: {
					id: cancellationIds.period,
					organizationId: "org-1",
					employeeId: cancellationIds.employee,
					approvalWorkflowId: cancellationIds.originalIn,
				},
			},
		],
		[
			"active correction",
			{
				entries: [
					originalIn,
					originalOut,
					{ ...correctionIn, isSuperseded: false },
					correctionOut,
				],
			},
		],
		[
			"wrong correction lineage",
			{
				entries: [
					originalIn,
					originalOut,
					{ ...correctionIn, replacesEntryId: cancellationIds.originalOut },
					correctionOut,
				],
			},
		],
		[
			"superseded original",
			{
				entries: [
					{ ...originalIn, isSuperseded: true },
					originalOut,
					correctionIn,
					correctionOut,
				],
			},
		],
		[
			"foreign correction employee",
			{
				entries: [
					originalIn,
					originalOut,
					{ ...correctionIn, employeeId: cancellationIds.originalIn },
					correctionOut,
				],
			},
		],
	] as const)("rejects %s before deleting", async (_label, options) => {
		const fixture = cancellationDb(options);
		await expect(
			deleteCancelledTimeCorrectionsInTransaction(
				cancellationInput(fixture.dbService),
			),
		).rejects.toThrow(/cancel/i);
		expect(fixture.deletes).toEqual([]);
	});

	it("rejects a changed untouched original in a partial correction", async () => {
		const fixture = cancellationDb({
			entries: [
				originalIn,
				{ ...originalOut, isSuperseded: true },
				correctionIn,
			],
		});
		await expect(
			deleteCancelledTimeCorrectionsInTransaction(
				cancellationInput(fixture.dbService, {
					action: "edit",
					clockInCorrectionId: cancellationIds.correctionIn,
				}),
			),
		).rejects.toThrow(/cancel/i);
		expect(fixture.deletes).toEqual([]);
	});

	it("cancels a later cycle without changing prior approved correction endpoints", async () => {
		const priorIn = {
			...correctionIn,
			id: cancellationIds.priorIn,
			replacesEntryId: cancellationIds.originalIn,
			isSuperseded: false,
		};
		const priorOut = {
			...correctionOut,
			id: cancellationIds.priorOut,
			replacesEntryId: cancellationIds.originalOut,
			isSuperseded: false,
		};
		const baseIn = {
			...originalIn,
			isSuperseded: true,
			supersededById: cancellationIds.priorIn,
		};
		const baseOut = {
			...originalOut,
			isSuperseded: true,
			supersededById: cancellationIds.priorOut,
		};
		const pendingIn = {
			...correctionIn,
			replacesEntryId: cancellationIds.priorIn,
		};
		const pendingOut = {
			...correctionOut,
			replacesEntryId: cancellationIds.priorOut,
		};
		const fixture = cancellationDb({
			period: {
				id: cancellationIds.period,
				organizationId: "org-1",
				employeeId: cancellationIds.employee,
				clockInId: cancellationIds.priorIn,
				clockOutId: cancellationIds.priorOut,
				canonicalRecordId: cancellationIds.canonical,
				approvalWorkflowId: cancellationIds.workflow,
				startTime: priorIn.timestamp,
				endTime: priorOut.timestamp,
				durationMinutes: 480,
				isActive: false,
				approvalStatus: "approved",
				pendingChanges: null,
				workLocationType: "office",
				workCategoryId: null,
				deletedAt: null,
			},
			entries: [priorIn, priorOut, pendingIn, pendingOut],
			historicalEntries: [baseIn, baseOut],
		});

		await deleteCancelledTimeCorrectionsInTransaction(
			cancellationInput(fixture.dbService, cancellationCorrection, {
				...cancellationExpectedSource,
				clockInId: cancellationIds.priorIn,
				clockOutId: cancellationIds.priorOut,
				currentEndpoints: {
					clockIn: cancellationEntryEvidence(priorIn, "clock_in"),
					clockOut: cancellationEntryEvidence(priorOut, "clock_out"),
				},
				pendingCorrections: {
					clockIn: cancellationEntryEvidence(pendingIn, "clock_in"),
					clockOut: cancellationEntryEvidence(pendingOut, "clock_out"),
				},
			}),
		);

		expect(fixture.deletes).toHaveLength(1);
		expect(
			fixture.deletes.flatMap((item) =>
				collectCancellationBoundValues(item.where),
			),
		).toEqual(
			expect.arrayContaining([
				cancellationIds.correctionIn,
				cancellationIds.correctionOut,
				cancellationIds.priorIn,
				cancellationIds.priorOut,
			]),
		);
		expect(fixture.update).not.toHaveBeenCalled();
		expect(fixture.transaction).not.toHaveBeenCalled();
	});

	it.each([
		["a partial returned set", [{ id: cancellationIds.correctionIn }]],
		[
			"a duplicate returned ID",
			[
				{ id: cancellationIds.correctionIn },
				{ id: cancellationIds.correctionIn },
			],
		],
		[
			"an equal-count unexpected ID",
			[
				{ id: cancellationIds.correctionIn },
				{ id: cancellationIds.priorIn },
			],
		],
	] as const)("rejects %s", async (_label, deleteRows) => {
		const options = { deleteRows: [...deleteRows] };
		const fixture = cancellationDb(options);
		await expect(
			deleteCancelledTimeCorrectionsInTransaction(
				cancellationInput(fixture.dbService),
			),
		).rejects.toThrow("Time correction cancellation delete conflict");
	});
});

function createPolicyResolutionDbService(policies: unknown[]) {
	const inserts: Array<{ table: unknown; values: Record<string, unknown> }> =
		[];
	const updates: Record<string, unknown>[] = [];
	const entryMutationIds = [correction.id, period.clockInId];
	const originalRows = [
		{
			...correction,
			id: period.clockInId,
			type: "clock_in",
			timestamp: period.startTime,
			replacesEntryId: null,
			isSuperseded: false,
		},
		{
			...correction,
			id: period.clockOutId,
			type: "clock_out",
			timestamp: period.endTime,
			replacesEntryId: null,
			isSuperseded: false,
		},
	];
	const dbService = {
		db: {
			query: {
				approvalRequest: { findFirst: vi.fn().mockResolvedValue(null) },
				approvalPolicy: { findMany: vi.fn().mockResolvedValue(policies) },
				employeeGroupMember: { findMany: vi.fn().mockResolvedValue([]) },
				employeeGroup: { findMany: vi.fn().mockResolvedValue([]) },
				employee: {
					findMany: vi.fn().mockResolvedValue([
						{
							id: "emp-requester",
							userId: "user-requester",
							organizationId: "org-1",
							isActive: true,
							role: "employee",
							user: { id: "user-requester", ...period.employee.user },
						},
						{
							id: "emp-manager",
							userId: "user-manager",
							organizationId: "org-1",
							isActive: true,
							role: "manager",
							user: timeCorrectionCurrentApprover.user,
						},
					]),
					findFirst: vi.fn().mockResolvedValue({
						id: "emp-requester",
						userId: "user-requester",
						organizationId: "org-1",
						role: "employee",
						user: period.employee.user,
					}),
				},
				workPeriod: { findFirst: vi.fn().mockResolvedValue(period) },
				timeEntry: { findFirst: vi.fn().mockResolvedValue(correction) },
				timeRecord: { findFirst: vi.fn().mockResolvedValue(null) },
				employeeManagers: {
					findMany: vi.fn().mockResolvedValue([
						{
							employeeId: "emp-requester",
							managerId: "emp-manager",
							isPrimary: true,
						},
					]),
				},
				teamMembership: { findMany: vi.fn().mockResolvedValue([]) },
				team: { findMany: vi.fn().mockResolvedValue([]) },
			},
			insert: vi.fn((table: unknown) => ({
				values: vi.fn((values: Record<string, unknown>) => {
					inserts.push({ table, values });
					return {
						returning: vi
							.fn()
							.mockResolvedValue([{ id: `insert-${inserts.length}` }]),
					};
				}),
			})),
			select: vi.fn(() => ({
				from: vi.fn((table: unknown) => ({
					where: vi.fn(() => {
						if (table === employee) {
							const finish = vi.fn().mockResolvedValue([
								{
									id: "emp-requester",
									organizationId: "org-1",
									userId: "user-requester",
									isActive: true,
								},
							]);
							return {
								for: finish,
								orderBy: vi.fn(() => ({ for: finish })),
							};
						}
						if (table === workPeriod) {
							return { for: vi.fn().mockResolvedValue([period]) };
						}
						return {
							orderBy: vi.fn(() => ({
								for: vi.fn().mockResolvedValue([...originalRows, correction]),
							})),
						};
					}),
				})),
			})),
			update: vi.fn((table: unknown) => ({
				set: vi.fn((values: Record<string, unknown>) => ({
					where: vi.fn(() => {
						updates.push(values);
						return {
							returning: vi.fn(async () => {
								if (table === timeEntry) {
									const id = entryMutationIds.shift();
									return id ? [{ id }] : [];
								}
								if (table === workPeriod) return [{ id: period.id }];
								return [];
							}),
						};
					}),
				})),
			})),
		},
		query: <T>(_name: string, fn: () => Promise<T>) => Effect.promise(fn),
	} as unknown as ApprovalDbService;

	return { dbService, inserts, updates };
}

const timePolicyContext = buildTimeCorrectionApprovalPolicyContext({
	organizationId: "org-1",
	requesterEmployeeId: "emp-requester",
	teamId: "team-1",
	workPeriodId: "period-1",
	overtimeRisk: "warning",
});

const timeCorrectionCurrentApprover: CurrentApprover = {
	id: "emp-manager",
	userId: "user-manager",
	organizationId: "org-1",
	user: {
		id: "user-manager",
		name: "Morgan Manager",
		email: "morgan@example.com",
		image: null,
	},
};

const period = {
	id: "period-1",
	employeeId: "emp-requester",
	clockInId: "entry-original",
	clockOutId: "entry-clock-out-original",
	organizationId: "org-1",
	canonicalRecordId: null,
	startTime: new Date("2026-05-11T08:00:00.000Z"),
	endTime: new Date("2026-05-11T16:00:00.000Z"),
	durationMinutes: 480,
	isActive: false,
	approvalStatus: "approved",
	pendingChanges: null,
	approvalWorkflowId: null,
	deletedAt: null,
	employee: {
		userId: "user-requester",
		organizationId: "org-1",
		user: { name: "Avery Requester", email: "avery@example.com", image: null },
	},
};

const correction = {
	id: "20000000-0000-4000-8000-000000000001",
	organizationId: "org-1",
	employeeId: "emp-requester",
	type: "correction",
	timestamp: new Date("2026-05-11T08:15:00.000Z"),
	utcOffsetMinutes: 120,
	timezone: "Europe/Berlin",
	timezoneSource: "browser",
	replacesEntryId: "entry-original",
	isSuperseded: true,
	supersededById: null,
};

const rejectedCorrection = {
	id: "20000000-0000-4000-8000-000000000002",
	organizationId: "org-1",
	employeeId: "emp-requester",
	type: "correction",
	timestamp: new Date("2026-05-11T07:45:00.000Z"),
	utcOffsetMinutes: 120,
	timezone: "Europe/Berlin",
	timezoneSource: "browser",
	replacesEntryId: "entry-original",
	isSuperseded: true,
	supersededById: null,
};

const clockOutCorrection = {
	id: "20000000-0000-4000-8000-000000000003",
	organizationId: "org-1",
	employeeId: "emp-requester",
	type: "correction",
	timestamp: new Date("2026-05-11T16:15:00.000Z"),
	utcOffsetMinutes: 120,
	timezone: "Europe/Berlin",
	timezoneSource: "browser",
	replacesEntryId: "entry-clock-out-original",
	isSuperseded: true,
	supersededById: null,
};

function createTimeCorrectionDecisionDbService() {
	const updateSets: Record<string, unknown>[] = [];
	const selectForUpdate = vi
		.fn()
		.mockResolvedValue([{ id: "entry-active-original" }]);
	let mutationIds: string[] = [];
	let legacyDiscoveredCorrections: Record<string, unknown>[] = [];
	let legacyCorrectionCandidates: Record<string, unknown>[] = [
		{ ...correction, isSuperseded: false },
	];
	const boundValues = (value: unknown): unknown[] => {
		if (!value || typeof value !== "object") return [];
		const candidate = value as { value?: unknown; queryChunks?: unknown[] };
		return [
			...("value" in candidate ? [candidate.value] : []),
			...(candidate.queryChunks?.flatMap(boundValues) ?? []),
		];
	};
	const columnNames = (value: unknown): string[] => {
		if (!value || typeof value !== "object") return [];
		const candidate = value as {
			config?: { name?: unknown };
			queryChunks?: unknown[];
		};
		return [
			...(typeof candidate.config?.name === "string"
				? [candidate.config.name]
				: []),
			...(candidate.queryChunks?.flatMap(columnNames) ?? []),
		];
	};
	const initialApprovalRequest = {
		id: "approval-1",
		organizationId: "org-1",
		entityType: "time_entry",
		entityId: "period-1",
		requestedBy: "emp-requester",
		approverId: "emp-manager",
		status: "pending",
		approvedAt: null,
		rejectionReason: null,
		reason: null,
		metadata: {
			timeCorrection: { action: "edit", clockInCorrectionId: correction.id },
		},
	};
	let persistedApprovalRequest: Record<string, unknown> | null = null;
	let boundaryMode: "legacy" | "shadow" | "ready" | null = null;
	let boundaryEmployeeRead = 0;
	const transactionCommitted = vi.fn();
	const approvalFindFirst = vi.fn(
		async () => persistedApprovalRequest ?? initialApprovalRequest,
	);
	let currentPeriod = { ...period };
	const workPeriodFindFirst = vi.fn(async () => currentPeriod);
	const timeEntryFindFirst = vi.fn().mockResolvedValue(correction);
	const timeRecordFindFirst = vi.fn(async () => {
		const loadedPeriod = await workPeriodFindFirst.mock.results.at(-1)?.value;
		if (!loadedPeriod?.canonicalRecordId) return null;
		return {
			id: loadedPeriod.canonicalRecordId,
			organizationId: loadedPeriod.organizationId,
			employeeId: loadedPeriod.employeeId,
			recordKind: "work",
			startAt: loadedPeriod.startTime,
			endAt: loadedPeriod.endTime,
			durationMinutes: loadedPeriod.durationMinutes,
			approvalState: "approved",
		};
	});
	let replayEntryRead = 0;
	const requester = {
		id: "emp-requester",
		organizationId: "org-1",
		userId: "user-requester",
		isActive: true,
		user: { id: "user-requester", ...period.employee.user },
	};
	const actor = {
		id: "emp-manager",
		organizationId: "org-1",
		userId: "user-manager",
		isActive: true,
		user: timeCorrectionCurrentApprover.user,
	};
	let delegationManagerLinks: Record<string, unknown>[] = [];
	let delegationEmployees: Record<string, unknown>[] = [requester, actor];
	const originalEntry = (
		id: string,
		type: "clock_in" | "clock_out",
		timestamp: Date,
	) => ({
		id,
		organizationId: "org-1",
		employeeId: "emp-requester",
		type,
		timestamp,
		utcOffsetMinutes: 120,
		timezone: "Europe/Berlin",
		timezoneSource: "browser",
		replacesEntryId: null,
		isSuperseded: false,
		supersededById: null,
	});
	const db = {
		execute: vi.fn(async (statement: SQL) => {
			const rendered = new PgDialect().sqlToQuery(statement).sql;
			if (/approval_workflow_rollout/i.test(rendered)) {
				return { rows: [{ lifecycle_mode: boundaryMode ?? "legacy" }] };
			}
			return { rows: [] };
		}),
		query: {
			approvalRequest: {
				findFirst: approvalFindFirst,
			},
			approvalWorkflow: { findFirst: vi.fn().mockResolvedValue(null) },
			approvalChainStageInstance: {
				findFirst: vi.fn().mockResolvedValue(null),
			},
			workPeriod: { findFirst: workPeriodFindFirst },
			timeEntry: {
				findFirst: timeEntryFindFirst,
				findMany: vi.fn(async () => {
					if (replayEntryRead++ < 2) return [correction];
					return [
						originalEntry(period.clockInId, "clock_in", period.startTime),
					];
				}),
			},
			employee: {
				findMany: vi.fn(async () => {
					if (boundaryMode && boundaryEmployeeRead++ === 0) return [actor];
					return delegationEmployees;
				}),
				findFirst: vi.fn().mockResolvedValue(actor),
			},
			member: {
				findMany: vi.fn().mockResolvedValue([
					{
						organizationId: "org-1",
						userId: "user-manager",
						status: "approved",
					},
				]),
			},
			employeeManagers: {
				findMany: vi.fn(async () => delegationManagerLinks),
			},
			teamMembership: { findMany: vi.fn().mockResolvedValue([]) },
			team: { findMany: vi.fn().mockResolvedValue([]) },
			timeRecord: {
				findFirst: timeRecordFindFirst,
			},
		},
		select: vi.fn(() => ({
			from: vi.fn((table: unknown) => ({
				where: vi.fn((whereClause: unknown) => {
					if (table === employee) {
						const finish = vi.fn().mockResolvedValue([
							{
								id: "emp-manager",
								organizationId: "org-1",
								userId: "user-manager",
								isActive: true,
							},
							{
								id: requester.id,
								organizationId: requester.organizationId,
								userId: requester.userId,
								isActive: requester.isActive,
							},
						]);
						return {
							for: finish,
							orderBy: vi.fn(() => ({ for: finish })),
						};
					}
					if (table === workPeriod) {
						const finish = vi.fn(async () => {
							const loaded = await workPeriodFindFirst();
							return loaded ? [loaded] : [];
						});
						return { for: finish };
					}
					if (table === timeRecord) {
						const finish = vi.fn(async () => {
							const loaded = await timeRecordFindFirst();
							return loaded ? [loaded] : [];
						});
						return { for: finish };
					}
					const values = boundValues(whereClause);
					const scannedCorrections = legacyCorrectionCandidates
						.filter((entry) => values.includes(entry.replacesEntryId))
						.map((entry) => ({ ...entry }));
					if (columnNames(whereClause).includes("replaces_entry_id")) {
						legacyDiscoveredCorrections = [
							...legacyDiscoveredCorrections,
							...scannedCorrections.filter(
								(entry) =>
									!legacyDiscoveredCorrections.some(
										(existing) => existing.id === entry.id,
									),
							),
						];
					}
					const scanRows = Promise.resolve(scannedCorrections) as Promise<
						unknown[]
					> & {
						orderBy: () => { for: () => Promise<unknown[]> };
					};
					scanRows.orderBy = () => ({
						for: async () => {
							const loadedPeriod =
								await workPeriodFindFirst.mock.results.at(-1)?.value;
							const loadedApproval =
								await approvalFindFirst.mock.results.at(-1)?.value;
							const metadata = loadedApproval?.metadata?.timeCorrection;
							const declaredCorrectionIds = [
								metadata?.clockInCorrectionId,
								metadata?.clockOutCorrectionId,
							].filter(Boolean);
							const correctionRows: Record<string, unknown>[] = [];
							if (declaredCorrectionIds.length > 0) {
								for (const correctionId of declaredCorrectionIds) {
									const loaded = await timeEntryFindFirst();
									if (loaded)
										correctionRows.push({
											...correction,
											...loaded,
											id: correctionId,
										});
								}
							} else {
								correctionRows.push(...legacyDiscoveredCorrections);
							}
							const originals = [
								originalEntry(
									loadedPeriod.clockInId,
									"clock_in",
									loadedPeriod.startTime,
								),
								...(loadedPeriod.clockOutId
									? [
											originalEntry(
												loadedPeriod.clockOutId,
												"clock_out",
												loadedPeriod.endTime,
											),
										]
									: []),
							];
							const activeEvidence = await selectForUpdate();
							if (activeEvidence.length === 0 && originals[0]) {
								originals[0] = { ...originals[0], isSuperseded: true };
							}
							for (const correctionRow of correctionRows) {
								if (correctionRow.isSuperseded === false) {
									const originalIndex = originals.findIndex(
										(entry) => entry.id === correctionRow.replacesEntryId,
									);
									if (originalIndex >= 0) {
										originals[originalIndex] = {
											...originals[originalIndex],
											isSuperseded: true,
											supersededById: correctionRow.id,
										};
									}
								}
							}
							mutationIds = correctionRows.flatMap((entry) =>
								entry.isSuperseded === false
									? [entry.replacesEntryId as string, entry.id as string]
									: [entry.id as string, entry.replacesEntryId as string],
							);
							return [...originals, ...correctionRows];
						},
					});
					return scanRows;
				}),
			})),
		})),
		update: vi.fn((table: unknown) => ({
			set: vi.fn((values: Record<string, unknown>) => {
				updateSets.push(values);
				return {
					where: vi.fn(() => ({
						returning: vi.fn(async () => {
							if (table === approvalRequest) {
								const loadedRequest =
									await approvalFindFirst.mock.results.at(-1)?.value;
								const persistedValues = Object.fromEntries(
									Object.entries(values).filter(
										([, value]) => value !== undefined,
									),
								);
								const loadedMetadata = loadedRequest?.metadata as
									| { timeCorrection?: Record<string, unknown> }
									| null
									| undefined;
								persistedApprovalRequest = loadedRequest
									? {
											...loadedRequest,
											approvedAt: loadedRequest.approvedAt ?? null,
											rejectionReason: loadedRequest.rejectionReason ?? null,
											...persistedValues,
											...(loadedMetadata?.timeCorrection
												? {
														metadata: {
															timeCorrection: {
																action:
																	loadedMetadata.timeCorrection.action ??
																	"edit",
																...loadedMetadata.timeCorrection,
															},
														},
													}
												: {}),
										}
									: null;
								return loadedRequest ? [{ id: loadedRequest.id }] : [];
							}
							if (table === timeEntry) {
								const id = mutationIds.shift();
								return id ? [{ id }] : [];
							}
							const loadedPeriod =
								await workPeriodFindFirst.mock.results.at(-1)?.value;
							if (table === workPeriod) {
								currentPeriod = { ...currentPeriod, ...values };
								return [{ id: loadedPeriod.id }];
							}
							if (table === timeRecord)
								return [{ id: loadedPeriod.canonicalRecordId }];
							return [];
						}),
					})),
				};
			}),
		})),
		insert: vi
			.fn()
			.mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) }),
		transaction: vi.fn(async (fn: (tx: unknown) => Promise<void>) => {
			const result = await fn(db);
			transactionCommitted();
			return result;
		}),
	};

	return {
		db,
		updateSets,
		selectForUpdate,
		transactionCommitted,
		enableBoundaryMode(mode: "legacy" | "shadow" | "ready") {
			boundaryMode = mode;
			boundaryEmployeeRead = 0;
			replayEntryRead = 0;
		},
		enableDelegation(eligible: boolean) {
			initialApprovalRequest.approverId = "emp-delegate";
			delegationEmployees = [
				{ ...requester, role: "employee" },
				{ ...actor, role: "manager" },
				{
					id: "emp-delegate",
					organizationId: "org-1",
					userId: "user-delegate",
					isActive: true,
					role: "manager",
					user: {
						id: "user-delegate",
						name: "Delegate",
						email: "delegate@example.com",
						image: null,
					},
				},
			];
			delegationManagerLinks = eligible
				? [
						{
							employeeId: "emp-requester",
							managerId: "emp-manager",
							isPrimary: true,
						},
						{
							employeeId: "emp-requester",
							managerId: "emp-delegate",
							isPrimary: false,
						},
					]
				: [];
		},
		setLegacyCorrectionCandidates: (entries: Record<string, unknown>[]) => {
			legacyCorrectionCandidates = entries;
		},
		query: <T>(_name: string, fn: () => Promise<T>) => Effect.promise(fn),
	} as unknown as ApprovalDbService & {
		updateSets: Record<string, unknown>[];
		selectForUpdate: typeof selectForUpdate;
		transactionCommitted: ReturnType<typeof vi.fn>;
		enableBoundaryMode(mode: "legacy" | "shadow" | "ready"): void;
		enableDelegation(eligible: boolean): void;
		setLegacyCorrectionCandidates(entries: Record<string, unknown>[]): void;
	};
}

function runTimeCorrectionDecisionEffect(
	effect: Effect.Effect<unknown, unknown, unknown>,
) {
	return Effect.runPromise(
		effect.pipe(
			Effect.provideService(ApprovalAuditLogger, {
				log: vi.fn(() => Effect.void),
				logBatch: vi.fn(() => Effect.void),
			}),
		),
	);
}

describe("calculateCorrectedDurationMinutes", () => {
	it("returns minutes when corrected clock-in and clock-out exist", () => {
		const result = calculateCorrectedDurationMinutes(
			new Date("2026-03-09T09:00:00.000Z"),
			new Date("2026-03-09T17:30:00.000Z"),
		);

		expect(result).toBe(510);
	});
});

describe("finalizeTimeCorrectionTerminalInTransaction", () => {
	const ids = {
		workflow: "10000000-0000-4000-8000-000000000001",
		approval: "10000000-0000-4000-8000-000000000002",
		period: "10000000-0000-4000-8000-000000000003",
		canonical: "10000000-0000-4000-8000-000000000004",
		originalIn: "10000000-0000-4000-8000-000000000005",
		originalOut: "10000000-0000-4000-8000-000000000006",
		correctionIn: "10000000-0000-4000-8000-000000000007",
		correctionOut: "10000000-0000-4000-8000-000000000008",
		nextCorrectionIn: "10000000-0000-4000-8000-000000000009",
		nextCorrectionOut: "10000000-0000-4000-8000-000000000010",
	};
	const originalIn = {
		id: ids.originalIn,
		organizationId: "org-1",
		employeeId: "emp-requester",
		type: "clock_in",
		timestamp: new Date("2026-07-18T22:30:00.000Z"),
		utcOffsetMinutes: 120,
		timezone: "Europe/Berlin",
		timezoneSource: "browser",
		replacesEntryId: null,
		isSuperseded: false,
		supersededById: null,
	};
	const originalOut = {
		...originalIn,
		id: ids.originalOut,
		type: "clock_out",
		timestamp: new Date("2026-07-19T06:30:00.000Z"),
	};
	const correctionIn = {
		...originalIn,
		id: ids.correctionIn,
		type: "correction",
		timestamp: new Date("2026-07-19T03:30:00.000Z"),
		utcOffsetMinutes: -240,
		timezone: "America/New_York",
		timezoneSource: "user_setting",
		replacesEntryId: ids.originalIn,
		isSuperseded: true,
	};
	const correctionOut = {
		...originalOut,
		id: ids.correctionOut,
		type: "correction",
		timestamp: new Date("2026-07-19T07:00:00.000Z"),
		replacesEntryId: ids.originalOut,
		isSuperseded: true,
	};
	const terminalPeriod = {
		id: ids.period,
		organizationId: "org-1",
		employeeId: "emp-requester",
		clockInId: ids.originalIn,
		clockOutId: ids.originalOut,
		canonicalRecordId: ids.canonical,
		approvalWorkflowId: ids.workflow,
		startTime: originalIn.timestamp,
		endTime: originalOut.timestamp,
		durationMinutes: 480,
		isActive: false,
		approvalStatus: "approved",
		pendingChanges: null,
		workLocationType: "office",
		workCategoryId: "71000000-0000-4000-8000-000000000802",
		deletedAt: null,
	};
	const canonicalRecord = {
		id: ids.canonical,
		organizationId: "org-1",
		employeeId: "emp-requester",
		recordKind: "work",
		startAt: originalIn.timestamp,
		endAt: originalOut.timestamp,
		durationMinutes: 480,
		approvalState: "approved",
	};
	const canonicalWorkRecord = {
		recordId: ids.canonical,
		organizationId: "org-1",
		recordKind: "work",
		workLocationType: "office",
		workCategoryId: "71000000-0000-4000-8000-000000000802",
	};
	const terminalCorrection = {
		action: "edit" as const,
		clockInCorrectionId: ids.correctionIn,
		clockOutCorrectionId: ids.correctionOut,
	};
	function terminalExpectedSource(metadataOnly = false) {
		const evidence = (
			entry: typeof originalIn,
			logicalRole: "clock_in" | "clock_out",
		) => ({
			...entry,
			logicalRole,
			timestamp: parseInstant(entry.timestamp.toISOString()),
		});
		return {
			employeeId: "emp-requester",
			approvalWorkflowId: ids.workflow,
			canonicalRecordId: ids.canonical,
			workLocationType: "office" as const,
			workCategoryId: terminalPeriod.workCategoryId,
			clockInId: ids.originalIn,
			clockOutId: ids.originalOut,
			startTime: parseInstant(originalIn.timestamp.toISOString()),
			endTime: parseInstant(originalOut.timestamp.toISOString()),
			durationMinutes: 480,
			isActive: false,
			approvalStatus: "approved" as const,
			pendingChanges: null,
			canonicalRecord: {
				id: ids.canonical,
				employeeId: "emp-requester",
				recordKind: "work" as const,
				startAt: parseInstant(originalIn.timestamp.toISOString()),
				endAt: parseInstant(originalOut.timestamp.toISOString()),
				durationMinutes: 480,
				approvalState: "approved" as const,
			},
			canonicalWork: { ...canonicalWorkRecord, recordKind: "work" as const },
			currentEndpoints: {
				clockIn: evidence(originalIn, "clock_in"),
				clockOut: evidence(originalOut as typeof originalIn, "clock_out"),
			},
			pendingCorrections: metadataOnly
				? { clockIn: null, clockOut: null }
				: {
						clockIn: evidence(correctionIn as typeof originalIn, "clock_in"),
						clockOut: evidence(correctionOut as typeof originalIn, "clock_out"),
					},
		};
	}
	const legacyRequest = {
		id: ids.approval,
		organizationId: "org-1",
		entityType: "time_entry",
		entityId: ids.period,
		requestedBy: "emp-requester",
		status: "approved",
		approvedAt: new Date("2026-07-20T09:00:00.000Z"),
		rejectionReason: null,
		metadata: { timeCorrection: terminalCorrection },
	};
	const canonicalWorkflow = {
		id: ids.workflow,
		organizationId: "org-1",
		workflowType: "time_correction",
		sourceType: "time_entry",
		sourceId: ids.period,
		requesterEmployeeId: "emp-requester",
		status: "approved",
		version: 2,
		contextSnapshot: { timeCorrection: terminalCorrection },
		completedAt: new Date("2026-07-20T09:00:00.000Z"),
	};
	const canonicalCompatibilityMetadata = {
		workflow: { id: ids.workflow, organizationId: "org-1" },
		stage: {
			id: "60000000-0000-4000-8000-000000000001",
			sequence: 2,
		},
		timeCorrection: terminalCorrection,
	};

	function collectSqlColumnNames(value: unknown): string[] {
		if (!value || typeof value !== "object") return [];
		const candidate = value as {
			config?: { name?: unknown };
			queryChunks?: unknown[];
		};
		return [
			...(typeof candidate.config?.name === "string"
				? [candidate.config.name]
				: []),
			...(candidate.queryChunks?.flatMap(collectSqlColumnNames) ?? []),
		];
	}

	function collectTerminalBoundValues(value: unknown): unknown[] {
		if (!value || typeof value !== "object") return [];
		const candidate = value as { value?: unknown; queryChunks?: unknown[] };
		return [
			...(Object.hasOwn(candidate, "value") ? [candidate.value] : []),
			...(candidate.queryChunks?.flatMap(collectTerminalBoundValues) ?? []),
		];
	}

	function createFinalizerDb(
		options: {
			period?: Record<string, unknown> | null;
			entries?: Record<string, unknown>[];
			historicalEntries?: Record<string, unknown>[];
			canonical?: Record<string, unknown> | null;
			canonicalWork?: Record<string, unknown> | null;
			legacyRequest?: Record<string, unknown> | null;
			workflow?: Record<string, unknown> | null;
			mutationRows?: Array<Array<{ id?: string; recordId?: string }>>;
			categoryAuthorization?: {
				memberships?: Record<string, unknown>[];
				teams?: Record<string, unknown>[];
				categories?: Record<string, unknown>[];
				assignments?: Record<string, unknown>[];
				sets?: Record<string, unknown>[];
				setCategories?: Record<string, unknown>[];
			};
		} = {},
	) {
		const lockedTables: unknown[] = [];
		const lockWhereClauses: unknown[] = [];
		const mutations: Array<{
			table: unknown;
			values: Record<string, unknown>;
			where: unknown;
		}> = [];
		const transaction = vi.fn();
		const periodRow =
			options.period === undefined ? terminalPeriod : options.period;
		const entries = options.entries ?? [
			correctionOut,
			originalIn,
			correctionIn,
			originalOut,
		];
		const canonical =
			options.canonical === undefined ? canonicalRecord : options.canonical;
		const canonicalWork =
			options.canonicalWork === undefined
				? canonicalWorkRecord
				: options.canonicalWork;
		const approvalRequestFindFirst = vi
			.fn()
			.mockResolvedValue(
				options.legacyRequest === undefined
					? { ...legacyRequest, metadata: canonicalCompatibilityMetadata }
					: options.legacyRequest,
			);
		const approvalWorkflowFindFirst = vi
			.fn()
			.mockResolvedValue(
				options.workflow === undefined ? canonicalWorkflow : options.workflow,
			);
		const defaultMutationRows = [
			[{ id: ids.correctionIn }],
			[{ id: ids.originalIn }],
			[{ id: ids.correctionOut }],
			[{ id: ids.originalOut }],
			[{ id: ids.period }],
			[{ id: ids.canonical }],
			[{ recordId: ids.canonical }],
		];
		const mutationRows = [...(options.mutationRows ?? defaultMutationRows)];
		let timeEntryLockCount = 0;
		const rowsForLock = (table: unknown) => {
			if (table === employee)
				return [
					{
						id: "emp-manager",
						organizationId: "org-1",
						userId: "user-manager",
						isActive: true,
					},
					{
						id: "emp-requester",
						organizationId: "org-1",
						userId: "user-requester",
						isActive: true,
						teamId: "71000000-0000-4000-8000-000000000803",
					},
				];
			if (table === teamMembership)
				return options.categoryAuthorization?.memberships ?? [];
			if (table === team) return options.categoryAuthorization?.teams ?? [];
			if (table === workCategory)
				return options.categoryAuthorization?.categories ?? [];
			if (table === workCategorySetAssignment)
				return options.categoryAuthorization?.assignments ?? [];
			if (table === workCategorySet)
				return options.categoryAuthorization?.sets ?? [];
			if (table === workCategorySetCategory)
				return options.categoryAuthorization?.setCategories ?? [];
			if (table === workPeriod) return periodRow ? [periodRow] : [];
			if (table === timeRecord) return canonical ? [canonical] : [];
			if (table === timeRecordWork) return canonicalWork ? [canonicalWork] : [];
			if (table === timeEntry) {
				const rows =
					timeEntryLockCount === 0
						? entries
						: (options.historicalEntries ?? []);
				timeEntryLockCount += 1;
				return rows;
			}
			return [];
		};
		const db = {
			transaction,
			query: {
				approvalRequest: {
					findFirst: approvalRequestFindFirst,
				},
				approvalWorkflow: {
					findFirst: approvalWorkflowFindFirst,
				},
				employee: {
					findMany: vi.fn().mockResolvedValue([
						{
							id: "emp-manager",
							organizationId: "org-1",
							userId: "user-manager",
							isActive: true,
							user: timeCorrectionCurrentApprover.user,
						},
						{
							id: "emp-requester",
							organizationId: "org-1",
							userId: "user-requester",
							isActive: true,
							user: period.employee.user,
						},
					]),
				},
				timeRecord: { findFirst: vi.fn().mockResolvedValue(canonical) },
			},
			select: vi.fn(() => ({
				from: vi.fn((table: unknown) => {
					lockedTables.push(table);
					return {
						where: vi.fn((whereClause: unknown) => {
							lockWhereClauses.push(whereClause);
							const finish = vi.fn().mockResolvedValue(rowsForLock(table));
							return {
								for: finish,
								orderBy: vi.fn(() => ({ for: finish })),
								limit: vi.fn(() => ({ for: finish })),
							};
						}),
					};
				}),
			})),
			update: vi.fn((table: unknown) => ({
				set: vi.fn((values: Record<string, unknown>) => ({
					where: vi.fn((whereClause: unknown) => {
						mutations.push({ table, values, where: whereClause });
						return {
							returning: vi.fn().mockResolvedValue(mutationRows.shift() ?? []),
						};
					}),
				})),
			})),
		};
		const dbService = {
			db,
			query: <T>(_name: string, fn: () => Promise<T>) => Effect.promise(fn),
			setPersistedEvidence: (
				correction: TimeCorrectionWorkflowPayload["timeCorrection"],
				transition:
					| { kind: "approve"; reason: string | null }
					| { kind: "reject"; reason: string },
			) => {
				const status = transition.kind === "approve" ? "approved" : "rejected";
				if (options.legacyRequest === undefined) {
					approvalRequestFindFirst.mockResolvedValue({
						...legacyRequest,
						status,
						approvedAt: new Date("2026-07-20T09:00:00.000Z"),
						rejectionReason:
							transition.kind === "reject" ? transition.reason : null,
						metadata: {
							...canonicalCompatibilityMetadata,
							timeCorrection: correction,
							...(Object.hasOwn(correction, "workLocationType")
								? {
										timeCorrectionOriginalWorkMetadata: {
											workLocationType: terminalPeriod.workLocationType,
											workCategoryId: terminalPeriod.workCategoryId,
										},
									}
								: {}),
						},
					});
				}
				if (options.workflow === undefined) {
					approvalWorkflowFindFirst.mockResolvedValue({
						...canonicalWorkflow,
						status,
						contextSnapshot: {
							timeCorrection: correction,
							...(Object.hasOwn(correction, "workLocationType")
								? {
										timeCorrectionOriginalWorkMetadata: {
											workLocationType: terminalPeriod.workLocationType,
											workCategoryId: terminalPeriod.workCategoryId,
										},
									}
								: {}),
						},
					});
				}
			},
		} as unknown as ApprovalDbService & {
			setPersistedEvidence(
				correction: TimeCorrectionWorkflowPayload["timeCorrection"],
				transition: FinalizeTimeCorrectionTerminalInput["transition"],
			): void;
		};
		return {
			dbService,
			lockedTables,
			lockWhereClauses,
			mutations,
			transaction,
		};
	}

	function createStatefulFinalizerTransaction(
		failAt?: "workPeriod" | "canonical",
	) {
		let state = structuredClone({
			period: terminalPeriod,
			entries: [originalIn, originalOut, correctionIn, correctionOut],
			canonical: canonicalRecord,
		});
		const attemptedTables: unknown[] = [];

		const buildTransactionDb = (draft: typeof state) => ({
			query: {
				approvalRequest: {
					findFirst: vi.fn().mockResolvedValue({
						...legacyRequest,
						metadata: canonicalCompatibilityMetadata,
					}),
				},
				approvalWorkflow: {
					findFirst: vi.fn().mockResolvedValue(canonicalWorkflow),
				},
				employee: {
					findMany: vi.fn().mockResolvedValue([
						{
							id: "emp-requester",
							organizationId: "org-1",
							userId: "user-requester",
							isActive: true,
							user: period.employee.user,
						},
						{
							id: "emp-manager",
							organizationId: "org-1",
							userId: "user-manager",
							isActive: true,
							user: timeCorrectionCurrentApprover.user,
						},
					]),
				},
				timeRecord: {
					findFirst: vi.fn(async () => draft.canonical),
				},
			},
			select: vi.fn(() => ({
				from: vi.fn((table: unknown) => ({
					where: vi.fn(() => {
						const rows =
							table === employee
								? [
										{
											id: "emp-manager",
											organizationId: "org-1",
											userId: "user-manager",
											isActive: true,
										},
										{
											id: "emp-requester",
											organizationId: "org-1",
											userId: "user-requester",
											isActive: true,
										},
									]
								: table === workPeriod
									? [draft.period]
									: table === timeRecord
										? [draft.canonical]
										: [...draft.entries].sort((left, right) =>
												left.id.localeCompare(right.id),
											);
						const finish = vi.fn().mockResolvedValue(rows);
						return {
							for: finish,
							orderBy: vi.fn(() => ({ for: finish })),
						};
					}),
				})),
			})),
			update: vi.fn((table: unknown) => ({
				set: vi.fn((values: Record<string, unknown>) => ({
					where: vi.fn(() => ({
						returning: vi.fn(async () => {
							attemptedTables.push(table);
							if (
								(failAt === "workPeriod" && table === workPeriod) ||
								(failAt === "canonical" && table === timeRecord)
							) {
								return [];
							}

							if (table === workPeriod) {
								Object.assign(draft.period, values);
								return [{ id: draft.period.id }];
							}
							if (table === timeRecord) {
								Object.assign(draft.canonical, values);
								return [{ id: draft.canonical.id }];
							}

							const target =
								values.isSuperseded === false
									? draft.entries.find(
											(entry) =>
												entry.type === "correction" && entry.isSuperseded,
										)
									: draft.entries.find(
											(entry) =>
												entry.id ===
												draft.entries.find(
													(candidate) => candidate.id === values.supersededById,
												)?.replacesEntryId,
										);
							if (!target) return [];
							Object.assign(target, values);
							return [{ id: target.id }];
						}),
					})),
				})),
			})),
		});

		const transaction = vi.fn(
			async <T>(
				callback: (tx: ReturnType<typeof buildTransactionDb>) => Promise<T>,
			) => {
				const draft = structuredClone(state);
				const result = await callback(buildTransactionDb(draft));
				state = draft;
				return result;
			},
		);
		const dbService = {
			db: { transaction },
			query: <T>(_name: string, fn: () => Promise<T>) => Effect.promise(fn),
		} as unknown as ApprovalDbService;

		return {
			attemptedTables,
			snapshot: () => structuredClone(state),
			finalize: () =>
				transaction(async (tx) =>
					finalizeTimeCorrectionTerminalInTransaction(
						approveInput({ ...dbService, db: tx } as ApprovalDbService),
					),
				),
		};
	}

	function approveInput(
		dbService: ApprovalDbService,
		overrides: Partial<
			Parameters<typeof finalizeTimeCorrectionTerminalInTransaction>[0]
		> = {},
	) {
		const input = {
			dbService,
			organizationId: "org-1",
			workPeriodId: ids.period,
			expectedApprovalWorkflowId: ids.workflow,
			expectedApprovalWorkflowVersion: 2,
			expectedRequesterEmployeeId: "emp-requester",
			actorEmployeeId: "emp-manager",
			actorUserId: "user-manager",
			correction: terminalCorrection,
			...(Object.hasOwn(
				overrides.correction ?? terminalCorrection,
				"workLocationType",
			)
				? {
						expectedOriginalWorkMetadata: {
							workLocationType: "office" as const,
							workCategoryId: terminalPeriod.workCategoryId,
						},
					}
				: {}),
			legacyApprovalRequestId: ids.approval,
			transition: { kind: "approve" as const, reason: null },
			finalizedAt: parseInstant("2026-07-20T09:00:00Z"),
			allowMetadataLessLegacyFallback: false,
			...overrides,
		};
		const evidenceDbService = dbService as ApprovalDbService & {
			setPersistedEvidence?: (
				correction: TimeCorrectionWorkflowPayload["timeCorrection"],
				transition: FinalizeTimeCorrectionTerminalInput["transition"],
			) => void;
		};
		evidenceDbService.setPersistedEvidence?.(
			input.correction,
			input.transition,
		);
		return input;
	}

	function legacyOnlyDb(request: Record<string, unknown> | null) {
		return createFinalizerDb({
			period: { ...terminalPeriod, approvalWorkflowId: null },
			legacyRequest: request,
			workflow: null,
		});
	}

	it.each([
		["requester", { requestedBy: "emp-other" }],
		["organization", { organizationId: "org-other" }],
		["entity type", { entityType: "absence_entry" }],
		["entity id", { entityId: "10000000-0000-4000-8000-000000000099" }],
		["lifecycle", { status: "pending", approvedAt: null }],
	] as const)("rejects legacy approval evidence with mismatched %s", async (_label, patch) => {
		const { dbService, mutations } = legacyOnlyDb({
			...legacyRequest,
			...patch,
		});

		await expect(
			finalizeTimeCorrectionTerminalInTransaction(
				approveInput(dbService, {
					expectedApprovalWorkflowId: null,
					expectedApprovalWorkflowVersion: null,
				}),
			),
		).rejects.toThrow(/changed|finaliz/i);
		expect(mutations).toEqual([]);
	});

	it("approves a category change with current organization entitlement", async () => {
		const proposedCategoryId = "71000000-0000-4000-8000-000000000804";
		const setId = "71000000-0000-4000-8000-000000000805";
		const correction = {
			action: "edit" as const,
			workLocationType: "office" as const,
			workCategoryId: proposedCategoryId,
		};
		const { dbService, mutations } = createFinalizerDb({
			entries: [originalIn, originalOut],
			legacyRequest: null,
			workflow: {
				...canonicalWorkflow,
				contextSnapshot: {
					timeCorrection: correction,
					timeCorrectionOriginalWorkMetadata: {
						workLocationType: "office",
						workCategoryId: terminalPeriod.workCategoryId,
					},
				},
			},
			mutationRows: [[{ id: ids.period }], [{ recordId: ids.canonical }]],
			categoryAuthorization: {
				categories: [
					{ id: proposedCategoryId, organizationId: "org-1", isActive: true },
				],
				assignments: [
					{
						id: "71000000-0000-4000-8000-000000000806",
						organizationId: "org-1",
						assignmentType: "organization",
						employeeId: null,
						teamId: null,
						setId,
						isActive: true,
						effectiveFrom: null,
						effectiveUntil: null,
					},
				],
				sets: [{ id: setId, organizationId: "org-1", isActive: true }],
				setCategories: [
					{ id: "71000000-0000-4000-8000-000000000807" },
				],
			},
		});

		await expect(
			finalizeTimeCorrectionTerminalInTransaction(
				approveInput(dbService, { legacyApprovalRequestId: null, correction }),
			),
		).resolves.toMatchObject({ transition: "approved" });
		expect(mutations).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					table: workPeriod,
					values: expect.objectContaining({ workCategoryId: proposedCategoryId }),
				}),
			]),
		);
	});

	it("does not revalidate an unchanged historical category", async () => {
		const correction = {
			action: "edit" as const,
			workLocationType: "home" as const,
			workCategoryId: terminalPeriod.workCategoryId,
		};
		const { dbService, lockedTables } = createFinalizerDb({
			entries: [originalIn, originalOut],
			legacyRequest: null,
			workflow: {
				...canonicalWorkflow,
				contextSnapshot: {
					timeCorrection: correction,
					timeCorrectionOriginalWorkMetadata: {
						workLocationType: "office",
						workCategoryId: terminalPeriod.workCategoryId,
					},
				},
			},
			mutationRows: [[{ id: ids.period }], [{ recordId: ids.canonical }]],
		});

		await finalizeTimeCorrectionTerminalInTransaction(
			approveInput(dbService, { legacyApprovalRequestId: null, correction }),
		);
		expect(lockedTables).not.toContain(workCategory);
		expect(lockedTables).not.toContain(workCategorySetAssignment);
	});

	it.each([
		[
			"IDs",
			{
				timeCorrection: {
					...terminalCorrection,
					clockInCorrectionId: "10000000-0000-4000-8000-000000000099",
				},
			},
		],
		["action", { timeCorrection: { ...terminalCorrection, action: "delete" } }],
	] as const)("rejects legacy approval metadata with different correction %s", async (_label, metadata) => {
		const { dbService, mutations } = legacyOnlyDb({
			...legacyRequest,
			metadata,
		});

		await expect(
			finalizeTimeCorrectionTerminalInTransaction(
				approveInput(dbService, {
					expectedApprovalWorkflowId: null,
					expectedApprovalWorkflowVersion: null,
				}),
			),
		).rejects.toThrow(/changed|finaliz/i);
		expect(mutations).toEqual([]);
	});

	it.each([
		["requester", { requesterEmployeeId: "emp-other" }],
		["organization", { organizationId: "org-other" }],
		["workflow type", { workflowType: "absence" }],
		["source type", { sourceType: "absence_entry" }],
		["source id", { sourceId: "10000000-0000-4000-8000-000000000099" }],
		["workflow id", { id: "10000000-0000-4000-8000-000000000099" }],
		["terminal status", { status: "pending" }],
		["terminal version", { version: 1 }],
	] as const)("rejects canonical workflow evidence with mismatched %s", async (_label, patch) => {
		const { dbService, mutations } = createFinalizerDb({
			legacyRequest: null,
			workflow: { ...canonicalWorkflow, ...patch },
		});

		await expect(
			finalizeTimeCorrectionTerminalInTransaction(
				approveInput(dbService, { legacyApprovalRequestId: null }),
			),
		).rejects.toThrow(/changed|finaliz/i);
		expect(mutations).toEqual([]);
	});

	it("rejects a persisted canonical version newer than the expected snapshot", async () => {
		const { dbService, mutations } = createFinalizerDb({
			legacyRequest: null,
			workflow: { ...canonicalWorkflow, version: 3 },
		});

		await expect(
			finalizeTimeCorrectionTerminalInTransaction(
				approveInput(dbService, {
					legacyApprovalRequestId: null,
					expectedApprovalWorkflowVersion: 2,
				}),
			),
		).rejects.toThrow(/changed|finaliz/i);
		expect(mutations).toEqual([]);
	});

	it("rejects a canonical workflow ID without an expected version", async () => {
		const { dbService, mutations } = createFinalizerDb({ legacyRequest: null });

		await expect(
			finalizeTimeCorrectionTerminalInTransaction(
				approveInput(dbService, {
					legacyApprovalRequestId: null,
					expectedApprovalWorkflowVersion: null,
				}),
			),
		).rejects.toThrow(/changed|finaliz/i);
		expect(mutations).toEqual([]);
	});

	it("rejects an expected canonical version without a workflow ID", async () => {
		const { dbService, mutations } = legacyOnlyDb(legacyRequest);

		await expect(
			finalizeTimeCorrectionTerminalInTransaction(
				approveInput(dbService, {
					expectedApprovalWorkflowId: null,
					expectedApprovalWorkflowVersion: 2,
				}),
			),
		).rejects.toThrow(/changed|finaliz/i);
		expect(mutations).toEqual([]);
	});

	it("accepts and queries the exact expected canonical workflow version", async () => {
		const { dbService } = createFinalizerDb({ legacyRequest: null });

		await finalizeTimeCorrectionTerminalInTransaction(
			approveInput(dbService, {
				legacyApprovalRequestId: null,
				expectedApprovalWorkflowVersion: 2,
			}),
		);

		const workflowQuery = vi.mocked(
			dbService.db.query.approvalWorkflow.findFirst,
		).mock.calls[0]?.[0] as { where?: unknown } | undefined;
		expect(collectSqlColumnNames(workflowQuery?.where)).toEqual(
			expect.arrayContaining(["id", "organization_id", "version"]),
		);
	});

	it("accepts the real canonical context shape while strictly validating its time correction member", async () => {
		const { dbService, mutations } = createFinalizerDb({
			legacyRequest: null,
			workflow: {
				...canonicalWorkflow,
				contextSnapshot: {
					id: ids.period,
					organizationId: "org-1",
					employeeId: "emp-requester",
					status: "approved",
					source: {
						workPeriod: { id: ids.period, approvalWorkflowId: ids.workflow },
						currentEndpoints: {
							clockIn: { id: ids.originalIn },
							clockOut: { id: ids.originalOut },
						},
					},
					privateRouting: { policyId: "policy-1", stage: 2 },
					timeCorrection: terminalCorrection,
				},
			},
		});

		await finalizeTimeCorrectionTerminalInTransaction(
			approveInput(dbService, { legacyApprovalRequestId: null }),
		);

		expect(mutations).toHaveLength(6);
	});

	it("atomically applies metadata-only approval to legacy and canonical work metadata", async () => {
		const correction = {
			action: "edit" as const,
			workLocationType: "remote" as const,
			workCategoryId: null,
		};
		const { dbService, lockedTables, lockWhereClauses, mutations } =
			createFinalizerDb({
				entries: [originalIn, originalOut],
				legacyRequest: null,
				workflow: {
					...canonicalWorkflow,
					contextSnapshot: {
						timeCorrection: correction,
						timeCorrectionOriginalWorkMetadata: {
							workLocationType: "office",
							workCategoryId: terminalPeriod.workCategoryId,
						},
					},
				},
				mutationRows: [[{ id: ids.period }], [{ recordId: ids.canonical }]],
			});

		await finalizeTimeCorrectionTerminalInTransaction(
			approveInput(dbService, {
				legacyApprovalRequestId: null,
				correction,
			}),
		);

		expect(mutations.filter(({ table }) => table === timeEntry)).toEqual([]);
		expect(mutations).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					table: workPeriod,
					values: expect.objectContaining({
						workLocationType: "remote",
						workCategoryId: null,
					}),
				}),
				expect.objectContaining({
					table: timeRecordWork,
					values: {
						workLocationType: "remote",
						workCategoryId: null,
					},
				}),
			]),
		);
		expect(lockedTables).toEqual([
			employee,
			workPeriod,
			timeEntry,
			timeRecord,
			timeRecordWork,
		]);
		expect(collectSqlColumnNames(lockWhereClauses[4])).toEqual(
			expect.arrayContaining(["record_id", "organization_id", "record_kind"]),
		);
		const canonicalWorkMutation = mutations.find(
			({ table }) => table === timeRecordWork,
		);
		expect(collectSqlColumnNames(canonicalWorkMutation?.where)).toEqual(
			expect.arrayContaining([
				"record_id",
				"organization_id",
				"record_kind",
				"work_location_type",
				"work_category_id",
			]),
		);
	});

	it("applies a clock-in correction before an active period has a canonical record", async () => {
		const correction = {
			action: "edit" as const,
			clockInCorrectionId: ids.correctionIn,
			workLocationType: "office" as const,
			workCategoryId: terminalPeriod.workCategoryId,
		};
		const { dbService, mutations } = createFinalizerDb({
			period: {
				...terminalPeriod,
				clockOutId: null,
				canonicalRecordId: null,
				endTime: null,
				durationMinutes: null,
				isActive: true,
			},
			entries: [originalIn, correctionIn],
			canonical: null,
			canonicalWork: null,
			legacyRequest: null,
			workflow: {
				...canonicalWorkflow,
				contextSnapshot: {
					timeCorrection: correction,
					timeCorrectionOriginalWorkMetadata: {
						workLocationType: "office",
						workCategoryId: terminalPeriod.workCategoryId,
					},
				},
			},
			mutationRows: [
				[{ id: ids.correctionIn }],
				[{ id: ids.originalIn }],
				[{ id: ids.period }],
			],
		});

		const result = await finalizeTimeCorrectionTerminalInTransaction(
			approveInput(dbService, {
				legacyApprovalRequestId: null,
				correction,
			}),
		);

		expect(result.transition).toBe("approved");
		expect(mutations.map(({ table }) => table)).toEqual([
			timeEntry,
			timeEntry,
			workPeriod,
		]);
		expect(mutations.at(-1)?.values).toMatchObject({
			clockInId: ids.correctionIn,
			clockOutId: null,
			endTime: null,
			durationMinutes: null,
		});
	});

	it("does not extend the missing-canonical exception to rejection", async () => {
		const correction = {
			action: "edit" as const,
			clockInCorrectionId: ids.correctionIn,
			workLocationType: "office" as const,
			workCategoryId: terminalPeriod.workCategoryId,
		};
		const { dbService, mutations } = createFinalizerDb({
			period: {
				...terminalPeriod,
				clockOutId: null,
				canonicalRecordId: null,
				endTime: null,
				durationMinutes: null,
				isActive: true,
			},
			entries: [originalIn, correctionIn],
			canonical: null,
			canonicalWork: null,
			legacyRequest: null,
			workflow: {
				...canonicalWorkflow,
				status: "rejected",
				contextSnapshot: {
					timeCorrection: correction,
					timeCorrectionOriginalWorkMetadata: {
						workLocationType: "office",
						workCategoryId: terminalPeriod.workCategoryId,
					},
				},
			},
		});

		await expect(
			finalizeTimeCorrectionTerminalInTransaction(
				approveInput(dbService, {
					legacyApprovalRequestId: null,
					correction,
					transition: { kind: "reject", reason: "invalid" },
				}),
			),
		).rejects.toMatchObject({
			message: "Time correction source changed during finalization",
			details: { reason: "missing_canonical_record" },
		});
		expect(mutations).toEqual([]);
	});

	it("rejects a completed period whose canonical record is missing", async () => {
		const correction = {
			action: "edit" as const,
			clockInCorrectionId: ids.correctionIn,
			workLocationType: "office" as const,
			workCategoryId: terminalPeriod.workCategoryId,
		};
		const { dbService, mutations } = createFinalizerDb({
			period: { ...terminalPeriod, canonicalRecordId: null },
			entries: [originalIn, originalOut, correctionIn],
			canonical: null,
			canonicalWork: null,
			legacyRequest: null,
			workflow: {
				...canonicalWorkflow,
				contextSnapshot: {
					timeCorrection: correction,
					timeCorrectionOriginalWorkMetadata: {
						workLocationType: "office",
						workCategoryId: terminalPeriod.workCategoryId,
					},
				},
			},
		});

		await expect(
			finalizeTimeCorrectionTerminalInTransaction(
				approveInput(dbService, {
					legacyApprovalRequestId: null,
					correction,
				}),
			),
		).rejects.toMatchObject({
			message: "Time correction source changed during finalization",
			details: { reason: "missing_canonical_record" },
		});
		expect(mutations).toEqual([]);
	});

	it.each([
		["category disabled", { categoryActive: false }],
		["category moved to another organization", { categoryOrganizationId: "org-2" }],
		["category removed from the assigned set", { includeSetCategory: false }],
		["category assignment inactive", { assignmentActive: false }],
		[
			"category assignment expired",
			{ effectiveUntil: new Date("2020-01-01T00:00:00.000Z") },
		],
		["employee team changed", { includeMembership: false, assignmentType: "team" }],
	] as const)("fails a category-changing approval closed when %s", async (_label, revocation) => {
		const revoked = revocation as {
			categoryActive?: boolean;
			categoryOrganizationId?: string;
			includeSetCategory?: boolean;
			assignmentActive?: boolean;
			effectiveUntil?: Date;
			includeMembership?: boolean;
			assignmentType?: "organization" | "team";
		};
		const correction = {
			action: "edit" as const,
			workLocationType: "office" as const,
			workCategoryId: "71000000-0000-4000-8000-000000000804",
		};
		const teamId = "71000000-0000-4000-8000-000000000803";
		const setId = "71000000-0000-4000-8000-000000000805";
		const { dbService, mutations } = createFinalizerDb({
			entries: [originalIn, originalOut],
			legacyRequest: null,
			workflow: {
				...canonicalWorkflow,
				contextSnapshot: {
					timeCorrection: correction,
					timeCorrectionOriginalWorkMetadata: {
						workLocationType: "office",
						workCategoryId: terminalPeriod.workCategoryId,
					},
				},
			},
			categoryAuthorization: {
				memberships: revoked.includeMembership === false ? [] : [
					{
						employeeId: "emp-requester",
						organizationId: "org-1",
						teamId,
					},
				],
				teams: [
					{
						id: teamId,
						organizationId: "org-1",
					},
				],
				categories: [
					{
						id: correction.workCategoryId,
						organizationId: revoked.categoryOrganizationId ?? "org-1",
						isActive: revoked.categoryActive ?? true,
					},
				],
				assignments: [
					{
						id: "71000000-0000-4000-8000-000000000806",
						organizationId: "org-1",
						assignmentType: revoked.assignmentType ?? "organization",
						employeeId: null,
						teamId: revoked.assignmentType === "team" ? teamId : null,
						setId,
						isActive: revoked.assignmentActive ?? true,
						effectiveFrom: null,
						effectiveUntil: revoked.effectiveUntil ?? null,
					},
				],
				sets: [{ id: setId, organizationId: "org-1", isActive: true }],
				setCategories:
					revoked.includeSetCategory === false
						? []
						: [{ id: "71000000-0000-4000-8000-000000000807" }],
			},
		});

		await expect(
			finalizeTimeCorrectionTerminalInTransaction(
				approveInput(dbService, {
					legacyApprovalRequestId: null,
					correction,
				}),
			),
		).rejects.toThrow(/category|finaliz|changed/i);
		expect(mutations).toEqual([]);
	});

	it.each([
		["zero", []],
		["multiple", [{ recordId: ids.canonical }, { recordId: ids.canonical }]],
	] as const)(
		"fails metadata-only approval when canonical work CAS returns %s rows",
		async (_label, canonicalWorkRows) => {
			const correction = {
				action: "edit" as const,
				workLocationType: "remote" as const,
				workCategoryId: null,
			};
			const { dbService } = createFinalizerDb({
				entries: [originalIn, originalOut],
				legacyRequest: null,
				workflow: {
					...canonicalWorkflow,
					contextSnapshot: {
						timeCorrection: correction,
						timeCorrectionOriginalWorkMetadata: {
							workLocationType: "office",
							workCategoryId: terminalPeriod.workCategoryId,
						},
					},
				},
				mutationRows: [[{ id: ids.period }], [...canonicalWorkRows]],
			});

			await expect(
				finalizeTimeCorrectionTerminalInTransaction(
					approveInput(dbService, {
						legacyApprovalRequestId: null,
						correction,
					}),
				),
			).rejects.toThrow("Time correction source changed during finalization");
		},
	);

	it("fails metadata-only approval before writes when canonical work metadata diverges", async () => {
		const correction = {
			action: "edit" as const,
			workLocationType: "remote" as const,
			workCategoryId: null,
		};
		const { dbService, mutations } = createFinalizerDb({
			entries: [originalIn, originalOut],
			canonicalWork: {
				...canonicalWorkRecord,
				workLocationType: "home",
			},
			legacyRequest: null,
			workflow: {
				...canonicalWorkflow,
				contextSnapshot: {
					timeCorrection: correction,
					timeCorrectionOriginalWorkMetadata: {
						workLocationType: "office",
						workCategoryId: terminalPeriod.workCategoryId,
					},
				},
			},
		});

		await expect(
			finalizeTimeCorrectionTerminalInTransaction(
				approveInput(dbService, {
					legacyApprovalRequestId: null,
					correction,
				}),
			),
		).rejects.toMatchObject({
			message: "Time correction source changed during finalization",
			details: { reason: "canonical_work_source_mismatch" },
		});
		expect(mutations).toEqual([]);
	});

	it("fails metadata-only approval when both metadata rows drift from immutable source evidence", async () => {
		const correction = {
			action: "edit" as const,
			workLocationType: "remote" as const,
			workCategoryId: null,
		};
		const { dbService, mutations } = createFinalizerDb({
			period: { ...terminalPeriod, workLocationType: "home" },
			entries: [originalIn, originalOut],
			canonicalWork: { ...canonicalWorkRecord, workLocationType: "home" },
			legacyRequest: null,
			workflow: {
				...canonicalWorkflow,
				contextSnapshot: {
					timeCorrection: correction,
					timeCorrectionOriginalWorkMetadata: {
						workLocationType: "office",
						workCategoryId: terminalPeriod.workCategoryId,
					},
				},
			},
		});

		await expect(
			finalizeTimeCorrectionTerminalInTransaction(
				approveInput(dbService, {
					legacyApprovalRequestId: null,
					correction,
					expectedSource: terminalExpectedSource(true),
				}),
			),
		).rejects.toThrow("Time correction source changed during finalization");
		expect(mutations).toEqual([]);
	});

	it("reports immutable endpoint drift as a finalization conflict", async () => {
		const expectedSource = terminalExpectedSource();
		expectedSource.currentEndpoints.clockIn.timestamp = parseInstant(
			"2026-07-18T22:31:00Z",
		);
		const { dbService, mutations } = createFinalizerDb({ legacyRequest: null });

		await expect(
			finalizeTimeCorrectionTerminalInTransaction(
				approveInput(dbService, {
					legacyApprovalRequestId: null,
					expectedSource,
				}),
			),
		).rejects.toThrow("Time correction source changed during finalization");
		expect(mutations).toEqual([]);
	});

	it("leaves both metadata rows unchanged on rejection", async () => {
		const correction = {
			action: "edit" as const,
			workLocationType: "remote" as const,
			workCategoryId: null,
		};
		const { dbService, mutations } = createFinalizerDb({
			entries: [originalIn, originalOut],
			legacyRequest: null,
			workflow: {
				...canonicalWorkflow,
				status: "rejected",
				contextSnapshot: {
					timeCorrection: correction,
					timeCorrectionOriginalWorkMetadata: {
						workLocationType: "office",
						workCategoryId: terminalPeriod.workCategoryId,
					},
				},
			},
		});

		await finalizeTimeCorrectionTerminalInTransaction(
			approveInput(dbService, {
				legacyApprovalRequestId: null,
				correction,
				transition: { kind: "reject", reason: "No change" },
			}),
		);

		expect(mutations).toEqual([]);
		expect(terminalPeriod.workLocationType).toBe("office");
		expect(canonicalWorkRecord.workLocationType).toBe("office");
	});

	it.each([
		["changed location", { workLocationType: "home", workCategoryId: null }],
		[
			"changed category",
			{
				workLocationType: "office",
				workCategoryId: "10000000-0000-4000-8000-000000000099",
			},
		],
		["legacy/current mismatch", null],
	] as const)(
		"rejects canonical correction equality with %s",
		async (_label, metadata) => {
			const expectedCorrection = {
				...terminalCorrection,
				workLocationType: "office" as const,
				workCategoryId: null,
			};
			const observedCorrection = metadata
				? { ...terminalCorrection, ...metadata }
				: terminalCorrection;
			const { dbService, mutations } = createFinalizerDb({
				legacyRequest: null,
				workflow: {
					...canonicalWorkflow,
					contextSnapshot: {
						timeCorrection: observedCorrection,
						timeCorrectionOriginalWorkMetadata: {
							workLocationType: "office",
							workCategoryId: terminalPeriod.workCategoryId,
						},
					},
				},
			});

			await expect(
				finalizeTimeCorrectionTerminalInTransaction(
					approveInput(dbService, {
						legacyApprovalRequestId: null,
						correction: expectedCorrection,
					}),
				),
			).rejects.toThrow("Time correction source changed during finalization");
			expect(mutations).toEqual([]);
		},
	);

	it.each([
		["missing", { source: { id: ids.period } }],
		[
			"malformed",
			{ timeCorrection: { action: "edit", clockInCorrectionId: "bad-id" } },
		],
		[
			"extra-key",
			{
				timeCorrection: {
					...terminalCorrection,
					unexpected: "evidence",
				},
			},
		],
	] as const)(
		"rejects canonical context with %s time correction evidence",
		async (_label, contextSnapshot) => {
			const { dbService, mutations } = createFinalizerDb({
				legacyRequest: null,
				workflow: { ...canonicalWorkflow, contextSnapshot },
			});

			await expect(
				finalizeTimeCorrectionTerminalInTransaction(
					approveInput(dbService, { legacyApprovalRequestId: null }),
				),
			).rejects.toThrow("Time correction source changed during finalization");
			expect(mutations).toEqual([]);
		},
	);

	it.each(["inherited", "accessor"] as const)(
		"rejects canonical context with an %s time correction member",
		async (shape) => {
			const contextSnapshot =
				shape === "inherited"
					? Object.assign(
							Object.create({ timeCorrection: terminalCorrection }),
							{
								source: { id: ids.period },
							},
						)
					: Object.defineProperty(
							{ source: { id: ids.period } },
							"timeCorrection",
							{
								enumerable: true,
								get: () => terminalCorrection,
							},
						);
			const { dbService, mutations } = createFinalizerDb({
				legacyRequest: null,
				workflow: { ...canonicalWorkflow, contextSnapshot },
			});

			await expect(
				finalizeTimeCorrectionTerminalInTransaction(
					approveInput(dbService, { legacyApprovalRequestId: null }),
				),
			).rejects.toThrow("Time correction source changed during finalization");
			expect(mutations).toEqual([]);
		},
	);

	it.each([
		["approve", "approved", { kind: "approve", reason: null }],
		["reject", "rejected", { kind: "reject", reason: "Incorrect time" }],
	] as const)(
		"accepts a pending compatibility request during canonical %s finalization",
		async (_label, status, transition) => {
			const { dbService } = createFinalizerDb({
				legacyRequest: {
					...legacyRequest,
					status: "pending",
					approvedAt: null,
					rejectionReason: null,
					metadata: canonicalCompatibilityMetadata,
				},
				workflow: { ...canonicalWorkflow, status },
			});

			await expect(
				finalizeTimeCorrectionTerminalInTransaction(
					approveInput(dbService, { transition }),
				),
			).resolves.toMatchObject({
				transition: status,
				requesterEmployeeId: "emp-requester",
			});
		},
	);

	it.each([
		["pending", "pending", null],
		["terminal mirror", "approved", new Date("2026-07-20T09:00:00.000Z")],
	] as const)("accepts canonical %s compatibility metadata with workflow and stage bindings", async (_label, status, approvedAt) => {
		const { dbService } = createFinalizerDb({
			legacyRequest: {
				...legacyRequest,
				status,
				approvedAt,
				rejectionReason: null,
				metadata: canonicalCompatibilityMetadata,
			},
		});

		await expect(
			finalizeTimeCorrectionTerminalInTransaction(approveInput(dbService)),
		).resolves.toMatchObject({ transition: "approved" });
	});

	it.each([
		[
			"workflow ID mismatch",
			{
				...canonicalCompatibilityMetadata,
				workflow: {
					...canonicalCompatibilityMetadata.workflow,
					id: "10000000-0000-4000-8000-000000000099",
				},
			},
		],
		[
			"workflow organization mismatch",
			{
				...canonicalCompatibilityMetadata,
				workflow: {
					...canonicalCompatibilityMetadata.workflow,
					organizationId: "org-other",
				},
			},
		],
		[
			"missing workflow binding",
			{
				stage: canonicalCompatibilityMetadata.stage,
				timeCorrection: terminalCorrection,
			},
		],
		[
			"malformed workflow binding",
			{ ...canonicalCompatibilityMetadata, workflow: null },
		],
		["old legacy-only metadata", { timeCorrection: terminalCorrection }],
		[
			"nested correction mismatch",
			{
				...canonicalCompatibilityMetadata,
				timeCorrection: {
					...terminalCorrection,
					clockInCorrectionId: "10000000-0000-4000-8000-000000000099",
				},
			},
		],
		[
			"extra nested correction key",
			{
				...canonicalCompatibilityMetadata,
				timeCorrection: { ...terminalCorrection, unexpected: true },
			},
		],
	] as const)(
		"rejects canonical compatibility metadata with %s",
		async (_label, metadata) => {
			const { dbService, mutations } = createFinalizerDb({
				legacyRequest: { ...legacyRequest, metadata },
			});

			await expect(
				finalizeTimeCorrectionTerminalInTransaction(approveInput(dbService)),
			).rejects.toThrow("Time correction source changed during finalization");
			expect(mutations).toEqual([]);
		},
	);

	it.each(["inherited", "accessor"] as const)(
		"rejects canonical compatibility metadata with an %s workflow binding",
		async (shape) => {
			const metadata =
				shape === "inherited"
					? Object.assign(
							Object.create({
								workflow: canonicalCompatibilityMetadata.workflow,
							}),
							{
								stage: canonicalCompatibilityMetadata.stage,
								timeCorrection: terminalCorrection,
							},
						)
					: Object.defineProperty(
							{
								stage: canonicalCompatibilityMetadata.stage,
								timeCorrection: terminalCorrection,
							},
							"workflow",
							{
								enumerable: true,
								get: () => canonicalCompatibilityMetadata.workflow,
							},
						);
			const { dbService, mutations } = createFinalizerDb({
				legacyRequest: { ...legacyRequest, metadata },
			});

			await expect(
				finalizeTimeCorrectionTerminalInTransaction(approveInput(dbService)),
			).rejects.toThrow("Time correction source changed during finalization");
			expect(mutations).toEqual([]);
		},
	);

	it("preserves legacy-authoritative normalized metadata without workflow or stage bindings", async () => {
		const { dbService } = legacyOnlyDb(legacyRequest);

		await expect(
			finalizeTimeCorrectionTerminalInTransaction(
				approveInput(dbService, {
					expectedApprovalWorkflowId: null,
					expectedApprovalWorkflowVersion: null,
				}),
			),
		).resolves.toMatchObject({ transition: "approved" });
	});

	it("rejects a pure-legacy metadata change when the canonical work record is missing", async () => {
		const correction = {
			action: "edit" as const,
			workLocationType: "remote" as const,
			workCategoryId: null,
		};
		const { dbService, mutations } = createFinalizerDb({
			period: {
				...terminalPeriod,
				approvalWorkflowId: null,
				canonicalRecordId: null,
			},
			entries: [originalIn, originalOut],
			canonical: null,
			canonicalWork: null,
			legacyRequest: {
				...legacyRequest,
				metadata: {
					timeCorrection: correction,
					timeCorrectionOriginalWorkMetadata: {
						workLocationType: "office",
						workCategoryId: terminalPeriod.workCategoryId,
					},
				},
			},
			workflow: null,
		});

		await expect(
			finalizeTimeCorrectionTerminalInTransaction(
				approveInput(dbService, {
					expectedApprovalWorkflowId: null,
					expectedApprovalWorkflowVersion: null,
					correction,
				}),
			),
		).rejects.toThrow("Time correction source changed during finalization");
		expect(mutations).toEqual([]);
	});

	it("rejects a pure-legacy metadata change when canonical work metadata diverges", async () => {
		const correction = {
			action: "edit" as const,
			workLocationType: "remote" as const,
			workCategoryId: null,
		};
		const { dbService, mutations } = createFinalizerDb({
			period: { ...terminalPeriod, approvalWorkflowId: null },
			entries: [originalIn, originalOut],
			canonicalWork: { ...canonicalWorkRecord, workLocationType: "home" },
			legacyRequest: {
				...legacyRequest,
				metadata: {
					timeCorrection: correction,
					timeCorrectionOriginalWorkMetadata: {
						workLocationType: "office",
						workCategoryId: terminalPeriod.workCategoryId,
					},
				},
			},
			workflow: null,
		});

		await expect(
			finalizeTimeCorrectionTerminalInTransaction(
				approveInput(dbService, {
					expectedApprovalWorkflowId: null,
					expectedApprovalWorkflowVersion: null,
					correction,
				}),
			),
		).rejects.toThrow("Time correction source changed during finalization");
		expect(mutations).toEqual([]);
	});

	it("accepts a pure-legacy v1 timestamp correction without a canonical record", async () => {
		const { dbService } = createFinalizerDb({
			period: {
				...terminalPeriod,
				approvalWorkflowId: null,
				canonicalRecordId: null,
			},
			canonical: null,
			canonicalWork: null,
			legacyRequest,
			workflow: null,
		});

		await expect(
			finalizeTimeCorrectionTerminalInTransaction(
				approveInput(dbService, {
					expectedApprovalWorkflowId: null,
					expectedApprovalWorkflowVersion: null,
				}),
			),
		).resolves.toMatchObject({ transition: "approved" });
	});

	it.each([
		["approve", "approved", "rejected", { kind: "approve", reason: null }],
		[
			"reject",
			"rejected",
			"approved",
			{ kind: "reject", reason: "Incorrect time" },
		],
	] as const)("rejects an opposite terminal compatibility request during canonical %s finalization", async (_label, canonicalStatus, legacyStatus, transition) => {
		const { dbService, mutations } = createFinalizerDb({
			legacyRequest: {
				...legacyRequest,
				status: legacyStatus,
				approvedAt: new Date("2026-07-20T09:00:00.000Z"),
				rejectionReason: legacyStatus === "rejected" ? "Incorrect time" : null,
				metadata: canonicalCompatibilityMetadata,
			},
			workflow: { ...canonicalWorkflow, status: canonicalStatus },
		});

		await expect(
			finalizeTimeCorrectionTerminalInTransaction(
				approveInput(dbService, { transition }),
			),
		).rejects.toThrow("Time correction source changed during finalization");
		expect(mutations).toEqual([]);
	});

	it("rejects canonical immutable context with different correction payload", async () => {
		const { dbService, mutations } = createFinalizerDb({
			legacyRequest: null,
			workflow: {
				...canonicalWorkflow,
				contextSnapshot: {
					timeCorrection: {
						...terminalCorrection,
						clockOutCorrectionId: "10000000-0000-4000-8000-000000000099",
					},
				},
			},
		});

		await expect(
			finalizeTimeCorrectionTerminalInTransaction(
				approveInput(dbService, { legacyApprovalRequestId: null }),
			),
		).rejects.toThrow(/changed|finaliz/i);
		expect(mutations).toEqual([]);
	});

	it("fails closed when no persisted approval evidence is supplied", async () => {
		const { dbService, mutations } = legacyOnlyDb(null);

		await expect(
			finalizeTimeCorrectionTerminalInTransaction(
				approveInput(dbService, {
					expectedApprovalWorkflowId: null,
					expectedApprovalWorkflowVersion: null,
					legacyApprovalRequestId: null,
				}),
			),
		).rejects.toThrow(/changed|finaliz/i);
		expect(mutations).toEqual([]);
	});

	it("fails closed when legacy and canonical requester evidence disagree", async () => {
		const { dbService, mutations } = createFinalizerDb({
			legacyRequest: {
				...legacyRequest,
				requestedBy: "emp-other",
				metadata: canonicalCompatibilityMetadata,
			},
		});

		await expect(
			finalizeTimeCorrectionTerminalInTransaction(approveInput(dbService)),
		).rejects.toThrow(/changed|finaliz/i);
		expect(mutations).toEqual([]);
	});

	it("fails closed on metadata-less legacy approval", async () => {
		const { dbService, mutations } = legacyOnlyDb({
			...legacyRequest,
			metadata: null,
		});

		await expect(
			finalizeTimeCorrectionTerminalInTransaction(
				approveInput(dbService, {
					expectedApprovalWorkflowId: null,
					expectedApprovalWorkflowVersion: null,
					allowMetadataLessLegacyFallback: true,
				}),
			),
		).rejects.toThrow(/changed|finaliz/i);
		expect(mutations).toEqual([]);
	});

	it("locks scoped employees, work period, endpoints, and canonical record before mutation", async () => {
		const { dbService, lockedTables, lockWhereClauses, mutations } =
			createFinalizerDb();

		await finalizeTimeCorrectionTerminalInTransaction(approveInput(dbService));

		expect(lockedTables).toEqual([employee, workPeriod, timeEntry, timeRecord]);
		expect(mutations).toHaveLength(6);
		expect(collectSqlColumnNames(lockWhereClauses[0])).toEqual(
			expect.arrayContaining(["id", "organization_id", "is_active"]),
		);
		expect(collectSqlColumnNames(lockWhereClauses[1])).toEqual(
			expect.arrayContaining(["id", "organization_id"]),
		);
		expect(collectSqlColumnNames(lockWhereClauses[2])).toEqual(
			expect.arrayContaining(["id", "organization_id", "employee_id"]),
		);
	});

	it("applies two endpoint edits with exact CAS and returns local dirty-date facts", async () => {
		const { dbService, mutations, transaction } = createFinalizerDb();

		const result = await finalizeTimeCorrectionTerminalInTransaction(
			approveInput(dbService),
		);

		expect(result).toEqual({
			transition: "approved",
			requesterEmployeeId: "emp-requester",
			dirtyFromDate: "2026-07-18",
		});
		expect(mutations.map((mutation) => mutation.table)).toEqual([
			timeEntry,
			timeEntry,
			timeEntry,
			timeEntry,
			workPeriod,
			timeRecord,
		]);
		expect(mutations[4].values).toMatchObject({
			clockInId: ids.correctionIn,
			clockOutId: ids.correctionOut,
			startTime: correctionIn.timestamp,
			endTime: correctionOut.timestamp,
			durationMinutes: 210,
		});
		expect(mutations[5].values).toMatchObject({
			startAt: correctionIn.timestamp,
			endAt: correctionOut.timestamp,
			durationMinutes: 210,
			updatedBy: "user-manager",
		});
		for (const mutation of mutations) {
			expect(collectSqlColumnNames(mutation.where)).toContain(
				"organization_id",
			);
		}
		expect(transaction).not.toHaveBeenCalled();
		expect(markEmployeeWorkBalanceDirty).not.toHaveBeenCalled();
		expect(onTimeCorrectionApproved).not.toHaveBeenCalled();
	});

	it("applies a later correction cycle while preserving prior endpoint history", async () => {
		const currentIn = { ...correctionIn, isSuperseded: false };
		const currentOut = { ...correctionOut, isSuperseded: false };
		const historicalIn = {
			...originalIn,
			isSuperseded: true,
			supersededById: ids.correctionIn,
		};
		const historicalOut = {
			...originalOut,
			isSuperseded: true,
			supersededById: ids.correctionOut,
		};
		const nextIn = {
			...correctionIn,
			id: ids.nextCorrectionIn,
			timestamp: new Date("2026-07-19T04:00:00.000Z"),
			replacesEntryId: ids.correctionIn,
			isSuperseded: true,
		};
		const nextOut = {
			...correctionOut,
			id: ids.nextCorrectionOut,
			timestamp: new Date("2026-07-19T08:00:00.000Z"),
			replacesEntryId: ids.correctionOut,
			isSuperseded: true,
		};
		const laterCorrection = {
			action: "edit" as const,
			clockInCorrectionId: ids.nextCorrectionIn,
			clockOutCorrectionId: ids.nextCorrectionOut,
		};
		const { dbService, mutations } = createFinalizerDb({
			period: {
				...terminalPeriod,
				clockInId: ids.correctionIn,
				clockOutId: ids.correctionOut,
				startTime: currentIn.timestamp,
				endTime: currentOut.timestamp,
				durationMinutes: 210,
			},
			canonical: {
				...canonicalRecord,
				startAt: currentIn.timestamp,
				endAt: currentOut.timestamp,
				durationMinutes: 210,
			},
			entries: [currentIn, currentOut, nextIn, nextOut],
			historicalEntries: [historicalIn, historicalOut],
			mutationRows: [
				[{ id: ids.nextCorrectionIn }],
				[{ id: ids.correctionIn }],
				[{ id: ids.nextCorrectionOut }],
				[{ id: ids.correctionOut }],
				[{ id: ids.period }],
				[{ id: ids.canonical }],
			],
		});

		await expect(
			finalizeTimeCorrectionTerminalInTransaction(
				approveInput(dbService, { correction: laterCorrection }),
			),
		).resolves.toEqual({
			transition: "approved",
			requesterEmployeeId: "emp-requester",
			dirtyFromDate: "2026-07-18",
		});
		expect(mutations.map((mutation) => mutation.table)).toEqual([
			timeEntry,
			timeEntry,
			timeEntry,
			timeEntry,
			workPeriod,
			timeRecord,
		]);
		expect(mutations[4]?.values).toMatchObject({
			clockInId: ids.nextCorrectionIn,
			clockOutId: ids.nextCorrectionOut,
			startTime: nextIn.timestamp,
			endTime: nextOut.timestamp,
			durationMinutes: 240,
		});
		expect(collectTerminalBoundValues(mutations[1]?.where)).toEqual(
			expect.arrayContaining([ids.correctionIn, ids.originalIn]),
		);
		expect(mutations[1]?.values).toMatchObject({
			supersededById: ids.nextCorrectionIn,
		});
		expect(collectTerminalBoundValues(mutations[3]?.where)).toEqual(
			expect.arrayContaining([ids.correctionOut, ids.originalOut]),
		);
		expect(mutations[3]?.values).toMatchObject({
			supersededById: ids.nextCorrectionOut,
		});
	});

	it("preserves an untouched clock-out for a clock-in-only correction", async () => {
		const { dbService, mutations } = createFinalizerDb({
			entries: [originalIn, originalOut, correctionIn],
			mutationRows: [
				[{ id: ids.correctionIn }],
				[{ id: ids.originalIn }],
				[{ id: ids.period }],
				[{ id: ids.canonical }],
			],
		});

		await finalizeTimeCorrectionTerminalInTransaction(
			approveInput(dbService, {
				correction: { action: "edit", clockInCorrectionId: ids.correctionIn },
			}),
		);

		expect(mutations[2].values).toMatchObject({
			clockInId: ids.correctionIn,
			clockOutId: ids.originalOut,
			endTime: originalOut.timestamp,
		});
	});

	it("leaves modern rejected corrections inactive and source records unchanged", async () => {
		const { dbService, mutations } = createFinalizerDb();

		const result = await finalizeTimeCorrectionTerminalInTransaction(
			approveInput(dbService, {
				transition: { kind: "reject", reason: "Incorrect times" },
			}),
		);

		expect(result).toEqual({
			transition: "rejected",
			requesterEmployeeId: "emp-requester",
			dirtyFromDate: null,
		});
		expect(mutations).toEqual([]);
	});

	it.each([
		["zero", []],
		["multiple", [{ id: ids.correctionIn }, { id: ids.correctionIn }]],
	] as const)("fails approval when a correction activation returns %s rows", async (_label, rows) => {
		const { dbService, mutations } = createFinalizerDb({
			mutationRows: [[...rows]],
		});

		await expect(
			finalizeTimeCorrectionTerminalInTransaction(approveInput(dbService)),
		).rejects.toThrow(/conflict|changed|finaliz/i);
		expect(mutations).toHaveLength(1);
	});

	it("rejects stale workflow links before writing", async () => {
		const { dbService, mutations } = createFinalizerDb({
			period: {
				...terminalPeriod,
				approvalWorkflowId: "10000000-0000-4000-8000-000000000099",
			},
		});

		await expect(
			finalizeTimeCorrectionTerminalInTransaction(approveInput(dbService)),
		).rejects.toThrow(/conflict|changed|workflow/i);
		expect(mutations).toEqual([]);
	});

	it("rejects a non-approved work-period source state before writing", async () => {
		const { dbService, mutations } = createFinalizerDb({
			period: { ...terminalPeriod, approvalStatus: "rejected" },
		});

		await expect(
			finalizeTimeCorrectionTerminalInTransaction(approveInput(dbService)),
		).rejects.toThrow(/changed|finaliz/i);
		expect(mutations).toEqual([]);
	});

	it("rejects stale canonical current-value parity before writing", async () => {
		const { dbService, mutations } = createFinalizerDb({
			canonical: {
				...canonicalRecord,
				startAt: new Date("2026-07-18T22:31:00.000Z"),
			},
		});

		await expect(
			finalizeTimeCorrectionTerminalInTransaction(approveInput(dbService)),
		).rejects.toThrow(/changed|finaliz/i);
		expect(mutations).toEqual([]);
	});

	it("rejects mismatched endpoint offset evidence before writing", async () => {
		const { dbService, mutations } = createFinalizerDb({
			entries: [
				originalIn,
				originalOut,
				{ ...correctionIn, utcOffsetMinutes: -300 },
				correctionOut,
			],
		});

		await expect(
			finalizeTimeCorrectionTerminalInTransaction(approveInput(dbService)),
		).rejects.toThrow(/changed|finaliz/i);
		expect(mutations).toEqual([]);
	});

	it("rejects untrusted timezone-source evidence before writing", async () => {
		const { dbService, mutations } = createFinalizerDb({
			entries: [
				originalIn,
				originalOut,
				{ ...correctionIn, timezoneSource: "viewer" },
				correctionOut,
			],
		});

		await expect(
			finalizeTimeCorrectionTerminalInTransaction(approveInput(dbService)),
		).rejects.toThrow(/changed|finaliz/i);
		expect(mutations).toEqual([]);
	});

	it.each([
		[
			"work period",
			[
				[{ id: ids.correctionIn }],
				[{ id: ids.originalIn }],
				[{ id: ids.correctionOut }],
				[{ id: ids.originalOut }],
				[],
			],
		],
		[
			"canonical record",
			[
				[{ id: ids.correctionIn }],
				[{ id: ids.originalIn }],
				[{ id: ids.correctionOut }],
				[{ id: ids.originalOut }],
				[{ id: ids.period }],
				[{ id: ids.canonical }, { id: ids.canonical }],
			],
		],
	] as const)("fails when the %s CAS has unexpected affected-row evidence", async (_label, rows) => {
		const { dbService } = createFinalizerDb({
			mutationRows: rows.map((row) => [...row]),
		});

		await expect(
			finalizeTimeCorrectionTerminalInTransaction(approveInput(dbService)),
		).rejects.toThrow(/changed|finaliz/i);
	});

	it("commits finalization once and leaves durable state unchanged on a duplicate attempt", async () => {
		const harness = createStatefulFinalizerTransaction();

		await harness.finalize();
		const committed = harness.snapshot();
		expect(committed.entries).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					id: ids.originalIn,
					isSuperseded: true,
					supersededById: ids.correctionIn,
				}),
				expect.objectContaining({
					id: ids.correctionIn,
					isSuperseded: false,
				}),
			]),
		);

		await expect(harness.finalize()).rejects.toThrow(/changed|finaliz/i);
		expect(harness.snapshot()).toEqual(committed);
	});

	it.each([
		["work period", "workPeriod", workPeriod],
		["canonical record", "canonical", timeRecord],
	] as const)("rolls back every earlier write when the late %s CAS fails", async (_label, failAt, failedTable) => {
		const harness = createStatefulFinalizerTransaction(failAt);
		const before = harness.snapshot();

		await expect(harness.finalize()).rejects.toThrow(/changed|finaliz/i);

		expect(harness.attemptedTables).toContain(failedTable);
		expect(harness.snapshot()).toEqual(before);
	});

	it("applies deletion sentinels with the supplied finalization instant and legacy actor fields", async () => {
		const sentinel = new Date("2026-07-18T22:30:00.000Z");
		const deletionIn = { ...correctionIn, timestamp: sentinel };
		const deletionOut = { ...correctionOut, timestamp: sentinel };
		const { dbService, mutations } = createFinalizerDb({
			entries: [originalIn, originalOut, deletionIn, deletionOut],
		});

		await finalizeTimeCorrectionTerminalInTransaction(
			approveInput(dbService, {
				correction: {
					action: "delete",
					clockInCorrectionId: ids.correctionIn,
					clockOutCorrectionId: ids.correctionOut,
				},
				transition: { kind: "approve", reason: "Duplicate period" },
			}),
		);

		expect(mutations[4].values).toMatchObject({
			startTime: sentinel,
			endTime: sentinel,
			durationMinutes: 0,
			deletedAt: new Date("2026-07-20T09:00:00.000Z"),
			deletedBy: "user-manager",
			deletionReason: "Duplicate period",
			deletionApprovalRequestId: ids.approval,
		});
	});

	it("reactivates an exact historical lineage only when the explicit fallback is enabled", async () => {
		const historicalOriginal = {
			...originalIn,
			isSuperseded: true,
			supersededById: ids.correctionIn,
		};
		const historicalCorrection = { ...correctionIn, isSuperseded: false };
		const { dbService, mutations } = createFinalizerDb({
			period: {
				...terminalPeriod,
				approvalWorkflowId: null,
			},
			entries: [historicalOriginal, originalOut, historicalCorrection],
			legacyRequest: {
				...legacyRequest,
				status: "rejected",
				approvedAt: new Date("2026-07-20T09:00:00.000Z"),
				rejectionReason: "Incorrect time",
				metadata: null,
			},
			workflow: null,
			mutationRows: [[{ id: ids.originalIn }], [{ id: ids.correctionIn }]],
		});

		await finalizeTimeCorrectionTerminalInTransaction(
			approveInput(dbService, {
				expectedApprovalWorkflowId: null,
				expectedApprovalWorkflowVersion: null,
				correction: { action: "edit", clockInCorrectionId: ids.correctionIn },
				legacyApprovalRequestId: ids.approval,
				transition: { kind: "reject", reason: "Incorrect time" },
				allowMetadataLessLegacyFallback: true,
			}),
		);

		expect(mutations.map((mutation) => mutation.values)).toEqual([
			{ isSuperseded: false, supersededById: null },
			{ isSuperseded: true, supersededById: null },
		]);
	});

	it("reactivates both inactive originals in deterministic endpoint order", async () => {
		const { dbService, mutations } = createFinalizerDb({
			period: { ...terminalPeriod, approvalWorkflowId: null },
			entries: [
				{
					...originalIn,
					isSuperseded: true,
					supersededById: ids.correctionIn,
				},
				{
					...originalOut,
					isSuperseded: true,
					supersededById: ids.correctionOut,
				},
				{ ...correctionIn, isSuperseded: false },
				{ ...correctionOut, isSuperseded: false },
			],
			legacyRequest: {
				...legacyRequest,
				status: "rejected",
				approvedAt: new Date("2026-07-20T09:00:00.000Z"),
				rejectionReason: "Incorrect time",
				metadata: null,
			},
			workflow: null,
			mutationRows: [
				[{ id: ids.originalIn }],
				[{ id: ids.correctionIn }],
				[{ id: ids.originalOut }],
				[{ id: ids.correctionOut }],
			],
		});

		await finalizeTimeCorrectionTerminalInTransaction(
			approveInput(dbService, {
				expectedApprovalWorkflowId: null,
				expectedApprovalWorkflowVersion: null,
				correction: {
					action: "edit",
					clockInCorrectionId: ids.correctionIn,
					clockOutCorrectionId: ids.correctionOut,
				},
				transition: { kind: "reject", reason: "Incorrect time" },
				allowMetadataLessLegacyFallback: true,
			}),
		);

		expect(mutations.map((mutation) => mutation.values)).toEqual([
			{ isSuperseded: false, supersededById: null },
			{ isSuperseded: true, supersededById: null },
			{ isSuperseded: false, supersededById: null },
			{ isSuperseded: true, supersededById: null },
		]);
	});

	it.each([
		["wrong organization", { correctionIn: { organizationId: "org-other" } }],
		["wrong employee", { correctionIn: { employeeId: "emp-other" } }],
		[
			"bad replacement lineage",
			{ correctionIn: { replacesEntryId: ids.originalOut } },
		],
		["inactive correction", { correctionIn: { isSuperseded: true } }],
		[
			"already-active original",
			{ originalIn: { isSuperseded: false, supersededById: null } },
		],
	] as const)("rejects two-endpoint historical fallback with %s", async (_label, patches) => {
		const historicalOriginalIn = {
			...originalIn,
			isSuperseded: true,
			supersededById: ids.correctionIn,
			...patches.originalIn,
		};
		const historicalOriginalOut = {
			...originalOut,
			isSuperseded: true,
			supersededById: ids.correctionOut,
		};
		const historicalCorrectionIn = {
			...correctionIn,
			isSuperseded: false,
			...patches.correctionIn,
		};
		const historicalCorrectionOut = {
			...correctionOut,
			isSuperseded: false,
		};
		const { dbService, mutations } = createFinalizerDb({
			period: { ...terminalPeriod, approvalWorkflowId: null },
			entries: [
				historicalOriginalIn,
				historicalOriginalOut,
				historicalCorrectionIn,
				historicalCorrectionOut,
			],
			legacyRequest: {
				...legacyRequest,
				status: "rejected",
				approvedAt: new Date("2026-07-20T09:00:00.000Z"),
				rejectionReason: "Incorrect time",
				metadata: null,
			},
			workflow: null,
		});

		await expect(
			finalizeTimeCorrectionTerminalInTransaction(
				approveInput(dbService, {
					expectedApprovalWorkflowId: null,
					expectedApprovalWorkflowVersion: null,
					correction: {
						action: "edit",
						clockInCorrectionId: ids.correctionIn,
						clockOutCorrectionId: ids.correctionOut,
					},
					transition: { kind: "reject", reason: "Incorrect time" },
					allowMetadataLessLegacyFallback: true,
				}),
			),
		).rejects.toThrow("Time correction source changed during finalization");
		expect(mutations).toEqual([]);
	});

	it("fails closed when the second endpoint historical rollback CAS is partial", async () => {
		const { dbService, mutations } = createFinalizerDb({
			period: { ...terminalPeriod, approvalWorkflowId: null },
			entries: [
				{
					...originalIn,
					isSuperseded: true,
					supersededById: ids.correctionIn,
				},
				{
					...originalOut,
					isSuperseded: true,
					supersededById: ids.correctionOut,
				},
				{ ...correctionIn, isSuperseded: false },
				{ ...correctionOut, isSuperseded: false },
			],
			legacyRequest: {
				...legacyRequest,
				status: "rejected",
				approvedAt: new Date("2026-07-20T09:00:00.000Z"),
				rejectionReason: "Incorrect time",
				metadata: null,
			},
			workflow: null,
			mutationRows: [
				[{ id: ids.originalIn }],
				[{ id: ids.correctionIn }],
				[{ id: ids.originalOut }],
				[],
			],
		});

		await expect(
			finalizeTimeCorrectionTerminalInTransaction(
				approveInput(dbService, {
					expectedApprovalWorkflowId: null,
					expectedApprovalWorkflowVersion: null,
					correction: {
						action: "edit",
						clockInCorrectionId: ids.correctionIn,
						clockOutCorrectionId: ids.correctionOut,
					},
					transition: { kind: "reject", reason: "Incorrect time" },
					allowMetadataLessLegacyFallback: true,
				}),
			),
		).rejects.toThrow("Time correction source changed during finalization");
		expect(mutations).toHaveLength(4);
	});

	it("refuses the historical rejection shape when fallback is disabled", async () => {
		const { dbService, mutations } = createFinalizerDb({
			period: {
				...terminalPeriod,
				approvalWorkflowId: null,
			},
			entries: [
				{ ...originalIn, isSuperseded: true, supersededById: ids.correctionIn },
				originalOut,
				{ ...correctionIn, isSuperseded: false },
			],
			legacyRequest: {
				...legacyRequest,
				status: "rejected",
				approvedAt: new Date("2026-07-20T09:00:00.000Z"),
				rejectionReason: "Incorrect time",
				metadata: null,
			},
			workflow: null,
		});

		await expect(
			finalizeTimeCorrectionTerminalInTransaction(
				approveInput(dbService, {
					expectedApprovalWorkflowId: null,
					expectedApprovalWorkflowVersion: null,
					correction: { action: "edit", clockInCorrectionId: ids.correctionIn },
					transition: { kind: "reject", reason: "Incorrect time" },
				}),
			),
		).rejects.toThrow(/changed|finaliz/i);
		expect(mutations).toEqual([]);
	});
});

describe("time correction approval workflow safety", () => {
	it("does not expose submission or decision core-implementation overrides", () => {
		const submissionInterface = source.slice(
			source.indexOf("export interface ExecuteTimeCorrectionSubmissionInput"),
			source.indexOf("type TimeCorrectionSubmissionResult"),
		);
		const decisionInterface = source.slice(
			source.indexOf("export interface ExecuteTimeCorrectionDecisionInput"),
			source.indexOf("function decisionFingerprint"),
		);

		expect(submissionInterface).not.toContain("dependencies");
		expect(submissionInterface).not.toContain("startWorkflow");
		expect(submissionInterface).not.toContain("bindWorkflow");
		expect(submissionInterface).not.toContain("finalizeTerminal");
		expect(decisionInterface).not.toContain("bindWorkflow");
		expect(decisionInterface).not.toContain("executeDecision");
		expect(decisionInterface).not.toContain("dispatchPostCommit");
	});

	it("constructs the production runtime and trusted decision boundary internally", () => {
		const wrapperStart = source.indexOf(
			"export function decideTimeCorrectionWithStableTargetEffect",
		);
		const wrapper = source.slice(
			wrapperStart,
			source.indexOf(
				"export function approveTimeCorrectionWithCurrentApproverEffect",
				wrapperStart,
			),
		);

		expect(wrapper).toContain("createProductionApprovalWorkflowRuntime");
		expect(wrapper).toContain("executeTimeCorrectionDecisionInTransaction");
		expect(wrapper).toContain("dispatchTimeCorrectionDecisionPostCommit");
		expect(wrapper).not.toContain("options?.runtime");
		expect(wrapper).not.toContain("options?.executeDecision");
		expect(wrapper).not.toContain("options?.dispatchPostCommit");
	});

	it("does not expose caller-supplied rollout authority across workflow write APIs", () => {
		const files = [
			"../workflow/start-workflow.ts",
			"../workflow/compatibility-writer.ts",
			"../workflow/transition-engine.ts",
			"../domain-adapters/legacy-write-coordinator.ts",
			"./time-correction-approvals.ts",
		];

		for (const file of files) {
			const contents = readFileSync(
				fileURLToPath(new URL(file, import.meta.url)),
				"utf8",
			);
			expect(contents, file).not.toContain("authoritySnapshot");
		}
	});

	it("bounds exact submission and compatibility lookups to ambiguity detection", () => {
		const submissionStart = source.indexOf(
			"export async function executeTimeCorrectionSubmissionInTransaction",
		);
		const replayLookup = source.slice(
			source.indexOf(
				"const requests = await input.dbService.db.query.approvalRequest.findMany",
				submissionStart,
			),
			source.indexOf("let replayCandidates", submissionStart),
		);
		const activeCompatibilityLookup = source.slice(
			source.indexOf(
				"export async function resolveTimeCorrectionCompatibilityApprovalId",
			),
			source.indexOf(
				"async function resolveOriginalTimeCorrectionCompatibilityApprovalId",
			),
		);
		const originalCompatibilityLookup = source.slice(
			source.indexOf(
				"async function resolveOriginalTimeCorrectionCompatibilityApprovalId",
			),
			source.indexOf("async function loadCanonicalAutoCompletionReplay"),
		);

		for (const lookup of [
			replayLookup,
			activeCompatibilityLookup,
			originalCompatibilityLookup,
		]) {
			expect(lookup).toContain("approvalRequest.metadata");
			expect(lookup).toContain("limit: 2");
		}
	});

	it("delegates legacy terminal decisions to the shared transaction-bound finalizer", () => {
		const approveStart = source.indexOf(
			"function persistApprovedTimeCorrection",
		);
		const rejectStart = source.indexOf(
			"function persistRejectedTimeCorrection",
		);
		const approveBody = source.slice(
			approveStart,
			source.indexOf("function handleApproved", approveStart),
		);
		const rejectBody = source.slice(
			rejectStart,
			source.indexOf(
				"function notifyRejectedTimeCorrectionAfterCommit",
				rejectStart,
			),
		);

		expect(approveBody).toContain(
			"finalizeTimeCorrectionTerminalDetailedInTransaction",
		);
		expect(rejectBody).toContain(
			"finalizeTimeCorrectionTerminalDetailedInTransaction",
		);
	});

	it("keeps modified time-correction business calculations on Temporal", () => {
		expect(source).not.toContain("DateTime.fromJSDate");
	});

	it("scopes pending time correction approval checks to the workflow organization", () => {
		const start = source.indexOf(
			"function ensureNoPendingTimeCorrectionApproval",
		);
		expect(start).toBeGreaterThanOrEqual(0);
		const body = source.slice(
			start,
			source.indexOf(
				"export async function syncCanonicalWorkCorrection",
				start,
			),
		);

		expect(body).toContain("organizationId: string");
		expect(body).toContain(
			"eq(approvalRequest.organizationId, organizationId)",
		);
	});

	it("scopes approved time correction work period updates to the approval organization", () => {
		const start = source.indexOf(
			"async function finalizeTimeCorrectionTerminalDetailedInTransaction",
		);
		expect(start).toBeGreaterThanOrEqual(0);
		const body = source.slice(
			start,
			source.indexOf(
				"export async function finalizeTimeCorrectionTerminalInTransaction",
				start,
			),
		);

		expect(body).toContain("eq(workPeriod.id, period.id)");
		expect(body).toContain(
			"eq(workPeriod.organizationId, input.organizationId)",
		);
		expect(body).toContain("eq(workPeriod.employeeId, period.employeeId)");
	});
});

describe("time correction requester decision notifications", () => {
	it.each([
		["approve", undefined],
		["reject", "Correction evidence is insufficient"],
	] as const)("runs the trusted production wrapper for a legacy %s and dispatches only after commit", async (action, reason) => {
		const dbService = createTimeCorrectionDecisionDbService();
		dbService.enableBoundaryMode("legacy");

		await Effect.runPromise(
			decideTimeCorrectionWithStableTargetEffect(
				dbService,
				timeCorrectionCurrentApprover,
				"approval-1",
				action,
				reason,
			),
		);

		expect(dbService.db.transaction).toHaveBeenCalledOnce();
		expect(dbService.transactionCommitted).toHaveBeenCalledOnce();
		const delivered =
			action === "approve"
				? onTimeCorrectionApproved
				: onTimeCorrectionRejected;
		expect(delivered).toHaveBeenCalledOnce();
		expect(
			dbService.transactionCommitted.mock.invocationCallOrder[0],
		).toBeLessThan(delivered.mock.invocationCallOrder[0] ?? 0);
		expect(
			action === "approve"
				? onTimeCorrectionRejected
				: onTimeCorrectionApproved,
		).not.toHaveBeenCalled();
	});

	it("swallows production-wrapper notification and maintenance delivery failures after commit", async () => {
		const dbService = createTimeCorrectionDecisionDbService();
		dbService.enableBoundaryMode("legacy");
		markEmployeeWorkBalanceDirty.mockRejectedValueOnce(
			new Error("maintenance unavailable"),
		);
		onTimeCorrectionApproved.mockRejectedValueOnce(
			new Error("notification unavailable"),
		);

		await expect(
			Effect.runPromise(
				decideTimeCorrectionWithStableTargetEffect(
					dbService,
					timeCorrectionCurrentApprover,
					"approval-1",
					"approve",
				),
			),
		).resolves.toBeUndefined();
		expect(dbService.transactionCommitted).toHaveBeenCalledOnce();
		expect(markEmployeeWorkBalanceDirty).toHaveBeenCalledOnce();
		expect(onTimeCorrectionApproved).toHaveBeenCalledOnce();
	});

	it("dispatches no production-wrapper effects when the decision transaction rolls back", async () => {
		const dbService = createTimeCorrectionDecisionDbService();
		dbService.enableBoundaryMode("legacy");
		dbService.selectForUpdate.mockResolvedValueOnce([]);

		await expect(
			Effect.runPromise(
				decideTimeCorrectionWithStableTargetEffect(
					dbService,
					timeCorrectionCurrentApprover,
					"approval-1",
					"approve",
				),
			),
		).rejects.toThrow(/changed during finalization/i);
		expect(dbService.transactionCommitted).not.toHaveBeenCalled();
		expect(markEmployeeWorkBalanceDirty).not.toHaveBeenCalled();
		expect(onTimeCorrectionApproved).not.toHaveBeenCalled();
		expect(onTimeCorrectionRejected).not.toHaveBeenCalled();
	});

	it.each([
		true,
		false,
	])("transactionally revalidates production-wrapper delegated authority: %s", async (eligible) => {
		const dbService = createTimeCorrectionDecisionDbService();
		dbService.enableBoundaryMode("legacy");
		dbService.enableDelegation(eligible);
		const decision = Effect.runPromise(
			decideTimeCorrectionWithStableTargetEffect(
				dbService,
				timeCorrectionCurrentApprover,
				"approval-1",
				"approve",
				undefined,
				{ allowAnyApprover: true },
			),
		);

		if (eligible) {
			await expect(decision).resolves.toBeUndefined();
			expect(dbService.transactionCommitted).toHaveBeenCalledOnce();
			expect(onTimeCorrectionApproved).toHaveBeenCalledOnce();
		} else {
			await expect(decision).rejects.toThrow(/not authorized/i);
			expect(dbService.transactionCommitted).not.toHaveBeenCalled();
			expect(markEmployeeWorkBalanceDirty).not.toHaveBeenCalled();
			expect(onTimeCorrectionApproved).not.toHaveBeenCalled();
		}
	});

	it("marks work balances dirty after approving a time correction request", async () => {
		const dbService = createTimeCorrectionDecisionDbService();

		await runTimeCorrectionDecisionEffect(
			approveTimeCorrectionWithCurrentApproverEffect(
				dbService,
				timeCorrectionCurrentApprover,
				"period-1",
			),
		);

		expect(markEmployeeWorkBalanceDirty).toHaveBeenCalledWith({
			employeeId: "emp-requester",
			organizationId: "org-1",
			dirtyFromDate: "2026-05-11",
		});
		expect(dbService.db.transaction).toHaveBeenCalled();
		expect(
			vi.mocked(dbService.db.transaction).mock.invocationCallOrder[0],
		).toBeLessThan(markEmployeeWorkBalanceDirty.mock.invocationCallOrder[0]);
	});

	it("keeps approval successful when dirty marking fails", async () => {
		const dbService = createTimeCorrectionDecisionDbService();
		markEmployeeWorkBalanceDirty.mockRejectedValueOnce(
			new Error("dirty marker failed"),
		);

		await expect(
			runTimeCorrectionDecisionEffect(
				approveTimeCorrectionWithCurrentApproverEffect(
					dbService,
					timeCorrectionCurrentApprover,
					"period-1",
				),
			),
		).resolves.toBeDefined();
		expect(onTimeCorrectionApproved).toHaveBeenCalled();
	});

	it("notifies the requester after approving a time correction request", async () => {
		const dbService = createTimeCorrectionDecisionDbService();

		await runTimeCorrectionDecisionEffect(
			approveTimeCorrectionWithCurrentApproverEffect(
				dbService,
				timeCorrectionCurrentApprover,
				"period-1",
			),
		);

		expect(onTimeCorrectionApproved).toHaveBeenCalledWith({
			workPeriodId: "period-1",
			employeeUserId: "user-requester",
			employeeName: "Avery Requester",
			organizationId: "org-1",
			originalTime: period.startTime,
			correctedTime: correction.timestamp,
			approverName: "Morgan Manager",
		});
		expect(onTimeCorrectionRejected).not.toHaveBeenCalled();
	});

	it("activates linked pending corrections and supersedes originals after approving a time correction request", async () => {
		const dbService = createTimeCorrectionDecisionDbService();
		vi.mocked(dbService.db.query.workPeriod.findFirst).mockResolvedValueOnce({
			...period,
			clockOutId: "entry-clock-out-original",
		});
		vi.mocked(
			dbService.db.query.approvalRequest.findFirst,
		).mockResolvedValueOnce({
			id: "approval-1",
			organizationId: "org-1",
			entityType: "time_entry",
			entityId: "period-1",
			requestedBy: "emp-requester",
			approverId: "emp-manager",
			status: "pending",
			metadata: {
				timeCorrection: {
					clockInCorrectionId: correction.id,
					clockOutCorrectionId: clockOutCorrection.id,
				},
			},
		});
		vi.mocked(dbService.db.query.timeEntry.findFirst)
			.mockResolvedValueOnce({ ...correction, isSuperseded: true })
			.mockResolvedValueOnce({ ...clockOutCorrection, isSuperseded: true });

		await runTimeCorrectionDecisionEffect(
			approveTimeCorrectionWithCurrentApproverEffect(
				dbService,
				timeCorrectionCurrentApprover,
				"period-1",
			),
		);

		expect(dbService.updateSets).toEqual(
			expect.arrayContaining([
				{ isSuperseded: false, supersededById: null },
				{ isSuperseded: true, supersededById: correction.id },
			]),
		);
	});

	it("updates the canonical work record through the transactional approval database", async () => {
		const dbService = createTimeCorrectionDecisionDbService();
		vi.mocked(dbService.db.query.workPeriod.findFirst).mockResolvedValueOnce({
			...period,
			canonicalRecordId: "record-1",
		});
		const globalWhere = vi.fn().mockResolvedValue(undefined);
		const globalUpdate = vi.spyOn(globalDb, "update").mockReturnValue({
			set: vi.fn(() => ({ where: globalWhere })),
		} as never);

		try {
			await runTimeCorrectionDecisionEffect(
				approveTimeCorrectionWithCurrentApproverEffect(
					dbService,
					timeCorrectionCurrentApprover,
					"period-1",
				),
			);

			expect(globalUpdate).not.toHaveBeenCalled();
			expect(dbService.db.update).toHaveBeenCalledWith(timeRecord);
			expect(dbService.updateSets).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						startAt: correction.timestamp,
						endAt: period.endTime,
						durationMinutes: 465,
						updatedBy: timeCorrectionCurrentApprover.userId,
					}),
				]),
			);
		} finally {
			globalUpdate.mockRestore();
		}
	});

	it("approves a clock-out-only correction while preserving the original clock-in", async () => {
		const dbService = createTimeCorrectionDecisionDbService();
		const periodWithClockOut = {
			...period,
			clockOutId: "entry-clock-out-original",
		};
		vi.mocked(dbService.db.query.workPeriod.findFirst).mockResolvedValueOnce(
			periodWithClockOut,
		);
		vi.mocked(
			dbService.db.query.approvalRequest.findFirst,
		).mockResolvedValueOnce({
			id: "approval-1",
			organizationId: "org-1",
			entityType: "time_entry",
			entityId: "period-1",
			requestedBy: "emp-requester",
			approverId: "emp-manager",
			status: "pending",
			metadata: {
				timeCorrection: { clockOutCorrectionId: clockOutCorrection.id },
			},
		});
		vi.mocked(dbService.db.query.timeEntry.findFirst).mockResolvedValueOnce({
			...clockOutCorrection,
			isSuperseded: true,
		});

		await runTimeCorrectionDecisionEffect(
			approveTimeCorrectionWithCurrentApproverEffect(
				dbService,
				timeCorrectionCurrentApprover,
				"period-1",
			),
		);

		expect(dbService.updateSets).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					clockInId: period.clockInId,
					clockOutId: clockOutCorrection.id,
					startTime: period.startTime,
					endTime: clockOutCorrection.timestamp,
					durationMinutes: 495,
				}),
				{ isSuperseded: false, supersededById: null },
				{ isSuperseded: true, supersededById: clockOutCorrection.id },
			]),
		);
		expect(onTimeCorrectionApproved).toHaveBeenCalledWith(
			expect.objectContaining({
				originalTime: period.endTime,
				correctedTime: clockOutCorrection.timestamp,
			}),
		);
	});

	it("rejects declared two-endpoint metadata when the clock-in correction cannot be resolved", async () => {
		const dbService = createTimeCorrectionDecisionDbService();
		vi.mocked(dbService.db.query.workPeriod.findFirst).mockResolvedValueOnce({
			...period,
			clockOutId: "entry-clock-out-original",
		});
		vi.mocked(
			dbService.db.query.approvalRequest.findFirst,
		).mockResolvedValueOnce({
			id: "approval-1",
			organizationId: "org-1",
			entityType: "time_entry",
			entityId: "period-1",
			requestedBy: "emp-requester",
			approverId: "emp-manager",
			status: "pending",
			metadata: {
				timeCorrection: {
					clockInCorrectionId: correction.id,
					clockOutCorrectionId: clockOutCorrection.id,
				},
			},
		});
		vi.mocked(dbService.db.query.timeEntry.findFirst)
			.mockResolvedValueOnce(null)
			.mockResolvedValueOnce(clockOutCorrection);

		await expect(
			runTimeCorrectionDecisionEffect(
				approveTimeCorrectionWithCurrentApproverEffect(
					dbService,
					timeCorrectionCurrentApprover,
					"period-1",
				),
			),
		).rejects.toThrow("Time correction source changed during finalization");
		expect(dbService.updateSets).not.toEqual(
			expect.arrayContaining([
				expect.objectContaining({ clockOutId: clockOutCorrection.id }),
			]),
		);
	});

	it("rejects declared two-endpoint metadata when the clock-out correction cannot be resolved", async () => {
		const dbService = createTimeCorrectionDecisionDbService();
		vi.mocked(dbService.db.query.workPeriod.findFirst).mockResolvedValueOnce({
			...period,
			clockOutId: "entry-clock-out-original",
		});
		vi.mocked(
			dbService.db.query.approvalRequest.findFirst,
		).mockResolvedValueOnce({
			id: "approval-1",
			organizationId: "org-1",
			entityType: "time_entry",
			entityId: "period-1",
			requestedBy: "emp-requester",
			approverId: "emp-manager",
			status: "pending",
			metadata: {
				timeCorrection: {
					clockInCorrectionId: correction.id,
					clockOutCorrectionId: clockOutCorrection.id,
				},
			},
		});
		vi.mocked(dbService.db.query.timeEntry.findFirst)
			.mockResolvedValueOnce(correction)
			.mockResolvedValueOnce(null);

		await expect(
			runTimeCorrectionDecisionEffect(
				approveTimeCorrectionWithCurrentApproverEffect(
					dbService,
					timeCorrectionCurrentApprover,
					"period-1",
				),
			),
		).rejects.toThrow("Time correction source changed during finalization");
		expect(dbService.updateSets).not.toEqual(
			expect.arrayContaining([
				expect.objectContaining({ clockInId: correction.id }),
			]),
		);
	});

	it("rejects a linked clock-in correction when its original entry is no longer active", async () => {
		const dbService = createTimeCorrectionDecisionDbService();
		vi.mocked(dbService.db.query.timeEntry.findFirst).mockResolvedValueOnce({
			...correction,
			isSuperseded: true,
		});
		dbService.selectForUpdate.mockResolvedValueOnce([]);

		await expect(
			runTimeCorrectionDecisionEffect(
				approveTimeCorrectionWithCurrentApproverEffect(
					dbService,
					timeCorrectionCurrentApprover,
					"period-1",
				),
			),
		).rejects.toThrow("Time correction source changed during finalization");
		expect(dbService.updateSets).not.toEqual(
			expect.arrayContaining([
				{ isSuperseded: false, supersededById: null },
				expect.objectContaining({ clockInId: correction.id }),
			]),
		);
	});

	it("rejects a linked clock-out correction when its original entry is no longer active", async () => {
		const dbService = createTimeCorrectionDecisionDbService();
		vi.mocked(dbService.db.query.workPeriod.findFirst).mockResolvedValueOnce({
			...period,
			clockOutId: "entry-clock-out-original",
		});
		vi.mocked(
			dbService.db.query.approvalRequest.findFirst,
		).mockResolvedValueOnce({
			id: "approval-1",
			organizationId: "org-1",
			entityType: "time_entry",
			entityId: "period-1",
			requestedBy: "emp-requester",
			approverId: "emp-manager",
			status: "pending",
			metadata: {
				timeCorrection: { clockOutCorrectionId: clockOutCorrection.id },
			},
		});
		vi.mocked(dbService.db.query.timeEntry.findFirst).mockResolvedValueOnce({
			...clockOutCorrection,
			isSuperseded: true,
		});
		dbService.selectForUpdate.mockResolvedValueOnce([]);

		await expect(
			runTimeCorrectionDecisionEffect(
				approveTimeCorrectionWithCurrentApproverEffect(
					dbService,
					timeCorrectionCurrentApprover,
					"period-1",
				),
			),
		).rejects.toThrow("Time correction source changed during finalization");
		expect(dbService.updateSets).not.toEqual(
			expect.arrayContaining([
				{ isSuperseded: false, supersededById: null },
				expect.objectContaining({ clockOutId: clockOutCorrection.id }),
			]),
		);
	});

	it("applies deletion approvals as a zero-duration deleted work period", async () => {
		const dbService = createTimeCorrectionDecisionDbService();
		const deletionTimestamp = new Date("2026-05-11T08:00:00.000Z");
		const deletionClockInCorrection = {
			id: "20000000-0000-4000-8000-000000000004",
			timestamp: deletionTimestamp,
			replacesEntryId: "entry-original",
			isSuperseded: true,
		};
		const deletionClockOutCorrection = {
			id: "20000000-0000-4000-8000-000000000005",
			timestamp: deletionTimestamp,
			replacesEntryId: "entry-clock-out-original",
			isSuperseded: true,
		};
		const deletionApproval = {
			id: "approval-delete-1",
			organizationId: "org-1",
			entityType: "time_entry",
			entityId: "period-1",
			requestedBy: "emp-requester",
			approverId: "emp-manager",
			status: "pending",
			reason: "Duplicate period",
			approvedAt: null,
			rejectionReason: null,
			metadata: {
				timeCorrection: {
					action: "delete",
					clockInCorrectionId: deletionClockInCorrection.id,
					clockOutCorrectionId: deletionClockOutCorrection.id,
				},
			},
			updatedAt: new Date("2026-05-11T08:05:00.000Z"),
		} satisfies PendingApprovalRequest;

		vi.mocked(dbService.db.query.workPeriod.findFirst).mockResolvedValueOnce({
			...period,
			clockOutId: "entry-clock-out-original",
		});
		vi.mocked(
			dbService.db.query.approvalRequest.findFirst,
		).mockResolvedValueOnce(deletionApproval);
		vi.mocked(dbService.db.query.timeEntry.findFirst)
			.mockResolvedValueOnce(deletionClockInCorrection)
			.mockResolvedValueOnce(deletionClockOutCorrection);

		await runTimeCorrectionDecisionEffect(
			approveTimeCorrectionWithCurrentApproverEffect(
				dbService,
				timeCorrectionCurrentApprover,
				"period-1",
			),
		);

		expect(deletionApproval.metadata).toEqual({
			timeCorrection: {
				action: "delete",
				clockInCorrectionId: deletionClockInCorrection.id,
				clockOutCorrectionId: deletionClockOutCorrection.id,
			},
		});
		expect(deletionClockInCorrection).toMatchObject({
			timestamp: deletionTimestamp,
			replacesEntryId: "entry-original",
			isSuperseded: true,
		});
		expect(deletionClockOutCorrection).toMatchObject({
			timestamp: deletionTimestamp,
			replacesEntryId: "entry-clock-out-original",
			isSuperseded: true,
		});
		expect(dbService.updateSets).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					clockInId: deletionClockInCorrection.id,
					clockOutId: deletionClockOutCorrection.id,
					startTime: deletionTimestamp,
					endTime: deletionTimestamp,
					durationMinutes: 0,
					deletedAt: expect.any(Date),
					deletedBy: timeCorrectionCurrentApprover.userId,
					deletionReason: deletionApproval.reason,
					deletionApprovalRequestId: deletionApproval.id,
				}),
			]),
		);
	});

	it("rejects deletion approvals when correction timestamps do not match", async () => {
		const dbService = createTimeCorrectionDecisionDbService();
		const deletionClockInCorrection = {
			id: "20000000-0000-4000-8000-000000000006",
			timestamp: new Date("2026-05-11T08:00:00.000Z"),
			replacesEntryId: "entry-original",
			isSuperseded: true,
		};
		const deletionClockOutCorrection = {
			id: "20000000-0000-4000-8000-000000000007",
			timestamp: new Date("2026-05-11T08:01:00.000Z"),
			replacesEntryId: "entry-clock-out-original",
			isSuperseded: true,
		};

		vi.mocked(dbService.db.query.workPeriod.findFirst).mockResolvedValueOnce({
			...period,
			clockOutId: "entry-clock-out-original",
		});
		vi.mocked(
			dbService.db.query.approvalRequest.findFirst,
		).mockResolvedValueOnce({
			id: "approval-delete-1",
			organizationId: "org-1",
			entityType: "time_entry",
			entityId: "period-1",
			requestedBy: "emp-requester",
			approverId: "emp-manager",
			status: "pending",
			metadata: {
				timeCorrection: {
					action: "delete",
					clockInCorrectionId: deletionClockInCorrection.id,
					clockOutCorrectionId: deletionClockOutCorrection.id,
				},
			},
		});
		vi.mocked(dbService.db.query.timeEntry.findFirst)
			.mockResolvedValueOnce(deletionClockInCorrection)
			.mockResolvedValueOnce(deletionClockOutCorrection);

		await expect(
			runTimeCorrectionDecisionEffect(
				approveTimeCorrectionWithCurrentApproverEffect(
					dbService,
					timeCorrectionCurrentApprover,
					"period-1",
				),
			),
		).rejects.toThrow("Deletion requires matching correction timestamps");

		expect(dbService.updateSets).not.toEqual(
			expect.arrayContaining([
				expect.objectContaining({ clockInId: deletionClockInCorrection.id }),
			]),
		);
	});

	it("approves the active correction instead of an older rejected correction for the same period", async () => {
		const dbService = createTimeCorrectionDecisionDbService();

		await runTimeCorrectionDecisionEffect(
			approveTimeCorrectionWithCurrentApproverEffect(
				dbService,
				timeCorrectionCurrentApprover,
				"period-1",
			),
		);

		expect(dbService.updateSets).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					clockInId: correction.id,
					startTime: correction.timestamp,
				}),
			]),
		);
		expect(onTimeCorrectionApproved).toHaveBeenCalledWith(
			expect.objectContaining({ correctedTime: correction.timestamp }),
		);
	});

	it("approves the correction entry linked to the approval request instead of unrelated rows", async () => {
		const dbService = createTimeCorrectionDecisionDbService();
		const linkedCorrection = {
			id: "20000000-0000-4000-8000-000000000008",
			timestamp: new Date("2026-05-11T08:30:00.000Z"),
			replacesEntryId: "entry-original",
			isSuperseded: true,
		};
		vi.mocked(
			dbService.db.query.approvalRequest.findFirst,
		).mockResolvedValueOnce({
			id: "approval-1",
			organizationId: "org-1",
			entityType: "time_entry",
			entityId: "period-1",
			requestedBy: "emp-requester",
			approverId: "emp-manager",
			status: "pending",
			metadata: {
				timeCorrection: { clockInCorrectionId: linkedCorrection.id },
			},
		});
		vi.mocked(dbService.db.query.timeEntry.findFirst).mockResolvedValueOnce(
			linkedCorrection,
		);

		await runTimeCorrectionDecisionEffect(
			approveTimeCorrectionWithCurrentApproverEffect(
				dbService,
				timeCorrectionCurrentApprover,
				"period-1",
			),
		);

		expect(dbService.updateSets).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					clockInId: linkedCorrection.id,
					startTime: linkedCorrection.timestamp,
				}),
			]),
		);
		expect(dbService.db.query.timeEntry.findFirst).toHaveBeenCalled();
	});

	it("rejects approval application when a clock-in-only correction is after the existing clock-out", async () => {
		const dbService = createTimeCorrectionDecisionDbService();
		const invalidCorrection = {
			...correction,
			timestamp: new Date("2026-05-11T17:00:00.000Z"),
		};
		vi.mocked(dbService.db.query.timeEntry.findFirst).mockResolvedValueOnce(
			invalidCorrection,
		);

		await expect(
			runTimeCorrectionDecisionEffect(
				approveTimeCorrectionWithCurrentApproverEffect(
					dbService,
					timeCorrectionCurrentApprover,
					"period-1",
				),
			),
		).rejects.toThrow("Clock out time must be after clock in time");

		expect(dbService.updateSets).not.toEqual(
			expect.arrayContaining([
				expect.objectContaining({ clockInId: invalidCorrection.id }),
			]),
		);
	});

	it("rejects approval application when the work period is already deleted", async () => {
		const dbService = createTimeCorrectionDecisionDbService();
		vi.mocked(dbService.db.query.workPeriod.findFirst).mockResolvedValueOnce({
			...period,
			deletedAt: new Date("2026-05-12T09:00:00.000Z"),
		});

		await expect(
			runTimeCorrectionDecisionEffect(
				approveTimeCorrectionWithCurrentApproverEffect(
					dbService,
					timeCorrectionCurrentApprover,
					"period-1",
				),
			),
		).rejects.toThrow("Time correction source changed during finalization");

		expect(dbService.updateSets).not.toEqual(
			expect.arrayContaining([
				expect.objectContaining({ clockInId: correction.id }),
			]),
		);
	});

	it("refuses to approve a legacy correction without immutable metadata", async () => {
		const dbService = createTimeCorrectionDecisionDbService();
		vi.mocked(
			dbService.db.query.approvalRequest.findFirst,
		).mockResolvedValueOnce({
			id: "approval-1",
			organizationId: "org-1",
			entityType: "time_entry",
			entityId: "period-1",
			requestedBy: "emp-requester",
			approverId: "emp-manager",
			status: "pending",
			metadata: null,
		});

		await expect(
			runTimeCorrectionDecisionEffect(
				approveTimeCorrectionWithCurrentApproverEffect(
					dbService,
					timeCorrectionCurrentApprover,
					"period-1",
				),
			),
		).rejects.toThrow("Time correction approval metadata is required");
	});

	it("rejects a legacy pending correction without metadata when active corrections are ambiguous", async () => {
		const dbService = createTimeCorrectionDecisionDbService();
		const secondCorrection = {
			id: "20000000-0000-4000-8000-000000000009",
			timestamp: new Date("2026-05-11T08:45:00.000Z"),
			replacesEntryId: "entry-original",
			isSuperseded: false,
		};
		vi.mocked(
			dbService.db.query.approvalRequest.findFirst,
		).mockResolvedValueOnce({
			id: "approval-1",
			organizationId: "org-1",
			entityType: "time_entry",
			entityId: "period-1",
			requestedBy: "emp-requester",
			approverId: "emp-manager",
			status: "pending",
			metadata: null,
		});
		vi.mocked(dbService.db.select).mockReturnValueOnce({
			from: vi.fn().mockReturnValue({
				where: vi.fn().mockResolvedValue([correction, secondCorrection]),
			}),
		} as never);

		await expect(
			runTimeCorrectionDecisionEffect(
				approveTimeCorrectionWithCurrentApproverEffect(
					dbService,
					timeCorrectionCurrentApprover,
					"period-1",
				),
			),
		).rejects.toThrow("Time correction approval metadata is required");

		expect(dbService.updateSets).not.toEqual(
			expect.arrayContaining([
				expect.objectContaining({ clockInId: correction.id }),
			]),
		);
	});

	it("notifies the requester after rejecting a time correction request", async () => {
		const dbService = createTimeCorrectionDecisionDbService();

		await runTimeCorrectionDecisionEffect(
			rejectTimeCorrectionWithCurrentApproverEffect(
				dbService,
				timeCorrectionCurrentApprover,
				"period-1",
				"Incorrect correction",
			),
		);

		expect(onTimeCorrectionRejected).toHaveBeenCalledWith(
			expect.objectContaining({
				workPeriodId: "period-1",
				employeeUserId: "user-requester",
				organizationId: "org-1",
				approverName: "Morgan Manager",
				rejectionReason: "Incorrect correction",
			}),
		);
		expect(onTimeCorrectionApproved).not.toHaveBeenCalled();
	});

	it("keeps linked pending corrections inactive without reactivating originals after rejection", async () => {
		const dbService = createTimeCorrectionDecisionDbService();
		vi.mocked(dbService.db.query.workPeriod.findFirst).mockResolvedValueOnce({
			...period,
			clockOutId: "entry-clock-out-original",
		});
		vi.mocked(
			dbService.db.query.approvalRequest.findFirst,
		).mockResolvedValueOnce({
			id: "approval-1",
			organizationId: "org-1",
			entityType: "time_entry",
			entityId: "period-1",
			requestedBy: "emp-requester",
			approverId: "emp-manager",
			status: "pending",
			metadata: {
				timeCorrection: {
					clockInCorrectionId: correction.id,
					clockOutCorrectionId: clockOutCorrection.id,
				},
			},
		});
		vi.mocked(dbService.db.query.timeEntry.findFirst)
			.mockResolvedValueOnce({ ...correction, isSuperseded: true })
			.mockResolvedValueOnce({ ...clockOutCorrection, isSuperseded: true });

		await runTimeCorrectionDecisionEffect(
			rejectTimeCorrectionWithCurrentApproverEffect(
				dbService,
				timeCorrectionCurrentApprover,
				"period-1",
				"Incorrect correction",
			),
		);

		expect(dbService.updateSets).not.toEqual(
			expect.arrayContaining([{ isSuperseded: true, supersededById: null }]),
		);
		expect(dbService.updateSets).not.toEqual(
			expect.arrayContaining([{ isSuperseded: false, supersededById: null }]),
		);
	});

	it("rejects a clock-out-only correction without changing the original endpoints", async () => {
		const dbService = createTimeCorrectionDecisionDbService();
		vi.mocked(dbService.db.query.workPeriod.findFirst).mockResolvedValueOnce({
			...period,
			clockOutId: "entry-clock-out-original",
		});
		vi.mocked(
			dbService.db.query.approvalRequest.findFirst,
		).mockResolvedValueOnce({
			id: "approval-1",
			organizationId: "org-1",
			entityType: "time_entry",
			entityId: "period-1",
			requestedBy: "emp-requester",
			approverId: "emp-manager",
			status: "pending",
			metadata: {
				timeCorrection: { clockOutCorrectionId: clockOutCorrection.id },
			},
		});
		vi.mocked(dbService.db.query.timeEntry.findFirst).mockResolvedValueOnce({
			...clockOutCorrection,
			isSuperseded: true,
		});

		await runTimeCorrectionDecisionEffect(
			rejectTimeCorrectionWithCurrentApproverEffect(
				dbService,
				timeCorrectionCurrentApprover,
				"period-1",
				"Incorrect clock-out",
			),
		);

		expect(dbService.updateSets).not.toEqual(
			expect.arrayContaining([{ isSuperseded: true, supersededById: null }]),
		);
		expect(dbService.updateSets).not.toEqual(
			expect.arrayContaining([{ isSuperseded: false, supersededById: null }]),
		);
		expect(dbService.updateSets).not.toEqual(
			expect.arrayContaining([
				expect.objectContaining({ clockOutId: expect.any(String) }),
			]),
		);
		expect(onTimeCorrectionRejected).toHaveBeenCalledWith(
			expect.objectContaining({
				originalTime: period.endTime,
				correctedTime: clockOutCorrection.timestamp,
			}),
		);
	});

	it("does not roll back older superseded correction entries when rejecting a pending time correction", async () => {
		const dbService = createTimeCorrectionDecisionDbService();

		await runTimeCorrectionDecisionEffect(
			rejectTimeCorrectionWithCurrentApproverEffect(
				dbService,
				timeCorrectionCurrentApprover,
				"period-1",
				"Incorrect correction",
			),
		);

		expect(dbService.updateSets).not.toEqual(
			expect.arrayContaining([{ isSuperseded: true, supersededById: null }]),
		);
		expect(dbService.updateSets).not.toEqual(
			expect.arrayContaining([
				expect.objectContaining({ id: rejectedCorrection.id }),
			]),
		);
	});

	it("rejects only the correction entries linked to the approval request", async () => {
		const dbService = createTimeCorrectionDecisionDbService();
		const linkedCorrection = {
			id: "20000000-0000-4000-8000-000000000010",
			timestamp: new Date("2026-05-11T08:30:00.000Z"),
			replacesEntryId: "entry-original",
			isSuperseded: true,
		};
		vi.mocked(
			dbService.db.query.approvalRequest.findFirst,
		).mockResolvedValueOnce({
			id: "approval-1",
			organizationId: "org-1",
			entityType: "time_entry",
			entityId: "period-1",
			requestedBy: "emp-requester",
			approverId: "emp-manager",
			status: "pending",
			metadata: {
				timeCorrection: { clockInCorrectionId: linkedCorrection.id },
			},
		});
		vi.mocked(dbService.db.query.timeEntry.findFirst).mockResolvedValueOnce(
			linkedCorrection,
		);

		await runTimeCorrectionDecisionEffect(
			rejectTimeCorrectionWithCurrentApproverEffect(
				dbService,
				timeCorrectionCurrentApprover,
				"period-1",
				"Incorrect correction",
			),
		);

		expect(dbService.db.query.timeEntry.findFirst).toHaveBeenCalled();
		expect(dbService.updateSets).not.toEqual(
			expect.arrayContaining([{ isSuperseded: true, supersededById: null }]),
		);
	});

	it("rejects a legacy pending correction without metadata when one active correction is unambiguous", async () => {
		const dbService = createTimeCorrectionDecisionDbService();
		vi.mocked(
			dbService.db.query.approvalRequest.findFirst,
		).mockResolvedValueOnce({
			id: "approval-1",
			organizationId: "org-1",
			entityType: "time_entry",
			entityId: "period-1",
			requestedBy: "emp-requester",
			approverId: "emp-manager",
			status: "pending",
			metadata: null,
		});

		await runTimeCorrectionDecisionEffect(
			rejectTimeCorrectionWithCurrentApproverEffect(
				dbService,
				timeCorrectionCurrentApprover,
				"period-1",
				"Incorrect correction",
			),
		);

		expect(dbService.updateSets).toEqual(
			expect.arrayContaining([{ isSuperseded: true, supersededById: null }]),
		);
	});

	it("rolls back one active historical correction per endpoint without metadata", async () => {
		const dbService = createTimeCorrectionDecisionDbService();
		dbService.setLegacyCorrectionCandidates([
			{ ...correction, isSuperseded: false },
			{ ...clockOutCorrection, isSuperseded: false },
		]);
		vi.mocked(
			dbService.db.query.approvalRequest.findFirst,
		).mockResolvedValueOnce({
			id: "approval-1",
			organizationId: "org-1",
			entityType: "time_entry",
			entityId: "period-1",
			requestedBy: "emp-requester",
			approverId: "emp-manager",
			status: "pending",
			metadata: null,
		});

		await runTimeCorrectionDecisionEffect(
			rejectTimeCorrectionWithCurrentApproverEffect(
				dbService,
				timeCorrectionCurrentApprover,
				"period-1",
				"Incorrect correction",
			),
		);

		expect(
			dbService.updateSets.filter((values) =>
				Object.hasOwn(values, "isSuperseded"),
			),
		).toEqual([
			{ isSuperseded: false, supersededById: null },
			{ isSuperseded: true, supersededById: null },
			{ isSuperseded: false, supersededById: null },
			{ isSuperseded: true, supersededById: null },
		]);
	});

	it.each([
		[
			"duplicate clock-in endpoint",
			[
				{ ...correction, isSuperseded: false },
				{
					...correction,
					id: "20000000-0000-4000-8000-000000000011",
					isSuperseded: false,
				},
			],
		],
		[
			"more than two corrections",
			[
				{ ...correction, isSuperseded: false },
				{
					...correction,
					id: "20000000-0000-4000-8000-000000000011",
					isSuperseded: false,
				},
				{ ...clockOutCorrection, isSuperseded: false },
			],
		],
	] as const)("rejects metadata-less historical fallback with %s", async (_label, candidates) => {
		const dbService = createTimeCorrectionDecisionDbService();
		dbService.setLegacyCorrectionCandidates([...candidates]);
		vi.mocked(
			dbService.db.query.approvalRequest.findFirst,
		).mockResolvedValueOnce({
			id: "approval-1",
			organizationId: "org-1",
			entityType: "time_entry",
			entityId: "period-1",
			requestedBy: "emp-requester",
			approverId: "emp-manager",
			status: "pending",
			metadata: null,
		});

		await expect(
			runTimeCorrectionDecisionEffect(
				rejectTimeCorrectionWithCurrentApproverEffect(
					dbService,
					timeCorrectionCurrentApprover,
					"period-1",
					"Incorrect correction",
				),
			),
		).rejects.toThrow("Time correction source changed during finalization");
		expect(dbService.updateSets).not.toEqual(
			expect.arrayContaining([{ isSuperseded: false, supersededById: null }]),
		);
	});

	it("does not roll back legacy pending corrections without metadata when active corrections are ambiguous", async () => {
		const dbService = createTimeCorrectionDecisionDbService();
		const secondCorrection = {
			id: "20000000-0000-4000-8000-000000000011",
			timestamp: new Date("2026-05-11T08:45:00.000Z"),
			replacesEntryId: "entry-original",
			isSuperseded: false,
		};
		vi.mocked(
			dbService.db.query.approvalRequest.findFirst,
		).mockResolvedValueOnce({
			id: "approval-1",
			organizationId: "org-1",
			entityType: "time_entry",
			entityId: "period-1",
			requestedBy: "emp-requester",
			approverId: "emp-manager",
			status: "pending",
			metadata: null,
		});
		vi.mocked(dbService.db.select).mockReturnValueOnce({
			from: vi.fn().mockReturnValue({
				where: vi.fn().mockResolvedValue([correction, secondCorrection]),
			}),
		} as never);

		await expect(
			runTimeCorrectionDecisionEffect(
				rejectTimeCorrectionWithCurrentApproverEffect(
					dbService,
					timeCorrectionCurrentApprover,
					"period-1",
					"Incorrect correction",
				),
			),
		).rejects.toThrow("Time correction source changed during finalization");

		expect(dbService.updateSets).not.toEqual(
			expect.arrayContaining([{ isSuperseded: false, supersededById: null }]),
		);
		expect(dbService.updateSets).not.toEqual(
			expect.arrayContaining([{ isSuperseded: true, supersededById: null }]),
		);
	});
});

describe("time correction approval policy resolution", () => {
	it("forces time correction decisions through the transactional approval path", async () => {
		vi.resetModules();
		const processApprovalWithCurrentEmployee = vi.fn(() => Effect.void);
		vi.doMock("@/lib/approvals/server/shared", () => ({
			processApprovalWithCurrentEmployee,
			processApproval: vi.fn(),
		}));
		const { approveTimeCorrectionWithCurrentApproverEffect } = await import(
			"@/lib/approvals/server/time-correction-approvals"
		);

		approveTimeCorrectionWithCurrentApproverEffect(
			{} as ApprovalDbService,
			{
				id: "emp-manager",
				userId: "user-manager",
				organizationId: "org-1",
				user: {
					id: "user-manager",
					name: "Manager",
					email: "manager@example.com",
					image: null,
				},
			},
			"period-1",
		);

		expect(processApprovalWithCurrentEmployee).toHaveBeenCalledWith(
			expect.anything(),
			expect.anything(),
			"time_entry",
			"period-1",
			"approve",
			undefined,
			expect.any(Function),
			undefined,
			expect.objectContaining({ transactional: true }),
			expect.objectContaining({
				updateEntity: expect.any(Function),
				afterCommit: expect.any(Function),
			}),
		);
		vi.doUnmock("@/lib/approvals/server/shared");
	});

	it("forces time correction rejections through the transactional approval path", async () => {
		vi.resetModules();
		const processApprovalWithCurrentEmployee = vi.fn(() => Effect.void);
		vi.doMock("@/lib/approvals/server/shared", () => ({
			processApprovalWithCurrentEmployee,
			processApproval: vi.fn(),
		}));
		const { rejectTimeCorrectionWithCurrentApproverEffect } = await import(
			"@/lib/approvals/server/time-correction-approvals"
		);

		rejectTimeCorrectionWithCurrentApproverEffect(
			{} as ApprovalDbService,
			{
				id: "emp-manager",
				userId: "user-manager",
				organizationId: "org-1",
				user: {
					id: "user-manager",
					name: "Manager",
					email: "manager@example.com",
					image: null,
				},
			},
			"period-1",
			"Incorrect shift",
		);

		expect(processApprovalWithCurrentEmployee).toHaveBeenCalledWith(
			expect.anything(),
			expect.anything(),
			"time_entry",
			"period-1",
			"reject",
			"Incorrect shift",
			expect.any(Function),
			undefined,
			expect.objectContaining({ transactional: true }),
			expect.objectContaining({
				updateEntity: expect.any(Function),
				afterCommit: expect.any(Function),
			}),
		);
		vi.doUnmock("@/lib/approvals/server/shared");
	});

	it("creates time correction approvals through the shared policy resolver", async () => {
		const { dbService, inserts } = createPolicyResolutionDbService([]);

		const result = await Effect.runPromise(
			createTimeCorrectionApprovalWorkflow(dbService, {
				organizationId: "org-1",
				requesterEmployeeId: "emp-requester",
				teamId: "team-1",
				workPeriodId: "period-1",
				defaultApproverId: "emp-manager",
				reason: "Correct missed clock-in",
				overtimeRisk: "warning",
				correctionEntryIds: {
					clockInCorrectionId: "entry-correction",
					clockOutCorrectionId: "entry-clock-out-correction",
				},
			}),
		);

		expect(result).toEqual({
			kind: "default_created",
			approvalRequestId: "insert-1",
		});
		expect(inserts).toHaveLength(1);
		expect(inserts[0].values).toMatchObject({
			organizationId: "org-1",
			entityType: "time_entry",
			entityId: "period-1",
			requestedBy: "emp-requester",
			approverId: "emp-manager",
			status: "pending",
			reason: "Correct missed clock-in",
			metadata: {
				timeCorrection: {
					clockInCorrectionId: "entry-correction",
					clockOutCorrectionId: "entry-clock-out-correction",
				},
			},
		});
	});

	it("stores clock-out-only correction approval metadata without an empty clock-in ID", async () => {
		const { dbService, inserts } = createPolicyResolutionDbService([]);

		await Effect.runPromise(
			createTimeCorrectionApprovalWorkflow(dbService, {
				organizationId: "org-1",
				requesterEmployeeId: "emp-requester",
				teamId: "team-1",
				workPeriodId: "period-1",
				defaultApproverId: "emp-manager",
				reason: "Correct missed clock-out",
				overtimeRisk: "warning",
				correctionEntryIds: {
					clockOutCorrectionId: "entry-clock-out-correction",
				},
			}),
		);

		expect(inserts[0].values.metadata).toEqual({
			timeCorrection: {
				action: "edit",
				clockOutCorrectionId: "entry-clock-out-correction",
			},
		});
	});

	it("rejects explicitly empty correction entry metadata", async () => {
		const { dbService, inserts } = createPolicyResolutionDbService([]);

		await expect(
			Effect.runPromise(
				createTimeCorrectionApprovalWorkflow(dbService, {
					organizationId: "org-1",
					requesterEmployeeId: "emp-requester",
					teamId: "team-1",
					workPeriodId: "period-1",
					defaultApproverId: "emp-manager",
					reason: "Invalid empty correction",
					overtimeRisk: "warning",
					correctionEntryIds: {},
				}),
			),
		).rejects.toThrow(
			"Time correction approval must link at least one correction entry",
		);
		expect(inserts).toHaveLength(0);
	});

	it("rejects a present blank clock-in correction ID when clock-out is valid", async () => {
		const { dbService, inserts } = createPolicyResolutionDbService([]);

		await expect(
			Effect.runPromise(
				createTimeCorrectionApprovalWorkflow(dbService, {
					organizationId: "org-1",
					requesterEmployeeId: "emp-requester",
					teamId: "team-1",
					workPeriodId: "period-1",
					defaultApproverId: "emp-manager",
					reason: "Invalid blank clock-in ID",
					overtimeRisk: "warning",
					correctionEntryIds: {
						clockInCorrectionId: "",
						clockOutCorrectionId: "entry-clock-out-correction",
					},
				}),
			),
		).rejects.toThrow("Correction entry IDs must not be blank");
		expect(inserts).toHaveLength(0);
	});

	it("rejects a present blank clock-out correction ID when clock-in is valid", async () => {
		const { dbService, inserts } = createPolicyResolutionDbService([]);

		await expect(
			Effect.runPromise(
				createTimeCorrectionApprovalWorkflow(dbService, {
					organizationId: "org-1",
					requesterEmployeeId: "emp-requester",
					teamId: "team-1",
					workPeriodId: "period-1",
					defaultApproverId: "emp-manager",
					reason: "Invalid blank clock-out ID",
					overtimeRisk: "warning",
					correctionEntryIds: {
						clockInCorrectionId: "entry-correction",
						clockOutCorrectionId: "",
					},
				}),
			),
		).rejects.toThrow("Correction entry IDs must not be blank");
		expect(inserts).toHaveLength(0);
	});

	it("treats an explicitly undefined clock-out correction ID as omitted", async () => {
		const { dbService, inserts } = createPolicyResolutionDbService([]);

		await expect(
			Effect.runPromise(
				createTimeCorrectionApprovalWorkflow(dbService, {
					organizationId: "org-1",
					requesterEmployeeId: "emp-requester",
					teamId: "team-1",
					workPeriodId: "period-1",
					defaultApproverId: "emp-manager",
					reason: "Correct clock-in",
					overtimeRisk: "warning",
					correctionEntryIds: {
						clockInCorrectionId: "entry-correction",
						clockOutCorrectionId: undefined,
					},
				}),
			),
		).resolves.toEqual({
			kind: "default_created",
			approvalRequestId: "insert-1",
		});
		expect(inserts[0].values.metadata).toEqual({
			timeCorrection: {
				action: "edit",
				clockInCorrectionId: "entry-correction",
			},
		});
	});

	it("treats an explicitly undefined clock-in correction ID as omitted", async () => {
		const { dbService, inserts } = createPolicyResolutionDbService([]);

		await expect(
			Effect.runPromise(
				createTimeCorrectionApprovalWorkflow(dbService, {
					organizationId: "org-1",
					requesterEmployeeId: "emp-requester",
					teamId: "team-1",
					workPeriodId: "period-1",
					defaultApproverId: "emp-manager",
					reason: "Correct clock-out",
					overtimeRisk: "warning",
					correctionEntryIds: {
						clockInCorrectionId: undefined,
						clockOutCorrectionId: "entry-clock-out-correction",
					},
				}),
			),
		).resolves.toEqual({
			kind: "default_created",
			approvalRequestId: "insert-1",
		});
		expect(inserts[0].values.metadata).toEqual({
			timeCorrection: {
				action: "edit",
				clockOutCorrectionId: "entry-clock-out-correction",
			},
		});
	});

	it("rejects deletion approval metadata unless both correction entries are linked", async () => {
		const { dbService, inserts } = createPolicyResolutionDbService([]);

		await expect(
			Effect.runPromise(
				createTimeCorrectionApprovalWorkflow(dbService, {
					organizationId: "org-1",
					requesterEmployeeId: "emp-requester",
					teamId: "team-1",
					workPeriodId: "period-1",
					defaultApproverId: "emp-manager",
					reason: "Delete period",
					overtimeRisk: "warning",
					correctionAction: "delete",
					correctionEntryIds: { clockInCorrectionId: "entry-correction" },
				}),
			),
		).rejects.toThrow(
			"Deletion approval requires clock-in and clock-out correction entries",
		);
		expect(inserts).toHaveLength(0);
	});

	it("rejects a new time correction approval when the work period already has one pending", async () => {
		const { dbService } = createPolicyResolutionDbService([]);
		vi.mocked(
			dbService.db.query.approvalRequest.findFirst,
		).mockResolvedValueOnce({
			id: "approval-existing",
		});

		await expect(
			Effect.runPromise(
				createTimeCorrectionApprovalWorkflow(dbService, {
					organizationId: "org-1",
					requesterEmployeeId: "emp-requester",
					teamId: "team-1",
					workPeriodId: "period-1",
					defaultApproverId: "emp-manager",
					reason: "Correct missed clock-in",
					overtimeRisk: "warning",
				}),
			),
		).rejects.toThrow(
			"A time correction approval is already pending for this work period",
		);
	});

	it("uses existing default approval behavior when no approval policy matches", async () => {
		const { dbService, inserts } = createPolicyResolutionDbService([]);

		const result = await Effect.runPromise(
			resolvePolicyAndCreateApproval(dbService, {
				context: timePolicyContext,
				defaultApproverId: "emp-manager",
				reason: "Correct missed clock-in",
			}),
		);

		expect(result).toEqual({
			kind: "default_created",
			approvalRequestId: "insert-1",
		});
		expect(inserts).toHaveLength(1);
		expect(inserts[0].values).toMatchObject({
			organizationId: "org-1",
			entityType: "time_entry",
			entityId: "period-1",
			requestedBy: "emp-requester",
			approverId: "emp-manager",
			status: "pending",
			reason: "Correct missed clock-in",
		});
	});

	it("creates a chain approval request when an approval policy matches", async () => {
		const { dbService, inserts } = createPolicyResolutionDbService([
			{
				id: "policy-1",
				organizationId: "org-1",
				name: "Overtime policy",
				isActive: true,
				priority: 1,
				conditions: [
					{
						conditionType: "approval_type",
						operator: "equals",
						valueJson: "time_entry",
					},
					{
						conditionType: "overtime_risk",
						operator: "equals",
						overtimeRisk: "warning",
					},
				],
				stages: [
					{
						id: "stage-1",
						stepOrder: 1,
						label: "Manager",
						approverType: "direct_manager",
						approverEmployeeId: null,
						fallbackBehavior: "fail",
					},
				],
			},
		]);

		const result = await Effect.runPromise(
			resolvePolicyAndCreateApproval(dbService, {
				context: timePolicyContext,
				defaultApproverId: "emp-manager",
				reason: "Correct missed clock-in",
			}),
		);

		expect(result).toEqual({
			kind: "chain_created",
			chainInstanceId: "insert-1",
			approvalRequestId: "insert-2",
		});
		expect(inserts).toHaveLength(3);
		expect(inserts.map((insert) => insert.values.organizationId)).toEqual([
			"org-1",
			"org-1",
			"org-1",
		]);
		expect(inserts[0].values).toMatchObject({
			policyId: "policy-1",
			entityType: "time_entry",
		});
		expect(inserts[1].values).toMatchObject({
			approverId: "emp-manager",
			entityId: "period-1",
		});
		expect(inserts[2].values).toMatchObject({
			chainInstanceId: "insert-1",
			approvalRequestId: "insert-2",
			resolvedApproverEmployeeId: "emp-manager",
		});
	});

	it("fails closed when a matched time policy cannot resolve an approver", async () => {
		const { dbService, inserts } = createPolicyResolutionDbService([
			{
				id: "policy-1",
				organizationId: "org-1",
				name: "Broken time policy",
				isActive: true,
				priority: 1,
				conditions: [
					{
						conditionType: "approval_type",
						operator: "equals",
						valueJson: "time_entry",
					},
				],
				stages: [
					{
						id: "stage-1",
						stepOrder: 1,
						label: "Missing approver",
						approverType: "specific_employee",
						approverEmployeeId: "missing-employee",
						fallbackBehavior: "fail",
					},
				],
			},
		]);

		await expect(
			Effect.runPromise(
				createTimeCorrectionApprovalWorkflow(dbService, {
					organizationId: "org-1",
					requesterEmployeeId: "emp-requester",
					teamId: "team-1",
					workPeriodId: "period-1",
					defaultApproverId: "emp-manager",
					reason: "Correct missed clock-in",
					overtimeRisk: "warning",
				}),
			),
		).rejects.toThrow("Specific approver is not active in this organization.");
		expect(inserts).toHaveLength(0);
	});

	it("applies an auto-completed requester correction without notifying inside the transaction", async () => {
		const { dbService, inserts, updates } = createPolicyResolutionDbService([]);
		vi.mocked(dbService.db.query.approvalRequest.findFirst)
			.mockResolvedValueOnce(null)
			.mockResolvedValue({
				id: "insert-1",
				organizationId: "org-1",
				entityType: "time_entry",
				entityId: "period-1",
				requestedBy: "emp-requester",
				approverId: "emp-requester",
				status: "approved",
				reason: "Correct missed clock-in",
				approvedAt: new Date(),
				rejectionReason: null,
				metadata: {
					timeCorrection: {
						action: "edit",
						clockInCorrectionId: correction.id,
					},
				},
				updatedAt: new Date(),
			});

		const result = await Effect.runPromise(
			createTimeCorrectionApprovalWorkflow(dbService, {
				organizationId: "org-1",
				requesterEmployeeId: "emp-requester",
				teamId: "team-1",
				workPeriodId: "period-1",
				defaultApproverId: "emp-requester",
				reason: "Correct missed clock-in",
				overtimeRisk: "warning",
				correctionEntryIds: { clockInCorrectionId: correction.id },
			}),
		);

		expect(result).toMatchObject({
			kind: "auto_completed",
			reason: "requester_is_approver",
			autoCompletion: {
				period: { id: "period-1" },
				workBalanceDirtyMark: {
					employeeId: "emp-requester",
					organizationId: "org-1",
					dirtyFromDate: "2026-05-11",
				},
			},
		});
		expect(inserts[0].values).toMatchObject({
			approverId: "emp-requester",
			status: "approved",
		});
		expect(updates).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					clockInId: correction.id,
					startTime: correction.timestamp,
				}),
			]),
		);
		expect(onTimeCorrectionApproved).not.toHaveBeenCalled();
	});
});
