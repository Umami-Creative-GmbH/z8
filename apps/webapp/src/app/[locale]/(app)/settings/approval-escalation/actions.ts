"use server";

import { Effect } from "effect";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { recoverApprovalDeliveryForAttention } from "@/lib/approvals/delivery/recovery";
import {
	dispatchEscalationAttentionAlerts,
	disposeEscalationAttention,
	ESCALATION_MANAGEMENT_PATH,
	MAX_ATTENTION_DISPOSITION_NOTE_LENGTH,
	recheckEscalationAttention,
} from "@/lib/approvals/escalation/attention-store";
import { getEscalationManagementOverview } from "@/lib/approvals/escalation/management-overview";
import { MAX_ESCALATION_RESPONSE_WINDOW_HOURS } from "@/lib/approvals/escalation/policy";
import {
	MAX_ESCALATION_POLICY_REASON_LENGTH,
	markEscalationPolicyConflictsReviewed,
	updateEscalationPolicy,
} from "@/lib/approvals/escalation/policy-store";
import {
	escalateAssignmentByManager,
	escalateLegacyApprovalByManager,
	type HumanEscalationActor,
	type HumanEscalationOutcome,
	listHumanEscalationCandidates,
	listLegacyHumanEscalationCandidates,
	MAX_ESCALATION_REASON_LENGTH,
} from "@/lib/approvals/escalation/transfer";
import {
	AuthorizationError,
	ConflictError,
	DatabaseError,
	NotFoundError,
	ValidationError,
} from "@/lib/effect/errors";
import { DatabaseService } from "@/lib/effect/services/database.service";
import { createLogger } from "@/lib/logger";
import {
	noInput,
	type OrganizationActor,
	organizationAction,
} from "@/lib/organization-action/organization-action";
import { approvalManagementRefusal } from "./approval-management";

const logger = createLogger("ApprovalEscalationSettingsActions");

/**
 * Promise work with a message safe to show users when it fails; the cause is
 * logged with the organization.
 */
function attempt<T>(
	organizationId: string,
	logMessage: string,
	userMessage: string,
	run: () => Promise<T>,
) {
	return Effect.gen(function* () {
		const dbService = yield* DatabaseService;
		return yield* dbService.query("approvalEscalation", run).pipe(
			Effect.mapError((error) => {
				logger.error({ error: error.cause, organizationId }, logMessage);
				return new DatabaseError({
					message: userMessage,
					operation: "approvalEscalation",
					cause: error.cause,
				});
			}),
		);
	});
}

const notPrepared = () =>
	new ConflictError({
		message: "The escalation policy has not been prepared yet.",
		conflictType: "escalation_policy_not_prepared",
	});

const attentionNotFound = () =>
	new NotFoundError({ message: "Attention item not found.", entityType: "escalation_attention" });

export const getApprovalEscalationOverview = organizationAction(
	{ name: "approvalEscalation.overview", requires: "member", schema: noInput },
	({ actor, organizationId }) =>
		Effect.gen(function* () {
			yield* approvalManagementRefusal(actor, organizationId);
			return yield* attempt(
				organizationId,
				"Failed to load escalation overview",
				"Escalation settings could not be loaded.",
				() => getEscalationManagementOverview(organizationId),
			);
		}),
);

const updatePolicySchema = z.object({
	expectedRevision: z.number().int().min(1),
	enabled: z.boolean(),
	responseWindowHours: z
		.number()
		.int("Response window must be a whole number of hours.")
		.min(1, "Response window must be at least 1 hour.")
		.max(
			MAX_ESCALATION_RESPONSE_WINDOW_HOURS,
			`Response window must be at most ${MAX_ESCALATION_RESPONSE_WINDOW_HOURS} hours.`,
		),
	reason: z.string().trim().max(MAX_ESCALATION_POLICY_REASON_LENGTH).optional(),
});

export const updateApprovalEscalationPolicy = organizationAction(
	{ name: "approvalEscalation.updatePolicy", requires: "member", schema: updatePolicySchema },
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			yield* approvalManagementRefusal(actor, organizationId);
			const outcome = yield* attempt(
				organizationId,
				"Failed to update the escalation policy",
				"The escalation policy could not be saved.",
				() => updateEscalationPolicy({ organizationId, actorUserId: actor.userId, ...input }),
			);
			switch (outcome.kind) {
				case "updated":
					revalidatePath(ESCALATION_MANAGEMENT_PATH);
					return { revision: outcome.revision, changed: true };
				case "unchanged":
					return { revision: outcome.revision, changed: false };
				case "stale":
					return yield* Effect.fail(
						new ConflictError({
							message: "The policy was changed by someone else. Reload to see the current policy.",
							conflictType: "stale_escalation_policy",
						}),
					);
				case "invalid":
					return yield* Effect.fail(new ValidationError({ message: "Invalid policy." }));
				case "not_prepared":
					return yield* Effect.fail(notPrepared());
			}
		}),
);

export const reviewApprovalEscalationPolicyConflicts = organizationAction(
	{ name: "approvalEscalation.reviewPolicyConflicts", requires: "member", schema: noInput },
	({ actor, organizationId }) =>
		Effect.gen(function* () {
			yield* approvalManagementRefusal(actor, organizationId);
			const outcome = yield* attempt(
				organizationId,
				"Failed to mark escalation policy conflicts reviewed",
				"The policy conflicts could not be marked as reviewed.",
				() => markEscalationPolicyConflictsReviewed({ organizationId, actorUserId: actor.userId }),
			);
			if (outcome.kind === "not_prepared") {
				return yield* Effect.fail(notPrepared());
			}
			revalidatePath(ESCALATION_MANAGEMENT_PATH);
		}),
);

const disposeSchema = z.object({
	attentionId: z.string().uuid(),
	note: z
		.string()
		.trim()
		.min(1, "A disposition note is required.")
		.max(MAX_ATTENTION_DISPOSITION_NOTE_LENGTH),
});

export const disposeApprovalEscalationAttention = organizationAction(
	{ name: "approvalEscalation.disposeAttention", requires: "member", schema: disposeSchema },
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			yield* approvalManagementRefusal(actor, organizationId);
			const outcome = yield* attempt(
				organizationId,
				"Failed to dispose escalation attention",
				"The attention item could not be closed.",
				() => disposeEscalationAttention({ organizationId, actorUserId: actor.userId, ...input }),
			);
			switch (outcome.kind) {
				case "disposed":
					revalidatePath(ESCALATION_MANAGEMENT_PATH);
					return;
				case "not_open":
					return yield* Effect.fail(
						new ConflictError({
							message: "This item was already closed.",
							conflictType: "attention_not_open",
						}),
					);
				case "not_found":
					return yield* Effect.fail(attentionNotFound());
				case "invalid_note":
					return yield* Effect.fail(
						new ValidationError({ message: "A disposition note is required.", field: "note" }),
					);
			}
		}),
);

const retryDeliverySchema = z.object(
	{
		attentionId: z.string({ error: "Attention item not found." }).uuid("Attention item not found."),
	},
	"Attention item not found.",
);

/**
 * Explicit recovery of an exhausted or repair-waiting approval delivery. It
 * re-arms only undelivered work; the item closes once delivery succeeds.
 */
export const retryApprovalEscalationDelivery = organizationAction(
	{ name: "approvalEscalation.retryDelivery", requires: "member", schema: retryDeliverySchema },
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			yield* approvalManagementRefusal(actor, organizationId);
			const outcome = yield* attempt(
				organizationId,
				"Approval delivery recovery failed",
				"The delivery could not be retried.",
				() =>
					recoverApprovalDeliveryForAttention({
						organizationId,
						actorUserId: actor.userId,
						attentionId: input.attentionId,
					}),
			);
			switch (outcome.kind) {
				case "rearmed":
					revalidatePath(ESCALATION_MANAGEMENT_PATH);
					return;
				case "not_recoverable":
					return yield* Effect.fail(
						new ConflictError({
							message:
								"This delivery is not waiting for recovery. Recheck to see its current state.",
							conflictType: "delivery_not_recoverable",
						}),
					);
				case "not_found":
					return yield* Effect.fail(attentionNotFound());
			}
		}),
);

/**
 * The management actor as an employee on the current roster. Explicit
 * `manage Approval` is checked first; the employee record only attributes
 * the transfer.
 */
function escalationManagementActor(actor: OrganizationActor, organizationId: string) {
	return Effect.gen(function* () {
		yield* approvalManagementRefusal(actor, organizationId);
		if (!actor.employee) {
			return yield* Effect.fail(
				new AuthorizationError({
					message: "You do not have permission to manage approval escalation.",
					userId: actor.userId,
					resource: "approval_escalation",
					action: "transfer",
				}),
			);
		}
		return {
			organizationId,
			userId: actor.userId,
			employeeId: actor.employee.id,
			canManageApprovals: true,
		} satisfies HumanEscalationActor;
	});
}

function humanEscalationRefusal(
	outcome: Exclude<HumanEscalationOutcome, { kind: "transferred" }>,
): AuthorizationError | ConflictError | NotFoundError | ValidationError {
	switch (outcome.kind) {
		case "forbidden":
			return new AuthorizationError({
				message: "You do not have permission to manage approval escalation.",
				resource: "approval_escalation",
				action: "transfer",
			});
		case "not_owner":
			return new ConflictError({
				message: "Channel automation still owns escalation for this organization.",
				conflictType: outcome.kind,
			});
		case "not_found":
			return new NotFoundError({
				message: "Approval assignment not found.",
				entityType: "approval_assignment",
			});
		case "not_pending":
			return new ConflictError({
				message: "This assignment is no longer pending. Reload to see its current state.",
				conflictType: outcome.kind,
			});
		case "unsupported":
			return new ValidationError({
				message:
					"This approval cannot be transferred here yet: its replacement would have no working inbox path.",
			});
		case "recipient_not_eligible":
			return new ValidationError({
				message: "The selected manager is not an eligible backup for this request.",
				field: "recipientEmployeeId",
			});
		case "no_eligible_backup":
			return new ValidationError({
				message: "No eligible backup manager is available for this request.",
			});
		case "idempotency_mismatch":
			return new ConflictError({
				message:
					"This transfer was already submitted with different details. Reload and try again.",
				conflictType: outcome.kind,
			});
		case "conflict":
			return new ConflictError({
				message: "The approval changed while transferring. Reload to see its current state.",
				conflictType: outcome.kind,
			});
	}
}

/**
 * What a human transfer moves: a canonical workflow assignment, or a
 * legacy-authoritative approval request (#299).
 */
const targetSchema = z.union(
	[z.strictObject({ assignmentId: z.uuid() }), z.strictObject({ approvalRequestId: z.uuid() })],
	"Invalid approval assignment.",
);

export const listApprovalEscalationCandidates = organizationAction(
	{ name: "approvalEscalation.listCandidates", requires: "member", schema: targetSchema },
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const escalationActor = yield* escalationManagementActor(actor, organizationId);
			const outcome = yield* attempt(
				organizationId,
				"Failed to load escalation candidates",
				"Eligible managers could not be loaded.",
				() =>
					"assignmentId" in input
						? listHumanEscalationCandidates({
								actor: escalationActor,
								assignmentId: input.assignmentId,
							})
						: listLegacyHumanEscalationCandidates({
								actor: escalationActor,
								approvalRequestId: input.approvalRequestId,
							}),
			);
			if (outcome.kind !== "ok") {
				return yield* Effect.fail(humanEscalationRefusal(outcome));
			}
			return outcome;
		}),
);

const transferDetailsSchema = z.object({
	recipientEmployeeId: z.string().uuid(),
	idempotencyKey: z.string().uuid(),
	reason: z.string().trim().max(MAX_ESCALATION_REASON_LENGTH).optional(),
});
const transferSchema = z.union([
	transferDetailsSchema.extend({ assignmentId: z.string().uuid() }).strict(),
	transferDetailsSchema.extend({ approvalRequestId: z.string().uuid() }).strict(),
]);

export const transferApprovalEscalationAssignment = organizationAction(
	{
		name: "approvalEscalation.transfer",
		requires: "member",
		schema: transferSchema,
		addsEmployees: (input) => [input.recipientEmployeeId],
	},
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const escalationActor = yield* escalationManagementActor(actor, organizationId);
			const details = {
				actor: escalationActor,
				idempotencyKey: input.idempotencyKey,
				recipientEmployeeId: input.recipientEmployeeId,
				reason: input.reason,
			};
			const outcome = yield* attempt(
				organizationId,
				"Approval escalation transfer failed",
				"The approval could not be transferred.",
				() =>
					"assignmentId" in input
						? escalateAssignmentByManager({ ...details, assignmentId: input.assignmentId })
						: escalateLegacyApprovalByManager({
								...details,
								approvalRequestId: input.approvalRequestId,
							}),
			);
			if (outcome.kind !== "transferred") {
				return yield* Effect.fail(humanEscalationRefusal(outcome));
			}
			revalidatePath(ESCALATION_MANAGEMENT_PATH);
			return { replayed: outcome.disposition === "replayed" };
		}),
);

export const recheckApprovalEscalationAttention = organizationAction(
	{ name: "approvalEscalation.recheckAttention", requires: "member", schema: noInput },
	({ actor, organizationId }) =>
		Effect.gen(function* () {
			yield* approvalManagementRefusal(actor, organizationId);
			const { recheck, alerts } = yield* attempt(
				organizationId,
				"Escalation attention recheck failed",
				"Attention items could not be rechecked.",
				async () => {
					const recheck = await recheckEscalationAttention({ organizationId });
					const alerts = await dispatchEscalationAttentionAlerts({ organizationId });
					return { recheck, alerts };
				},
			);
			revalidatePath(ESCALATION_MANAGEMENT_PATH);
			return { checked: recheck.checked, resolved: recheck.resolved, alerted: alerts.alerted };
		}),
);
