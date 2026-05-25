import { DateTime } from "luxon";
import type {
	ApprovalFastLaneGroupKey,
	ApprovalRiskLevel,
	ApprovalRiskReason,
	ApprovalTriageMetadata,
	UnifiedApprovalItem,
} from "./domain/types";

const DEFAULT_STALE_AFTER_DAYS = 3;
const DEFAULT_SMALL_TIME_CORRECTION_MINUTES = 15;

export interface ApprovalTriageOptions {
	now?: Date;
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
	const ageDays = getAgeDays(approval.createdAt, options.now ?? new Date());
	const staleAfterDays = options.staleAfterDays ?? DEFAULT_STALE_AFTER_DAYS;
	const smallTimeCorrectionMinutes =
		options.smallTimeCorrectionMinutes ?? DEFAULT_SMALL_TIME_CORRECTION_MINUTES;
	const isPayrollRelevant = approval.triage?.isPayrollRelevant === true;
	const timeDeltaMinutes = approval.triage?.timeDeltaMinutes;

	let riskLevel: ApprovalRiskLevel = "medium";
	let riskReasons: ApprovalRiskReason[] = ["needs_review"];
	let fastLaneGroup: ApprovalFastLaneGroupKey | null = null;

	if (isPayrollRelevant) {
		riskLevel = "high";
		riskReasons = ["payroll_relevant"];
		fastLaneGroup = "payroll_blocker";
	} else if (approval.status === "pending" && ageDays >= staleAfterDays) {
		riskLevel = "high";
		riskReasons = ["stale_pending"];
		fastLaneGroup = "stale_pending";
	} else if (
		approval.approvalType === "time_entry" &&
		isSmallTimeCorrection(timeDeltaMinutes, smallTimeCorrectionMinutes)
	) {
		riskLevel = "low";
		riskReasons = ["small_time_delta"];
		fastLaneGroup = "small_time_correction";
	} else if (approval.approvalType === "absence_entry") {
		riskLevel = "low";
		riskReasons = ["no_conflicts_detected"];
		fastLaneGroup = "low_risk_absence";
	}

	return {
		...approval.triage,
		riskLevel,
		riskReasons,
		fastLaneGroup,
		isPayrollRelevant,
		ageDays,
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
				getRiskRank(second.triage.riskLevel) - getRiskRank(first.triage.riskLevel);

			if (riskDifference !== 0) {
				return riskDifference;
			}

			return first.createdAt.getTime() - second.createdAt.getTime();
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

function getAgeDays(createdAt: Date, now: Date): number {
	const days = DateTime.fromJSDate(now).diff(
		DateTime.fromJSDate(createdAt),
		"days",
	).days;

	return Math.max(0, Math.floor(days));
}

function isSmallTimeCorrection(
	timeDeltaMinutes: number | undefined,
	thresholdMinutes: number,
): boolean {
	return (
		typeof timeDeltaMinutes === "number" &&
		Math.abs(timeDeltaMinutes) <= thresholdMinutes
	);
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
