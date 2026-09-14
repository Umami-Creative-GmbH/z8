import { eq } from "drizzle-orm";
import { db } from "@/db";
import { approvalEscalationControl } from "@/db/schema";

export interface LegacyEscalationSuppression {
	organizationId: string;
	reason: "ownership_moved" | "automation_paused";
}

/**
 * Fresh, authoritative execution admission for retained legacy job names.
 * Never cache this or accept ownership from a queued job/config snapshot.
 * This read is not a cutover lock: active work must drain before ownership is
 * changed until the exclusive adoption protocol is integrated and verified.
 * Committed receipts, assignments and delivery recovery do not use this gate.
 */
export async function getLegacyEscalationSuppression(
	organizationId: string,
): Promise<LegacyEscalationSuppression | null> {
	if (!organizationId) throw new Error("Escalation execution requires organization scope");
	const control = await db.query.approvalEscalationControl.findFirst({
		where: eq(approvalEscalationControl.organizationId, organizationId),
		columns: { owner: true, automationPaused: true },
	});
	if (control && control.owner !== "legacy") {
		return { organizationId, reason: "ownership_moved" };
	}
	if (control?.automationPaused) {
		return { organizationId, reason: "automation_paused" };
	}
	return null;
}
