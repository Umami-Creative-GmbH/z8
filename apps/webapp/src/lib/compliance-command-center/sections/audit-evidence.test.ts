import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";
import { deriveAuditEvidenceSection } from "./audit-evidence";

describe("deriveAuditEvidenceSection", () => {
	it("marks the section critical when a recent audit-pack request failed", () => {
		const result = deriveAuditEvidenceSection({
			hasConfig: true,
			activeKeyFingerprint: "fp_123",
			recentFailedRequests: 1,
			recentInvalidVerifications: 0,
			latestSuccessAt: DateTime.utc().minus({ hours: 3 }).toISO(),
		});

		expect(result.card.status).toBe("critical");
		expect(result.recentCriticalEvents[0]?.title).toContain(
			"Audit pack generation failed",
		);
	});

	it("marks the section warning when signing is not configured", () => {
		const result = deriveAuditEvidenceSection({
			hasConfig: false,
			activeKeyFingerprint: null,
			recentFailedRequests: 0,
			recentInvalidVerifications: 0,
			latestSuccessAt: null,
		});

		expect(result.card.status).toBe("warning");
		expect(result.card.facts).toContain("Signing keys are not configured yet.");
	});
});
