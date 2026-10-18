"use client";

import { useTranslate } from "@tolgee/react";
import type { DocumentRequestView } from "@/lib/personnel-file/document-request.types";
import { DocumentRequestList } from "./document-request-list";

/**
 * "Requested documents" in My documents (#1401): what officers asked the
 * employee for, with deadline, status, overdue flag, reasons and history.
 * Hidden while there are none. An HR-only renewed document never reaches it.
 */
export function RequestedDocuments({
	requests,
	timezone,
}: {
	requests: readonly DocumentRequestView[];
	timezone: string;
}) {
	const { t } = useTranslate();
	if (requests.length === 0) return null;
	return (
		<section aria-labelledby="requested-documents-title" className="space-y-3">
			<div className="space-y-1">
				<h2 id="requested-documents-title" className="text-lg font-semibold tracking-tight">
					{t("settings.personnelFiles.myDocuments.requested.title", "Requested documents")}
				</h2>
				<p className="text-sm text-muted-foreground">
					{t(
						"settings.personnelFiles.myDocuments.requested.description",
						"Documents your organization asked you for, with their deadline.",
					)}
				</p>
			</div>
			<DocumentRequestList requests={requests} timezone={timezone} />
		</section>
	);
}
