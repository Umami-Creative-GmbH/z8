import { DateTime } from "luxon";
import type { ApprovalEvidence, ApprovalEvidenceInput } from "./types";

function normalizeIsoTimestamp(timestamp: string): string {
	const parsed = DateTime.fromISO(timestamp, { setZone: true });
	if (!parsed.isValid) {
		return timestamp;
	}

	return (
		parsed
			.toUTC()
			.toISO({ includeOffset: true, suppressMilliseconds: false, suppressSeconds: false }) ??
		timestamp
	);
}

export function normalizeApprovalEvidence(input: ApprovalEvidenceInput): ApprovalEvidence {
	return {
		id: input.id,
		organizationId: input.organizationId,
		entryId: input.entryId,
		approvedAt: normalizeIsoTimestamp(input.approvedAt),
		status: input.status,
		approvedById: input.approvedById,
	};
}

export function buildApprovalEvidence(
	inputs: readonly ApprovalEvidenceInput[],
	organizationId: string,
): ApprovalEvidence[] {
	return inputs
		.flatMap((input) =>
			input.organizationId === organizationId ? [normalizeApprovalEvidence(input)] : [],
		)
		.sort((a, b) => {
			if (a.approvedAt !== b.approvedAt) {
				return a.approvedAt.localeCompare(b.approvedAt);
			}

			return a.id.localeCompare(b.id);
		});
}
