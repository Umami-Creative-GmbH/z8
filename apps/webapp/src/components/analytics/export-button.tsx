"use client";

import {
	IconDownload,
	IconFileTypeCsv,
	IconFileTypeXls,
	IconLoader2,
} from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export type ExportFormat = "csv" | "excel";

export type ExportData<T = any> = {
	data: T[];
	headers: Array<{
		key: keyof T;
		label: string;
	}>;
	filename: string;
};

interface ExportButtonProps<T = any> {
	data: ExportData<T>;
	onExport?: (format: ExportFormat) => Promise<void>;
	disabled?: boolean;
	/** Opt-in identity for a route-owned organization/period result. */
	exportScope?: string;
}

export function ExportButton<T = any>({
	data,
	onExport,
	disabled,
	exportScope,
}: ExportButtonProps<T>) {
	const { t } = useTranslate();
	const [isExporting, setIsExporting] = useState(false);
	const [exportingFormat, setExportingFormat] = useState<ExportFormat | null>(
		null,
	);
	const mounted = useRef(true);
	const current = useRef({ disabled, exportScope });
	useLayoutEffect(() => {
		current.current = { disabled, exportScope };
	}, [disabled, exportScope]);
	useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
		};
	}, []);

	const handleExport = async (format: ExportFormat) => {
		if (disabled || isExporting) return;
		setIsExporting(true);
		setExportingFormat(format);

		const exportResult = await (async () => {
			if (onExport) {
				await onExport(format);
				return { type: "custom" as const };
			}

			const response = await fetch("/api/analytics/export", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					format,
					data: data.data,
					headers: data.headers,
					filename: data.filename,
				}),
			});

			if (!response.ok) {
				return { type: "error" as const, message: response.statusText };
			}

			return { type: "blob" as const, blob: await response.blob() };
		})().then(
			(value) => ({ ok: true as const, value }),
			(error) => ({ ok: false as const, error }),
		);
		// A completed transport must still belong to the admitted route and period.
		if (!mounted.current) return;
		if (
			current.current.disabled ||
			current.current.exportScope !== exportScope
		) {
			setIsExporting(false);
			setExportingFormat(null);
			return;
		}

		if (!exportResult.ok) {
			console.error("Export failed:", exportResult.error);
			toast.error(
				t(
					"common:analytics.export.failedAsFormat",
					"Failed to export as {format}",
					{
						format: format.toUpperCase(),
					},
				),
			);
			setIsExporting(false);
			setExportingFormat(null);
			return;
		}

		if (exportResult.value.type === "error") {
			console.error("Export failed:", exportResult.value.message);
			toast.error(
				t(
					"common:analytics.export.failedAsFormat",
					"Failed to export as {format}",
					{
						format: format.toUpperCase(),
					},
				),
			);
			setIsExporting(false);
			setExportingFormat(null);
			return;
		}

		if (exportResult.value.type === "blob") {
			const url = window.URL.createObjectURL(exportResult.value.blob);
			const link = document.createElement("a");
			link.href = url;

			const extension = format === "csv" ? "csv" : "xlsx";
			link.download = `${data.filename}.${extension}`;

			document.body.appendChild(link);
			link.click();
			document.body.removeChild(link);
			window.URL.revokeObjectURL(url);
		}

		toast.success(
			t("common:analytics.export.exportedAsFormat", "Exported as {format}", {
				format: format.toUpperCase(),
			}),
		);
		setIsExporting(false);
		setExportingFormat(null);
	};

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button variant="outline" size="sm" disabled={disabled || isExporting}>
					{isExporting ? (
						<>
							<IconLoader2 className="mr-2 size-4 animate-spin" />
							{t(
								"common:analytics.export.exportingFormat",
								"Exporting {format}…",
								{
									format: exportingFormat?.toUpperCase() ?? "",
								},
							)}
						</>
					) : (
						<>
							<IconDownload className="mr-2 size-4" />
							{t("common:analytics.export.export", "Export")}
						</>
					)}
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end">
				<DropdownMenuItem
					onClick={() => handleExport("csv")}
					disabled={disabled || isExporting}
				>
					<IconFileTypeCsv className="mr-2 size-4" />
					{t("common:analytics.export.exportAsCsv", "Export as CSV")}
				</DropdownMenuItem>
				<DropdownMenuItem
					onClick={() => handleExport("excel")}
					disabled={disabled || isExporting}
				>
					<IconFileTypeXls className="mr-2 size-4" />
					{t("common:analytics.export.exportAsExcel", "Export as Excel")}
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
