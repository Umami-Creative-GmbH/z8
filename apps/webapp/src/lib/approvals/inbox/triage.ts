import { getAgeDays } from "./serialization";
import type {
	ApprovalInboxPriority,
	ApprovalInboxRiskLevel,
	ApprovalInboxStatus,
	ApprovalInboxTriage,
	ApprovalInboxType,
} from "./types";

const STALE_AFTER_DAYS = 3;
const SMALL_TIME_CORRECTION_MINUTES = 15;

export interface BuildInboxTriageInput {
	type: ApprovalInboxType;
	priority: ApprovalInboxPriority;
	status: ApprovalInboxStatus;
	createdAt: Date | string;
	now?: Date;
	isPayrollRelevant?: boolean;
	riskLevel?: ApprovalInboxRiskLevel;
	timeDeltaMinutes?: number;
}

export function buildInboxTriage(input: BuildInboxTriageInput): ApprovalInboxTriage {
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

	if (
		input.type === "time_entry" &&
		typeof input.timeDeltaMinutes === "number" &&
		Math.abs(input.timeDeltaMinutes) <= SMALL_TIME_CORRECTION_MINUTES
	) {
		return {
			priority: input.priority,
			riskLevel: "low",
			riskReasons: ["small_time_delta"],
			fastLaneGroup: "small_time_correction",
			isPayrollRelevant: false,
			explanation: `Time delta is within ${SMALL_TIME_CORRECTION_MINUTES} minutes.`,
		};
	}

	if (input.type === "absence_entry" && input.riskLevel !== "high") {
		return {
			priority: input.priority,
			riskLevel: "low",
			riskReasons: ["no_conflicts_detected"],
			fastLaneGroup: "low_risk_absence",
			isPayrollRelevant: false,
			explanation: "No conflicts detected.",
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
