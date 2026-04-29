import { describe, expect, it } from "vitest";

import {
	qualificationEvidence,
	qualificationEvidenceRelations,
	qualificationRenewalRequest,
	qualificationRenewalRequestEvidence,
	qualificationRenewalRequestEvidenceRelations,
	qualificationRenewalRequestRelations,
} from "..";

describe("qualification relations schema", () => {
	it("exports renewal request evidence link tables and relations", () => {
		expect(qualificationEvidence).toBeDefined();
		expect(qualificationRenewalRequest).toBeDefined();
		expect(qualificationRenewalRequestEvidence).toBeDefined();
		expect(qualificationEvidenceRelations).toBeDefined();
		expect(qualificationRenewalRequestRelations).toBeDefined();
		expect(qualificationRenewalRequestEvidenceRelations).toBeDefined();
	});
});
