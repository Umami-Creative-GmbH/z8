import { describe, expect, it } from "vitest";
import {
	MAX_QUALIFICATION_EVIDENCE_BYTES,
	isAllowedQualificationEvidenceMime,
	sanitizeQualificationEvidenceFileName,
} from "../evidence-validation";

describe("qualification evidence validation", () => {
	it("allows PDF and image evidence", () => {
		expect(isAllowedQualificationEvidenceMime("application/pdf")).toBe(true);
		expect(isAllowedQualificationEvidenceMime("image/jpeg")).toBe(true);
		expect(isAllowedQualificationEvidenceMime("image/png")).toBe(true);
	});

	it("rejects executable evidence", () => {
		expect(isAllowedQualificationEvidenceMime("application/x-msdownload")).toBe(false);
	});

	it("sets a 10MB evidence limit", () => {
		expect(MAX_QUALIFICATION_EVIDENCE_BYTES).toBe(10 * 1024 * 1024);
	});

	it("sanitizes unsafe filenames", () => {
		expect(sanitizeQualificationEvidenceFileName("../Forklift License 2026.pdf")).toBe(
			"Forklift-License-2026.pdf",
		);
		expect(sanitizeQualificationEvidenceFileName("***")).toBe("qualification-evidence");
	});
});
