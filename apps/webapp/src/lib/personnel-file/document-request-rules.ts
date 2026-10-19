import type { Temporal } from "temporal-polyfill";
import { comparePlainDates, parsePlainDate } from "@/lib/datetime/temporal-core";
import {
	DOCUMENT_REQUEST_TEXT_MAX_LENGTH,
	DOCUMENT_REQUEST_TITLE_MAX_LENGTH,
	type DocumentRequestCategory,
	type DocumentRequestFollowUpEventKind,
	type DocumentRequestRefusal,
	type DocumentRequestReminderKind,
	type DocumentRequestStatus,
	isDocumentRequestCategory,
} from "./document-request.types";

/**
 * Pure rules of document requests (#1307): input validation, the lifecycle's
 * allowed steps and the derived overdue flag. The store applies them under the
 * request's row lock.
 */

type Validated<T> = { ok: true; value: T } | { ok: false; reason: DocumentRequestRefusal };

export interface DocumentRequestInput {
	category: DocumentRequestCategory;
	title: string;
	note: string | null;
	/** `YYYY-MM-DD` */
	deadline: string;
}

/** An optional free text: trimmed, empty becomes null. */
export function optionalDocumentRequestText(value: unknown): Validated<string | null> {
	if (value === null || value === undefined) return { ok: true, value: null };
	if (typeof value !== "string") return { ok: false, reason: "invalid_note" };
	const text = value.trim();
	if (text.length > DOCUMENT_REQUEST_TEXT_MAX_LENGTH) return { ok: false, reason: "invalid_note" };
	return { ok: true, value: text || null };
}

/** A deadline: a real calendar day, not before the organization's today. */
export function validateDocumentRequestDeadline(
	value: unknown,
	today: Temporal.PlainDate,
): Validated<string> {
	let deadline: Temporal.PlainDate;
	try {
		deadline = parsePlainDate(value as string);
	} catch {
		return { ok: false, reason: "invalid_deadline" };
	}
	if (comparePlainDates(deadline, today) < 0) return { ok: false, reason: "deadline_in_past" };
	return { ok: true, value: deadline.toString() };
}

/** Validates what an officer sends to create a request; `today` is the organization's day. */
export function validateDocumentRequestInput(
	input: { category: unknown; title: unknown; note: unknown; deadline: unknown },
	today: Temporal.PlainDate,
): Validated<DocumentRequestInput> {
	if (!isDocumentRequestCategory(input.category)) {
		return { ok: false, reason: "category_not_requestable" };
	}
	const title = typeof input.title === "string" ? input.title.trim() : "";
	if (!title || title.length > DOCUMENT_REQUEST_TITLE_MAX_LENGTH) {
		return { ok: false, reason: "invalid_title" };
	}
	const note = optionalDocumentRequestText(input.note);
	if (!note.ok) return note;
	const deadline = validateDocumentRequestDeadline(input.deadline, today);
	if (!deadline.ok) return deadline;
	return {
		ok: true,
		value: { category: input.category, title, note: note.value, deadline: deadline.value },
	};
}

/** A required reason (cancel, return): trimmed, at most 2000 characters. */
export function validateDocumentRequestReason(value: unknown): Validated<string> {
	const reason = typeof value === "string" ? value.trim() : "";
	if (!reason) return { ok: false, reason: "reason_required" };
	if (reason.length > DOCUMENT_REQUEST_TEXT_MAX_LENGTH) {
		return { ok: false, reason: "invalid_reason" };
	}
	return { ok: true, value: reason };
}

/**
 * The status an event moves a request to, or null when the event is not
 * allowed from `current` (the caller reports a conflict):
 * open → submitted → accepted; submitted → open on return; open or submitted →
 * cancelled; edits keep an open or submitted request's status.
 */
export function nextDocumentRequestStatus(
	current: DocumentRequestStatus,
	kind: DocumentRequestFollowUpEventKind,
): DocumentRequestStatus | null {
	switch (kind) {
		case "submitted":
			return current === "open" ? "submitted" : null;
		case "returned":
			return current === "submitted" ? "open" : null;
		case "accepted":
			return current === "submitted" ? "accepted" : null;
		case "cancelled":
			return current === "open" || current === "submitted" ? "cancelled" : null;
		case "edited":
			return current === "open" || current === "submitted" ? current : null;
	}
}

/** What an edit changes (#1403); a field it leaves out stays as it is. */
export interface DocumentRequestEditPatch {
	/** `YYYY-MM-DD` */
	deadline?: string;
	note?: string | null;
}

/**
 * Validates an officer's edit of a request's deadline and note (#1403) and
 * returns only what actually changes. A new deadline is a real day, not
 * before the organization's `today`; an unchanged deadline is kept even when
 * it has passed, so the note of an overdue request can still be changed. A
 * field left `undefined` is not edited.
 */
export function validateDocumentRequestEdit(
	current: { deadline: string; note: string | null },
	input: { deadline?: unknown; note?: unknown },
	today: Temporal.PlainDate,
): Validated<DocumentRequestEditPatch> {
	const patch: DocumentRequestEditPatch = {};
	if (input.deadline !== undefined) {
		if (typeof input.deadline !== "string") return { ok: false, reason: "invalid_deadline" };
		let deadline: string;
		try {
			deadline = parsePlainDate(input.deadline).toString();
		} catch {
			return { ok: false, reason: "invalid_deadline" };
		}
		if (deadline !== current.deadline) {
			const validated = validateDocumentRequestDeadline(deadline, today);
			if (!validated.ok) return validated;
			patch.deadline = validated.value;
		}
	}
	if (input.note !== undefined) {
		const note = optionalDocumentRequestText(input.note);
		if (!note.ok) return note;
		if (note.value !== current.note) patch.note = note.value;
	}
	return { ok: true, value: patch };
}

/** Days before the deadline of the employee's first deadline reminder. */
export const DOCUMENT_REQUEST_REMINDER_LEAD_DAYS = 3;

/**
 * The deadline reminder an open request is due for today (#1406), if any. All
 * days are the organization's calendar days.
 * - `three_days_before` and `deadline_day` fire on exactly that day, and only
 *   when the request was already open before it began: the creation and the
 *   return notifications name the deadline, so the day a request was created
 *   or returned (`openedOn`) brings no extra reminder.
 * - `overdue` fires on any day after the deadline: the ledger keeps it to the
 *   first, and a request returned after its deadline is overdue at once.
 * Submitted, accepted and cancelled requests get none.
 */
export function dueDocumentRequestReminder(input: {
	status: DocumentRequestStatus;
	/** `YYYY-MM-DD` */
	deadline: string;
	/** The day the request was created or last returned. */
	openedOn: Temporal.PlainDate;
	today: Temporal.PlainDate;
}): DocumentRequestReminderKind | null {
	if (input.status !== "open") return null;
	const daysLeft = input.today.until(parsePlainDate(input.deadline), { largestUnit: "days" }).days;
	if (daysLeft < 0) return "overdue";
	if (comparePlainDates(input.openedOn, input.today) >= 0) return null;
	if (daysLeft === DOCUMENT_REQUEST_REMINDER_LEAD_DAYS) return "three_days_before";
	if (daysLeft === 0) return "deadline_day";
	return null;
}

/** Open after its deadline day, in the organization's calendar (`today`). */
export function isDocumentRequestOverdue(
	request: { status: DocumentRequestStatus; deadline: string },
	today: Temporal.PlainDate,
): boolean {
	return (
		request.status === "open" && comparePlainDates(parsePlainDate(request.deadline), today) < 0
	);
}
