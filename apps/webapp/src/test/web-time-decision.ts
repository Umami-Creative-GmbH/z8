/**
 * A web decision on a time approval for integration suites: the session's
 * active employee claims the approver right and decides through the time
 * approval decision (spec #1673). It stands in for the approve/reject server
 * actions deleted in #1680. A suite imports it after its `vi.mock` calls.
 */
import type { TimeApprovalDecisionResult } from "@/lib/approvals/server/time-approval-decision";

export interface WebTimeDecisionSession {
	userId: string | null;
	organizationId: string | null;
}

export interface WebTimeDecision {
	success: boolean;
	result: TimeApprovalDecisionResult | null;
}

export function webTimeDecision(session: WebTimeDecisionSession) {
	async function decide(
		approvalId: string,
		decision: { kind: "approve" } | { kind: "reject"; reason: string },
	): Promise<WebTimeDecision> {
		const { userId, organizationId } = session;
		if (!userId || !organizationId) return { success: false, result: null };
		const [{ db }, { employee }, { and, eq }, { decideTimeApproval }] = await Promise.all([
			import("@/db"),
			import("@/db/schema"),
			import("drizzle-orm"),
			import("@/lib/approvals/server/time-approval-decision"),
		]);
		const [actor] = await db
			.select({ id: employee.id })
			.from(employee)
			.where(
				and(
					eq(employee.userId, userId),
					eq(employee.organizationId, organizationId),
					eq(employee.isActive, true),
				),
			)
			.limit(1);
		if (!actor) return { success: false, result: null };
		const result = await decideTimeApproval({
			organizationId,
			approvalId,
			actor: { employeeId: actor.id, userId },
			right: { as: "approver" },
			decision,
		});
		return { success: result.status === "decided", result };
	}

	return {
		approve: (approvalId: string) => decide(approvalId, { kind: "approve" }),
		reject: (approvalId: string, reason: string) => decide(approvalId, { kind: "reject", reason }),
	};
}
