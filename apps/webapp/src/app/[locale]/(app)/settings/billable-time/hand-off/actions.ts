"use server";

import { Effect } from "effect";
import { defaultAccountingDependencies } from "@/lib/billable-time/accounting/connection-store";
import {
	checkInvoiceDraftStatus,
	clearChangedAfterInvoicing,
	confirmHandOff,
	getInvoiceDraftDetail,
	type HandOffOutcome,
	type HandOffRequestRefusal,
	listChangedAfterInvoicing,
	listHandOffCustomers,
	listInvoiceDrafts,
	parseHandOffRequest,
	previewHandOff,
	releaseInvoiceDraft,
	retryHandOff,
} from "@/lib/billable-time/hand-off/hand-off-store";
import type {
	DraftToolStatusView,
	HandOffBlockerView,
	HandOffCustomerOption,
	HandOffPreview,
	InvoiceDraftDetailView,
	InvoiceDraftSummaryView,
	InvoicedWorkView,
} from "@/lib/billable-time/hand-off/views";
import { getBillableTimeSettings } from "@/lib/billable-time/settings";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/effect/errors";
import { runServerActionSafe, type ServerActionResult } from "@/lib/effect/result";
import { DatabaseService } from "@/lib/effect/services/database.service";
import { activeOrganizationActor } from "../action-actor";

/**
 * The hand-off (#903 pass B): preview, confirm (one invoice draft through the
 * accounting provider port, idempotent), retry, release, draft status check,
 * timesheet and changed-after-invoicing marks. Owners and admins of the active
 * organization only; the module must be on (except release and clearing marks,
 * which stay possible to clean up).
 */

const ADMIN_ONLY = "Only owners and admins can hand off billable work";

const actor = (action: string) =>
	activeOrganizationActor({ requiredRole: "admin", message: ADMIN_ONLY, action });

const billableTimeOff = () =>
	new ValidationError({ message: "Billable Time is switched off", field: "billableTimeEnabled" });

const draftNotFound = () =>
	new NotFoundError({ message: "The hand-off was not found", entityType: "invoice_draft" });

function requireModuleOn(organizationId: string) {
	return Effect.gen(function* () {
		const dbService = yield* DatabaseService;
		const settings = yield* dbService.query("billableTime.handOff.settings", () =>
			getBillableTimeSettings(organizationId, dbService.db),
		);
		if (!settings.enabled || settings.currency === null) {
			return yield* Effect.fail(billableTimeOff());
		}
	});
}

function requestRefusalError(reason: HandOffRequestRefusal) {
	switch (reason) {
		case "invalid_customer":
			return new ValidationError({ message: "Choose a customer", field: "customerId" });
		case "invalid_period":
			return new ValidationError({
				message: "Choose a period of at most one year whose end is not before its start",
				field: "period",
			});
		case "invalid_projects":
			return new ValidationError({
				message: "Choose projects of this customer",
				field: "projectIds",
			});
	}
}

/** A clear message for each reason a hand-off cannot be confirmed. */
function blockerMessage(blocker: HandOffBlockerView): string {
	switch (blocker.kind) {
		case "billable_time_off":
			return "Billable Time is switched off";
		case "not_connected":
			return "Connect an accounting tool first";
		case "provider_unavailable":
			return "The connected accounting tool is not available in this installation";
		case "no_contact_link":
			return "Link this customer to a contact in the accounting tool first";
		case "unpriced_work":
			return `${blocker.count} work periods have no billable rate. Add a rate for them before handing off`;
		case "nothing_to_hand_off":
			return "There is no un-invoiced billable work to hand off in this period";
		case "too_many_lines":
			return `The draft would have ${blocker.lines} lines; the accounting tool takes at most ${blocker.maxDraftLines}. Leave out the timesheet lines or choose a shorter period`;
		case "currency_not_supported":
			return `The accounting tool cannot take drafts in ${blocker.currency}`;
		case "tax_treatment_not_supported":
			return "The accounting tool cannot take this customer's tax treatment";
	}
}

export interface HandOffConfirmation {
	draftId: string;
	replayed: boolean;
}

function outcomeError(outcome: Exclude<HandOffOutcome, { ok: true }>) {
	switch (outcome.reason) {
		case "invalid_key":
			return new ValidationError({ message: "Reload the preview and try again", field: "key" });
		case "invalid_customer":
		case "invalid_period":
		case "invalid_projects":
			return requestRefusalError(outcome.reason);
		case "blocked":
			return new ValidationError({ message: blockerMessage(outcome.blocker), field: "handOff" });
		case "preview_outdated":
			return new ConflictError({
				message: "The work changed since the preview. Review the new preview before handing off",
				conflictType: "hand_off_preview_outdated",
			});
		case "key_reused":
			return new ConflictError({
				message: "Reload the preview and try again",
				conflictType: "hand_off_key_reused",
			});
		case "connection_changed":
			return new ConflictError({
				message:
					"The accounting connection changed since this hand-off started. Release it and hand off again",
				conflictType: "hand_off_connection_changed",
			});
		case "not_connected":
			return new ValidationError({
				message: "Connect an accounting tool first",
				field: "accountingConnection",
			});
		case "provider_unavailable":
			return new ValidationError({
				message: "The connected accounting tool is not available in this installation",
				field: "accountingConnection",
			});
		case "credentials_missing":
			return new ValidationError({
				message: "The API key of the accounting connection is missing. Replace the connection",
				field: "accountingConnection",
			});
		case "outcome_unknown":
			return new ConflictError({
				message:
					"The accounting tool did not answer. Retry the hand-off: it will not create a second draft",
				conflictType: "hand_off_outcome_unknown",
			});
		case "not_performed":
			return new ConflictError({
				message: `The accounting tool could not create the draft right now (${outcome.message}). Retry later`,
				conflictType: "hand_off_not_performed",
			});
		case "rejected":
			return new ValidationError({
				message: `The accounting tool refused the draft: ${outcome.message}`,
				field: "handOff",
			});
		case "credentials_refused":
			return new ValidationError({
				message: "The accounting tool refused the stored API key. Replace the connection",
				field: "accountingConnection",
			});
		case "not_pending":
			return new ConflictError({
				message: "This hand-off was already released or failed. Start a new one",
				conflictType: "hand_off_not_pending",
			});
		case "not_found":
			return draftNotFound();
	}
}

export interface HandOffOverview {
	customers: HandOffCustomerOption[];
	drafts: InvoiceDraftSummaryView[];
	changedAfterInvoicing: (InvoicedWorkView & { invoiceDraftId: string })[];
}

/** The hand-off area: customers to choose from, hand-offs and marked work. */
export async function getHandOffOverview(): Promise<ServerActionResult<HandOffOverview>> {
	const effect = Effect.gen(function* () {
		const { organizationId } = yield* actor("readHandOffs");
		yield* requireModuleOn(organizationId);
		const dbService = yield* DatabaseService;
		return yield* dbService.query("billableTime.handOff.overview", async () => ({
			customers: await listHandOffCustomers(dbService.db, organizationId),
			drafts: await listInvoiceDrafts(dbService.db, organizationId),
			changedAfterInvoicing: await listChangedAfterInvoicing(dbService.db, organizationId),
		}));
	});
	return runServerActionSafe(effect);
}

export interface HandOffRequestInput {
	customerId: string;
	periodFrom: string;
	periodTo: string;
	projectIds: string[] | null;
	includeTimesheet: boolean;
	locale: string;
}

/** Previews a hand-off. Nothing is written; the accounting tool is not called. */
export async function previewHandOffAction(
	input: HandOffRequestInput,
): Promise<ServerActionResult<HandOffPreview>> {
	const effect = Effect.gen(function* () {
		const { organizationId } = yield* actor("previewHandOff");
		yield* requireModuleOn(organizationId);
		const parsed = parseHandOffRequest(input);
		if (!parsed.ok) return yield* Effect.fail(requestRefusalError(parsed.reason));
		const dbService = yield* DatabaseService;
		const outcome = yield* dbService.query("billableTime.handOff.preview", () =>
			previewHandOff(dbService.db, defaultAccountingDependencies(), {
				organizationId,
				request: parsed.request,
			}),
		);
		if (!outcome.ok) return yield* Effect.fail(requestRefusalError(outcome.reason));
		return outcome.preview;
	});
	return runServerActionSafe(effect);
}

/**
 * Confirms a hand-off: creates one invoice draft in the accounting tool. Pass
 * the same `idempotencyKey` when retrying after a timeout; it never creates a
 * second draft or invoices work twice. `fingerprint` is the preview's.
 */
export async function confirmHandOffAction(
	input: HandOffRequestInput & { idempotencyKey: string; fingerprint: string },
): Promise<ServerActionResult<HandOffConfirmation>> {
	const effect = Effect.gen(function* () {
		const { organizationId, userId } = yield* actor("confirmHandOff");
		const parsed = parseHandOffRequest(input);
		if (!parsed.ok) return yield* Effect.fail(requestRefusalError(parsed.reason));
		const dbService = yield* DatabaseService;
		const outcome = yield* dbService.query("billableTime.handOff.confirm", () =>
			confirmHandOff(dbService.db, defaultAccountingDependencies(), {
				organizationId,
				actorUserId: userId,
				request: parsed.request,
				idempotencyKey: input.idempotencyKey,
				expectedFingerprint: input.fingerprint,
			}),
		);
		if (!outcome.ok) return yield* Effect.fail(outcomeError(outcome));
		return { draftId: outcome.draftId, replayed: outcome.replayed };
	});
	return runServerActionSafe(effect);
}

/** Retries a pending hand-off with its recorded key and lines. */
export async function retryHandOffAction(input: {
	draftId: string;
}): Promise<ServerActionResult<HandOffConfirmation>> {
	const effect = Effect.gen(function* () {
		const { organizationId, userId } = yield* actor("retryHandOff");
		const dbService = yield* DatabaseService;
		const outcome = yield* dbService.query("billableTime.handOff.retry", () =>
			retryHandOff(dbService.db, defaultAccountingDependencies(), {
				organizationId,
				actorUserId: userId,
				draftId: String(input.draftId),
			}),
		);
		if (!outcome.ok) return yield* Effect.fail(outcomeError(outcome));
		return { draftId: outcome.draftId, replayed: outcome.replayed };
	});
	return runServerActionSafe(effect);
}

/** One hand-off with lines, work, marks and its timesheet. */
export async function getInvoiceDraftAction(input: {
	draftId: string;
}): Promise<ServerActionResult<InvoiceDraftDetailView>> {
	const effect = Effect.gen(function* () {
		const { organizationId } = yield* actor("readHandOff");
		const dbService = yield* DatabaseService;
		const detail = yield* dbService.query("billableTime.handOff.detail", () =>
			getInvoiceDraftDetail(dbService.db, defaultAccountingDependencies(), {
				organizationId,
				draftId: String(input.draftId),
			}),
		);
		if (!detail) return yield* Effect.fail(draftNotFound());
		return detail;
	});
	return runServerActionSafe(effect);
}

/**
 * Asks the accounting tool for a draft's status (called when a hand-off is
 * opened). A draft reported as gone suggests a release; nothing is released.
 */
export async function checkInvoiceDraftStatusAction(input: {
	draftId: string;
}): Promise<ServerActionResult<DraftToolStatusView>> {
	const effect = Effect.gen(function* () {
		const { organizationId } = yield* actor("checkInvoiceDraftStatus");
		const dbService = yield* DatabaseService;
		const outcome = yield* dbService.query("billableTime.handOff.status", () =>
			checkInvoiceDraftStatus(dbService.db, defaultAccountingDependencies(), {
				organizationId,
				draftId: String(input.draftId),
			}),
		);
		if (!outcome.ok) return yield* Effect.fail(draftNotFound());
		return outcome.status;
	});
	return runServerActionSafe(effect);
}

/** Releases a hand-off: its work is un-invoiced again. Audited. */
export async function releaseInvoiceDraftAction(input: {
	draftId: string;
	reason?: string;
}): Promise<ServerActionResult<{ workReturned: number }>> {
	const effect = Effect.gen(function* () {
		const { organizationId, userId } = yield* actor("releaseInvoiceDraft");
		const dbService = yield* DatabaseService;
		const outcome = yield* dbService.query("billableTime.handOff.release", () =>
			releaseInvoiceDraft(dbService.db, {
				organizationId,
				actorUserId: userId,
				draftId: String(input.draftId),
				reason: input.reason,
			}),
		);
		if (!outcome.ok) {
			return yield* Effect.fail(
				outcome.reason === "not_found"
					? draftNotFound()
					: new ConflictError({
							message: "This hand-off was already released or failed",
							conflictType: "hand_off_not_releasable",
						}),
			);
		}
		return { workReturned: outcome.workReturned };
	});
	return runServerActionSafe(effect);
}

/** Clears changed-after-invoicing marks of invoiced work. Audited. */
export async function clearChangedAfterInvoicingAction(input: {
	invoicedWorkIds: string[];
}): Promise<ServerActionResult<{ cleared: number }>> {
	const effect = Effect.gen(function* () {
		const { organizationId, userId } = yield* actor("clearChangedAfterInvoicing");
		const dbService = yield* DatabaseService;
		const outcome = yield* dbService.query("billableTime.handOff.clearMarks", () =>
			clearChangedAfterInvoicing(dbService.db, {
				organizationId,
				actorUserId: userId,
				invoicedWorkIds: input.invoicedWorkIds,
			}),
		);
		if (!outcome.ok) {
			return yield* Effect.fail(
				new ValidationError({ message: "Choose marked work", field: "invoicedWorkIds" }),
			);
		}
		return { cleared: outcome.cleared };
	});
	return runServerActionSafe(effect);
}
