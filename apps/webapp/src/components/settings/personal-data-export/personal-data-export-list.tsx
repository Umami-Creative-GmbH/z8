"use client";

import { IconDownload, IconLoader2 } from "@tabler/icons-react";
import { useState } from "react";
import { toast } from "sonner";
import { getPersonalDataExportDownloadUrl } from "@/app/[locale]/(app)/settings/my-data/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useDisplayContext } from "@/hooks/use-display-context";
import { parseInstant } from "@/lib/datetime/temporal-core";
import { formatInstant } from "@/lib/datetime/temporal-format";
import { formatFileSize } from "@/lib/format-file-size";
import type { PersonalDataExportSummary } from "@/lib/personal-data-export/store";

/** The texts of one page's list, from that page's own translation keys. */
export interface PersonalDataExportListLabels {
	list: string;
	requestedAt: (date: string) => string;
	availableUntil: (date: string) => string;
	status: (status: PersonalDataExportSummary["status"]) => string;
	download: string;
	downloadFailed: string;
}

/**
 * Past personal data exports with their status and a download button for
 * finished ones (#811): My data and the employee page's admin exports. Each
 * download asks the server for a fresh short-lived link.
 */
export function PersonalDataExportList({
	exports,
	labels,
}: {
	exports: readonly PersonalDataExportSummary[];
	labels: PersonalDataExportListLabels;
}) {
	const display = useDisplayContext();
	const [downloading, setDownloading] = useState<string | null>(null);
	const at = (iso: string) => formatInstant(parseInstant(iso), display, "dateTimeMedium");

	const download = async (exportId: string) => {
		setDownloading(exportId);
		try {
			const result = await getPersonalDataExportDownloadUrl(exportId);
			if (result.success) {
				window.location.assign(result.data.url);
			} else {
				toast.error(labels.downloadFailed);
			}
		} catch {
			toast.error(labels.downloadFailed);
		}
		setDownloading(null);
	};

	if (exports.length === 0) return null;
	return (
		<ul className="divide-y rounded-md border" aria-label={labels.list}>
			{exports.map((entry) => (
				<li key={entry.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
					<div className="min-w-0 space-y-1">
						<p className="text-sm font-medium">{labels.requestedAt(at(entry.createdAt))}</p>
						<p className="text-xs text-muted-foreground">
							{entry.status === "completed" ? labels.availableUntil(at(entry.expiresAt)) : null}
							{entry.status === "completed" && entry.sizeBytes !== null
								? ` · ${formatFileSize(entry.sizeBytes, display.locale)}`
								: null}
						</p>
					</div>
					<div className="flex items-center gap-2">
						<Badge variant={entry.status === "failed" ? "destructive" : "secondary"}>
							{labels.status(entry.status)}
						</Badge>
						{entry.status === "completed" ? (
							<Button
								size="sm"
								variant="outline"
								onClick={() => download(entry.id)}
								disabled={downloading === entry.id}
							>
								{downloading === entry.id ? (
									<IconLoader2 className="size-4 animate-spin" aria-hidden="true" />
								) : (
									<IconDownload className="size-4" aria-hidden="true" />
								)}
								{labels.download}
							</Button>
						) : null}
					</div>
				</li>
			))}
		</ul>
	);
}
