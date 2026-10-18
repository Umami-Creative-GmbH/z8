import { expect, it } from "vitest";
import { db } from "@/db";
import type { PayrollBaselineEvidence } from "./baseline-types";
import { readPayrollComparisonExplanations } from "./comparison-explanations";

it("returns no source explanations for an empty supported scope without touching the database", async () => {
	const baseline: PayrollBaselineEvidence = {
		version: 1,
		destination: {
			configId: "config",
			mandantennummer: "123",
			beraternummer: "123",
		},
		config: {},
		filters: { dateRange: { start: "2026-09-01", end: "2026-09-30" } },
		period: { startDate: "2026-09-01", endDate: "2026-09-30" },
		employeeIds: [],
		employeeWindows: [],
		output: {
			version: 1,
			formatId: "datev_lohn",
			formatterVersion: "2024.1",
			excludedLineKinds: ["expense"],
			rows: [],
		},
		fileDigest: "digest",
		attemptId: "attempt",
	};
	expect(
		await readPayrollComparisonExplanations(db, {
			organizationId: "org",
			baseline,
			baselineCompletedAt: "2026-10-01T00:00:00Z",
			current: baseline.output,
		}),
	).toEqual([]);
});
