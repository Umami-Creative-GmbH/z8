/* @vitest-environment jsdom */

import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReportData } from "@/lib/reports/types";

const mocks = vi.hoisted(() => ({
	excelEvaluated: false,
	excel: vi.fn(),
	csv: vi.fn(),
	pdf: vi.fn(),
	error: vi.fn(),
	success: vi.fn(),
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));
vi.mock("@/hooks/use-display-context", () => ({
	useDisplayContext: () => ({
		locale: "en-US",
		timezone: "Europe/Berlin",
		timeFormat: "24h",
	}),
}));
vi.mock("@/lib/datetime/temporal-core", () => ({
	systemClock: {
		nowInstant: () => ({ toString: () => "2026-10-02T12:00:00Z" }),
	},
}));
vi.mock("sonner", () => ({
	toast: { error: mocks.error, success: mocks.success },
}));
vi.mock("@/lib/reports/exporters/csv-exporter", () => ({
	exportToCSV: mocks.csv,
	generateCSVFilename: () => "report-fixture-user-1790942400000.csv",
}));
vi.mock("@/lib/reports/exporters/pdf-exporter", () => ({
	exportToPDF: mocks.pdf,
	generatePDFFilename: () => "report-fixture-user-1790942400000.pdf",
}));

const reportData: ReportData = {
	employee: { id: "fictional-employee", name: "Fixture User" },
	period: {
		startDate: "2026-09-01",
		endDate: "2026-09-30",
		label: "September 2026",
	},
	workHours: {
		totalHours: 16,
		totalMinutes: 960,
		workDays: 2,
		averagePerDay: 8,
		byMonth: new Map([["2026-09", { hours: 16, days: 2 }]]),
	},
	absences: {
		totalDays: 1,
		byCategory: new Map([["Vacation", { days: 1 }]]),
		vacation: { approved: 1, pending: 0 },
		sick: { approved: 0, pending: 0 },
		homeOffice: {
			days: 1,
			hoursWorked: 8,
			dateDetails: [{ date: "2026-09-10", hours: 8 }],
		},
		other: { approved: 0, pending: 0 },
	},
	complianceMetrics: {
		attendancePercentage: 100,
		overtimeMinutes: 0,
		underTimeMinutes: 0,
	},
};

function mockExcelModule() {
	vi.doMock("@/lib/reports/exporters/excel-exporter", () => {
		mocks.excelEvaluated = true;
		return {
			exportToExcel: mocks.excel,
			generateExcelFilename: () => "report-fixture-user-1790942400000.xlsx",
		};
	});
}

async function mount() {
	const { ExportButtons } = await import("./export-buttons");
	render(<ExportButtons reportData={reportData} />);
}

function readBlob(blob: Blob): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(String(reader.result));
		reader.onerror = () => reject(reader.error);
		reader.readAsText(blob);
	});
}

describe("ExportButtons", () => {
	const downloads: HTMLAnchorElement[] = [];
	const createURL = vi.fn<(blob: Blob) => string>();
	const revokeURL = vi.fn();

	beforeEach(() => {
		vi.resetModules();
		vi.clearAllMocks();
		mocks.excelEvaluated = false;
		mocks.excel.mockResolvedValue(Buffer.from("fixture workbook"));
		mocks.csv.mockReturnValue("Employee,Hours\nFixture User,16");
		mocks.pdf.mockResolvedValue("%PDF-fixture-report");
		mockExcelModule();
		downloads.length = 0;
		createURL.mockReturnValue("blob:fixture");
		vi.stubGlobal(
			"URL",
			class extends URL {
				static createObjectURL = createURL;
				static revokeObjectURL = revokeURL;
			},
		);
		vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
			this: HTMLAnchorElement,
		) {
			downloads.push(this);
		});
		vi.spyOn(console, "error").mockImplementation(() => {});
	});

	afterEach(() => {
		cleanup();
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});

	it("mounts without evaluating the Excel module", async () => {
		await mount();
		expect(screen.getAllByRole("button")).toHaveLength(3);
		expect(mocks.excelEvaluated).toBe(false);
	});

	it.each([
		[
			"CSV",
			"csv",
			"text/csv;charset=utf-8;",
			"Employee,Hours\nFixture User,16",
		],
		["PDF", "pdf", "application/pdf", "%PDF-fixture-report"],
	])(
		"exports %s content and cleans up without evaluating Excel",
		async (label, extension, mime, content) => {
			await mount();
			fireEvent.click(screen.getByRole("button", { name: `Export ${label}` }));
			await waitFor(() => expect(downloads).toHaveLength(1));
			expect(mocks.excelEvaluated).toBe(false);
			expect(downloads[0].download).toBe(
				`report-fixture-user-1790942400000.${extension}`,
			);
			const blob = createURL.mock.calls[0][0];
			expect(blob.type).toBe(mime);
			expect(await readBlob(blob)).toBe(content);
			expect(downloads[0].isConnected).toBe(false);
			expect(revokeURL).toHaveBeenCalledWith("blob:fixture");
			if (label === "PDF")
				expect(mocks.pdf).toHaveBeenCalledWith(reportData, {
					locale: "en-US",
					timezone: "Europe/Berlin",
					timeFormat: "24h",
					generatedAt: "2026-10-02T12:00:00Z",
				});
		},
	);

	it("loads Excel on click, holds all controls, and cleans up repeated downloads", async () => {
		createURL
			.mockReturnValueOnce("blob:first")
			.mockReturnValueOnce("blob:second");
		let finish!: (value: Buffer) => void;
		mocks.excel.mockImplementationOnce(
			() =>
				new Promise<Buffer>((resolve) => {
					finish = resolve;
				}),
		);
		await mount();
		const button = screen.getByRole("button", { name: "Export Excel" });
		fireEvent.click(button);
		await waitFor(() => expect(mocks.excel).toHaveBeenCalledWith(reportData));
		expect(mocks.excelEvaluated).toBe(true);
		for (const control of screen.getAllByRole("button"))
			expect(control).toHaveProperty("disabled", true);
		expect(createURL).not.toHaveBeenCalled();
		await act(async () => finish(Buffer.from("fixture workbook")));
		expect(button).toHaveProperty("disabled", false);
		fireEvent.click(button);
		await waitFor(() => expect(downloads).toHaveLength(2));
		for (const anchor of downloads) {
			expect(anchor.download).toMatch(/^report-fixture-user-\d+\.xlsx$/);
			expect(anchor.download).toBe("report-fixture-user-1790942400000.xlsx");
			expect(anchor.isConnected).toBe(false);
		}
		for (const [blob] of createURL.mock.calls) {
			expect(blob.type).toBe(
				"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
			);
			expect(await readBlob(blob)).toBe("fixture workbook");
		}
		expect(downloads.map((anchor) => anchor.href)).toEqual([
			"blob:first",
			"blob:second",
		]);
		expect(revokeURL.mock.calls).toEqual([["blob:first"], ["blob:second"]]);
		expect(mocks.success).toHaveBeenCalledTimes(2);
		expect(mocks.error).not.toHaveBeenCalled();
	});

	it("restores controls after a rejected Excel import and permits retry", async () => {
		await mount();
		vi.doMock("@/lib/reports/exporters/excel-exporter", async () => {
			throw new Error("Excel chunk unavailable");
		});
		const button = screen.getByRole("button", { name: "Export Excel" });
		fireEvent.click(button);
		// Vitest wraps rejected module factories; the handler displays the import error's message.
		await waitFor(() =>
			expect(mocks.error).toHaveBeenCalledWith("Export failed", {
				description: expect.any(String),
			}),
		);
		const importError = vi.mocked(console.error).mock.calls[0][1] as Error;
		expect(importError.cause).toEqual(new Error("Excel chunk unavailable"));
		expect(mocks.error.mock.calls[0][1].description).toBe(importError.message);
		for (const control of screen.getAllByRole("button"))
			expect(control).toHaveProperty("disabled", false);
		expect(mocks.excel).not.toHaveBeenCalled();
		expect(createURL).not.toHaveBeenCalled();
		expect(revokeURL).not.toHaveBeenCalled();
		// Restore module availability without remounting; actual browser chunk retry is a separate gate.
		mockExcelModule();
		fireEvent.click(button);
		await waitFor(() => expect(downloads).toHaveLength(1));
		expect(button).toHaveProperty("disabled", false);
		expect(revokeURL).toHaveBeenCalledWith("blob:fixture");
	});

	it("disables all controls while the Excel module is still loading", async () => {
		let finishImport!: () => void;
		vi.doMock("@/lib/reports/exporters/excel-exporter", async () => {
			await new Promise<void>((resolve) => {
				finishImport = resolve;
			});
			return {
				exportToExcel: mocks.excel,
				generateExcelFilename: () => "report-fixture-user-1790942400000.xlsx",
			};
		});
		await mount();
		fireEvent.click(screen.getByRole("button", { name: "Export Excel" }));
		await waitFor(() => expect(finishImport).toBeTypeOf("function"));
		for (const control of screen.getAllByRole("button"))
			expect(control).toHaveProperty("disabled", true);
		expect(createURL).not.toHaveBeenCalled();
		await act(async () => finishImport());
		await waitFor(() => expect(downloads).toHaveLength(1));
		for (const control of screen.getAllByRole("button"))
			expect(control).toHaveProperty("disabled", false);
	});

	it("restores controls after workbook generation rejects and permits retry without leaking URLs", async () => {
		mocks.excel.mockRejectedValueOnce(new Error("Workbook generation failed"));
		await mount();
		const button = screen.getByRole("button", { name: "Export Excel" });
		fireEvent.click(button);
		await waitFor(() =>
			expect(mocks.error).toHaveBeenCalledWith("Export failed", {
				description: "Workbook generation failed",
			}),
		);
		for (const control of screen.getAllByRole("button"))
			expect(control).toHaveProperty("disabled", false);
		expect(createURL).not.toHaveBeenCalled();
		expect(revokeURL).not.toHaveBeenCalled();
		fireEvent.click(button);
		await waitFor(() => expect(downloads).toHaveLength(1));
		expect(button).toHaveProperty("disabled", false);
		expect(revokeURL).toHaveBeenCalledTimes(1);
	});
});
