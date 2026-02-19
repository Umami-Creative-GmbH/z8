import { describe, expect, it } from "vitest";
import { shouldOpenComplianceDialog } from "@/components/scheduling/scheduler/publish-compliance-dialog";

describe("shouldOpenComplianceDialog", () => {
	it("returns true when publish requires acknowledgment", () => {
		expect(
			shouldOpenComplianceDialog({
				published: false,
				requiresAcknowledgment: true,
				count: 0,
				complianceSummary: {
					totalFindings: 2,
					byType: {
						restTime: 1,
						maxHours: 1,
						overtime: 0,
					},
				},
				evaluationFingerprint: "fingerprint-123",
			}),
		).toBe(true);
	});

	it("returns false for direct publish success", () => {
		expect(
			shouldOpenComplianceDialog({
				published: true,
				requiresAcknowledgment: false,
				count: 3,
			}),
		).toBe(false);
	});

	it("returns false when required payload is missing", () => {
		expect(
			shouldOpenComplianceDialog({
				published: false,
				requiresAcknowledgment: true,
				count: 0,
				complianceSummary: {
					totalFindings: 0,
					byType: {
						restTime: 0,
						maxHours: 0,
						overtime: 0,
					},
				},
				evaluationFingerprint: "",
			}),
		).toBe(false);
	});
});
