"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { employee } from "@/db/schema";
import {
	dispatchEscalationAttentionAlerts,
	disposeEscalationAttention,
	ESCALATION_MANAGEMENT_PATH,
	MAX_ATTENTION_DISPOSITION_NOTE_LENGTH,
	recheckEscalationAttention,
} from "@/lib/approvals/escalation/attention-store";
import {
	type EscalationManagementOverview,
	getEscalationManagementOverview,
} from "@/lib/approvals/escalation/management-overview";
import { MAX_ESCALATION_RESPONSE_WINDOW_HOURS } from "@/lib/approvals/escalation/policy";
import {
	MAX_ESCALATION_POLICY_REASON_LENGTH,
	markEscalationPolicyConflictsReviewed,
	updateEscalationPolicy,
} from "@/lib/approvals/escalation/policy-store";
import {
	type EscalationCandidateListOutcome,
	escalateAssignmentByManager,
	type HumanEscalationActor,
	type HumanEscalationOutcome,
	listHumanEscalationCandidates,
	MAX_ESCALATION_REASON_LENGTH,
} from "@/lib/approvals/escalation/transfer";
import { getAbility, getAuthContext } from "@/lib/auth-helpers";
import { employeeHasOrganizationAccess } from "@/lib/employee-lifecycle/access";
import { createLogger } from "@/lib/logger";

const logger = createLogger("ApprovalEscalationSettingsActions");

type ActionResult<T> =
	| { success: true; data: T }
	| { success: false; error: string };

const FORBIDDEN: ActionResult<never> = {
	success: false,
	error: "You do not have permission to manage approval escalation.",
};

/**
 * Escalation policy and attention are approval-management concerns: holding
 * an approval assignment or being an eligible manager is not sufficient.
 */
async function requireEscalationManager(): Promise<{
	organizationId: string;
	userId: string;
} | null> {
	const authContext = await getAuthContext();
	const organizationId = authContext?.session.activeOrganizationId;
	if (!authContext || !organizationId) return null;

	const ability = await getAbility();
	if (!ability || ability.cannot("manage", "Approval")) return null;

	return { organizationId, userId: authContext.user.id };
}

export async function getApprovalEscalationOverview(): Promise<
	ActionResult<EscalationManagementOverview>
> {
	const manager = await requireEscalationManager();
	if (!manager) return FORBIDDEN;

	try {
		return {
			success: true,
			data: await getEscalationManagementOverview(manager.organizationId),
		};
	} catch (error) {
		logger.error(
			{ error, organizationId: manager.organizationId },
			"Failed to load escalation overview",
		);
		return {
			success: false,
			error: "Escalation settings could not be loaded.",
		};
	}
}

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

export async function updateApprovalEscalationPolicy(
	input: z.input<typeof updatePolicySchema>,
): Promise<ActionResult<{ revision: number; changed: boolean }>> {
	const manager = await requireEscalationManager();
	if (!manager) return FORBIDDEN;

	const parsed = updatePolicySchema.safeParse(input);
	if (!parsed.success) {
		return {
			success: false,
			error: parsed.error.issues[0]?.message ?? "Invalid policy.",
		};
	}

	const outcome = await updateEscalationPolicy({
		organizationId: manager.organizationId,
		actorUserId: manager.userId,
		...parsed.data,
	});
	switch (outcome.kind) {
		case "updated":
			revalidatePath(ESCALATION_MANAGEMENT_PATH);
			return {
				success: true,
				data: { revision: outcome.revision, changed: true },
			};
		case "unchanged":
			return {
				success: true,
				data: { revision: outcome.revision, changed: false },
			};
		case "stale":
			return {
				success: false,
				error:
					"The policy was changed by someone else. Reload to see the current policy.",
			};
		case "invalid":
			return { success: false, error: "Invalid policy." };
		case "not_prepared":
			return {
				success: false,
				error: "The escalation policy has not been prepared yet.",
			};
	}
}

export async function reviewApprovalEscalationPolicyConflicts(): Promise<
	ActionResult<undefined>
> {
	const manager = await requireEscalationManager();
	if (!manager) return FORBIDDEN;

	const outcome = await markEscalationPolicyConflictsReviewed({
		organizationId: manager.organizationId,
		actorUserId: manager.userId,
	});
	if (outcome.kind === "not_prepared") {
		return {
			success: false,
			error: "The escalation policy has not been prepared yet.",
		};
	}
	revalidatePath(ESCALATION_MANAGEMENT_PATH);
	return { success: true, data: undefined };
}

const disposeSchema = z.object({
	attentionId: z.string().uuid(),
	note: z
		.string()
		.trim()
		.min(1, "A disposition note is required.")
		.max(MAX_ATTENTION_DISPOSITION_NOTE_LENGTH),
});

export async function disposeApprovalEscalationAttention(
	input: z.input<typeof disposeSchema>,
): Promise<ActionResult<undefined>> {
	const manager = await requireEscalationManager();
	if (!manager) return FORBIDDEN;

	const parsed = disposeSchema.safeParse(input);
	if (!parsed.success) {
		return {
			success: false,
			error: parsed.error.issues[0]?.message ?? "Invalid disposition.",
		};
	}

	const outcome = await disposeEscalationAttention({
		organizationId: manager.organizationId,
		actorUserId: manager.userId,
		...parsed.data,
	});
	switch (outcome.kind) {
		case "disposed":
			revalidatePath(ESCALATION_MANAGEMENT_PATH);
			return { success: true, data: undefined };
		case "not_open":
			return { success: false, error: "This item was already closed." };
		case "not_found":
			return { success: false, error: "Attention item not found." };
		case "invalid_note":
			return { success: false, error: "A disposition note is required." };
	}
}

/**
 * The management actor as an active employee of the organization. Explicit
 * `manage Approval` is checked first; the employee record only attributes
 * the transfer and must resolve uniquely.
 */
async function requireEscalationManagementActor(): Promise<HumanEscalationActor | null> {
	const manager = await requireEscalationManager();
	if (!manager) return null;
	const actors = await db
		.select({ id: employee.id })
		.from(employee)
		.where(
			and(
				eq(employee.organizationId, manager.organizationId),
				eq(employee.userId, manager.userId),
				employeeHasOrganizationAccess(),
			),
		)
		.limit(2);
	const actor = actors[0];
	if (actors.length !== 1 || !actor) return null;
	return {
		organizationId: manager.organizationId,
		userId: manager.userId,
		employeeId: actor.id,
		canManageApprovals: true,
	};
}

function humanEscalationError(
	outcome: Exclude<HumanEscalationOutcome, { kind: "transferred" }>,
): string {
	switch (outcome.kind) {
		case "forbidden":
			return "You do not have permission to manage approval escalation.";
		case "not_owner":
			return "Channel automation still owns escalation for this organization.";
		case "not_found":
			return "Approval assignment not found.";
		case "not_pending":
			return "This assignment is no longer pending. Reload to see its current state.";
		case "unsupported":
			return "This approval cannot be transferred here yet: its replacement would have no working inbox path.";
		case "recipient_not_eligible":
			return "The selected manager is not an eligible backup for this request.";
		case "no_eligible_backup":
			return "No eligible backup manager is available for this request.";
		case "idempotency_mismatch":
			return "This transfer was already submitted with different details. Reload and try again.";
		case "conflict":
			return "The approval changed while transferring. Reload to see its current state.";
	}
}

const assignmentSchema = z.object({ assignmentId: z.string().uuid() });

export async function listApprovalEscalationCandidates(
	input: z.input<typeof assignmentSchema>,
): Promise<
	ActionResult<Extract<EscalationCandidateListOutcome, { kind: "ok" }>>
> {
	const actor = await requireEscalationManagementActor();
	if (!actor) return FORBIDDEN;
	const parsed = assignmentSchema.safeParse(input);
	if (!parsed.success) {
		return { success: false, error: "Invalid approval assignment." };
	}
	try {
		const outcome = await listHumanEscalationCandidates({
			actor,
			assignmentId: parsed.data.assignmentId,
		});
		return outcome.kind === "ok"
			? { success: true, data: outcome }
			: { success: false, error: humanEscalationError(outcome) };
	} catch (error) {
		logger.error(
			{ error, organizationId: actor.organizationId },
			"Failed to load escalation candidates",
		);
		return {
			success: false,
			error: "Eligible managers could not be loaded.",
		};
	}
}

const transferSchema = z.object({
	assignmentId: z.string().uuid(),
	recipientEmployeeId: z.string().uuid(),
	idempotencyKey: z.string().uuid(),
	reason: z.string().trim().max(MAX_ESCALATION_REASON_LENGTH).optional(),
});

export async function transferApprovalEscalationAssignment(
	input: z.input<typeof transferSchema>,
): Promise<ActionResult<{ replayed: boolean }>> {
	const actor = await requireEscalationManagementActor();
	if (!actor) return FORBIDDEN;
	const parsed = transferSchema.safeParse(input);
	if (!parsed.success) {
		return {
			success: false,
			error: parsed.error.issues[0]?.message ?? "Invalid transfer.",
		};
	}
	try {
		const outcome = await escalateAssignmentByManager({
			actor,
			assignmentId: parsed.data.assignmentId,
			idempotencyKey: parsed.data.idempotencyKey,
			recipientEmployeeId: parsed.data.recipientEmployeeId,
			reason: parsed.data.reason,
		});
		if (outcome.kind !== "transferred") {
			return { success: false, error: humanEscalationError(outcome) };
		}
		revalidatePath(ESCALATION_MANAGEMENT_PATH);
		return {
			success: true,
			data: { replayed: outcome.disposition === "replayed" },
		};
	} catch (error) {
		logger.error(
			{ error, organizationId: actor.organizationId },
			"Approval escalation transfer failed",
		);
		return { success: false, error: "The approval could not be transferred." };
	}
}

export async function recheckApprovalEscalationAttention(): Promise<
	ActionResult<{ checked: number; resolved: number; alerted: number }>
> {
	const manager = await requireEscalationManager();
	if (!manager) return FORBIDDEN;

	try {
		const recheck = await recheckEscalationAttention({
			organizationId: manager.organizationId,
		});
		const alerts = await dispatchEscalationAttentionAlerts({
			organizationId: manager.organizationId,
		});
		revalidatePath(ESCALATION_MANAGEMENT_PATH);
		return {
			success: true,
			data: {
				checked: recheck.checked,
				resolved: recheck.resolved,
				alerted: alerts.alerted,
			},
		};
	} catch (error) {
		logger.error(
			{ error, organizationId: manager.organizationId },
			"Escalation attention recheck failed",
		);
		return { success: false, error: "Attention items could not be rechecked." };
	}
}
