import { and, eq } from "drizzle-orm";
import { Cause, Effect, Exit, Option } from "effect";
import { member } from "@/db/auth-schema";
import {
	approvalRequest,
	employee,
	travelExpenseClaim,
	travelExpenseDecisionLog,
} from "@/db/schema";
import {
	type AnyAppError,
	AuthorizationError,
	ConflictError,
	NotFoundError,
} from "@/lib/effect/errors";
import { createLogger } from "@/lib/logger";
import { onTravelExpenseApproved, onTravelExpenseRejected } from "@/lib/notifications/triggers";
import { recordLegacyDeliveryIntent } from "../delivery/intents";
import { kickApprovalDelivery } from "../delivery/kick";
import type { ApprovalActionOptions } from "../domain/types";
import { ApprovalEvidenceError } from "../evidence/errors";
import {
	type ApprovalInvocationCommand,
	type ApprovalInvocationIdentity,
	ApprovalInvocationNotAdmittedError,
	approvalInvocationIdempotencyKey,
	approvalInvocationProvider,
	findCommittedInvocationDecision,
	lockApprovalInvocation,
	readApprovalPresentationMode,
	recordApprovalInvocation,
	requireLegacyInvocationDecision,
} from "../evidence/invocation";
import {
	type LegacyDecisionEvidenceRecord,
	loadLegacyReviewBinding,
	loadLegacyTravelExpenseSubmittedRevision,
} from "../evidence/store";
import {
	findLegacyTravelExpenseDecisionReplay,
	hasLegacyTravelExpenseAuthority,
	prepareLegacyTravelExpenseDecisionEvidence,
	recordLegacyTravelExpenseDecisionEvidence,
	travelExpenseDecisionIdempotencyKey,
} from "../evidence/travel-expense-decision";
import { compareTravelExpenseWithSubmittedRevision } from "../evidence/travel-expense-submission";
import {
	ApprovalAuditLogger,
	createApprovalAuditLogger,
} from "../infrastructure/audit-logger";
import {
	type ResolvePolicyAndCreateApprovalResult,
	resolvePolicyAndCreateApproval,
} from "../policies/chain-service";
import type { ApprovalPolicyEvaluationContext } from "../policies/types";
import { acquireApprovalWriteLock } from "../workflow/cutover";
import { processApprovalWithCurrentEmployee } from "./shared";
import type {
	ApprovalAction,
	ApprovalDatabase,
	ApprovalDbService,
	CurrentApprover,
} from "./types";

const logger = createLogger("TravelExpenseApprovals");

export function buildTravelExpenseApprovalPolicyContext(claim: {
	id: string;
	organizationId: string;
	employeeId: string;
	totalAmount?: number | string;
	calculatedAmount?: number | string;
	employee: { teamId: string | null };
}): ApprovalPolicyEvaluationContext {
	return {
		organizationId: claim.organizationId,
		approvalType: "travel_expense_claim",
		requesterEmployeeId: claim.employeeId,
		teamId: claim.employee.teamId,
		locationId: null,
		absenceCategoryId: null,
		travelExpenseAmount: Number(claim.totalAmount ?? claim.calculatedAmount),
		overtimeRisk: null,
		employeeGroupIds: [],
		entityType: "travel_expense_claim",
		entityId: claim.id,
	};
}

interface TravelExpenseNotificationContext {
	id: string;
	organizationId: string;
	status: "draft" | "submitted" | "approved" | "rejected";
	destinationCity: string | null;
	calculatedAmount: string;
	calculatedCurrency: string;
	employee: {
		userId: string;
	};
}

export function createTravelExpenseApprovalWorkflow(
	dbService: ApprovalDbService,
	input: {
		claim: Parameters<typeof buildTravelExpenseApprovalPolicyContext>[0];
		defaultApproverId: string;
	},
): Effect.Effect<ResolvePolicyAndCreateApprovalResult, AnyAppError, never> {
	return resolvePolicyAndCreateApproval(dbService, {
		context: buildTravelExpenseApprovalPolicyContext(input.claim),
		defaultApproverId: input.defaultApproverId,
	}).pipe(
		Effect.flatMap(
			(
				result,
			): Effect.Effect<ResolvePolicyAndCreateApprovalResult, AnyAppError, never> =>
			result.kind === "auto_completed"
				? loadAutoApprovalRequester(
						dbService,
						input.claim.employeeId,
						input.claim.organizationId,
					).pipe(
						Effect.flatMap((requester) =>
							persistTravelExpenseDecision(dbService, input.claim.id, requester, "approve"),
						),
						Effect.as(result),
					)
				: Effect.succeed(result),
		),
	);
}

function loadAutoApprovalRequester(
	dbService: ApprovalDbService,
	requesterEmployeeId: string,
	organizationId: string,
) {
	return dbService
		.query("getAutoApprovalRequester", async () => {
			return await dbService.db.query.employee.findFirst({
				where: and(
					eq(employee.id, requesterEmployeeId),
					eq(employee.organizationId, organizationId),
					eq(employee.isActive, true),
				),
				with: { user: true },
			});
		})
		.pipe(
			Effect.flatMap((requester) =>
				requester
					? Effect.succeed(requester as CurrentApprover)
					: Effect.fail(
							new NotFoundError({
								message: "Auto-approval requester not found",
								entityType: "employee",
								entityId: requesterEmployeeId,
							}),
						),
			),
		);
}

export function loadTravelExpenseApprover(
	dbService: ApprovalDbService,
	approverId: string,
): Effect.Effect<CurrentApprover, AnyAppError, never> {
	return dbService
		.query("getTravelExpenseApprover", async () => {
			return await dbService.db.query.employee.findFirst({
				where: eq(employee.id, approverId),
				with: { user: true },
			});
		})
		.pipe(
			Effect.flatMap((currentEmployee) =>
				currentEmployee
					? Effect.succeed(currentEmployee as CurrentApprover)
					: Effect.fail(
							new NotFoundError({
								message: "Employee profile not found",
								entityType: "employee",
								entityId: approverId,
							}),
						),
			),
		);
}

function hasAssignedPendingTravelExpenseApproval(
	dbService: ApprovalDbService,
	claimId: string,
	currentEmployee: CurrentApprover,
) {
	return dbService
		.query("getAssignedTravelExpenseApprovalRequest", async () => {
			return await dbService.db.query.approvalRequest.findFirst({
				where: and(
					eq(approvalRequest.entityType, "travel_expense_claim"),
					eq(approvalRequest.entityId, claimId),
					eq(approvalRequest.approverId, currentEmployee.id),
					eq(approvalRequest.organizationId, currentEmployee.organizationId),
					eq(approvalRequest.status, "pending"),
				),
			});
		})
		.pipe(Effect.map(Boolean));
}

export function preflightTravelExpenseDecision(
	dbService: ApprovalDbService,
	claimId: string,
	currentEmployee: CurrentApprover,
	action: "approve" | "reject",
	options?: Pick<ApprovalActionOptions, "allowAnyApprover">,
) {
	return Effect.gen(function* (_) {
		const claim = yield* _(
			dbService.query("getTravelExpenseClaimForDecision", async () => {
				return await dbService.db.query.travelExpenseClaim.findFirst({
					where: and(
						eq(travelExpenseClaim.id, claimId),
						eq(travelExpenseClaim.organizationId, currentEmployee.organizationId),
					),
				});
			}),
		);

		if (!claim) {
			return yield* _(
				Effect.fail(
					new NotFoundError({
						message: "Travel expense claim not found",
						entityType: "travel_expense_claim",
						entityId: claimId,
					}),
				),
			);
		}

		const hasDirectAuthorization =
			claim.approverId === currentEmployee.id ||
			currentEmployee.role === "admin" ||
			!!options?.allowAnyApprover;
		const hasAssignedApproval = hasDirectAuthorization
			? false
			: yield* _(hasAssignedPendingTravelExpenseApproval(dbService, claimId, currentEmployee));

		if (!hasDirectAuthorization && !hasAssignedApproval) {
			return yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Unauthorized",
						userId: currentEmployee.id,
						resource: "travel_expense_claim",
						action,
					}),
				),
			);
		}

		if (claim.status !== "submitted") {
			return yield* _(
				Effect.fail(
					new ConflictError({
						message: "Only submitted claims can be decided",
						conflictType: "travel_expense_claim_status",
					}),
				),
			);
		}

		// A frozen submission is always enforced: a changed receipt set, amount
		// or date needs a new claim, not a decision on different facts.
		const comparison = yield* _(
			dbService.query("compareTravelExpenseSubmittedRevision", async () => {
				const revision = await loadLegacyTravelExpenseSubmittedRevision(dbService.db, {
					organizationId: currentEmployee.organizationId,
					claimId,
				});
				return revision
					? await compareTravelExpenseWithSubmittedRevision(dbService.db, revision)
					: null;
			}),
		);
		if (comparison?.kind === "material_change") {
			return yield* _(
				Effect.fail(
					new ConflictError({
						message:
							"This claim changed after it was submitted. It cannot be decided; the employee must submit a new claim.",
						conflictType: "approval_evidence",
						details: { code: "material_change", changedFields: comparison.changedFields },
					}),
				),
			);
		}

		return claim;
	});
}

function loadTravelExpenseNotificationContext(
	dbService: ApprovalDbService,
	claimId: string,
	organizationId: string,
): Effect.Effect<TravelExpenseNotificationContext, AnyAppError, never> {
	return dbService
		.query("getTravelExpenseNotificationContext", async () => {
			return await dbService.db.query.travelExpenseClaim.findFirst({
				where: and(
					eq(travelExpenseClaim.id, claimId),
					eq(travelExpenseClaim.organizationId, organizationId),
				),
				with: {
					employee: true,
				},
			});
		})
		.pipe(
			Effect.flatMap((claim) =>
				claim
					? Effect.succeed(claim as unknown as TravelExpenseNotificationContext)
					: Effect.fail(
							new NotFoundError({
								message: "Travel expense claim not found",
								entityType: "travel_expense_claim",
								entityId: claimId,
							}),
						),
			),
		);
}

function notifyTravelExpenseRequester(
	claim: TravelExpenseNotificationContext,
	currentEmployee: CurrentApprover,
	action: "approve" | "reject",
	reason?: string,
) {
	const payload = {
		claimId: claim.id,
		requesterUserId: claim.employee.userId,
		organizationId: claim.organizationId,
		approverName: currentEmployee.user.name,
		destinationCity: claim.destinationCity,
		amount: claim.calculatedAmount,
		currency: claim.calculatedCurrency,
	};

	if (action === "approve") {
		try {
			void Promise.resolve(onTravelExpenseApproved(payload)).catch(() => undefined);
		} catch {
			// Notification triggers are best-effort after durable decision persistence.
		}
		return;
	}

	try {
		void Promise.resolve(
			onTravelExpenseRejected({
				...payload,
				rejectionReason: reason,
			}),
		).catch(() => undefined);
	} catch {
		// Notification triggers are best-effort after durable decision persistence.
	}
}

export function notifyTravelExpenseRequesterAfterDecision(
	dbService: ApprovalDbService,
	claimId: string,
	currentEmployee: CurrentApprover,
	action: "approve" | "reject",
	reason?: string,
): Effect.Effect<void, never, never> {
	return loadTravelExpenseNotificationContext(
		dbService,
		claimId,
		currentEmployee.organizationId,
	).pipe(
		Effect.flatMap((claim) =>
			claim.status === (action === "approve" ? "approved" : "rejected")
				? Effect.sync(() => notifyTravelExpenseRequester(claim, currentEmployee, action, reason))
				: Effect.void,
		),
		Effect.catchAllCause(() => Effect.void),
	);
}

export function notifyTravelExpenseRequesterAfterDecisionForApprover(
	dbService: ApprovalDbService,
	claimId: string,
	approverId: string,
	action: "approve" | "reject",
	reason?: string,
): Effect.Effect<void, never, never> {
	return loadTravelExpenseApprover(dbService, approverId).pipe(
		Effect.flatMap((currentEmployee) =>
			notifyTravelExpenseRequesterAfterDecision(
				dbService,
				claimId,
				currentEmployee,
				action,
				reason,
			),
		),
		Effect.catchAllCause(() => Effect.void),
	);
}

export function persistTravelExpenseDecision(
	dbService: ApprovalDbService,
	claimId: string,
	currentEmployee: CurrentApprover,
	action: "approve" | "reject",
	commentOrReason?: string,
) {
	return Effect.gen(function* (_) {
		const decidedAt = new Date();
		yield* _(
			dbService
				.query("updateTravelExpenseDecision", async () => {
					const updateQuery = dbService.db
						.update(travelExpenseClaim)
						.set({
							status: action === "approve" ? "approved" : "rejected",
							decidedAt,
							updatedBy: currentEmployee.user.id,
							updatedAt: decidedAt,
						})
						.where(
							and(
								eq(travelExpenseClaim.id, claimId),
								eq(travelExpenseClaim.organizationId, currentEmployee.organizationId),
								eq(travelExpenseClaim.status, "submitted"),
							),
						);

					const updatedRows =
						updateQuery && typeof updateQuery === "object" && "returning" in updateQuery
							? await updateQuery.returning({ id: travelExpenseClaim.id })
							: await updateQuery;

					return updatedRows;
				})
				.pipe(
					Effect.flatMap((updatedRows) =>
						Array.isArray(updatedRows) && updatedRows.length === 0
							? Effect.fail(
									new ConflictError({
										message: "Only submitted claims can be decided",
										conflictType: "travel_expense_claim_status",
									}),
								)
							: Effect.succeed(updatedRows),
					),
				),
		);

		yield* _(
			dbService.query("insertTravelExpenseDecisionLog", async () => {
				await dbService.db.insert(travelExpenseDecisionLog).values({
					organizationId: currentEmployee.organizationId,
					claimId,
					actorEmployeeId: currentEmployee.id,
					approverId: currentEmployee.id,
					action: action === "approve" ? "approved" : "rejected",
					reason: action === "reject" ? (commentOrReason ?? null) : null,
					comment: action === "approve" ? (commentOrReason ?? null) : null,
					createdAt: decidedAt,
				});
			}),
		);
	});
}

// ---------------------------------------------------------------------------
// Decision owner (#296). Every expense decision (inbox, expense page and bound
// cards) runs the unchanged legacy mutation inside one transaction that also
// holds the rollout gate, replays committed operations first, enforces the
// frozen submission, and records the decision evidence, the provider
// invocation and the delivery intent atomically with it.
// ---------------------------------------------------------------------------

/** A bound card action: the reviewed binding and its provider invocation. */
export interface TravelExpenseBoundInvocation {
	bindingId: string;
	identity: ApprovalInvocationIdentity;
	/** Transport delivery identity (e.g. Telegram update_id); not identity. */
	deliveryId: string | null;
	providerActorId: string;
}

export interface TravelExpenseDecisionInput {
	organizationId: string;
	claimId: string;
	actor: CurrentApprover;
	action: ApprovalAction;
	/** Rejection reason; it enters evidence only as a fingerprint. */
	reason?: string;
	/** Approval comment stored with the legacy decision log. */
	note?: string;
	options?: Pick<
		ApprovalActionOptions,
		| "approvalRequestId"
		| "allowAnyApprover"
		| "allowOrganizationWideApprover"
		| "reviewedBindingId"
	>;
	/** Present only for a bound card action; its authority is the binding alone. */
	bound?: TravelExpenseBoundInvocation;
}

export type TravelExpenseDecisionOutcome =
	| {
			kind: "replayed";
			/** The committed operation's original evidence; nothing new happened. */
			evidence: LegacyDecisionEvidenceRecord;
			approvalRequestId: string;
	  }
	| {
			kind: "decided";
			/** Null while capture is inactive and the claim has no frozen submission. */
			evidence: LegacyDecisionEvidenceRecord | null;
			approvalRequestId: string | null;
			deliveryIntent: boolean;
	  };

async function findPendingTravelExpenseRequestForApprover(
	database: ApprovalDatabase,
	input: { organizationId: string; claimId: string; approverId: string },
): Promise<string | undefined> {
	const rows = await database
		.select({ id: approvalRequest.id })
		.from(approvalRequest)
		.where(
			and(
				eq(approvalRequest.organizationId, input.organizationId),
				eq(approvalRequest.entityType, "travel_expense_claim"),
				eq(approvalRequest.entityId, input.claimId),
				eq(approvalRequest.approverId, input.approverId),
				eq(approvalRequest.status, "pending"),
			),
		)
		.limit(1);
	return rows[0]?.id;
}

function failureOf(cause: Cause.Cause<unknown>): unknown {
	return (
		Option.getOrNull(Cause.failureOption(cause)) ??
		[...Cause.defects(cause)][0] ??
		new Error("An error has occurred")
	);
}

/**
 * Runs one expense decision in the caller's transaction. Order: rollout gate,
 * invocation lock and replay, presentation admission (bound only), exact target
 * request, semantic replay (authenticated only), fresh evidence checks, the
 * unchanged legacy mutation, then decision evidence, invocation association and
 * delivery intent. Any failure throws and rolls everything back.
 */
export async function executeTravelExpenseDecisionInTransaction(
	database: ApprovalDatabase,
	query: ApprovalDbService["query"],
	input: TravelExpenseDecisionInput,
): Promise<TravelExpenseDecisionOutcome> {
	const dbService: ApprovalDbService = { db: database, query };
	const { organizationId, claimId, actor, action } = input;
	if (actor.organizationId !== organizationId) {
		throw new ApprovalEvidenceError("invariant", { field: "organization" });
	}
	if (input.options?.reviewedBindingId !== undefined && !input.bound) {
		// A binding is validated only together with its invocation; never ignored.
		throw new ApprovalEvidenceError("binding_mismatch");
	}
	// Shared rollout lock first, so evidence and admission reads are stable.
	await acquireApprovalWriteLock(dbService, {
		organizationId,
		workflowType: "travel_expense",
	});
	const actorIdentity = { employeeId: actor.id, userId: actor.userId };

	let invocation: { key: string; command: ApprovalInvocationCommand } | null = null;
	if (input.bound) {
		const { identity } = input.bound;
		if (identity.organizationId !== organizationId) {
			throw new ApprovalEvidenceError("invariant", { field: "invocation" });
		}
		const command: ApprovalInvocationCommand = {
			actorEmployeeId: actor.id,
			actorUserId: actor.userId,
			providerActorId: input.bound.providerActorId,
			reviewedBindingId: input.bound.bindingId,
			action,
			reason: input.reason ?? null,
		};
		// Receipt before fresh checks: an exact committed invocation returns its
		// original evidence even if the claim, assignment or admission moved.
		await lockApprovalInvocation(database, identity);
		const committed = await findCommittedInvocationDecision(database, {
			identity,
			command,
		});
		if (committed) {
			const evidence = requireLegacyInvocationDecision(committed);
			return {
				kind: "replayed",
				evidence,
				approvalRequestId: evidence.legacy.approvalRequestId,
			};
		}
		// A fresh invocation needs current admission, read under the rollout gate:
		// pausing a provider stops cards that were already sent.
		const presentationMode = await readApprovalPresentationMode(database, {
			organizationId,
			workflowType: "travel_expense",
			provider: approvalInvocationProvider(identity.scheme),
		});
		if (presentationMode !== "actionable") {
			throw new ApprovalInvocationNotAdmittedError();
		}
		// Expense claims have legacy authority only; a card never decides under
		// another (#384 cutover rule).
		if (!(await hasLegacyTravelExpenseAuthority(database, organizationId))) {
			throw new ApprovalEvidenceError("binding_mismatch", { field: "authority" });
		}
		invocation = { key: approvalInvocationIdempotencyKey(identity), command };
	}

	const binding = input.bound
		? await loadLegacyReviewBinding(database, {
				organizationId,
				bindingId: input.bound.bindingId,
			})
		: null;
	if (input.bound && (!binding || binding.recipientEmployeeId !== actor.id)) {
		throw new ApprovalEvidenceError("binding_mismatch");
	}
	// The exact legacy request decided: the bound one, the caller's, or the
	// actor's own pending request (the shared owner rechecks it).
	const approvalRequestId =
		binding?.legacyApprovalRequestId ??
		input.options?.approvalRequestId ??
		(await findPendingTravelExpenseRequestForApprover(database, {
			organizationId,
			claimId,
			approverId: actor.id,
		}));

	if (!input.bound && input.options?.approvalRequestId) {
		// Receipt before fresh checks for an exact authenticated retry.
		const replayed = await findLegacyTravelExpenseDecisionReplay(database, {
			organizationId,
			claimId,
			approvalRequestId: input.options.approvalRequestId,
			action,
			reason: input.reason,
			actor: actorIdentity,
		});
		if (replayed) {
			return {
				kind: "replayed",
				evidence: replayed,
				approvalRequestId: input.options.approvalRequestId,
			};
		}
	}

	const revision = await prepareLegacyTravelExpenseDecisionEvidence(database, {
		organizationId,
		claimId,
	});
	if (binding && (!revision || binding.submittedRevisionId !== revision.id)) {
		// The card showed another (or no) frozen submission of this claim.
		throw new ApprovalEvidenceError("binding_mismatch", { field: "revision" });
	}

	// The unchanged legacy owner. A card carries no management or
	// eligible-manager authority: only the exact bound request's approver.
	const { reviewedBindingId: _validatedAbove, ...callerOptions } = input.options ?? {};
	const options: ApprovalActionOptions = {
		...(input.bound ? {} : callerOptions),
		...(approvalRequestId ? { approvalRequestId } : {}),
		transactional: true,
	};
	const exit = await Effect.runPromiseExit(
		processApprovalWithCurrentEmployee(
			dbService,
			actor,
			"travel_expense_claim",
			claimId,
			action,
			input.reason,
			(decisionDbService, decisionEntityId, approver) =>
				persistTravelExpenseDecision(
					decisionDbService,
					decisionEntityId,
					approver,
					action,
					action === "reject" ? input.reason : input.note,
				),
			(decisionDbService, decisionEntityId, approver, actionOptions) =>
				preflightTravelExpenseDecision(
					decisionDbService,
					decisionEntityId,
					approver,
					action,
					actionOptions,
				),
			options,
			undefined,
			"existing",
		).pipe(
			Effect.provideService(ApprovalAuditLogger, createApprovalAuditLogger(dbService)),
		) as Effect.Effect<unknown, AnyAppError, never>,
	);
	if (Exit.isFailure(exit)) throw failureOf(exit.cause);

	let evidence: LegacyDecisionEvidenceRecord | null = null;
	if (revision) {
		if (!approvalRequestId) {
			throw new ApprovalEvidenceError("evidence_incomplete", {
				field: "legacy_request",
			});
		}
		evidence = await recordLegacyTravelExpenseDecisionEvidence(database, revision, {
			organizationId,
			claimId,
			action,
			reason: input.reason,
			approvalRequestId,
			idempotencyKey:
				invocation?.key ??
				travelExpenseDecisionIdempotencyKey({
					claimId,
					approvalRequestId,
					action,
					reason: input.reason,
				}),
			actor: actorIdentity,
			reviewedBindingId: binding?.id ?? null,
		});
	}
	if (invocation && input.bound) {
		if (!evidence || !approvalRequestId) {
			throw new ApprovalEvidenceError("invariant", {
				field: "invocation_decision",
			});
		}
		// Same transaction as the legacy mutation and its evidence.
		await recordApprovalInvocation(database, {
			identity: input.bound.identity,
			deliveryId: input.bound.deliveryId,
			command: invocation.command,
			legacyApprovalRequestId: approvalRequestId,
			receiptIdempotencyKey: invocation.key,
			decisionEvidenceId: evidence.id,
		});
	}
	const deliveryIntent = approvalRequestId
		? await recordLegacyDeliveryIntent(database, {
				organizationId,
				workflowType: "travel_expense",
				sourceType: "travel_expense_claim",
				sourceId: claimId,
				approvalRequestId,
				event: "decided",
			})
		: false;
	return { kind: "decided", evidence, approvalRequestId: approvalRequestId ?? null, deliveryIntent };
}

const EVIDENCE_CONFLICT_MESSAGES: Record<string, string> = {
	material_change:
		"This claim changed after it was submitted. It cannot be decided; the employee must submit a new claim.",
	evidence_required:
		"This claim was submitted before its facts were recorded, so a decision cannot be bound to them. It is held for review.",
	evidence_incomplete:
		"This decision could not be recorded against the submitted claim. It is held for review.",
	binding_mismatch: "The reviewed claim no longer matches this decision. Review the claim again.",
	invocation_mismatch: "This action was already recorded with a different decision.",
};

/** Evidence holds surface as 409 conflicts; integrity contradictions stay errors. */
export function translateTravelExpenseDecisionError(error: unknown): unknown {
	if (!(error instanceof ApprovalEvidenceError) || error.code === "invariant") {
		return error;
	}
	return new ConflictError({
		message: EVIDENCE_CONFLICT_MESSAGES[error.code] ?? "Approval evidence conflict",
		conflictType: "approval_evidence",
		details: {
			code: error.code,
			...(error.details.fields ? { changedFields: error.details.fields.split(",") } : {}),
		},
	});
}

async function afterTravelExpenseDecision(
	dbService: ApprovalDbService,
	input: Pick<TravelExpenseDecisionInput, "organizationId" | "claimId" | "actor" | "action" | "reason">,
	outcome: TravelExpenseDecisionOutcome,
): Promise<void> {
	// A replay repeats no effect: no notification and no new delivery.
	if (outcome.kind !== "decided") return;
	await Effect.runPromise(
		notifyTravelExpenseRequesterAfterDecision(
			dbService,
			input.claimId,
			input.actor,
			input.action,
			input.reason,
		),
	);
	if (outcome.deliveryIntent) {
		kickApprovalDelivery({ organizationId: input.organizationId });
	}
}

/**
 * Authenticated expense decision (inbox and expense page). Opens its own
 * transaction; after commit the requester is notified and delivery kicked.
 */
export function decideTravelExpenseClaimEffect(
	dbService: ApprovalDbService,
	currentEmployee: CurrentApprover,
	input: Omit<TravelExpenseDecisionInput, "organizationId" | "actor" | "bound">,
): Effect.Effect<TravelExpenseDecisionOutcome, AnyAppError, never> {
	const decision: TravelExpenseDecisionInput = {
		...input,
		organizationId: currentEmployee.organizationId,
		actor: currentEmployee,
	};
	return Effect.tryPromise({
		try: async () => {
			const outcome = await dbService.db.transaction((transaction) =>
				executeTravelExpenseDecisionInTransaction(transaction, dbService.query, decision),
			);
			await afterTravelExpenseDecision(dbService, decision, outcome).catch((error) =>
				logger.error({ error, claimId: input.claimId }, "Expense decision follow-up failed"),
			);
			return outcome;
		},
		catch: (error) => translateTravelExpenseDecisionError(error) as AnyAppError,
	});
}

export type BoundTravelExpenseInvocationResult =
	| {
			status: "decided";
			/** True when this invocation had already committed (exact replay). */
			replayed: boolean;
			evidence: LegacyDecisionEvidenceRecord;
	  }
	| {
			status: "review_required";
			reason: "binding" | "stale" | "material_change" | "evidence" | "not_admitted";
	  }
	| { status: "conflict" }
	| { status: "not_found" };

function classifyBoundTravelExpenseError(error: unknown): BoundTravelExpenseInvocationResult {
	if (error instanceof ApprovalInvocationNotAdmittedError) {
		return { status: "review_required", reason: "not_admitted" };
	}
	if (error instanceof ApprovalEvidenceError) {
		switch (error.code) {
			case "invocation_mismatch":
				return { status: "conflict" };
			case "binding_mismatch":
				return { status: "review_required", reason: "binding" };
			case "material_change":
				return { status: "review_required", reason: "material_change" };
			case "evidence_required":
			case "evidence_incomplete":
				return { status: "review_required", reason: "evidence" };
			case "invariant":
				throw error;
		}
	}
	// The legacy owner's own refusals: no longer the approver, decided, missing.
	if (error instanceof AuthorizationError || error instanceof NotFoundError) {
		return { status: "review_required", reason: "stale" };
	}
	if (error instanceof ConflictError) {
		return error.conflictType === "approval_evidence"
			? { status: "review_required", reason: "material_change" }
			: { status: "review_required", reason: "stale" };
	}
	throw error;
}

/**
 * A reviewed-binding expense decision from an authenticated bot invocation
 * (#296). The actor comes from verified provider linkage. An exact committed
 * invocation replays first, before any current state is read. Otherwise the
 * authority is the exact bound legacy request only; neither eligible-manager
 * fallback nor organization management is reachable from a card, so a stale
 * card needs authenticated review. Infrastructure errors propagate.
 */
export async function decideBoundTravelExpenseInvocation(input: {
	database: ApprovalDatabase;
	organizationId: string;
	actorEmployeeId: string;
	actorUserId: string;
	bindingId: string;
	action: ApprovalAction;
	reason?: string;
	invocation: Omit<TravelExpenseBoundInvocation, "bindingId">;
}): Promise<BoundTravelExpenseInvocationResult> {
	const { database } = input;
	try {
		const committed = await findCommittedInvocationDecision(database, {
			identity: input.invocation.identity,
			command: {
				actorEmployeeId: input.actorEmployeeId,
				actorUserId: input.actorUserId,
				providerActorId: input.invocation.providerActorId,
				reviewedBindingId: input.bindingId,
				action: input.action,
				reason: input.reason ?? null,
			},
		});
		if (committed) {
			return {
				status: "decided",
				replayed: true,
				evidence: requireLegacyInvocationDecision(committed),
			};
		}
	} catch (error) {
		return classifyBoundTravelExpenseError(error);
	}
	const [memberships, binding, actors] = await Promise.all([
		database
			.select({ id: member.id })
			.from(member)
			.where(
				and(
					eq(member.organizationId, input.organizationId),
					eq(member.userId, input.actorUserId),
					eq(member.status, "approved"),
				),
			)
			.limit(1),
		loadLegacyReviewBinding(database, {
			organizationId: input.organizationId,
			bindingId: input.bindingId,
		}),
		database.query.employee.findMany({
			where: and(
				eq(employee.id, input.actorEmployeeId),
				eq(employee.organizationId, input.organizationId),
				eq(employee.isActive, true),
			),
			with: { user: true },
			limit: 2,
		}),
	]);
	const actor = actors[0];
	if (
		memberships.length !== 1 ||
		!binding ||
		binding.recipientEmployeeId !== input.actorEmployeeId ||
		actors.length !== 1 ||
		!actor ||
		actor.userId !== input.actorUserId
	) {
		return { status: "not_found" };
	}
	const [request] = await database
		.select({ claimId: approvalRequest.entityId })
		.from(approvalRequest)
		.where(
			and(
				eq(approvalRequest.id, binding.legacyApprovalRequestId),
				eq(approvalRequest.organizationId, input.organizationId),
				eq(approvalRequest.entityType, "travel_expense_claim"),
			),
		)
		.limit(1);
	if (!request) return { status: "not_found" };
	const query: ApprovalDbService["query"] = <T>(_name: string, operation: () => Promise<T>) =>
		Effect.promise(operation);
	const decision: TravelExpenseDecisionInput = {
		organizationId: input.organizationId,
		claimId: request.claimId,
		actor: actor as CurrentApprover,
		action: input.action,
		...(input.reason === undefined ? {} : { reason: input.reason }),
		bound: { ...input.invocation, bindingId: binding.id },
	};
	let outcome: TravelExpenseDecisionOutcome;
	try {
		outcome = await database.transaction((transaction) =>
			executeTravelExpenseDecisionInTransaction(transaction, query, decision),
		);
	} catch (error) {
		return classifyBoundTravelExpenseError(error);
	}
	await afterTravelExpenseDecision({ db: database, query }, decision, outcome).catch((error) =>
		logger.error({ error, claimId: request.claimId }, "Expense decision follow-up failed"),
	);
	if (!outcome.evidence) {
		throw new ApprovalEvidenceError("invariant", { field: "invocation_decision" });
	}
	return {
		status: "decided",
		replayed: outcome.kind === "replayed",
		evidence: outcome.evidence,
	};
}
