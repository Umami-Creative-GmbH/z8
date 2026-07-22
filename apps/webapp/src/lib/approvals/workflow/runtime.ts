import { sql } from "drizzle-orm";
import { type Clock, systemClock } from "@/lib/datetime/temporal-core";
import {
	type AbsenceApprovalAdapterDependencies,
	createAbsenceApprovalAdapter,
} from "../domain-adapters/absence.adapter";
import { createProductionApprovalDomainAdapterRegistry } from "../domain-adapters/production-registry";
import type { ApprovalDomainAdapterRegistry } from "../domain-adapters/registry";
import {
	createTimeCorrectionApprovalAdapter,
	type TimeCorrectionApprovalAdapterDependencies,
} from "../domain-adapters/time-correction.adapter";
import type { ApprovalTerminalFinalizationResult } from "../domain-adapters/types";
import {
	createOrdinaryWorkPeriodApprovalAdapter,
	type OrdinaryWorkPeriodApprovalAdapterDependencies,
} from "../domain-adapters/work-period.adapter";
import { createLegacyApprovalRowWriter } from "./compatibility-writer";
import { createLegacyApprovalObservationPlanner } from "./legacy-observation-planner";
import type {
	ApprovalCommandActorResolver,
	ApprovalMaterializedTransitionPlan,
	ApprovalTransitionResultBuilder,
	ApprovalWorkflowAuthorization,
	ApprovalWorkflowSourceLoader,
} from "./ports";
import {
	type ApprovalWorkflowDatabase,
	type ApprovalWorkflowRepository,
	createApprovalWorkflowRepository,
} from "./repository";
import { normalizeStableData } from "./stable-data";
import {
	type ApprovalTransitionEngine,
	createApprovalTransitionEngine,
} from "./transition-engine";

function runtimeFailure(reason: string): never {
	throw new Error(`Approval workflow runtime: ${reason}`);
}

function rows(result: unknown): unknown[] {
	return typeof result === "object" &&
		result !== null &&
		"rows" in result &&
		Array.isArray(result.rows)
		? result.rows
		: [];
}

function record(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

const CANONICAL_UUID =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function exactEmployeeActorRow(
	value: unknown,
	organizationId: string,
	userId: string,
): string {
	if (
		!record(value) ||
		Reflect.ownKeys(value).length !== 3 ||
		typeof value.id !== "string" ||
		value.organization_id !== organizationId ||
		value.user_id !== userId
	) {
		return runtimeFailure("employee actor lookup returned foreign evidence");
	}
	return value.id;
}

function exactApprovedMemberRow(
	value: unknown,
	organizationId: string,
	userId: string,
): void {
	if (
		!record(value) ||
		Reflect.ownKeys(value).length !== 3 ||
		value.organization_id !== organizationId ||
		value.user_id !== userId ||
		value.status !== "approved"
	) {
		runtimeFailure("member actor lookup returned foreign evidence");
	}
}

export function createDatabaseApprovalCommandActorResolver(): ApprovalCommandActorResolver {
	return {
		async resolve(input) {
			if (input.principal.kind === "system") {
				if (
					input.principal.systemId !== "approval-expiry" &&
					input.principal.systemId !== "approval-activation"
				) {
					return runtimeFailure("unknown system actor");
				}
				return { kind: "system", employeeId: null, userId: null };
			}
			const result = rows(
				await input.dbService.db.execute(sql`
					select id, organization_id, user_id
					from employee
					where organization_id = ${input.organizationId}
						and user_id = ${input.principal.userId}
						and is_active = true
					order by id
					limit 2
				`),
			);
			if (result.length !== 1) {
				return runtimeFailure("employee actor lookup requires exactly one row");
			}
			const employeeId = exactEmployeeActorRow(
				result[0],
				input.organizationId,
				input.principal.userId,
			);
			const memberships = rows(
				await input.dbService.db.execute(sql`
					select organization_id, user_id, status
					from member
					where organization_id = ${input.organizationId}
						and user_id = ${input.principal.userId}
					order by id
					limit ${2}
				`),
			);
			if (memberships.length !== 1) {
				return runtimeFailure("member actor lookup requires exactly one row");
			}
			exactApprovedMemberRow(
				memberships[0],
				input.organizationId,
				input.principal.userId,
			);
			return {
				kind: "employee",
				employeeId,
				userId: input.principal.userId,
			};
		},
	};
}

export function createApprovalWorkflowAuthorization(input: {
	canManageApproval: (input: {
		dbService: import("./ports").ApprovalDbService;
		organizationId: string;
		actorEmployeeId: string;
		workflow: import("./ports").ApprovalWorkflowSnapshot;
		command: import("./state-machine").ApprovalWorkflowCommand;
	}) => Promise<boolean>;
}): ApprovalWorkflowAuthorization {
	return {
		async authorize(request) {
			const workflow = request.workflow;
			const command = request.command;
			if (
				workflow.organizationId !== request.organizationId ||
				workflow.stages.some(
					(stage) =>
						stage.organizationId !== request.organizationId ||
						stage.workflowId !== workflow.id ||
						stage.assignments.some(
							(assignment) =>
								assignment.organizationId !== request.organizationId ||
								assignment.workflowId !== workflow.id ||
								assignment.stageId !== stage.id,
						),
				)
			) {
				return runtimeFailure("authorization scope mismatch");
			}
			if (request.actor.kind === "system") return "system";
			if (
				(command.type === "approve" || command.type === "reject") &&
				workflow.stages.some(
					(stage) =>
						stage.id === command.stageId &&
						stage.status === "pending" &&
						stage.assignments.some(
							(assignment) =>
								assignment.id === command.assignmentId &&
								assignment.status === "pending" &&
								assignment.approverEmployeeId === request.actor.employeeId,
						),
				)
			) {
				return "active_assignment";
			}
			if (
				command.type === "cancel" &&
				workflow.requesterEmployeeId === request.actor.employeeId
			) {
				return "requester";
			}
			if (
				await input.canManageApproval({
					dbService: request.dbService,
					organizationId: request.organizationId,
					actorEmployeeId: request.actor.employeeId,
					workflow,
					command,
				})
			) {
				return "manage_approval";
			}
			return runtimeFailure("forbidden command actor");
		},
	};
}

export function createRegistryApprovalSourceLoader(
	registry: ApprovalDomainAdapterRegistry,
): ApprovalWorkflowSourceLoader {
	return {
		async load(input) {
			const workflow = input.workflow;
			const adapter = registry.get(workflow.workflowType);
			if (
				workflow.organizationId !== input.organizationId ||
				adapter.workflowType !== workflow.workflowType ||
				adapter.sourceType !== workflow.sourceType
			) {
				return runtimeFailure("source loader scope mismatch");
			}
			return adapter.loadSource({
				dbService: input.dbService,
				organizationId: input.organizationId,
				workflow,
				sourceIdentity: {
					organizationId: workflow.organizationId,
					workflowType: workflow.workflowType,
					sourceType: workflow.sourceType,
					sourceId: workflow.sourceId,
				},
				actor: input.actor,
			});
		},
	};
}

function expectedTerminalEvent(
	finalization: ApprovalTerminalFinalizationResult,
): string {
	switch (finalization.transitionKind) {
		case "approve":
			return "workflow.approved";
		case "reject":
			return "workflow.rejected";
		case "cancel_pending":
		case "cancel_approved":
			return "workflow.cancelled";
		case "expire":
			return "workflow.expired";
	}
}

function validateBatch(
	batch: readonly [
		ApprovalMaterializedTransitionPlan,
		...ApprovalMaterializedTransitionPlan[],
	],
	finalization: ApprovalTerminalFinalizationResult | null,
): void {
	const first = batch[0];
	const final = batch.at(-1);
	if (!first || !final) runtimeFailure("result builder received no pass");
	const scope = first.resultingSnapshot;
	const eventIds = new Set<string>();
	let expectedVersion = first.expectedVersion;
	for (const pass of batch) {
		const snapshot = pass.resultingSnapshot;
		if (
			pass.expectedVersion !== expectedVersion ||
			snapshot.version !== expectedVersion + 1 ||
			snapshot.organizationId !== scope.organizationId ||
			snapshot.id !== scope.id ||
			snapshot.workflowType !== scope.workflowType ||
			snapshot.sourceType !== scope.sourceType ||
			snapshot.sourceId !== scope.sourceId ||
			pass.events.length === 0
		) {
			runtimeFailure("result builder batch consistency failure");
		}
		for (const [eventIndex, event] of pass.events.entries()) {
			if (
				!CANONICAL_UUID.test(event.id) ||
				eventIds.has(event.id) ||
				event.organizationId !== scope.organizationId ||
				event.workflowId !== scope.id ||
				event.version !== snapshot.version ||
				event.eventIndex !== eventIndex
			) {
				runtimeFailure("result builder event consistency failure");
			}
			eventIds.add(event.id);
		}
		expectedVersion = snapshot.version;
	}
	if (finalization) {
		const source = finalization.sourceIdentity;
		const lastEvent = final.events.at(-1);
		if (
			finalization.organizationId !== scope.organizationId ||
			finalization.workflowId !== scope.id ||
			finalization.terminalStatus !== final.resultingSnapshot.status ||
			source.organizationId !== scope.organizationId ||
			source.workflowType !== scope.workflowType ||
			source.sourceType !== scope.sourceType ||
			source.sourceId !== scope.sourceId ||
			lastEvent?.eventType !== expectedTerminalEvent(finalization)
		) {
			runtimeFailure("result builder finalization consistency failure");
		}
	}
}

export function createApprovalTransitionResultBuilder(): ApprovalTransitionResultBuilder {
	return {
		build(input) {
			const stableInput = normalizeStableData(input) as typeof input;
			validateBatch(stableInput.materializedBatch, stableInput.finalization);
			const final = stableInput.materializedBatch.at(-1);
			if (!final) return runtimeFailure("result builder received no pass");
			const snapshot = final.resultingSnapshot;
			const events = stableInput.materializedBatch.flatMap((pass) =>
				pass.events.map(
					({ persistenceMetadata: _metadata, ...event }) => event,
				),
			);
			const currentStage = snapshot.stages.find(
				(stage) => stage.sequence === snapshot.currentStageOrder,
			);
			const displayEnvelope = snapshot.displaySnapshot;
			const hasStableDisplayEnvelope =
				record(displayEnvelope) &&
				Reflect.ownKeys(displayEnvelope).length === 2 &&
				record(displayEnvelope.displayPayload) &&
				typeof displayEnvelope.searchText === "string";
			const displayPayload = hasStableDisplayEnvelope
				? displayEnvelope.displayPayload
				: displayEnvelope;
			const searchText =
				typeof displayEnvelope.searchText === "string"
					? displayEnvelope.searchText
					: "";
			const result = {
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
					displayPayload,
					searchText,
					activeInboxStage:
						snapshot.status === "pending" && currentStage?.status === "pending"
							? {
									stageId: currentStage.id,
									stageOrder: currentStage.sequence,
								}
							: null,
					updatedAt: events.at(-1)?.occurredAt ?? snapshot.submittedAt,
				},
				outbox: events.map((event) => ({
					organizationId: snapshot.organizationId,
					workflowId: snapshot.id,
					eventId: event.id,
					eventType: event.eventType,
					dedupeKey: `approval:${snapshot.id}:${event.id}:observe`,
					payload:
						stableInput.finalization && event.id === final.events.at(-1)?.id
							? stableInput.finalization.eventPayload
							: {
									workflowType: snapshot.workflowType,
									sourceType: snapshot.sourceType,
									sourceId: snapshot.sourceId,
									status: snapshot.status,
								},
					disposition: "observe" as const,
					createdAt: event.occurredAt,
				})),
			};
			return normalizeStableData(result) as ReturnType<
				ApprovalTransitionResultBuilder["build"]
			>;
		},
	};
}

export function createApprovalWorkflowRuntime(_input: {
	db: ApprovalWorkflowDatabase;
	adapterRegistry: ApprovalDomainAdapterRegistry;
	canManageApproval: (input: {
		dbService: import("./ports").ApprovalDbService;
		organizationId: string;
		actorEmployeeId: string;
		workflow: import("./ports").ApprovalWorkflowSnapshot;
		command: import("./state-machine").ApprovalWorkflowCommand;
	}) => Promise<boolean>;
	clock?: Clock;
}): {
	repository: ApprovalWorkflowRepository;
	transitionEngine: ApprovalTransitionEngine;
} {
	const clock = _input.clock ?? systemClock;
	const repository = createApprovalWorkflowRepository({
		db: _input.db,
		adapterRegistry: _input.adapterRegistry,
		createLegacyRowWriter: createLegacyApprovalRowWriter,
		observationPlanner: createLegacyApprovalObservationPlanner({ clock }),
		clock,
	});
	const transitionEngine = createApprovalTransitionEngine({
		repository,
		actorResolver: createDatabaseApprovalCommandActorResolver(),
		authorization: createApprovalWorkflowAuthorization({
			canManageApproval: _input.canManageApproval,
		}),
		sourceLoader: createRegistryApprovalSourceLoader(_input.adapterRegistry),
		resultBuilder: createApprovalTransitionResultBuilder(),
		clock,
	});
	return { repository, transitionEngine };
}

export function createProductionApprovalWorkflowRuntime(input: {
	db: ApprovalWorkflowDatabase;
	adapters: {
		absence: AbsenceApprovalAdapterDependencies;
		timeCorrection: TimeCorrectionApprovalAdapterDependencies;
		ordinaryWorkPeriod: OrdinaryWorkPeriodApprovalAdapterDependencies;
	};
	canManageApproval: Parameters<
		typeof createApprovalWorkflowRuntime
	>[0]["canManageApproval"];
	clock?: Clock;
}): {
	repository: ApprovalWorkflowRepository;
	transitionEngine: ApprovalTransitionEngine;
} {
	return createApprovalWorkflowRuntime({
		db: input.db,
		adapterRegistry: createProductionApprovalDomainAdapterRegistry({
			absence: createAbsenceApprovalAdapter(input.adapters.absence),
			timeCorrection: createTimeCorrectionApprovalAdapter(
				input.adapters.timeCorrection,
			),
			manualTimeSubmission: createOrdinaryWorkPeriodApprovalAdapter(
				"manual_time_submission",
				input.adapters.ordinaryWorkPeriod,
			),
			policyClockOut: createOrdinaryWorkPeriodApprovalAdapter(
				"policy_clock_out",
				input.adapters.ordinaryWorkPeriod,
			),
		}),
		canManageApproval: input.canManageApproval,
		clock: input.clock,
	});
}
