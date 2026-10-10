"use client";

import { IconCalendarOff, IconDownload, IconExternalLink, IconFileText } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import type { ReactNode } from "react";
import type { EmployeeDocumentView } from "@/app/[locale]/(app)/personnel-files/actions";
import { useAppLocale } from "@/components/providers/app-locale-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDateOnly } from "@/components/ui/date-picker-utils";
import { formatAbsenceDateRange } from "@/lib/personnel-file/sick-note-labels";
import {
	formatFileSize,
	formatPayPeriod,
	personnelDocumentUrl,
	usePersonnelFileLabels,
} from "./document-labels";

function DocumentThumbnail({ document }: { document: EmployeeDocumentView }) {
	if (!document.mimeType.startsWith("image/")) {
		return (
			<div className="flex size-12 shrink-0 items-center justify-center rounded-md border bg-muted">
				<IconFileText aria-hidden="true" className="size-5 text-muted-foreground" />
			</div>
		);
	}
	return (
		// biome-ignore lint/performance/noImgElement: a private, access-checked preview, not an optimizable asset.
		<img
			src={personnelDocumentUrl(document.id, { thumb: true })}
			alt=""
			loading="lazy"
			className="size-12 shrink-0 rounded-md border object-cover"
		/>
	);
}

/** Employee documents with their metadata, an open and a download link, and optional actions. */
export function DocumentList({
	documents,
	showVisibility,
	actions,
}: {
	documents: readonly EmployeeDocumentView[];
	showVisibility: boolean;
	actions?: (document: EmployeeDocumentView) => ReactNode;
}) {
	const { t } = useTranslate();
	const locale = useAppLocale();
	const labels = usePersonnelFileLabels();

	return (
		<ul className="divide-y rounded-md border">
			{documents.map((document) => (
				<li key={document.id} className="flex flex-wrap items-center gap-3 p-3 sm:flex-nowrap">
					<DocumentThumbnail document={document} />
					<div className="min-w-0 flex-1 space-y-1">
						<div className="flex flex-wrap items-center gap-2">
							<span className="truncate font-medium">{document.title}</span>
							<Badge variant="secondary">{labels.categories[document.category]}</Badge>
							{showVisibility ? (
								<Badge variant={document.visibility === "shared" ? "outline" : "secondary"}>
									{labels.visibilities[document.visibility]}
								</Badge>
							) : null}
						</div>
						<p className="text-sm text-muted-foreground">
							{document.payPeriod
								? t("settings.personnelFiles.list.payPeriod", "Pay period {period}", {
										period: formatPayPeriod(document.payPeriod, locale),
									})
								: formatDateOnly(document.documentDate, locale)}
							{document.expiryDate
								? ` · ${t("settings.personnelFiles.list.expires", "Expires {date}", {
										date: formatDateOnly(document.expiryDate, locale),
									})}`
								: null}
							{` · ${document.fileName} (${formatFileSize(document.sizeBytes, locale)})`}
						</p>
						{document.absence ? (
							<p className="flex items-center gap-1 text-sm text-muted-foreground">
								<IconCalendarOff aria-hidden="true" className="size-3.5" />
								{t("settings.personnelFiles.list.absence", "For sick leave {dateRange}", {
									dateRange: formatAbsenceDateRange(
										document.absence.startDate,
										document.absence.endDate,
										locale,
									),
								})}
							</p>
						) : null}
					</div>
					<div className="flex items-center gap-1">
						<Button asChild variant="ghost" size="icon">
							<a
								href={personnelDocumentUrl(document.id)}
								target="_blank"
								rel="noopener noreferrer"
								aria-label={t("settings.personnelFiles.list.open", "Open {title}", {
									title: document.title,
								})}
							>
								<IconExternalLink aria-hidden="true" className="size-4" />
							</a>
						</Button>
						<Button asChild variant="ghost" size="icon">
							<a
								href={personnelDocumentUrl(document.id, { download: true })}
								aria-label={t("settings.personnelFiles.list.download", "Download {title}", {
									title: document.title,
								})}
							>
								<IconDownload aria-hidden="true" className="size-4" />
							</a>
						</Button>
						{actions?.(document)}
					</div>
				</li>
			))}
		</ul>
	);
}
