"use server";

import { Effect } from "effect";
import { z } from "zod";
import { defaultAccountingDependencies } from "@/lib/billable-time/accounting/connection-store";
import type { InvoiceDraftCapabilityProblem } from "@/lib/billable-time/accounting/invoice-draft";
import { groupChangedWork } from "@/lib/billable-time/hand-off/changed-work-groups";
import {
	checkInvoiceDraftStatus,
	confirmHandOff,
	getInvoiceDraftDetail,
	type HandOffOutcome,
	type HandOffRequestRefusal,
	listHandOffCustomers,
	listInvoiceDrafts,
	parseHandOffRequest,
	previewHandOff,
	releaseInvoiceDraft,
	retryHandOff,
} from "@/lib/billable-time/hand-off/hand-off-store";
import { reconciliationCsv } from "@/lib/billable-time/hand-off/reconciliation-csv";
import {
	parseResolutionInput,
	RESOLUTION_EXPLANATION_MAX_LENGTH,
	RESOLUTION_REFERENCE_MAX_LENGTH,
	type ResolutionFieldError,
	type ResolveItem,
} from "@/lib/billable-time/hand-off/resolution";
import {
	listMarkedItems,
	readDraftReconciliation,
	readDraftReconciliationItems,
	resolveChangedAfterInvoicing,
} from "@/lib/billable-time/hand-off/resolution-store";
import type {
	HandOffBlockerView,
	HandOffCustomerOption,
	InvoiceDraftDetailView,
	InvoiceDraftSummaryView,
	MarkedWorkItemView,
} from "@/lib/billable-time/hand-off/views";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/effect/errors";
import { DatabaseService } from "@/lib/effect/services/database.service";
import { noInput, organizationAction } from "@/lib/organization-action/organization-action";
import {
	accountingProviderRefusalError,
	accountingProviderRefusalMessage,
	billableTimeCurrency,
	billableTimeOff,
} from "../module-guard";

/**
 * The hand-off (#903 pass B): preview, confirm (one invoice draft through the
 * accounting provider port, idempotent), retry, release, draft status check,
 * timesheet and changed-after-invoicing marks. Owners and admins of the active
 * organization only; the module must be on (except reading a hand-off, release
 * and resolving marks, which stay possible to clean up).
 */

const draftNotFound = () =>
	new NotFoundError({ message: "The hand-off was not found", entityType: "invoice_draft" });

const moduleCurrency = (organizationId: string) =>
	billableTimeCurrency(organizationId, "billableTime.handOff.settings");

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
			return billableTimeOff().message;
		case "not_connected":
		case "provider_unavailable":
			return accountingProviderRefusalMessage(blocker.kind);
		case "no_contact_link":
			return "Link this customer to a contact in the accounting tool first";
		case "unpriced_work":
			return `${blocker.count} work periods have no billable rate. Add a rate for them before handing off`;
		case "nothing_to_hand_off":
			return "There is no un-invoiced billable work to hand off in this period";
		case "too_many_lines":
			return `The draft would have ${blocker.lines} work lines; the accounting tool takes at most ${blocker.maxDraftLines}. Choose fewer projects or a shorter period`;
		case "currency_not_supported":
			return `The accounting tool cannot take drafts in ${blocker.currency}`;
		case "tax_treatment_not_supported":
			return "The accounting tool cannot take this customer's tax treatment";
	}
}

function fitProblemText(problem: InvoiceDraftCapabilityProblem): string {
	switch (problem.problem) {
		case "too_many_lines":
			return `${problem.lines} lines; it takes at most ${problem.maxDraftLines}`;
		case "currency_not_supported":
			return `drafts in ${problem.currency}`;
		case "tax_treatment_not_supported":
			return "this tax treatment";
	}
}

export interface HandOffConfirmation {
	draftId: string;
	/**
	 * `pending`: the tool did not confirm the draft yet (timeout, or it could not
	 * take it right now). Retrying is safe and never creates a second draft.
	 */
	status: "created" | "pending";
	replayed: boolean;
	/** Why the hand-off is still pending. */
	pendingReason: "outcome_unknown" | "not_performed" | null;
}

function confirmationOf(outcome: HandOffOutcome) {
	if (outcome.ok) {
		return {
			draftId: outcome.draftId,
			status: "created",
			replayed: outcome.replayed,
			pendingReason: null,
		} satisfies HandOffConfirmation;
	}
	if (outcome.reason === "outcome_unknown" || outcome.reason === "not_performed") {
		return {
			draftId: outcome.draftId,
			status: "pending",
			replayed: false,
			pendingReason: outcome.reason,
		} satisfies HandOffConfirmation;
	}
	return null;
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
		case "preview_required":
			return new ValidationError({
				message: "Preview the hand-off before confirming it",
				field: "fingerprint",
			});
		case "draft_does_not_fit":
			return new ValidationError({
				message: `The accounting tool no longer takes this draft (${fitProblemText(outcome.problem)}). Release it and hand off again`,
				field: "handOff",
			});
		case "in_progress":
			return new ConflictError({
				message:
					"This hand-off is being sent to the accounting tool right now. Check it again in a moment",
				conflictType: "hand_off_in_progress",
			});
		case "connection_changed":
			return new ConflictError({
				message:
					"The accounting connection changed since this hand-off started. Release it and hand off again",
				conflictType: "hand_off_connection_changed",
			});
		case "not_connected":
		case "provider_unavailable":
		case "credentials_missing":
			return accountingProviderRefusalError(outcome.reason);
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
			return accountingProviderRefusalError("credentials_refused");
		case "not_pending":
			return new ConflictError({
				message: "This hand-off was already released or failed. Start a new one",
				conflictType: "hand_off_not_pending",
			});
		case "not_found":
			return draftNotFound();
	}
}

const handOffRequestShape = {
	customerId: z.string().max(255),
	periodFrom: z.string().max(32),
	periodTo: z.string().max(32),
	projectIds: z.array(z.string().max(255)).max(1000).nullable(),
	includeTimesheet: z.boolean(),
	locale: z.string().max(35),
};
/** `parseHandOffRequest` reads the request, so its refusals keep their wording. */
const previewHandOffActionSchema = z.object(handOffRequestShape);
const confirmHandOffActionSchema = z.object({
	...handOffRequestShape,
	idempotencyKey: z.string().max(255),
	fingerprint: z.string().max(255),
});
const draftIdSchema = z.strictObject({ draftId: z.string().max(255) });
const retryHandOffActionSchema = draftIdSchema;
const getInvoiceDraftActionSchema = draftIdSchema;
const checkInvoiceDraftStatusActionSchema = draftIdSchema;
const downloadDraftReconciliationCsvActionSchema = draftIdSchema;
const releaseInvoiceDraftActionSchema = z.strictObject({
	draftId: z.string().max(255),
	reason: z.string().max(5000).optional(),
});
/** `parseResolutionInput` reads the items and texts, so its refusal codes stay. */
const resolveChangedAfterInvoicingActionSchema = z.strictObject({
	items: z.custom<ResolveItem[]>((value) => Array.isArray(value), { error: "Choose marked work" }),
	explanation: z.string(),
	accountingReference: z.string().nullable().optional(),
});

export interface HandOffOverview {
	customers: HandOffCustomerOption[];
	drafts: InvoiceDraftSummaryView[];
	changedAfterInvoicing: MarkedWorkItemView[];
}

/** The hand-off area: customers to choose from, hand-offs and marked work. */
export const getHandOffOverview = organizationAction(
	{ name: "billableTime.handOff.readHandOffs", requires: "orgAdmin", schema: noInput },
	({ organizationId }) =>
		Effect.gen(function* () {
			yield* moduleCurrency(organizationId);
			const dbService = yield* DatabaseService;
			return yield* dbService.query("billableTime.handOff.overview", async () => ({
				customers: await listHandOffCustomers(dbService.db, organizationId),
				drafts: await listInvoiceDrafts(dbService.db, organizationId),
				changedAfterInvoicing: await listMarkedItems(dbService.db, organizationId),
			}));
		}),
);

export interface HandOffRequestInput {
	customerId: string;
	periodFrom: string;
	periodTo: string;
	projectIds: string[] | null;
	includeTimesheet: boolean;
	locale: string;
}

/** Previews a hand-off. Nothing is written; the accounting tool is not called. */
export const previewHandOffAction = organizationAction(
	{
		name: "billableTime.handOff.previewHandOff",
		requires: "orgAdmin",
		schema: previewHandOffActionSchema,
	},
	({ organizationId, input }) =>
		Effect.gen(function* () {
			yield* moduleCurrency(organizationId);
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
		}),
);

/**
 * Confirms a hand-off: creates one invoice draft in the accounting tool. Pass
 * the same `idempotencyKey` when retrying after a timeout; it never creates a
 * second draft or invoices work twice. `fingerprint` is the preview's.
 */
export const confirmHandOffAction = organizationAction(
	{
		name: "billableTime.handOff.confirmHandOff",
		requires: "orgAdmin",
		schema: confirmHandOffActionSchema,
	},
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const userId = actor.userId;
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
			const confirmation = confirmationOf(outcome);
			if (confirmation) return confirmation;
			return yield* Effect.fail(outcomeError(outcome as Exclude<HandOffOutcome, { ok: true }>));
		}),
);

/** Retries a pending hand-off with its recorded key and lines. */
export const retryHandOffAction = organizationAction(
	{
		name: "billableTime.handOff.retryHandOff",
		requires: "orgAdmin",
		schema: retryHandOffActionSchema,
	},
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const userId = actor.userId;
			const dbService = yield* DatabaseService;
			const outcome = yield* dbService.query("billableTime.handOff.retry", () =>
				retryHandOff(dbService.db, defaultAccountingDependencies(), {
					organizationId,
					actorUserId: userId,
					draftId: String(input.draftId),
				}),
			);
			const confirmation = confirmationOf(outcome);
			if (confirmation) return confirmation;
			return yield* Effect.fail(outcomeError(outcome as Exclude<HandOffOutcome, { ok: true }>));
		}),
);

/** One hand-off with lines, work, marks and its timesheet. */
export const getInvoiceDraftAction = organizationAction(
	{
		name: "billableTime.handOff.readHandOff",
		requires: "orgAdmin",
		schema: getInvoiceDraftActionSchema,
	},
	({ organizationId, input }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			const detail = yield* dbService.query("billableTime.handOff.detail", async () => {
				const draft = await getInvoiceDraftDetail(dbService.db, defaultAccountingDependencies(), {
					organizationId,
					draftId: String(input.draftId),
				});
				if (!draft) return null;
				const reconciliation = await readDraftReconciliation(dbService.db, {
					organizationId,
					draftId: draft.id,
				});
				return { ...draft, ...reconciliation } satisfies InvoiceDraftDetailView;
			});
			if (!detail) return yield* Effect.fail(draftNotFound());
			return detail;
		}),
);

/**
 * Asks the accounting tool for a draft's status (called when a hand-off is
 * opened). A draft reported as gone suggests a release; nothing is released.
 */
export const checkInvoiceDraftStatusAction = organizationAction(
	{
		name: "billableTime.handOff.checkInvoiceDraftStatus",
		requires: "orgAdmin",
		schema: checkInvoiceDraftStatusActionSchema,
	},
	({ organizationId, input }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			const outcome = yield* dbService.query("billableTime.handOff.status", () =>
				checkInvoiceDraftStatus(dbService.db, defaultAccountingDependencies(), {
					organizationId,
					draftId: String(input.draftId),
				}),
			);
			if (!outcome.ok) return yield* Effect.fail(draftNotFound());
			return outcome.status;
		}),
);

/** Releases a hand-off: its work is un-invoiced again. Audited. */
export const releaseInvoiceDraftAction = organizationAction(
	{
		name: "billableTime.handOff.releaseInvoiceDraft",
		requires: "orgAdmin",
		schema: releaseInvoiceDraftActionSchema,
	},
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const userId = actor.userId;
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
		}),
);

export interface ReconciliationCsvFile {
	fileName: string;
	content: string;
}

/**
 * Builds a reconciliation CSV from what was read. A value it can't write (a
 * stored amount that isn't one) is logged with its detail, never shown.
 */
const reconciliationCsvOf = (build: () => string) =>
	Effect.try({
		try: build,
		catch: (cause) => new Error("The reconciliation CSV could not be built", { cause }),
	}).pipe(Effect.orDie);

/**
 * A draft's reconciliation CSV (#1504): its items marked or resolved, released
 * drafts included. Works while the module is off.
 */
export const downloadDraftReconciliationCsvAction = organizationAction(
	{
		name: "billableTime.handOff.downloadDraftReconciliationCsv",
		requires: "orgAdmin",
		schema: downloadDraftReconciliationCsvActionSchema,
	},
	({ organizationId, input }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			const reconciliation = yield* dbService.query("billableTime.handOff.reconciliationCsv", () =>
				readDraftReconciliationItems(dbService.db, {
					organizationId,
					draftId: String(input.draftId),
				}),
			);
			if (!reconciliation) return yield* Effect.fail(draftNotFound());
			const { period, items } = reconciliation;
			return {
				fileName: `reconciliation-${period.from}_${period.to}.csv`,
				content: yield* reconciliationCsvOf(() => reconciliationCsv(items)),
			};
		}),
);

/**
 * Every item currently marked as changed after invoicing as a reconciliation
 * CSV (#1504), in the changed-work list's order. Works while the module is off.
 */
export const downloadChangedWorkCsvAction = organizationAction(
	{ name: "billableTime.handOff.downloadChangedWorkCsv", requires: "orgAdmin", schema: noInput },
	({ organizationId }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			const marked = yield* dbService.query("billableTime.handOff.changedWorkCsv", () =>
				listMarkedItems(dbService.db, organizationId),
			);
			const content = yield* reconciliationCsvOf(() =>
				reconciliationCsv(
					groupChangedWork(marked).flatMap((customer) =>
						customer.drafts.flatMap((draft) => draft.items),
					),
				),
			);
			return { fileName: "changed-after-invoicing.csv", content };
		}),
);

/** Server messages are English; the dialog shows its own copy per refusal. */
const characterCount = (count: number) => count.toLocaleString("en-US");

function resolutionInputError(error: ResolutionFieldError) {
	const refusal = `${error.field}.${error.code}`;
	switch (refusal) {
		case "explanation.required":
			return new ValidationError({
				message: "Explain how the change was handled",
				field: error.field,
				refusal,
			});
		case "explanation.too_long":
			return new ValidationError({
				message: `Keep the explanation to ${characterCount(RESOLUTION_EXPLANATION_MAX_LENGTH)} characters`,
				field: error.field,
				refusal,
			});
		case "accountingReference.too_long":
			return new ValidationError({
				message: `Keep the accounting reference to ${characterCount(RESOLUTION_REFERENCE_MAX_LENGTH)} characters`,
				field: error.field,
				refusal,
			});
		default:
			return new ValidationError({ message: "Choose marked work", field: error.field, refusal });
	}
}

/**
 * Resolves changed-after-invoicing marks (#1499): one resolution and audit row
 * per item, sharing the explanation and accounting reference. The whole batch
 * is refused as `stale`, naming the items, when any item changed since it was
 * loaded, and as `released` when an item's draft was released (#1503). Works
 * while the module is off.
 */
export const resolveChangedAfterInvoicingAction = organizationAction(
	{
		name: "billableTime.handOff.resolveChangedAfterInvoicing",
		requires: "orgAdmin",
		schema: resolveChangedAfterInvoicingActionSchema,
	},
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const userId = actor.userId;
			const parsed = parseResolutionInput(input);
			if (!parsed.ok) return yield* Effect.fail(resolutionInputError(parsed.errors[0]));
			const dbService = yield* DatabaseService;
			const outcome = yield* dbService.query("billableTime.handOff.resolveMarks", () =>
				resolveChangedAfterInvoicing(dbService.db, {
					organizationId,
					actorUserId: userId,
					resolution: parsed.value,
				}),
			);
			if (outcome.ok) return { status: "resolved", resolved: outcome.resolved } as const;
			if (outcome.reason === "stale" || outcome.reason === "released") {
				return { status: outcome.reason, invoicedWorkIds: outcome.invoicedWorkIds } as const;
			}
			return yield* Effect.fail(
				new NotFoundError({
					message: "Some of this work was not found. Reload and try again",
					entityType: "invoiced_work",
				}),
			);
		}),
);
