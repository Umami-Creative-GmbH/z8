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
}));

import { ExportHistory } from "./export-history";

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
	filters: {
		dateRange: {
			start: "2026-06-01T00:00:00.000Z",
			end: "2026-06-30T23:59:59.999Z",
		},
	},
};

describe("ExportHistory", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		getExportDownloadUrlActionMock.mockResolvedValue({
			success: true,
			data: "https://storage.example.test/signed-export",
		});
	});

	it("opens the signed export URL without giving the new page opener access", async () => {
		const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);

		render(
			<ExportHistory organizationId="org-1" exports={[completedExport]} />,
		);

		fireEvent.click(screen.getByRole("button", { name: "Download export" }));

		await waitFor(() => {
			expect(getExportDownloadUrlActionMock).toHaveBeenCalledWith(
				"org-1",
				"job-1",
			);
			expect(openSpy).toHaveBeenCalledWith(
				"https://storage.example.test/signed-export",
				"_blank",
				"noopener,noreferrer",
			);
		});
	});
});
