/* @vitest-environment jsdom */

import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { type ImportReviewRow, ImportReviewTable } from "./import-review-table";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: Record<string, string | number>) =>
			fallback.replace(/\{(\w+)\}/g, (_match, name: string) => String(params?.[name] ?? "")),
	}),
}));

function workRow(id: string, billability: ImportReviewRow["billability"]): ImportReviewRow {
	return {
		id,
		entityType: "work_period",
		providerSourceId: `clockodo:entry:${id}`,
		rowStatus: "staged",
		issueSeverity: "none",
		billability,
	};
}

const rows: ImportReviewRow[] = [
	workRow("billable", { providerValue: 1, billable: true, note: null }),
	workRow("billed", { providerValue: 2, billable: true, note: "already_billed" }),
	workRow("internal", { providerValue: 1, billable: false, note: "no_customer" }),
	workRow("unmapped", { providerValue: 1, billable: false, note: "unmapped_project" }),
	workRow("no-project", { providerValue: 1, billable: false, note: "no_project" }),
	workRow("old", { providerValue: null, billable: false, note: "no_billable_value" }),
];

function cellOf(rowId: string) {
	const row = screen.getByText(rowId).closest("tr");
	if (!row) throw new Error(`Row ${rowId} missing`);
	return within(row);
}

describe("ImportReviewTable billability (#907)", () => {
	it("shows each staged entry's billable value and why work imports as non-billable", () => {
		render(<ImportReviewTable rows={rows} showBillability />);

		expect(screen.getByRole("columnheader", { name: "Billable" })).toBeTruthy();
		expect(cellOf("billable").getByText("Billable")).toBeTruthy();
		expect(cellOf("billed").getByText("Billable")).toBeTruthy();
		expect(
			cellOf("billed").getByText(
				"Already billed in Clockodo. Imported as billable work, not as invoiced work.",
			),
		).toBeTruthy();
		expect(cellOf("internal").getByText("Non-billable")).toBeTruthy();
		expect(
			cellOf("internal").getByText("Billable in Clockodo, but the Z8 project has no customer."),
		).toBeTruthy();
		expect(
			cellOf("unmapped").getByText(
				"Billable in Clockodo, but the Clockodo project is not mapped to a Z8 project.",
			),
		).toBeTruthy();
		expect(
			cellOf("no-project").getByText("Billable in Clockodo, but the entry has no project."),
		).toBeTruthy();
		expect(
			cellOf("old").getByText("Staged without a billable value; commits as non-billable work."),
		).toBeTruthy();
	});

	it("hides billability while Billable Time is off", () => {
		render(<ImportReviewTable rows={rows} showBillability={false} />);

		expect(screen.queryByRole("columnheader", { name: "Billable" })).toBeNull();
		expect(screen.queryByText("Non-billable")).toBeNull();
	});
});
