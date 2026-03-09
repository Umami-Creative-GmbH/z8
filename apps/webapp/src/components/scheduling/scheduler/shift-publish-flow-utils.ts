import type { PublishShiftsResult } from "@/app/[locale]/(app)/scheduling/types";

export type PendingPublishAcknowledgment = Extract<
	PublishShiftsResult,
	{ published: false; requiresAcknowledgment: true }
>;

export function getPendingPublishAcknowledgment(
	result: PublishShiftsResult | null | undefined,
): PendingPublishAcknowledgment | null {
	if (!result || result.published || !result.requiresAcknowledgment) {
		return null;
	}

	if (result.complianceSummary.totalFindings <= 0 || result.evaluationFingerprint.length === 0) {
		return null;
	}

	return result;
}
