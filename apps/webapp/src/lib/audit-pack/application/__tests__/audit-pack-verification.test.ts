import { describe, expect, it } from "vitest";
import { verifyAuditPackCoverage } from "../verify-audit-pack-coverage";

describe("verifyAuditPackCoverage", () => {
	it("fails when lineage is not closed", () => {
		const result = verifyAuditPackCoverage({
			nodeIds: ["b"],
			requiredLinkedIds: ["a", "b"],
		});

		expect(result.isValid).toBe(false);
		expect(result.missingLinkedIds).toEqual(["a"]);
	});

	it("passes when all required links are present", () => {
		const result = verifyAuditPackCoverage({
			nodeIds: ["a", "b", "c"],
			requiredLinkedIds: ["a", "b"],
		});

		expect(result.isValid).toBe(true);
		expect(result.missingLinkedIds).toEqual([]);
	});
});
