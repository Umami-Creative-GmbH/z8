import type {
	ApprovalInboxItem,
	ApprovalInboxPriority,
	ApprovalInboxType,
} from "@/lib/approvals/inbox/types";
import type { BriefingApproval } from "../types";

/** A pending item of the viewer's unified Approval inbox, as the briefing's approvals source returns it. */
export function briefingInboxApproval(input: {
	id: string;
	requester: { id: string; name: string };
	type?: ApprovalInboxType;
	entityId?: string;
	title?: string;
	detail?: string;
	priority?: ApprovalInboxPriority;
	capabilities?: Partial<ApprovalInboxItem["capabilities"]>;
}): BriefingApproval {
	return {
		id: input.id,
		type: input.type ?? "absence_entry",
		entityId: input.entityId ?? `entity-${input.id}`,
		status: "pending",
		requester: { ...input.requester, email: "", image: null, teamId: null },
		summary: {
			title: input.title ?? "Vacation",
			subtitle: "Apr 28",
			detail: input.detail ?? `${input.requester.name} requested absence`,
			badge: null,
		},
		timing: {
			createdAt: "2026-04-27T08:00:00.000Z",
			resolvedAt: null,
			slaDeadline: null,
			ageDays: 1,
		},
		triage: {
			priority: input.priority ?? "normal",
			riskLevel: "low",
			riskReasons: [],
			fastLaneGroup: null,
			isPayrollRelevant: false,
			explanation: "",
		},
		capabilities: {
			canApprove: true,
			canReject: true,
			canBulkApprove: true,
			requiresRejectReason: true,
			...input.capabilities,
		},
	};
}
