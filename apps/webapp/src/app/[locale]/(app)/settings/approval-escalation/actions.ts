"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
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
import { getAbility, getAuthContext } from "@/lib/auth-helpers";
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
