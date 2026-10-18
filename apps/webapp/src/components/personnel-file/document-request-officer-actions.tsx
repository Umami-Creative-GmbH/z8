"use client";

import { IconPencil, IconX } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
	type DocumentRequestView,
	isActiveDocumentRequestStatus,
} from "@/lib/personnel-file/document-request.types";
import { CancelDocumentRequestDialog } from "./cancel-document-request-dialog";
import { DocumentRequestDecisionActions } from "./document-request-decision";
import { EditDocumentRequestDialog } from "./edit-document-request-dialog";

/**
 * What a covering officer can do with one request, wherever requests are
 * listed for officers (the "Document requests" page and the requests section
 * of an employee's file, #1403): edit the deadline and note and cancel, while
 * the request is open or submitted, and accept or return a submitted one
 * (#1402). The server re-checks coverage for each.
 */
export function DocumentRequestOfficerActions({
	request,
	today,
	onChanged,
}: {
	request: DocumentRequestView;
	/** The organization's today (`YYYY-MM-DD`): the earliest new deadline. */
	today: string;
	/** After any change, or a conflict: the list reloads. */
	onChanged: () => void;
}) {
	const { t } = useTranslate();
	const [dialog, setDialog] = useState<"edit" | "cancel" | null>(null);
	if (!isActiveDocumentRequestStatus(request.status)) return null;

	return (
		<>
			<DocumentRequestDecisionActions request={request} onDecided={onChanged} />
			<Button
				type="button"
				variant="ghost"
				size="sm"
				onClick={() => setDialog("edit")}
				aria-label={t("settings.personnelFiles.requests.edit.open", "Change {title}", {
					title: request.title,
				})}
			>
				<IconPencil aria-hidden="true" className="size-4" />
				{t("settings.personnelFiles.requests.edit.button", "Change")}
			</Button>
			<Button
				type="button"
				variant="ghost"
				size="sm"
				onClick={() => setDialog("cancel")}
				aria-label={t("settings.personnelFiles.requests.cancel.open", "Cancel {title}", {
					title: request.title,
				})}
			>
				<IconX aria-hidden="true" className="size-4" />
				{t("settings.personnelFiles.requests.cancel.button", "Cancel")}
			</Button>
			{dialog === "edit" ? (
				<EditDocumentRequestDialog
					key={`${request.id}:${request.version}`}
					request={request}
					today={today}
					onOpenChange={(open) => {
						if (!open) setDialog(null);
					}}
					onSaved={onChanged}
				/>
			) : null}
			<CancelDocumentRequestDialog
				request={dialog === "cancel" ? request : null}
				onOpenChange={(open) => {
					if (!open) setDialog(null);
				}}
				onCancelled={onChanged}
			/>
		</>
	);
}
