import { DateTime } from "luxon";
import type { EntryChainEvidence, EntryChainEvidenceInput } from "./types";

function normalizeIsoTimestamp(timestamp: string): string {
	const parsed = DateTime.fromISO(timestamp, { setZone: true });
	if (!parsed.isValid) {
		return timestamp;
	}

	return (
		parsed
			.toUTC()
			.toISO({ includeOffset: true, suppressMilliseconds: false, suppressSeconds: false }) ?? timestamp
	);
}

export function normalizeEntryChainEvidence(input: EntryChainEvidenceInput): EntryChainEvidence {
	return {
		id: input.id,
		organizationId: input.organizationId,
		occurredAt: normalizeIsoTimestamp(input.occurredAt),
		lineage: {
			previousEntryId: input.previousEntryId,
			replacesEntryId: input.replacesEntryId,
			supersededById: input.supersededById,
		},
	};
}

export function buildEntryChainEvidence(
	inputs: readonly EntryChainEvidenceInput[],
	organizationId: string,
): EntryChainEvidence[] {
	return inputs
		.filter((input) => input.organizationId === organizationId)
		.map((input) => normalizeEntryChainEvidence(input))
		.sort((a, b) => {
			if (a.occurredAt !== b.occurredAt) {
				return a.occurredAt.localeCompare(b.occurredAt);
			}

			return a.id.localeCompare(b.id);
		});
}
