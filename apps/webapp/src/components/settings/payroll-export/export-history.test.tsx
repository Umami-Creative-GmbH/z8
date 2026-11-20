/* @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PayrollExportJobSummary } from "@/lib/payroll-export/types";

const { getExportDownloadUrlActionMock } = vi.hoisted(() => ({
	getExportDownloadUrlActionMock: vi.fn(),
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, defaultValue?: string) => defaultValue ?? _key,
	}),
}));

vi.mock("@/app/[locale]/(app)/settings/payroll-export/actions", () => ({
	getExportDownloadUrlAction: getExportDownloadUrlActionMock,
	discardPayrollRunAction: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
const localeState = vi.hoisted(() => ({ locale: "en" }));
vi.mock("next-intl", () => ({ useLocale: () => localeState.locale }));

import { ExportHistory } from "./export-history";
import {
	createPayrollExportTimeFormatter,
	formatPayrollExportRange,
} from "./export-history-format";

const completedExport: PayrollExportJobSummary = {
	id: "job-1",
	status: "completed",
	fileName: "payroll-export.csv",
	fileSizeBytes: 1024,
	workPeriodCount: 3,
	employeeCount: 2,
	createdAt: new Date("2026-07-01T10:00:00.000Z"),
	completedAt: new Date("2026-07-01T10:01:00.000Z"),
	errorMessage: null,
	payrollRunIncludedReports: 0,
	unmappedOvertimePayoutCount: 0,
	settledDaysLeftOut: 0,
	includesSettledDays: false,
	filters: {
		dateRange: {
			start: "2026-06-01T00:00:00.000Z",
			end: "2026-06-30T23:59:59.999Z",
		},
	},
};

describe("formatPayrollExportRange", () => {
	it("names a whole calendar month in the reader's locale", () => {
		expect(formatPayrollExportRange(completedExport.filters, "en")).toBe("June 2026");
		expect(formatPayrollExportRange(completedExport.filters, "de")).toBe("Juni 2026");
	});

	it("reads the logical dates, not the instant, of an offset-stamped bound", () => {
		expect(
			formatPayrollExportRange(
				{
					dateRange: {
						start: "2026-06-01T00:00:00.000+02:00",
						end: "2026-06-30T00:00:00.000+02:00",
					},
				},
				"en",
			),
		).toBe("June 2026");
	});

	it("shows a partial range as its dates", () => {
		const label = formatPayrollExportRange(
			{ dateRange: { start: "2026-06-03", end: "2026-06-17" } },
			"en",
		);
		expect(label).toMatch(/Jun/);
		expect(label).toMatch(/3/);
		expect(label).toMatch(/17/);
		expect(label).not.toBe("June 2026");
	});
});

describe("createPayrollExportTimeFormatter", () => {
	it("shows the creation instant in the organization's zone with the zone named", () => {
		const format = createPayrollExportTimeFormatter("en", "America/New_York");
		const label = format(new Date("2026-07-01T10:00:00.000Z"));

		expect(label).toContain("06:00");
		expect(label).toMatch(/EDT|GMT-4/);
	});

	it("follows the reader's locale", () => {
		const format = createPayrollExportTimeFormatter("de", "Europe/Berlin");
		const label = format("2026-07-01T10:00:00.000Z");

		expect(label).toContain("12:00");
		expect(label).toMatch(/Juli|Jul/);
		expect(label).toMatch(/MESZ|GMT\+2/);
	});
});

describe("ExportHistory", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		localeState.locale = "en";
		getExportDownloadUrlActionMock.mockResolvedValue({
			success: true,
			data: "https://storage.example.test/signed-export",
		});
	});

	it("opens the signed export URL without giving the new page opener access", async () => {
		const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);

		render(
			<ExportHistory exports={[completedExport]} organizationTimezone="Europe/Berlin" />,
		);

		fireEvent.click(screen.getByRole("button", { name: "Download export" }));

		await waitFor(() => {
			expect(getExportDownloadUrlActionMock).toHaveBeenCalledWith({ jobId: "job-1" });
			expect(openSpy).toHaveBeenCalledWith(
				"https://storage.example.test/signed-export",
				"_blank",
				"noopener,noreferrer",
			);
		});
	});

	it("reports the overtime payouts an export left out for want of a wage type (#1001)", () => {
		const { rerender } = render(
			<ExportHistory exports={[completedExport]} organizationTimezone="Europe/Berlin" />,
		);
		expect(screen.queryByText(/not exported/)).toBeNull();

		rerender(
			<ExportHistory
				exports={[{ ...completedExport, unmappedOvertimePayoutCount: 2 }]}
				organizationTimezone="Europe/Berlin"
			/>,
		);

		expect(screen.getByText(/overtime payouts}} not exported/)).toBeTruthy();
	});

	it("shows the period as a month and the creation time in the organization's zone", () => {
		render(<ExportHistory exports={[completedExport]} organizationTimezone="Asia/Tokyo" />);

		expect(screen.getByText("June 2026")).toBeTruthy();
		const created = screen.getByText(/07:00\sPM|19:00/);
		expect(created.tagName).toBe("TIME");
		expect(created.getAttribute("datetime")).toBe("2026-07-01T10:00:00.000Z");
		expect(created.textContent).toMatch(/GMT\+9|JST/);
	});
});
