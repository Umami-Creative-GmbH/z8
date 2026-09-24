import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
	approvalEscalationPolicy,
	approvalEscalationPolicyRevision,
	auditLog,
	discordBotConfig,
	slackWorkspaceConfig,
	teamsTenantConfig,
	telegramBotConfig,
} from "@/db/schema";
import { AuditAction } from "@/lib/audit-logger";
import type { EscalationAttentionExecutor } from "./attention-store";
import {
	deriveMigratedEscalationPolicy,
	type EscalationPolicySourceInput,
	isValidEscalationResponseWindowHours,
} from "./policy";

export type EscalationPolicyRow = typeof approvalEscalationPolicy.$inferSelect;

export const MAX_ESCALATION_POLICY_REASON_LENGTH = 500;

/** Current escalation settings of every integration row in the organization. */
export async function loadEscalationPolicySources(
	executor: EscalationAttentionExecutor,
	organizationId: string,
): Promise<EscalationPolicySourceInput[]> {
	const [slack, telegram, discord, teams] = await Promise.all([
		executor
			.select({
				sourceId: slackWorkspaceConfig.id,
				displayName: slackWorkspaceConfig.slackTeamName,
				setupStatus: slackWorkspaceConfig.setupStatus,
				escalationEnabled: slackWorkspaceConfig.enableEscalations,
				escalationTimeoutHours: slackWorkspaceConfig.escalationTimeoutHours,
			})
			.from(slackWorkspaceConfig)
			.where(eq(slackWorkspaceConfig.organizationId, organizationId)),
		executor
			.select({
				sourceId: telegramBotConfig.id,
				displayName: telegramBotConfig.botUsername,
				setupStatus: telegramBotConfig.setupStatus,
				escalationEnabled: telegramBotConfig.enableEscalations,
				escalationTimeoutHours: telegramBotConfig.escalationTimeoutHours,
			})
			.from(telegramBotConfig)
			.where(eq(telegramBotConfig.organizationId, organizationId)),
		executor
			.select({
				sourceId: discordBotConfig.id,
				displayName: discordBotConfig.applicationId,
				setupStatus: discordBotConfig.setupStatus,
				escalationEnabled: discordBotConfig.enableEscalations,
				escalationTimeoutHours: discordBotConfig.escalationTimeoutHours,
			})
			.from(discordBotConfig)
			.where(eq(discordBotConfig.organizationId, organizationId)),
		executor
			.select({
				sourceId: teamsTenantConfig.id,
				displayName: teamsTenantConfig.tenantName,
				setupStatus: teamsTenantConfig.setupStatus,
				escalationEnabled: teamsTenantConfig.enableEscalations,
				escalationTimeoutHours: teamsTenantConfig.escalationTimeoutHours,
			})
			.from(teamsTenantConfig)
			.where(eq(teamsTenantConfig.organizationId, organizationId)),
	]);

	return [
		...slack.map((row) => ({ ...row, channel: "slack" as const })),
		...telegram.map((row) => ({ ...row, channel: "telegram" as const })),
		...discord.map((row) => ({ ...row, channel: "discord" as const })),
		...teams.map((row) => ({ ...row, channel: "teams" as const })),
	];
}

/**
 * Idempotently migrate the organization's escalation policy from its current
 * integration settings. The first successful preparation wins and later
 * integration edits never rewrite it; subsequent deadlines belong to the
 * organization policy. Preparation does not transfer escalation ownership.
 */
export async function prepareEscalationPolicy(
	organizationId: string,
): Promise<EscalationPolicyRow> {
	if (!organizationId)
		throw new Error("Escalation policy requires organization scope");

	const existing = await db.query.approvalEscalationPolicy.findFirst({
		where: eq(approvalEscalationPolicy.organizationId, organizationId),
	});
	if (existing) return existing;

	return db.transaction(async (tx) => {
		const migrated = deriveMigratedEscalationPolicy(
			await loadEscalationPolicySources(tx, organizationId),
		);
		const [inserted] = await tx
			.insert(approvalEscalationPolicy)
			.values({
				organizationId,
				enabled: migrated.enabled,
				responseWindowHours: migrated.responseWindowHours,
				revision: 1,
				migrationProvenance: migrated.provenance,
				conflictReviewStatus: migrated.conflictReviewStatus,
			})
			.onConflictDoNothing({ target: approvalEscalationPolicy.organizationId })
			.returning();

		if (inserted) {
			await tx.insert(approvalEscalationPolicyRevision).values({
				organizationId,
				revision: 1,
				enabled: migrated.enabled,
				responseWindowHours: migrated.responseWindowHours,
				origin: "migration",
				reason: migrated.provenance.outcome,
			});
			return inserted;
		}

		// A concurrent preparation committed first; return its result.
		const [winner] = await tx
			.select()
			.from(approvalEscalationPolicy)
			.where(eq(approvalEscalationPolicy.organizationId, organizationId))
			.limit(1);
		if (!winner) throw new Error("Escalation policy preparation lost its row");
		return winner;
	});
}

export type UpdateEscalationPolicyOutcome =
	| { kind: "updated"; revision: number }
	| { kind: "unchanged"; revision: number }
	| { kind: "stale"; currentRevision: number }
	| { kind: "invalid"; field: "responseWindowHours" | "reason" }
	| { kind: "not_prepared" };

/**
 * Management edit of the organization policy. Optimistic on `expectedRevision`
 * so concurrent editors cannot silently overwrite each other. A new window
 * applies to the existing actionable instants of pending assignments; it does
 * not restart any response clock.
 */
export async function updateEscalationPolicy(input: {
	organizationId: string;
	actorUserId: string;
	expectedRevision: number;
	enabled: boolean;
	responseWindowHours: number;
	reason?: string;
}): Promise<UpdateEscalationPolicyOutcome> {
	if (!isValidEscalationResponseWindowHours(input.responseWindowHours)) {
		return { kind: "invalid", field: "responseWindowHours" };
	}
	const reason = input.reason?.trim() || null;
	if (reason && reason.length > MAX_ESCALATION_POLICY_REASON_LENGTH) {
		return { kind: "invalid", field: "reason" };
	}

	return db.transaction(async (tx): Promise<UpdateEscalationPolicyOutcome> => {
		const [current] = await tx
			.select()
			.from(approvalEscalationPolicy)
			.where(eq(approvalEscalationPolicy.organizationId, input.organizationId))
			.limit(1)
			.for("update");
		if (!current) return { kind: "not_prepared" };
		if (current.revision !== input.expectedRevision) {
			return { kind: "stale", currentRevision: current.revision };
		}
		if (
			current.enabled === input.enabled &&
			current.responseWindowHours === input.responseWindowHours
		) {
			return { kind: "unchanged", revision: current.revision };
		}

		const revision = current.revision + 1;
		await tx
			.update(approvalEscalationPolicy)
			.set({
				enabled: input.enabled,
				responseWindowHours: input.responseWindowHours,
				revision,
				updatedByUserId: input.actorUserId,
			})
			.where(
				and(
					eq(approvalEscalationPolicy.organizationId, input.organizationId),
					eq(approvalEscalationPolicy.revision, current.revision),
				),
			);
		const [revisionRow] = await tx
			.insert(approvalEscalationPolicyRevision)
			.values({
				organizationId: input.organizationId,
				revision,
				enabled: input.enabled,
				responseWindowHours: input.responseWindowHours,
				origin: "management_edit",
				changedByUserId: input.actorUserId,
				reason,
			})
			.returning({ id: approvalEscalationPolicyRevision.id });
		if (!revisionRow)
			throw new Error("Escalation policy revision write returned no row");
		await tx.insert(auditLog).values({
			organizationId: input.organizationId,
			// The policy is keyed by organization; audit the immutable revision row.
			entityType: "approval_escalation_policy_revision",
			entityId: revisionRow.id,
			action: AuditAction.APPROVAL_ESCALATION_POLICY_UPDATED,
			performedBy: input.actorUserId,
			changes: JSON.stringify({
				enabled: { from: current.enabled, to: input.enabled },
				responseWindowHours: {
					from: current.responseWindowHours,
					to: input.responseWindowHours,
				},
				revision: { from: current.revision, to: revision },
			}),
			metadata: JSON.stringify({ reason }),
		});
		return { kind: "updated", revision };
	});
}

async function policyRevisionId(
	executor: EscalationAttentionExecutor,
	organizationId: string,
	revision: number,
): Promise<string> {
	const [row] = await executor
		.select({ id: approvalEscalationPolicyRevision.id })
		.from(approvalEscalationPolicyRevision)
		.where(
			and(
				eq(approvalEscalationPolicyRevision.organizationId, organizationId),
				eq(approvalEscalationPolicyRevision.revision, revision),
			),
		)
		.limit(1);
	if (!row) throw new Error("Escalation policy revision missing");
	return row.id;
}

export type ReviewEscalationPolicyConflictsOutcome =
	| { kind: "reviewed" }
	| { kind: "nothing_to_review" }
	| { kind: "not_prepared" };

/** Audited acknowledgement that an administrator reviewed the migration conflicts. */
export async function markEscalationPolicyConflictsReviewed(input: {
	organizationId: string;
	actorUserId: string;
}): Promise<ReviewEscalationPolicyConflictsOutcome> {
	return db.transaction(
		async (tx): Promise<ReviewEscalationPolicyConflictsOutcome> => {
			const [current] = await tx
				.select({
					conflictReviewStatus: approvalEscalationPolicy.conflictReviewStatus,
					revision: approvalEscalationPolicy.revision,
				})
				.from(approvalEscalationPolicy)
				.where(
					eq(approvalEscalationPolicy.organizationId, input.organizationId),
				)
				.limit(1)
				.for("update");
			if (!current) return { kind: "not_prepared" };
			if (current.conflictReviewStatus !== "pending")
				return { kind: "nothing_to_review" };

			await tx
				.update(approvalEscalationPolicy)
				.set({
					conflictReviewStatus: "reviewed",
					conflictReviewedByUserId: input.actorUserId,
					conflictReviewedAt: new Date(),
				})
				.where(
					eq(approvalEscalationPolicy.organizationId, input.organizationId),
				);
			await tx.insert(auditLog).values({
				organizationId: input.organizationId,
				// Conflicts belong to the migration snapshot, recorded as revision 1.
				entityType: "approval_escalation_policy_revision",
				entityId: await policyRevisionId(tx, input.organizationId, 1),
				action: AuditAction.APPROVAL_ESCALATION_CONFLICTS_REVIEWED,
				performedBy: input.actorUserId,
				changes: JSON.stringify({
					conflictReviewStatus: { from: "pending", to: "reviewed" },
				}),
				metadata: JSON.stringify({ policyRevision: current.revision }),
			});
			return { kind: "reviewed" };
		},
	);
}
