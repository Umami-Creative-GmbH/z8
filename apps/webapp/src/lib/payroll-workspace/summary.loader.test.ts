import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("payroll blocker dismissal loading", () => {
	const source = readFileSync(new URL("./summary.ts", import.meta.url), "utf8");

	it("scopes dismissal lookup by organization and candidate source IDs", () => {
		expect(source).toContain("db.query.payrollBlockerDismissal.findMany({");
		expect(source).toContain(
			"eq(payrollBlockerDismissal.organizationId, organizationId)",
		);
		expect(source).toContain(
			"inArray(payrollBlockerDismissal.sourceId, candidateSourceIds)",
		);
		expect(source).toContain("columns: { blockerType: true, sourceId: true }");
	});

	it("returns before querying dismissals when there are no candidates", () => {
		const emptyGuard = source.indexOf(
			"if (blockerCandidates.length === 0) return blockerCandidates;",
		);
		const dismissalQuery = source.indexOf(
			"db.query.payrollBlockerDismissal.findMany({",
		);

		expect(emptyGuard).toBeGreaterThan(-1);
		expect(dismissalQuery).toBeGreaterThan(emptyGuard);
	});
});
