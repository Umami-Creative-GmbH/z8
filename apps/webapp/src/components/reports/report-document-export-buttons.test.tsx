// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { Activity } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ReportDocument } from "@/lib/reports/exporters/report-document";
import { render } from "@/test/render-with-translations";

const mocks = vi.hoisted(() => ({
	pdf: vi.fn(),
	success: vi.fn(),
	error: vi.fn(),
}));
vi.mock("@/lib/reports/exporters/report-document-pdf", () => ({
	exportReportDocumentToPDF: mocks.pdf,
}));
vi.mock("@/hooks/use-display-context", () => ({
	useDisplayContext: () => ({
		locale: "en-US",
		timezone: "UTC",
		timeFormat: "24h",
	}),
}));
vi.mock("sonner", () => ({
	toast: { success: mocks.success, error: mocks.error },
}));

import { SharedReportView } from "./projects/shared-report-view";
import { ReportDocumentExportButtons } from "./report-document-export-buttons";

const document: ReportDocument = {
	title: "Project A",
	fileStem: "project-a",
	facts: [],
	tables: [],
	notes: [],
	footer: "Z8",
	unknownLabel: "Unknown",
};
const build = () => document;
let click: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
	vi.clearAllMocks();
	vi.stubGlobal(
		"URL",
		Object.assign(URL, {
			createObjectURL: vi.fn(() => "blob:fixture"),
			revokeObjectURL: vi.fn(),
		}),
	);
	click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
});
afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

it("keeps anonymous frozen-report export controls available and renders their trimmed report scope", async () => {
	mocks.pdf.mockResolvedValue(new Uint8Array([37, 80, 68, 70]));
	render(
		<SharedReportView
			locale="en"
			organizationName="Synthetic organization"
			organizationTimeZone="Europe/Berlin"
			creatorName="Synthetic sharer"
			createdAt="2026-11-10T10:00:00Z"
			expiresAt="2026-12-10T10:00:00Z"
			snapshot={{
				kind: "project",
				project: { name: "Frozen Delivery", customer: null },
				period: { startDate: "2026-11-01", endDate: "2026-11-30" },
				summary: { totalMinutes: 300, workPeriodCount: 2 },
				employeeBreakdown: [],
				timeSeries: [{ date: "2026-11-10", hours: 5 }],
			}}
		/>,
	);
	expect(screen.getByRole("heading", { level: 1 }).textContent).toContain("Project report");
	expect(screen.getAllByText("Frozen Delivery").length).toBeGreaterThan(0);
	expect(screen.queryByText("Cost")).toBeNull();
	expect(screen.queryByText("Margin")).toBeNull();
	expect(screen.getByRole("button", { name: "Export Excel" })).toBeTruthy();
	expect(screen.getByRole("button", { name: "Export CSV" })).toBeTruthy();
	fireEvent.click(screen.getByRole("button", { name: "Export PDF" }));
	await waitFor(() => expect(click).toHaveBeenCalledTimes(1));
	expect(mocks.pdf.mock.calls[0][0].facts).toContainEqual({
		label: "Project",
		value: "Frozen Delivery",
	});
});

it.each(["unmount", "Activity", "replacement"])(
	"retires a pending anonymous export on %s and allows a fresh deliberate download",
	async (kind) => {
		let finish!: (value: Uint8Array) => void;
		mocks.pdf
			.mockReturnValueOnce(
				new Promise((done) => {
					finish = done;
				}),
			)
			.mockResolvedValue(new Uint8Array([37, 80, 68, 70]));
		const tree = (builder = build, mode: "visible" | "hidden" = "visible") => (
			<Activity mode={mode}>
				<ReportDocumentExportButtons buildDocument={builder} />
			</Activity>
		);
		const view = render(tree());
		fireEvent.click(screen.getByRole("button", { name: "Export PDF" }));
		await waitFor(() => expect(mocks.pdf).toHaveBeenCalledTimes(1));
		if (kind === "unmount") view.unmount();
		else if (kind === "Activity") {
			view.rerender(tree(build, "hidden"));
			view.rerender(tree());
		} else view.rerender(tree(() => ({ ...document, title: "Project B" })));
		await act(async () => finish(new Uint8Array([37, 80, 68, 70])));
		expect(click).not.toHaveBeenCalled();
		expect(mocks.success).not.toHaveBeenCalled();
		if (kind === "unmount") render(tree());
		fireEvent.click(screen.getByRole("button", { name: "Export PDF" }));
		await waitFor(() => expect(click).toHaveBeenCalledTimes(1));
		expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:fixture");
	},
);
