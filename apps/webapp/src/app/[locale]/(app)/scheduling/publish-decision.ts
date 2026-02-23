import type { ScheduleComplianceSummary } from "@/lib/scheduling/compliance/types";
import type { PublishAcknowledgmentInput, PublishShiftsResult } from "./types";

interface BuildPublishDecisionInput {
	count: number;
	compliance: {
		summary: ScheduleComplianceSummary;
		fingerprint: string;
	};
	acknowledgment?: PublishAcknowledgmentInput | null;
}

export function buildPublishDecision(input: BuildPublishDecisionInput): PublishShiftsResult {
	const hasFindings = input.compliance.summary.totalFindings > 0;
	const hasValidAcknowledgment =
		input.acknowledgment?.evaluationFingerprint === input.compliance.fingerprint;

	if (hasFindings && !hasValidAcknowledgment) {
		return {
			published: false as const,
			requiresAcknowledgment: true as const,
			count: 0,
			complianceSummary: input.compliance.summary,
			evaluationFingerprint: input.compliance.fingerprint,
		};
	}

	return {
		published: true as const,
		requiresAcknowledgment: false as const,
		count: input.count,
	};
}
