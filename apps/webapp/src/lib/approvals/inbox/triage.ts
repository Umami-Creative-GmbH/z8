import {
	type ApprovalTriageContext,
	type ApprovalTriageEvidence,
	type ApprovalTriageRequestKind,
	assessApprovalTriage,
} from "../triage-assessment";
import {
	type ApprovalTriagePolicy,
	DEFAULT_APPROVAL_TRIAGE_POLICY,
} from "../triage-policy";
import { getAgeDays } from "./serialization";
import type {
	ApprovalInboxPriority,
	ApprovalInboxRiskLevel,
	ApprovalInboxStatus,
	ApprovalInboxTriage,
	ApprovalInboxType,
} from "./types";

const STALE_AFTER_DAYS = 3;

export interface BuildInboxTriageInput {
	type: ApprovalInboxType;
	requestKind?: ApprovalTriageRequestKind;
	context?: ApprovalTriageContext;
	evidence?: readonly ApprovalTriageEvidence[];
	policy?: ApprovalTriagePolicy;
	riskReasons?: readonly string[];
	priority: ApprovalInboxPriority;
	status: ApprovalInboxStatus;
	createdAt: Date | string;
	now?: Date;
	isPayrollRelevant?: boolean;
	riskLevel?: ApprovalInboxRiskLevel;
	timeDeltaMinutes?: number;
}

export function buildInboxTriage(
	input: BuildInboxTriageInput,
): ApprovalInboxTriage {
	const requestKind =
		input.requestKind ??
		(input.type === "absence_entry"
			? "absence"
			: input.type === "absence_change_request"
				? "absence_change"
				: "other");
	if (requestKind !== "other")
		return {
			priority: input.priority,
			...assessApprovalTriage({
				...input,
				requestKind,
				policy: input.policy ?? DEFAULT_APPROVAL_TRIAGE_POLICY,
			}),
		};
	const ageDays = getAgeDays({ createdAt: input.createdAt, now: input.now });
	const isPayrollRelevant = input.isPayrollRelevant === true;

	if (isPayrollRelevant) {
		return {
			priority: input.priority,
			riskLevel: "high",
			riskReasons: ["payroll_relevant"],
			fastLaneGroup: "payroll_blocker",
			isPayrollRelevant: true,
			explanation: "Blocks payroll readiness.",
		};
	}

	if (input.status === "pending" && ageDays >= STALE_AFTER_DAYS) {
		return {
			priority: input.priority,
			riskLevel: "high",
			riskReasons: ["stale_pending"],
			fastLaneGroup: "stale_pending",
			isPayrollRelevant: false,
			explanation: `Pending longer than ${STALE_AFTER_DAYS} days.`,
		};
	}

	return {
		priority: input.priority,
		riskLevel: "medium",
		riskReasons: ["needs_review"],
		fastLaneGroup: null,
		isPayrollRelevant: false,
		explanation: "Needs manual review.",
	};
}
