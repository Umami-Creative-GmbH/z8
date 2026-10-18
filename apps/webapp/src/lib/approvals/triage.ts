import { instantFromDate, parseInstant } from "@/lib/datetime/temporal-core";
import type {
	ApprovalFastLaneGroupKey,
	ApprovalRiskLevel,
	ApprovalRiskReason,
	ApprovalTriageMetadata,
	UnifiedApprovalItem,
} from "./domain/types";
import { getAgeDays as inboxAgeDays } from "./inbox/serialization";
import { buildInboxTriage } from "./inbox/triage";
import type { ApprovalTriagePolicy } from "./triage-policy";

export interface ApprovalTriageOptions {
	now?: Date;
	policy?: ApprovalTriagePolicy;
	staleAfterDays?: number;
	smallTimeCorrectionMinutes?: number;
}

export type ComputedApprovalTriageMetadata = ApprovalTriageMetadata & {
	riskLevel: ApprovalRiskLevel;
	riskReasons: ApprovalRiskReason[];
	fastLaneGroup: ApprovalFastLaneGroupKey | null;
	isPayrollRelevant: boolean;
	ageDays: number;
};

export type TriagedApprovalItem = UnifiedApprovalItem & {
	triage: ComputedApprovalTriageMetadata;
};

export interface ApprovalFastLaneGroup {
	key: ApprovalFastLaneGroupKey;
	items: TriagedApprovalItem[];
}

export function buildApprovalTriage(
	approval: UnifiedApprovalItem,
	options: ApprovalTriageOptions = {},
): ComputedApprovalTriageMetadata {
	const triage = buildInboxTriage({
		type:
			approval.approvalType === "shift_request"
				? "period_submission"
				: approval.approvalType,
		requestKind: approval.triage?.requestKind,
		context: approval.triage?.context,
		evidence: approval.triage?.evidence,
		priority: approval.priority,
		status: approval.status,
		createdAt: approval.createdAt,
		now: options.now,
		policy: options.policy ?? {
			staleAfterHours: (options.staleAfterDays ?? 3) * 24,
			smallCorrectionMinutes: options.smallTimeCorrectionMinutes ?? 15,
		},
		riskLevel: approval.triage?.riskLevel,
		riskReasons: approval.triage?.riskReasons,
		isPayrollRelevant: approval.triage?.isPayrollRelevant,
	});
	return {
		...approval.triage,
		...triage,
		ageDays: inboxAgeDays({ createdAt: approval.createdAt, now: options.now }),
	};
}
export function withApprovalTriage(
	approval: UnifiedApprovalItem,
	options: ApprovalTriageOptions = {},
): TriagedApprovalItem {
	return {
		...approval,
		triage: buildApprovalTriage(approval, options),
	};
}

export function sortSprintApprovals(
	approvals: UnifiedApprovalItem[],
	options: ApprovalTriageOptions = {},
): TriagedApprovalItem[] {
	return approvals
		.map((approval) => withApprovalTriage(approval, options))
		.sort((first, second) => {
			const riskDifference =
				getRiskRank(second.triage.riskLevel) -
				getRiskRank(first.triage.riskLevel);

			if (riskDifference !== 0) {
				return riskDifference;
			}

			const priorityRank = { urgent: 0, high: 1, normal: 2, low: 3 };
			return (
				priorityRank[first.priority] - priorityRank[second.priority] ||
				getSortTimestamp(first.createdAt) -
					getSortTimestamp(second.createdAt) ||
				first.id.localeCompare(second.id) ||
				first.approvalType.localeCompare(second.approvalType)
			);
		});
}

export function groupApprovalFastLanes(
	approvals: UnifiedApprovalItem[],
	options: ApprovalTriageOptions = {},
): ApprovalFastLaneGroup[] {
	const groups = new Map<ApprovalFastLaneGroupKey, TriagedApprovalItem[]>();

	for (const approval of approvals) {
		const triagedApproval = withApprovalTriage(approval, options);
		const fastLaneGroup = triagedApproval.triage.fastLaneGroup;

		if (fastLaneGroup === null) {
			continue;
		}

		groups.set(fastLaneGroup, [
			...(groups.get(fastLaneGroup) ?? []),
			triagedApproval,
		]);
	}

	return Array.from(groups, ([key, items]) => ({ key, items }));
}

function getSortTimestamp(createdAt: Date | string): number {
	try {
		return (
			typeof createdAt === "string"
				? parseInstant(createdAt)
				: instantFromDate(createdAt)
		).epochMilliseconds;
	} catch {
		return Number.MAX_SAFE_INTEGER;
	}
}
function getRiskRank(riskLevel: ApprovalRiskLevel): number {
	switch (riskLevel) {
		case "high":
			return 3;
		case "medium":
			return 2;
		case "low":
			return 1;
	}
}
