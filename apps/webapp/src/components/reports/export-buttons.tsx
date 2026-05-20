"use client";

import { IconDownload, IconFileSpreadsheet, IconFileText } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { exportToCSV, generateCSVFilename } from "@/lib/reports/exporters/csv-exporter";
import { exportToExcel, generateExcelFilename } from "@/lib/reports/exporters/excel-exporter";
import { exportToPDF, generatePDFFilename } from "@/lib/reports/exporters/pdf-exporter";
import type { ReportData } from "@/lib/reports/types";

interface ExportButtonsProps {
	reportData: ReportData;
}

type ExportFormat = "pdf" | "excel" | "csv";

export function ExportButtons({ reportData }: ExportButtonsProps) {
	const { t } = useTranslate();
	const [loading, setLoading] = useState<ExportFormat | null>(null);

	const handleExport = async (format: ExportFormat) => {
		setLoading(format);

		const exportResult = await (async () => {
			if (format === "pdf") {
				return {
					data: await exportToPDF(reportData),
					filename: generatePDFFilename(reportData),
					mimeType: "application/pdf",
				};
			}

			if (format === "excel") {
				return {
					data: await exportToExcel(reportData),
					filename: generateExcelFilename(reportData),
					mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
				};
			}

			return {
				data: exportToCSV(reportData),
				filename: generateCSVFilename(reportData),
				mimeType: "text/csv;charset=utf-8;",
			};
		})().then(
			(value) => ({ ok: true as const, value }),
			(error) => ({ ok: false as const, error }),
		);

		if (!exportResult.ok) {
			console.error("Export failed:", exportResult.error);
			toast.error(t("reports.export.failed", "Export failed"), {
				description:
					exportResult.error instanceof Error
						? exportResult.error.message
						: t("reports.export.errorDescription", "An error occurred while exporting the report"),
			});
			setLoading(null);
			return;
		}

		const { data, filename, mimeType } = exportResult.value;
		const blob = new Blob([data as BlobPart], { type: mimeType });
		const url = URL.createObjectURL(blob);
		const a = document.createElement("a");
		a.href = url;
		a.download = filename;
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
		URL.revokeObjectURL(url);

		toast.success(t("reports.export.success", "Export successful"), {
			description: t("reports.export.downloaded", "Downloaded {filename}", { filename }),
		});
		setLoading(null);
	};

	return (
		<div className="flex flex-wrap gap-2">
			<Button
				onClick={() => handleExport("pdf")}
				disabled={loading !== null}
				variant="default"
				size="lg"
			>
				<IconFileText className="mr-2 size-4" />
				{loading === "pdf"
					? t("reports.export.generating", "Generating...")
					: t("reports.export.pdf", "Export PDF")}
			</Button>

			<Button
				onClick={() => handleExport("excel")}
				disabled={loading !== null}
				variant="outline"
				size="lg"
			>
				<IconFileSpreadsheet className="mr-2 size-4" />
				{loading === "excel"
					? t("reports.export.generating", "Generating...")
					: t("reports.export.excel", "Export Excel")}
			</Button>

			<Button
				onClick={() => handleExport("csv")}
				disabled={loading !== null}
				variant="outline"
				size="lg"
			>
				<IconDownload className="mr-2 size-4" />
				{loading === "csv"
					? t("reports.export.generating", "Generating...")
					: t("reports.export.csv", "Export CSV")}
			</Button>
		</div>
	);
}
