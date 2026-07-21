import { isInstant } from "@/lib/datetime/temporal-core";
import type {
	ApprovalDomainAdapterContext,
	ApprovalDomainCommand,
	ApprovalTerminalAdapterInput,
	ApprovalWorkflowTransactionContext,
} from "../domain-adapters/types";
import type {
	ApprovalCommandActorResolver,
	ApprovalCommandResult,
	ApprovalMaterializedTransitionPlan,
	ApprovalTransitionResultBuilder,
	ApprovalWorkflowAuthorization,
	ApprovalWorkflowCommandRequest,
	ApprovalWorkflowSourceLoader,
	ApprovalWriteGate,
} from "./ports";
import type { ApprovalWorkflowRepository } from "./repository";
import type { ApprovalWorkflowCommand } from "./state-machine";
import {
	ApprovalStateMachineError,
	fingerprintApprovalCommandActor,
	materializeApprovalTransitionPlan,
	planStageActivation,
	planWorkflowTransition,
} from "./state-machine";

export type ApprovalTransitionEngineErrorCode =
	| "malformed_command"
	| "forbidden"
	| "idempotency_mismatch"
	| "version_conflict"
	| "result_scope"
	| "invariant"
	| "activation_cycle";

export class ApprovalTransitionEngineError extends Error {
	readonly code: ApprovalTransitionEngineErrorCode;
	readonly details: Readonly<Record<string, string>>;

	constructor(
		code: ApprovalTransitionEngineErrorCode,
		details: Readonly<Record<string, string>> = {},
	) {
		super(code);
		this.name = "ApprovalTransitionEngineError";
		this.code = code;
		this.details = details;
	}
}

const engineCreatedErrors = new WeakSet<object>();

const CANONICAL_UUID =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

type CommandRecord = Record<string, unknown>;

function createApprovalTransitionEngineError(
	code: ApprovalTransitionEngineErrorCode,
	details: Readonly<Record<string, string>> = {},
): ApprovalTransitionEngineError {
	const error = new ApprovalTransitionEngineError(code, details);
	engineCreatedErrors.add(error);
	return error;
}

function malformed(field: string): never {
	throw createApprovalTransitionEngineError("malformed_command", { field });
}

function isEngineCreatedError(
	error: unknown,
): error is ApprovalTransitionEngineError {
	return (
		typeof error === "object" &&
		error !== null &&
		engineCreatedErrors.has(error)
	);
}

function commandRecord(value: unknown): CommandRecord {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return malformed("command");
	}
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) {
		return malformed("command");
	}
	return value as CommandRecord;
}

function exactKeys(
	value: CommandRecord,
	required: readonly string[],
	optional: readonly string[] = [],
): void {
	const allowed = new Set([...required, ...optional]);
	const keys = Reflect.ownKeys(value);
	if (
		keys.some((key) => typeof key !== "string" || !allowed.has(key)) ||
		required.some((key) => !Object.hasOwn(value, key))
	) {
		malformed("command_shape");
	}
}

function property(value: CommandRecord, key: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	if (!descriptor?.enumerable || !("value" in descriptor)) {
		return malformed(key);
	}
	return descriptor.value;
}

function canonicalUuid(value: unknown, field: string): string {
	if (typeof value !== "string" || !CANONICAL_UUID.test(value)) {
		return malformed(field);
	}
	return value;
}

function requiredReason(value: unknown): string {
	if (typeof value !== "string" || value.trim().length === 0) {
		return malformed("reason");
	}
	return value;
}

function optionalReason(value: CommandRecord): string | null {
	if (!Object.hasOwn(value, "reason")) return null;
	return requiredReason(property(value, "reason"));
}

function canonicalizeCommand(command: unknown): Record<string, string | null> {
	const value = commandRecord(command);
	const type = property(value, "type");
	if (typeof type !== "string") return malformed("type");

	switch (type) {
		case "approve":
			exactKeys(value, ["type", "stageId", "assignmentId"], ["reason"]);
			return {
				type,
				stageId: canonicalUuid(property(value, "stageId"), "stageId"),
				assignmentId: canonicalUuid(
					property(value, "assignmentId"),
					"assignmentId",
				),
				reason: optionalReason(value),
			};
		case "reject":
			exactKeys(value, ["type", "stageId", "assignmentId", "reason"]);
			return {
				type,
				stageId: canonicalUuid(property(value, "stageId"), "stageId"),
				assignmentId: canonicalUuid(
					property(value, "assignmentId"),
					"assignmentId",
				),
				reason: requiredReason(property(value, "reason")),
			};
		case "cancel":
		case "expire":
			exactKeys(value, ["type", "reason"]);
			return { type, reason: requiredReason(property(value, "reason")) };
		case "reassign":
		case "escalate":
			exactKeys(value, ["type", "stageId", "fromEmployeeId", "toEmployeeId"]);
			return {
				type,
				stageId: canonicalUuid(property(value, "stageId"), "stageId"),
				fromEmployeeId: canonicalUuid(
					property(value, "fromEmployeeId"),
					"fromEmployeeId",
				),
				toEmployeeId: canonicalUuid(
					property(value, "toEmployeeId"),
					"toEmployeeId",
				),
			};
		default:
			return malformed("type");
	}
}

/** Produces a stable receipt value from every semantic state-machine command field. */
export function fingerprintApprovalWorkflowCommand(
	command: ApprovalWorkflowCommand,
): string {
	try {
		return JSON.stringify(canonicalizeCommand(command));
	} catch (error) {
		if (isEngineCreatedError(error)) throw error;
		return malformed("command");
	}
}

export interface ApprovalTransitionEngine {
	execute(
		request: ApprovalWorkflowCommandRequest,
	): Promise<ApprovalCommandResult>;
	executeInTransactionWithDisposition(
		context: ApprovalWorkflowTransactionContext,
		request: ApprovalWorkflowCommandRequest,
	): Promise<{
		result: ApprovalCommandResult;
		disposition: "executed" | "replayed";
	}>;
	executeInTransaction(
		context: ApprovalWorkflowTransactionContext,
		request: ApprovalWorkflowCommandRequest,
	): Promise<ApprovalCommandResult>;
}

export interface ApprovalTransitionEngineDependencies {
	repository: ApprovalWorkflowRepository;
	actorResolver: ApprovalCommandActorResolver;
	authorization: ApprovalWorkflowAuthorization;
	sourceLoader: ApprovalWorkflowSourceLoader;
	resultBuilder: ApprovalTransitionResultBuilder;
	clock: { nowInstant(): import("@/lib/datetime/temporal-core").Instant };
}

function engineError(
	code: Exclude<ApprovalTransitionEngineErrorCode, "malformed_command">,
	details: Readonly<Record<string, string>> = {},
): ApprovalTransitionEngineError {
	return createApprovalTransitionEngineError(code, details);
}

function assertSnapshotScope(
	request: ApprovalWorkflowCommandRequest,
	workflow: { id: string; organizationId: string },
): void {
	if (
		workflow.organizationId !== request.organizationId ||
		workflow.id !== request.workflowId
	) {
		throw engineError("forbidden", { field: "workflow_scope" });
	}
}

function allowsAuthorization(
	request: ApprovalWorkflowCommandRequest,
	authorization:
		| "active_assignment"
		| "requester"
		| "manage_approval"
		| "system",
): boolean {
	if (
		request.principal.kind === "system" &&
		request.principal.systemId === "approval-activation"
	) {
		return false;
	}
	if (authorization === "active_assignment") {
		return (
			request.principal.kind === "employee" &&
			(request.command.type === "approve" || request.command.type === "reject")
		);
	}
	if (authorization === "requester") {
		return (
			request.principal.kind === "employee" && request.command.type === "cancel"
		);
	}
	if (authorization === "manage_approval") {
		return (
			request.principal.kind === "employee" && request.command.type !== "expire"
		);
	}
	return (
		request.command.type === "expire" &&
		request.principal.kind === "system" &&
		request.principal.systemId === "approval-expiry"
	);
}

function adapterCommand(
	command: ApprovalWorkflowCommand,
): ApprovalDomainCommand | null {
	switch (command.type) {
		case "approve":
			return { kind: "approve", reason: command.reason ?? null };
		case "reject":
			return { kind: "reject", reason: command.reason };
		case "cancel":
			return { kind: "cancel", reason: command.reason };
		default:
			return null;
	}
}

function proposedStatus(
	command: ApprovalDomainCommand,
): "approved" | "rejected" | "cancelled" {
	if (command.kind === "approve") return "approved";
	if (command.kind === "reject") return "rejected";
	return "cancelled";
}

function assertResultScope(
	request: ApprovalWorkflowCommandRequest,
	result: ApprovalCommandResult,
): void {
	const snapshotChildrenAreScoped = result.snapshot.stages.every(
		(stage) =>
			stage.organizationId === request.organizationId &&
			stage.workflowId === request.workflowId &&
			stage.assignments.every(
				(assignment) =>
					assignment.organizationId === request.organizationId &&
					assignment.workflowId === request.workflowId &&
					assignment.stageId === stage.id,
			),
	);
	if (
		result.snapshot.organizationId !== request.organizationId ||
		result.snapshot.id !== request.workflowId ||
		!snapshotChildrenAreScoped ||
		result.projection.organizationId !== request.organizationId ||
		result.projection.workflowId !== request.workflowId ||
		result.events.some(
			(event) =>
				event.organizationId !== request.organizationId ||
				event.workflowId !== request.workflowId,
		) ||
		result.outbox.some(
			(outbox) =>
				outbox.organizationId !== request.organizationId ||
				outbox.workflowId !== request.workflowId,
		)
	) {
		throw engineError("result_scope");
	}
}

function comparable(value: unknown): unknown {
	if (isInstant(value)) return value.toString();
	if (Array.isArray(value)) return value.map(comparable);
	if (typeof value === "object" && value !== null) {
		const record = value as Record<string, unknown>;
		return Object.fromEntries(
			Object.keys(record)
				.sort()
				.map((key) => [key, comparable(record[key])]),
		);
	}
	return value;
}

function semanticallyEqual(left: unknown, right: unknown): boolean {
	return JSON.stringify(comparable(left)) === JSON.stringify(comparable(right));
}

interface MaterializedBatchBaseline {
	snapshot: unknown;
	events: unknown[];
	eventReferences: Array<{ eventId: string; eventType: string }>;
}

function createMaterializedBatchBaseline(
	materializedBatch: readonly [
		ApprovalMaterializedTransitionPlan,
		...ApprovalMaterializedTransitionPlan[],
	],
): MaterializedBatchBaseline {
	const finalPass = materializedBatch.at(-1);
	if (!finalPass) invariant({ field: "result_builder" });
	const events = materializedBatch.flatMap((pass) =>
		pass.events.map(
			({ persistenceMetadata: _persistenceMetadata, ...event }) => event,
		),
	);
	return {
		snapshot: comparable(finalPass.resultingSnapshot),
		events: events.map(comparable),
		eventReferences: events.map((event) => ({
			eventId: event.id,
			eventType: event.eventType,
		})),
	};
}

function isolateForResultBuilder<T>(value: T): T {
	if (isInstant(value)) return value;
	if (Array.isArray(value)) {
		return value.map(isolateForResultBuilder) as T;
	}
	if (typeof value === "object" && value !== null) {
		return Object.fromEntries(
			Object.entries(value).map(([key, child]) => [
				key,
				isolateForResultBuilder(child),
			]),
		) as T;
	}
	return value;
}

function assertResultMatchesMaterializedBatch(
	result: ApprovalCommandResult,
	baseline: MaterializedBatchBaseline,
): void {
	const eventsMatch =
		result.events.length === baseline.events.length &&
		baseline.events.every((event, index) =>
			semanticallyEqual(result.events[index], event),
		);
	const outboxMatches =
		result.outbox.length === baseline.eventReferences.length &&
		baseline.eventReferences.every(
			(event) =>
				result.outbox.filter(
					(outbox) =>
						outbox.eventId === event.eventId &&
						outbox.eventType === event.eventType,
				).length === 1,
		);
	if (
		!semanticallyEqual(result.snapshot, baseline.snapshot) ||
		!eventsMatch ||
		!outboxMatches
	) {
		invariant({ field: "result_builder" });
	}
}

const activationActor = {
	kind: "system",
	employeeId: null,
	userId: null,
} as const;

function invariant(details: Readonly<Record<string, string>> = {}): never {
	throw engineError("invariant", details);
}

export function createApprovalTransitionEngine(
	dependencies: ApprovalTransitionEngineDependencies,
): ApprovalTransitionEngine {
	const executeInTransactionWithDisposition: ApprovalTransitionEngine["executeInTransactionWithDisposition"] =
		async (context, request) => {
			const actor = await dependencies.actorResolver.resolve({
				dbService: context.dbService,
				organizationId: request.organizationId,
				principal: request.principal,
			});
			const actorMatchesPrincipal =
				request.principal.kind === "system"
					? actor.kind === "system"
					: actor.kind === "employee" &&
						actor.userId === request.principal.userId;
			if (!actorMatchesPrincipal) {
				throw engineError("forbidden", { field: "principal_actor" });
			}
			const workflow = await context.repository.loadSnapshot({
				organizationId: request.organizationId,
				workflowId: request.workflowId,
			});
			assertSnapshotScope(request, workflow);
			const gate = await context.writeGate.acquire({
				organizationId: request.organizationId,
				workflowType: workflow.workflowType,
			});
			assertSnapshotScope(request, workflow);
			if (!gate.behavior.decideCanonical || !gate.behavior.writeCanonical) {
				throw engineError("forbidden", {
					field: "canonical_authority",
					mode: gate.mode,
				});
			}
			const receipt = {
				organizationId: request.organizationId,
				workflowId: request.workflowId,
				idempotencyKey: request.idempotencyKey,
				actorFingerprint: fingerprintApprovalCommandActor(actor),
				commandFingerprint: fingerprintApprovalWorkflowCommand(request.command),
			};
			const claim = await context.repository.claimCommand(receipt);
			if (claim.kind === "completed") {
				assertResultScope(request, claim.result);
				return { result: claim.result, disposition: "replayed" };
			}
			if (claim.kind === "fingerprint_mismatch") {
				throw engineError("idempotency_mismatch");
			}
			if (workflow.version !== request.expectedVersion) {
				throw engineError("version_conflict", {
					expectedVersion: String(request.expectedVersion),
					actualVersion: String(workflow.version),
				});
			}

			const authorization = await dependencies.authorization.authorize({
				dbService: context.dbService,
				organizationId: request.organizationId,
				workflow,
				actor,
				command: request.command,
			});
			if (!allowsAuthorization(request, authorization)) {
				throw engineError("forbidden", { command: request.command.type });
			}

			const adapter = context.adapterRegistry.get(workflow.workflowType);
			let source: unknown;
			try {
				source = await dependencies.sourceLoader.load({
					dbService: context.dbService,
					organizationId: request.organizationId,
					workflow,
					actor,
				});
			} catch (error) {
				const current = await context.repository.loadSnapshot({
					organizationId: request.organizationId,
					workflowId: request.workflowId,
				});
				if (current.version !== workflow.version) {
					throw engineError("version_conflict", {
						expectedVersion: String(workflow.version),
						actualVersion: String(current.version),
					});
				}
				throw error;
			}
			const adapterContext: ApprovalDomainAdapterContext<unknown> = {
				organizationId: request.organizationId,
				workflow,
				sourceIdentity: {
					organizationId: workflow.organizationId,
					workflowType: workflow.workflowType,
					sourceType: workflow.sourceType,
					sourceId: workflow.sourceId,
				},
				source,
				actor,
			};
			const capabilities = await adapter.getTrustedCapabilities(adapterContext);
			const preflight = adapterCommand(request.command);
			if (preflight) {
				await adapter.preflightCommand({
					...adapterContext,
					command: preflight,
					proposedStatus: proposedStatus(preflight),
				});
			}
			const policy =
				request.command.type === "cancel" && workflow.status === "approved"
					? {
							kind: "approved_cancellation" as const,
							authorization: capabilities.canCancelAfterApproval
								? await context.adapterRegistry.authorizeApprovedCancellation(
										adapterContext,
									)
								: (() => {
										throw engineError("forbidden", { command: "cancel" });
									})(),
						}
					: ({ kind: "standard" } as const);
			const plan = planWorkflowTransition(
				workflow,
				request.command,
				policy,
				dependencies.clock.nowInstant(),
			);
			if (plan.expectedVersion !== request.expectedVersion) {
				throw engineError("version_conflict", {
					expectedVersion: String(request.expectedVersion),
					actualVersion: String(plan.expectedVersion),
				});
			}

			const terminal = plan.nextAction;
			const terminalTransition =
				terminal.kind === "finalize_terminal" ? terminal.transition : null;

			const materializeAndApply = async (
				transitionPlan: typeof plan,
				commandActor: typeof actor,
			) => {
				const identities =
					await context.repository.allocateTransitionIdentities({
						organizationId: request.organizationId,
						workflowId: request.workflowId,
						identityAllocations: transitionPlan.identityAllocations,
					});
				const materialized = materializeApprovalTransitionPlan(
					transitionPlan,
					identities,
					{
						receipt,
						receiptActor: commandActor.kind === "system" ? actor : undefined,
						actor: commandActor,
					},
				);
				const cas = await context.repository.tryAdvanceVersion({
					organizationId: request.organizationId,
					workflowId: request.workflowId,
					expectedVersion: transitionPlan.expectedVersion,
				});
				if (cas.kind === "conflict") {
					throw engineError("version_conflict", {
						expectedVersion: String(transitionPlan.expectedVersion),
						actualVersion: cas.version === null ? "" : String(cas.version),
					});
				}
				await context.repository.applyMaterializedTransition(materialized);
				return materialized;
			};

			let materialized = await materializeAndApply(plan, actor);
			const materializedBatch: [
				ApprovalMaterializedTransitionPlan,
				...ApprovalMaterializedTransitionPlan[],
			] = [materialized];
			let finalization = null;
			if (terminalTransition) {
				const terminalInput: ApprovalTerminalAdapterInput<unknown> = {
					...adapterContext,
					workflow: materialized.resultingSnapshot,
					dbService: context.dbService,
					transition: terminalTransition,
					finalizationCause: "command",
					finalizedAt: dependencies.clock.nowInstant(),
				};
				await adapter.preflightTerminal(terminalInput);
				finalization = await adapter.finalizeTerminal(terminalInput);
			}
			let currentSnapshot = materialized.resultingSnapshot;
			let activationPasses = 0;
			const activationPassLimit = workflow.stages.length + 1;
			const routingContext =
				materialized.nextAction.kind === "needs_activation"
					? await adapter.produceRoutingContext(adapterContext)
					: null;

			while (materialized.nextAction.kind === "needs_activation") {
				if (activationPasses >= activationPassLimit) {
					throw engineError("activation_cycle", {
						limit: String(activationPassLimit),
					});
				}
				const requested = materialized.nextAction;
				const stage = currentSnapshot.stages.find(
					(candidate) =>
						candidate.id === requested.stageId &&
						candidate.sequence === requested.stageOrder,
				);
				if (
					!stage ||
					currentSnapshot.status !== "pending" ||
					currentSnapshot.currentStageOrder !== requested.stageOrder ||
					stage.organizationId !== request.organizationId ||
					stage.workflowId !== request.workflowId ||
					stage.status !== "waiting" ||
					routingContext === null
				) {
					invariant({ activation: "missing_or_invalid_stage" });
				}
				const resolved = await context.activationResolver.resolve({
					dbService: context.dbService,
					organizationId: request.organizationId,
					workflow: currentSnapshot,
					stage,
					actor: activationActor,
					routingContext,
				});
				if (
					resolved.organizationId !== request.organizationId ||
					resolved.workflowId !== request.workflowId ||
					resolved.stageId !== stage.id
				) {
					invariant({ activation: "resolver_scope" });
				}
				let activationPlan: typeof plan;
				try {
					activationPlan = planStageActivation(
						currentSnapshot,
						resolved,
						dependencies.clock.nowInstant(),
					);
				} catch (error) {
					if (error instanceof ApprovalStateMachineError) {
						invariant({ activation: error.code });
					}
					throw error;
				}
				const activationMaterialized = await materializeAndApply(
					activationPlan,
					activationActor,
				);
				materializedBatch.push(activationMaterialized);
				materialized = activationMaterialized;
				currentSnapshot = materialized.resultingSnapshot;
				activationPasses += 1;

				if (materialized.nextAction.kind === "finalize_terminal") {
					const activationTerminalInput: ApprovalTerminalAdapterInput<unknown> =
						{
							...adapterContext,
							workflow: currentSnapshot,
							actor: activationActor,
							dbService: context.dbService,
							transition: materialized.nextAction.transition,
							finalizationCause: "activation",
							finalizedAt: dependencies.clock.nowInstant(),
						};
					await adapter.preflightTerminal(activationTerminalInput);
					finalization = await adapter.finalizeTerminal(
						activationTerminalInput,
					);
				}
			}
			const resultBaseline = createMaterializedBatchBaseline(materializedBatch);
			const result = dependencies.resultBuilder.build({
				materializedBatch: isolateForResultBuilder(materializedBatch),
				finalization,
			});
			assertResultScope(request, result);
			assertResultMatchesMaterializedBatch(result, resultBaseline);
			if (gate.behavior.mirror === "canonical_to_legacy") {
				const fixedGate: ApprovalWriteGate = {
					acquire: async (scope) => {
						if (
							scope.organizationId !== result.snapshot.organizationId ||
							scope.workflowType !== result.snapshot.workflowType
						) {
							invariant({ mirror: "write_gate_scope" });
						}
						return gate;
					},
				};
				await context.compatibilityWriter
					.withWriteGate(fixedGate)
					.mirrorCanonicalToLegacy({ result });
			}
			await context.projectionWriter.write(result.projection);
			for (const outbox of result.outbox) {
				await context.outboxWriter.write(outbox);
			}
			await context.repository.completeCommand({ ...receipt, result });
			return { result, disposition: "executed" };
		};
	const executeInTransaction: ApprovalTransitionEngine["executeInTransaction"] =
		async (context, request) =>
			(await executeInTransactionWithDisposition(context, request)).result;
	return {
		execute: (request) =>
			dependencies.repository.withTransaction((context) =>
				executeInTransaction(context, request),
			),
		executeInTransaction,
		executeInTransactionWithDisposition,
	};
}
