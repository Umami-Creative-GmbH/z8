"use client";

import { Download, FileSpreadsheet, FileText } from "lucide-react";
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
			toast.error("Export failed", {
				description:
					exportResult.error instanceof Error
						? exportResult.error.message
						: "An error occurred while exporting the report",
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

		toast.success("Export successful", {
			description: `Downloaded ${filename}`,
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
				<FileText className="mr-2 h-4 w-4" />
				{loading === "pdf" ? "Generating..." : "Export PDF"}
			</Button>

			<Button
				onClick={() => handleExport("excel")}
				disabled={loading !== null}
				variant="outline"
				size="lg"
			>
				<FileSpreadsheet className="mr-2 h-4 w-4" />
				{loading === "excel" ? "Generating..." : "Export Excel"}
			</Button>

			<Button
				onClick={() => handleExport("csv")}
				disabled={loading !== null}
				variant="outline"
				size="lg"
			>
				<Download className="mr-2 h-4 w-4" />
				{loading === "csv" ? "Generating..." : "Export CSV"}
			</Button>
		</div>
	);
}
