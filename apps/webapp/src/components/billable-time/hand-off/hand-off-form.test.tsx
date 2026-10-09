/* @vitest-environment jsdom */

import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { HandOffPreview } from "@/lib/billable-time/hand-off/views";
import { render } from "@/test/render-with-translations";

vi.mock("@/hooks/use-display-context", () => ({
	useDisplayContext: () => ({ locale: "de-DE", timezone: "Europe/Berlin", timeFormat: "24h" }),
}));

import { HandOffPreviewView } from "./hand-off-form";

const work = {
	workPeriodId: "wp-1",
	day: "2026-03-02",
	employeeName: "Grace",
	projectName: "Website",
	hours: "2.50",
};

const preview: HandOffPreview = {
	customer: { id: "c-1", name: "Acme" },
	period: { from: "2026-03-01", to: "2026-03-31" },
	projects: [{ id: "p-1", name: "Website", selected: true }],
	currency: "EUR",
	connection: { providerKind: "lexware_office", accountLabel: null, maxDraftLines: 300 },
	contact: { contactId: "k-1", contactName: "Acme GmbH", contactNumber: null },
	taxTreatment: null,
	lines: [
		{
			position: 1,
			kind: "work",
			projectId: "p-1",
			projectName: "Website",
			text: "Website",
			hours: "1234.50",
			rate: "95.00",
			amount: "117277.50",
		},
	],
	netTotal: "117277.50",
	hours: "1234.50",
	included: [],
	heldBack: [work],
	alreadyInvoiced: [],
	unpriced: [],
	withoutCustomer: { count: 1, hours: "1.25", projects: ["Intern"] },
	nonBillable: { count: 0, hours: "0.00" },
	timesheetLineCount: 1,
	timesheetOmitted: 0,
	blockers: [],
	fingerprint: "f",
};

describe("HandOffPreviewView", () => {
	it("shows days, the period and hours in the viewer's locale", () => {
		render(
			<HandOffPreviewView
				preview={preview}
				confirming={false}
				retryable={false}
				onConfirm={vi.fn()}
			/>,
		);

		expect(screen.getByText("01.03.2026 – 31.03.2026")).toBeTruthy();
		expect(screen.getAllByText("1.234,50")).toHaveLength(2);
		expect(screen.getByText("02.03.2026")).toBeTruthy();
		expect(screen.getByText("2,50 h")).toBeTruthy();
		expect(screen.getByText(/\(1,25 h\) on projects without a customer/)).toBeTruthy();
	});

	it("counts timesheet text lines in words", () => {
		render(
			<HandOffPreviewView
				preview={preview}
				confirming={false}
				retryable={false}
				onConfirm={vi.fn()}
			/>,
		);

		expect(screen.getByText("1 timesheet text line is added to the draft.")).toBeTruthy();
		expect(screen.queryByText(/left out of the text lines/)).toBeNull();
	});

	it("says how many work periods a shortened timesheet leaves out", () => {
		render(
			<HandOffPreviewView
				preview={{ ...preview, timesheetOmitted: 2 }}
				confirming={false}
				retryable={false}
				onConfirm={vi.fn()}
			/>,
		);

		expect(screen.getByText(/2 work periods are left out of the text lines/)).toBeTruthy();
	});
});
