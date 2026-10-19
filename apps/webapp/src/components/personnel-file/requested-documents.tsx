"use client";

import { IconSend, IconUpload } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import type { DocumentRequestView } from "@/lib/personnel-file/document-request.types";
import type { PersonnelFilePanelCapability } from "@/lib/personnel-file/panel";
import { DocumentDialog } from "./document-dialog";
import { DocumentRequestList } from "./document-request-list";
import { SubmitDocumentRequestDialog } from "./submit-document-request-dialog";

/**
 * "Requested documents" in My documents (#1401): what officers asked the
 * employee for, with deadline, status, overdue flag, reasons and history.
 * Hidden while there are none. An HR-only renewed document never reaches it.
 * From an open request the employee uploads documents and submits them
 * (#1402); they cannot decline or cancel it.
 */
export function RequestedDocuments({
	requests,
	capability,
}: {
	requests: readonly DocumentRequestView[];
	/** The employee's own upload capability (employee, today and timezone of the organization). */
	capability: PersonnelFilePanelCapability;
}) {
	const { t } = useTranslate();
	const router = useRouter();
	const [uploading, setUploading] = useState<DocumentRequestView | null>(null);
	const [submitting, setSubmitting] = useState<DocumentRequestView | null>(null);
	const headingId = useId();
	if (requests.length === 0) return null;
	return (
		<section aria-labelledby={headingId} className="space-y-3">
			<div className="space-y-1">
				<h2 id={headingId} className="text-lg font-semibold tracking-tight">
					{t("settings.personnelFiles.myDocuments.requested.title", "Requested documents")}
				</h2>
				<p className="text-sm text-muted-foreground">
					{t(
						"settings.personnelFiles.myDocuments.requested.description",
						"Documents your organization asked you for, with their deadline.",
					)}
				</p>
			</div>
			<DocumentRequestList
				requests={requests}
				timezone={capability.timezone}
				actions={(request) =>
					request.status === "open" ? (
						<>
							<Button
								type="button"
								variant="outline"
								size="sm"
								onClick={() => setUploading(request)}
								aria-label={t(
									"settings.personnelFiles.myDocuments.requested.upload.open",
									"Upload a document for {title}",
									{ title: request.title },
								)}
							>
								<IconUpload aria-hidden="true" className="size-4" />
								{t("settings.personnelFiles.myDocuments.requested.upload.button", "Upload")}
							</Button>
							<Button
								type="button"
								size="sm"
								disabled={request.pendingDocuments.length === 0}
								onClick={() => setSubmitting(request)}
								aria-label={t(
									"settings.personnelFiles.myDocuments.requested.submit.open",
									"Submit {title}",
									{ title: request.title },
								)}
							>
								<IconSend aria-hidden="true" className="size-4" />
								{t("settings.personnelFiles.myDocuments.requested.submit.button", "Submit")}
							</Button>
						</>
					) : null
				}
			/>
			{uploading ? (
				<DocumentDialog
					key={uploading.id}
					mode="upload"
					uploadAs="employee"
					documentRequest={{
						id: uploading.id,
						category: uploading.category,
						title: uploading.title,
					}}
					open
					onOpenChange={(open) => {
						if (!open) setUploading(null);
					}}
					employeeId={capability.employeeId}
					categories={[uploading.category]}
					today={capability.today}
					onSaved={() => router.refresh()}
				/>
			) : null}
			<SubmitDocumentRequestDialog
				request={submitting}
				onOpenChange={(open) => {
					if (!open) setSubmitting(null);
				}}
				onSubmitted={() => router.refresh()}
			/>
		</section>
	);
}
