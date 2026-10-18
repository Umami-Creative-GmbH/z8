"use client";

import { useTranslate } from "@tolgee/react";
import {
	DOCUMENT_REQUEST_BULK_MAX_RECIPIENTS,
	type DocumentRequestEventKind,
	type DocumentRequestReasonCode,
	type DocumentRequestRefusal,
	type DocumentRequestStatus,
} from "@/lib/personnel-file/document-request.types";

/** Translated names of request statuses, history events and system reasons (#1307). */
export function useDocumentRequestLabels() {
	const { t } = useTranslate();
	const statuses: Record<DocumentRequestStatus, string> = {
		open: t("settings.personnelFiles.requests.status.open", "Open"),
		submitted: t("settings.personnelFiles.requests.status.submitted", "Submitted"),
		accepted: t("settings.personnelFiles.requests.status.accepted", "Accepted"),
		cancelled: t("settings.personnelFiles.requests.status.cancelled", "Cancelled"),
	};
	const events: Record<DocumentRequestEventKind, string> = {
		created: t("settings.personnelFiles.requests.event.created", "Requested"),
		edited: t("settings.personnelFiles.requests.event.edited", "Changed"),
		submitted: t("settings.personnelFiles.requests.event.submitted", "Submitted"),
		returned: t("settings.personnelFiles.requests.event.returned", "Returned"),
		accepted: t("settings.personnelFiles.requests.event.accepted", "Accepted"),
		cancelled: t("settings.personnelFiles.requests.event.cancelled", "Cancelled"),
	};
	const reasonCodes: Record<DocumentRequestReasonCode, string> = {
		employment_ended: t(
			"settings.personnelFiles.requests.reasonCode.employmentEnded",
			"Employment ended",
		),
	};
	const overdue = t("settings.personnelFiles.requests.overdue", "Overdue");
	return { statuses, events, reasonCodes, overdue };
}

/** The message for a failed request action: translated by `code`, else the server's text. */
export function useDocumentRequestErrorMessage() {
	const { t } = useTranslate();
	const messages: Record<DocumentRequestRefusal | "conflict", string> = {
		category_not_requestable: t(
			"settings.personnelFiles.requests.error.categoryNotRequestable",
			"Only certificates and other documents can be requested.",
		),
		invalid_title: t(
			"settings.personnelFiles.requests.error.invalidTitle",
			"Enter a title of at most 200 characters.",
		),
		invalid_note: t(
			"settings.personnelFiles.requests.error.invalidNote",
			"The note can be at most 2000 characters.",
		),
		invalid_deadline: t(
			"settings.personnelFiles.requests.error.invalidDeadline",
			"Choose a deadline.",
		),
		deadline_in_past: t(
			"settings.personnelFiles.requests.error.deadlineInPast",
			"The deadline cannot be in the past.",
		),
		reason_required: t("settings.personnelFiles.requests.error.reasonRequired", "Enter a reason."),
		invalid_reason: t(
			"settings.personnelFiles.requests.error.invalidReason",
			"The reason can be at most 2000 characters.",
		),
		own_file: t(
			"settings.personnelFiles.requests.error.ownFile",
			"You cannot request documents on your own personnel file.",
		),
		former_employee: t(
			"settings.personnelFiles.requests.error.formerEmployee",
			"This employee's employment has ended.",
		),
		renewed_document_mismatch: t(
			"settings.personnelFiles.requests.error.renewedDocumentMismatch",
			"The renewed document must be a document of the same employee and category.",
		),
		renewal_already_requested: t(
			"settings.personnelFiles.requests.error.renewalAlreadyRequested",
			"This document already has an open request for its renewal.",
		),
		no_documents: t(
			"settings.personnelFiles.requests.error.noDocuments",
			"Upload at least one document before you submit.",
		),
		not_editable: t(
			"settings.personnelFiles.requests.error.notEditable",
			"Only the deadline and note can be changed. Cancel the request and create a new one instead.",
		),
		no_recipients: t(
			"settings.personnelFiles.requests.error.noRecipients",
			"Choose at least one employee or team.",
		),
		too_many_recipients: t(
			"settings.personnelFiles.requests.error.tooManyRecipients",
			"Request documents from at most {max} employees at once.",
			{ max: DOCUMENT_REQUEST_BULK_MAX_RECIPIENTS },
		),
		renewal_not_in_bulk: t(
			"settings.personnelFiles.requests.error.renewalNotInBulk",
			"Requests for several employees cannot name a renewed document.",
		),
		conflict: t(
			"settings.personnelFiles.requests.error.conflict",
			"Someone else changed this request in the meantime. Reload it and try again.",
		),
	};
	return (result: { error: string; code?: string }) =>
		(result.code && result.code in messages
			? messages[result.code as keyof typeof messages]
			: null) ?? result.error;
}
