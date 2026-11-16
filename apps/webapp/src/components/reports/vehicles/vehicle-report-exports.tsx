"use client";

import { IconDownload, IconFileSpreadsheet, IconFileText } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { type ReportDocument, reportFileName } from "@/lib/reports/exporters/report-document";

type Format = "pdf" | "xlsx" | "csv";

// Vehicle-only lifetime control. Shared project/customer/snapshot export controls
// remain with their owner; all three file serializers and the document are canonical.
export function VehicleReportExports({
	buildDocument,
	isCurrent,
}: {
	buildDocument: () => ReportDocument;
	isCurrent: () => boolean;
}) {
	const { t } = useTranslate();
	const [loading, setLoading] = useState<Format | null>(null);
	const [error, setError] = useState<string | null>(null);
	const active = useRef<{ active: boolean }>({ active: false });
	const pending = useRef<object | null>(null);
	useEffect(() => {
		const arrival = { active: true };
		active.current = arrival;
		pending.current = null;
		setLoading(null);
		return () => {
			arrival.active = false;
		};
	}, []);
	async function download(format: Format) {
		const arrival = active.current;
		if (!arrival.active || !isCurrent() || pending.current) return;
		const request = {};
		pending.current = request;
		setLoading(format);
		setError(null);
		try {
			const document = buildDocument();
			const data =
				format === "pdf"
					? await (
							await import("@/lib/reports/exporters/report-document-pdf")
						).exportReportDocumentToPDF(document)
					: format === "xlsx"
						? await (
								await import("@/lib/reports/exporters/report-document-excel")
							).exportReportDocumentToExcel(document)
						: (
								await import("@/lib/reports/exporters/report-document-csv")
							).exportReportDocumentToCSV(document);
			if (!arrival.active || !isCurrent() || pending.current !== request) return;
			const type =
				format === "pdf"
					? "application/pdf"
					: format === "xlsx"
						? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
						: "text/csv;charset=utf-8;";
			const url = URL.createObjectURL(new Blob([data as BlobPart], { type }));
			try {
				const anchor = window.document.createElement("a");
				anchor.href = url;
				anchor.download = reportFileName(document, format);
				window.document.body.appendChild(anchor);
				anchor.click();
				anchor.remove();
				toast.success(t("reports.export.success", "Export successful"), {
					description: t("reports.export.downloaded", "Downloaded {filename}", {
						filename: anchor.download,
					}),
				});
			} finally {
				// Give the browser's download task time to consume the blob.
				window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
			}
		} catch (cause) {
			if (arrival.active && pending.current === request)
				setError(
					cause instanceof Error
						? cause.message
						: t("reports.export.errorDescription", "An error occurred while exporting the report"),
				);
		} finally {
			if (arrival.active && pending.current === request) {
				pending.current = null;
				setLoading(null);
			}
		}
	}
	return (
		<div className="space-y-2">
			<div className="flex flex-wrap gap-2">
				<Button
					type="button"
					variant="outline"
					disabled={loading !== null}
					onClick={() => void download("pdf")}
				>
					<IconFileText aria-hidden="true" className="size-4" />
					{loading === "pdf"
						? t("reports.export.generating", "Generating...")
						: t("reports.export.pdf", "Export PDF")}
				</Button>
				<Button
					type="button"
					variant="outline"
					disabled={loading !== null}
					onClick={() => void download("xlsx")}
				>
					<IconFileSpreadsheet aria-hidden="true" className="size-4" />
					{loading === "xlsx"
						? t("reports.export.generating", "Generating...")
						: t("reports.export.excel", "Export Excel")}
				</Button>
				<Button
					type="button"
					variant="outline"
					disabled={loading !== null}
					onClick={() => void download("csv")}
				>
					<IconDownload aria-hidden="true" className="size-4" />
					{loading === "csv"
						? t("reports.export.generating", "Generating...")
						: t("reports.export.csv", "Export CSV")}
				</Button>
			</div>
			{error && (
				<p role="alert">
					{t("reports.export.failed", "Export failed")}: {error}
				</p>
			)}
		</div>
	);
}
