"use client";

import { Download, FileSpreadsheet, FileText } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { exportToCSV, generateCSVFilename } from "@/lib/reports/exporters/csv-exporter";
import { exportToExcel, generateExcelFilename } from "@/lib/reports/exporters/excel-exporter";
import type { ReportData } from "@/lib/reports/types";

interface ExportButtonsProps {
	reportData: ReportData;
}

type ExportFormat = "pdf" | "excel" | "csv";

export function ExportButtons({ reportData }: ExportButtonsProps) {
	const [loading, setLoading] = useState<ExportFormat | null>(null);

	const handleExport = async (format: ExportFormat) => {
		setLoading(format);

		try {
			let data: Uint8Array | Buffer | string;
			let filename: string;
			let mimeType: string;

			if (format === "pdf") {
				// Dynamic import to avoid bundling @react-pdf/renderer in the main bundle
				const { exportToPDF, generatePDFFilename } = await import(
					"@/lib/reports/exporters/pdf-exporter"
				);
				data = await exportToPDF(reportData);
				filename = generatePDFFilename(reportData);
				mimeType = "application/pdf";
			} else if (format === "excel") {
				data = await exportToExcel(reportData);
				filename = generateExcelFilename(reportData);
				mimeType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
			} else {
				data = exportToCSV(reportData);
				filename = generateCSVFilename(reportData);
				mimeType = "text/csv;charset=utf-8;";
			}

			// Create blob and download
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
		} catch (error) {
			console.error("Export failed:", error);
			toast.error("Export failed", {
				description:
					error instanceof Error ? error.message : "An error occurred while exporting the report",
			});
		} finally {
			setLoading(null);
		}
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
