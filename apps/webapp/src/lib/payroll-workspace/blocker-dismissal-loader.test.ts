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
		type: "pending_time_correction",
		label: "Pending time correction",
		date: "2026-06-11",
		time: "10:00",
	},
];

function sqlDetails(statement: unknown) {
	const columnNames: string[] = [];
	const values: unknown[] = [];

	function visit(node: unknown) {
		if (!node || typeof node !== "object") return;
		if (Array.isArray(node)) {
			for (const item of node) visit(item);
			return;
		}
		if (
			"name" in node &&
			typeof (node as { name: unknown }).name === "string"
		) {
			columnNames.push((node as { name: string }).name);
		}
		if ("encoder" in node && "value" in node) {
			values.push((node as { value: unknown }).value);
		}
		const chunks = (node as { queryChunks?: unknown[] }).queryChunks;
		if (chunks) for (const chunk of chunks) visit(chunk);
	}

	visit(statement);
	return { columnNames, values };
}

function equalityPredicateValues(statement: unknown) {
	const values = new Map<string, unknown>();

	function visit(node: unknown) {
		if (!node || typeof node !== "object") return;
		if (Array.isArray(node)) {
			for (const item of node) visit(item);
			return;
		}
		const chunks = (node as { queryChunks?: unknown[] }).queryChunks;
		if (!chunks) return;

		for (let index = 0; index < chunks.length; index++) {
			const column = chunks[index] as { name?: unknown };
			const parameter = chunks[index + 2] as { value?: unknown } | undefined;
			if (
				typeof column?.name === "string" &&
				parameter &&
				"value" in parameter
			) {
				values.set(column.name, parameter.value);
			}
			visit(chunks[index]);
		}
	}

	visit(statement);
	return values;
}

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
		const { columnNames, values } = sqlDetails(query?.where);
		expect(columnNames).toEqual(
			expect.arrayContaining(["organization_id", "source_id"]),
		);
		expect(equalityPredicateValues(query?.where).get("organization_id")).toBe(
			"org-1",
		);
		expect(values).toEqual(["org-1", "source-1", "source-2"]);
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
