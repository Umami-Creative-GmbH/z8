export interface VerifyAuditPackCoverageInput {
	nodeIds: readonly string[];
	requiredLinkedIds: readonly string[];
}

export interface VerifyAuditPackCoverageResult {
	isValid: boolean;
	missingLinkedIds: string[];
	summary: string;
}

export function verifyAuditPackCoverage(
	input: VerifyAuditPackCoverageInput,
): VerifyAuditPackCoverageResult {
	const present = new Set(input.nodeIds);
	const missingLinkedIds = [...new Set(input.requiredLinkedIds)].filter((id) => !present.has(id));

	if (missingLinkedIds.length > 0) {
		return {
			isValid: false,
			missingLinkedIds,
			summary: `Missing linked lineage nodes: ${missingLinkedIds.join(", ")}`,
		};
	}

	return {
		isValid: true,
		missingLinkedIds: [],
		summary: "Lineage coverage is complete",
	};
}
