import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";
import { filterDismissedPayrollBlockerCandidates } from "./blocker-dismissal-loader";
import type { PayrollBlocker } from "./types";

const candidates: PayrollBlocker[] = [
	{
		id: "source-1",
		employeeId: "employee-1",
		type: "missing_clock_out",
		label: "Missing clock-out",
		date: "2026-06-10",
		time: "09:00",
	},
	{
		id: "source-1",
		employeeId: "employee-1",
		type: "pending_absence",
		label: "Pending absence",
		date: "2026-06-10",
		time: null,
	},
	{
		id: "source-2",
		employeeId: "employee-2",
		type: "pending_absence",
		label: "Pending absence",
		date: "2026-06-11",
		time: null,
	},
];

describe("filterDismissedPayrollBlockerCandidates", () => {
	it("queries scoped dismissal keys and applies exact filtering", async () => {
		const findDismissals = vi
			.fn()
			.mockResolvedValue([
				{ blockerType: "missing_clock_out", sourceId: "source-1" },
			]);

		const result = await filterDismissedPayrollBlockerCandidates({
			organizationId: "org-1",
			blockerCandidates: candidates,
			findDismissals,
		});

		expect(result).toEqual([candidates[1], candidates[2]]);
		expect(findDismissals).toHaveBeenCalledOnce();
		const query = findDismissals.mock.calls[0]?.[0];
		expect(query?.columns).toEqual({ blockerType: true, sourceId: true });
		const compiled = new PgDialect().sqlToQuery(query?.where);
		expect(compiled.sql).toContain('"organization_id" = $1');
		expect(compiled.sql).toContain('"blocker_type" = $2');
		expect(compiled.sql).toContain('"source_id" in ($3)');
		expect(compiled.sql).toContain(" or ");
		expect(compiled.sql).toContain('"blocker_type" = $4');
		expect(compiled.sql).toContain('"source_id" in ($5, $6)');
		expect(compiled.params).toEqual([
			"org-1",
			"missing_clock_out",
			"source-1",
			"pending_absence",
			"source-1",
			"source-2",
		]);
	});

	it("returns empty candidates without querying dismissals", async () => {
		const findDismissals = vi.fn();

		await expect(
			filterDismissedPayrollBlockerCandidates({
				organizationId: "org-1",
				blockerCandidates: [],
				findDismissals,
			}),
		).resolves.toEqual([]);
		expect(findDismissals).not.toHaveBeenCalled();
	});
});
