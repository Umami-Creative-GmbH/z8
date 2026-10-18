import { eq, sql } from "drizzle-orm";
import type { db as appDb } from "@/db";
import { approvalSetting } from "@/db/schema";
import { AuditAction } from "@/lib/audit-logger";
import { withAuditTrail } from "@/lib/audit-trail";
import { acquireExclusiveOrganizationConfigurationGuard } from "@/lib/time-tracking/work-transaction";
import {
	type ApprovalTriagePolicy,
	DEFAULT_APPROVAL_TRIAGE_POLICY,
} from "./triage-policy-config";

type Database = typeof appDb;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
const columns = {
	staleAfterHours: approvalSetting.staleAfterHours,
	smallCorrectionMinutes: approvalSetting.smallCorrectionMinutes,
};

export async function loadApprovalTriageSettings(
	database: Pick<Database | Transaction, "select">,
	organizationId: string,
): Promise<ApprovalTriagePolicy> {
	const [row] = await database
		.select(columns)
		.from(approvalSetting)
		.where(eq(approvalSetting.organizationId, organizationId))
		.limit(1);
	return row ?? { ...DEFAULT_APPROVAL_TRIAGE_POLICY };
}

/** Serializes concurrent saves and commits the audit with the actual change. */
export async function saveApprovalTriageSettings(
	database: Database,
	input: ApprovalTriagePolicy & { organizationId: string; actorUserId: string },
): Promise<ApprovalTriagePolicy> {
	return withAuditTrail((audit) =>
		database.transaction(async (tx) => {
			await acquireExclusiveOrganizationConfigurationGuard(
				tx,
				input.organizationId,
			);
			await tx
				.insert(approvalSetting)
				.values({ organizationId: input.organizationId })
				.onConflictDoNothing({ target: approvalSetting.organizationId });
			const [current] = await tx
				.select({ ...columns, id: approvalSetting.id })
				.from(approvalSetting)
				.where(eq(approvalSetting.organizationId, input.organizationId))
				.for("update");
			if (!current)
				throw new Error("Approval settings row missing after insert");
			const next = {
				staleAfterHours: input.staleAfterHours,
				smallCorrectionMinutes: input.smallCorrectionMinutes,
			};
			const changes: Record<string, { from: number; to: number }> = {};
			if (current.staleAfterHours !== next.staleAfterHours)
				changes.staleAfterHours = {
					from: current.staleAfterHours,
					to: next.staleAfterHours,
				};
			if (current.smallCorrectionMinutes !== next.smallCorrectionMinutes)
				changes.smallCorrectionMinutes = {
					from: current.smallCorrectionMinutes,
					to: next.smallCorrectionMinutes,
				};
			if (!Object.keys(changes).length) return next;
			await tx
				.update(approvalSetting)
				.set({ ...next, updatedBy: input.actorUserId, updatedAt: sql`now()` })
				.where(eq(approvalSetting.organizationId, input.organizationId));
			await audit.record(tx, {
				organizationId: input.organizationId,
				action: AuditAction.APPROVAL_SETTING_TRIAGE_CHANGED,
				actorUserId: input.actorUserId,
				targetType: "approval_setting",
				targetId: current.id,
				changes,
			});
			return next;
		}),
	);
}
