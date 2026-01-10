"use client";

import { IconDownload, IconFileTypeCsv, IconFileTypeXls, IconLoader2 } from "@tabler/icons-react";
import { useState } from "react";
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
}

export function ExportButton<T = any>({ data, onExport, disabled }: ExportButtonProps<T>) {
	const [isExporting, setIsExporting] = useState(false);
	const [exportingFormat, setExportingFormat] = useState<ExportFormat | null>(null);

	const handleExport = async (format: ExportFormat) => {
		try {
			setIsExporting(true);
			setExportingFormat(format);

			// If custom onExport provided, use it
			if (onExport) {
				await onExport(format);
				toast.success(`Exported as ${format.toUpperCase()}`);
				return;
			}

			// Default export implementation via API
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
				throw new Error(`Export failed: ${response.statusText}`);
			}

			// Get the blob from response
			const blob = await response.blob();

			// Create download link
			const url = window.URL.createObjectURL(blob);
			const link = document.createElement("a");
			link.href = url;

			// Set filename based on format
			const extension = format === "csv" ? "csv" : "xlsx";
			link.download = `${data.filename}.${extension}`;

			// Trigger download
			document.body.appendChild(link);
			link.click();

			// Cleanup
			document.body.removeChild(link);
			window.URL.revokeObjectURL(url);

			toast.success(`Exported as ${format.toUpperCase()}`);
		} catch (error) {
			console.error("Export failed:", error);
			toast.error(`Failed to export as ${format.toUpperCase()}`);
		} finally {
			setIsExporting(false);
			setExportingFormat(null);
		}
	};

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button variant="outline" size="sm" disabled={disabled || isExporting}>
					{isExporting ? (
						<>
							<IconLoader2 className="mr-2 size-4 animate-spin" />
							Exporting {exportingFormat?.toUpperCase()}...
						</>
					) : (
						<>
							<IconDownload className="mr-2 size-4" />
							Export
						</>
					)}
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end">
				<DropdownMenuItem onClick={() => handleExport("csv")} disabled={isExporting}>
					<IconFileTypeCsv className="mr-2 size-4" />
					Export as CSV
				</DropdownMenuItem>
				<DropdownMenuItem onClick={() => handleExport("excel")} disabled={isExporting}>
					<IconFileTypeXls className="mr-2 size-4" />
					Export as Excel
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
