import { eq, sql } from "drizzle-orm";
import type { db as appDb } from "@/db";
import { approvalSetting } from "@/db/schema";
import { AuditAction } from "@/lib/audit-logger";
import { withAuditTrail } from "@/lib/audit-trail";

/**
 * Organization-wide approval settings (#1015, migration 0199). No row means
 * the defaults. Users who can manage approvals (`manage Approval`) change them
 * on the approval escalation settings page; every change is audit-logged.
 */

type Database = typeof appDb;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Reader = Pick<Database | Transaction, "select">;

export interface ApprovalSettings {
	/**
	 * "Deputies can decide approvals" (Approvals ADR 0002): while an approver
	 * is away, the deputy named on the absence may decide their approvals. Off:
	 * deputies stay contacts and covering is always false.
	 */
	deputyDecisionsEnabled: boolean;
}

export const DEFAULT_APPROVAL_SETTINGS: ApprovalSettings = Object.freeze({
	deputyDecisionsEnabled: true,
});

export async function loadApprovalSettings(
	database: Reader,
	organizationId: string,
): Promise<ApprovalSettings> {
	const [row] = await database
		.select({ deputyDecisionsEnabled: approvalSetting.deputyDecisionsEnabled })
		.from(approvalSetting)
		.where(eq(approvalSetting.organizationId, organizationId))
		.limit(1);
	return row ?? DEFAULT_APPROVAL_SETTINGS;
}

/**
 * Turns "Deputies can decide approvals" on or off. An actual change is
 * audit-logged in the same transaction; saving the current value changes
 * nothing.
 */
export async function saveDeputyDecisionsEnabled(
	database: Database,
	input: { organizationId: string; enabled: boolean; actorUserId: string },
): Promise<{ changed: boolean; deputyDecisionsEnabled: boolean }> {
	return withAuditTrail((audit) =>
		database.transaction(async (tx) => {
			// Create the row first so concurrent saves serialize on its lock.
			await tx
				.insert(approvalSetting)
				.values({ organizationId: input.organizationId })
				.onConflictDoNothing({ target: approvalSetting.organizationId });
			const [current] = await tx
				.select({
					id: approvalSetting.id,
					deputyDecisionsEnabled: approvalSetting.deputyDecisionsEnabled,
				})
				.from(approvalSetting)
				.where(eq(approvalSetting.organizationId, input.organizationId))
				.for("update");
			if (!current) throw new Error("Approval settings row missing after insert");
			const from = current.deputyDecisionsEnabled;
			if (from === input.enabled) return { changed: false, deputyDecisionsEnabled: from };

			await tx
				.update(approvalSetting)
				.set({
					deputyDecisionsEnabled: input.enabled,
					updatedBy: input.actorUserId,
					updatedAt: sql`now()`,
				})
				.where(eq(approvalSetting.organizationId, input.organizationId));
			await audit.record(tx, {
				organizationId: input.organizationId,
				action: AuditAction.APPROVAL_SETTING_DEPUTY_DECISIONS_CHANGED,
				actorUserId: input.actorUserId,
				targetType: "approval_setting",
				targetId: current.id,
				changes: { deputyDecisionsEnabled: { from, to: input.enabled } },
			});
			return { changed: true, deputyDecisionsEnabled: input.enabled };
		}),
	);
}
