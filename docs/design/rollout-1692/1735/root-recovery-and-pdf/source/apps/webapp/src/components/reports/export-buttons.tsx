"use client";

import {
	IconDownload,
	IconFileSpreadsheet,
	IconFileText,
} from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useLayoutEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useDisplayContext } from "@/hooks/use-display-context";
import { systemClock } from "@/lib/datetime/temporal-core";
import {
	exportToCSV,
	generateCSVFilename,
} from "@/lib/reports/exporters/csv-exporter";
import {
	exportToPDF,
	generatePDFFilename,
} from "@/lib/reports/exporters/pdf-exporter";
import type { ReportData } from "@/lib/reports/types";

interface ExportButtonsProps {
	reportData: ReportData;
	disabled?: boolean;
	exportScope?: string;
	isCurrent?: () => boolean;
}

type ExportFormat = "pdf" | "excel" | "csv";

function loadExcelExporter() {
	return import("@/lib/reports/exporters/excel-exporter");
}

export function ExportButtons({
	reportData,
	disabled = false,
	exportScope,
	isCurrent,
}: ExportButtonsProps) {
	const { t } = useTranslate();
	const displayContext = useDisplayContext();
	const [loading, setLoading] = useState<ExportFormat | null>(null);
	const arrival = useRef<symbol | null>(null);
	const running = useRef(false);
	// react-doctor-disable-next-line react-doctor/no-reset-all-state-on-prop-change -- Only pending export feedback resets when its snapshot or arrival retires, never a user draft.
	useLayoutEffect(() => {
		arrival.current = Symbol(
			`${exportScope}:${reportData.employee.id}:${disabled}`,
		);
		running.current = false;
		// react-doctor-disable-next-line react-hooks-js/set-state-in-effect -- A reconnected Activity or replacement report must release canceled export controls.
		setLoading(null);
		return () => {
			arrival.current = null;
		};
	}, [reportData, disabled, exportScope]);

	const handleExport = async (format: ExportFormat) => {
		if (
			disabled ||
			running.current ||
			!arrival.current ||
			isCurrent?.() === false
		)
			return;
		const owner = arrival.current;
		running.current = true;
		setLoading(format);
		const generatedAt = systemClock.nowInstant().toString();

		const exportResult = await (async () => {
			if (format === "pdf") {
				return {
					data: await exportToPDF(reportData, {
						...displayContext,
						generatedAt,
					}),
					filename: generatePDFFilename(reportData),
					mimeType: "application/pdf",
				};
			}

			if (format === "excel") {
				const { exportToExcel, generateExcelFilename } =
					await loadExcelExporter();
				return {
					data: await exportToExcel(reportData),
					filename: generateExcelFilename(reportData),
					mimeType:
						"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
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
		if (arrival.current !== owner || isCurrent?.() === false) return;
		running.current = false;

		if (!exportResult.ok) {
			console.error("Export failed:", exportResult.error);
			toast.error(t("reports.export.failed", "Export failed"), {
				description:
					exportResult.error instanceof Error
						? exportResult.error.message
						: t(
								"reports.export.errorDescription",
								"An error occurred while exporting the report",
							),
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
			description: t("reports.export.downloaded", "Downloaded {filename}", {
				filename,
			}),
		});
		setLoading(null);
	};

	return (
		<div className="flex flex-wrap gap-2">
			<Button
				onClick={() => handleExport("pdf")}
				disabled={disabled || loading !== null}
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
				disabled={disabled || loading !== null}
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
				disabled={disabled || loading !== null}
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
