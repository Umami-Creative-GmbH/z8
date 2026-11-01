/**
 * What the hand-off screens receive (#903): serializable, amounts as
 * two-decimal strings, days as ISO dates. Client-safe.
 */

import type { AccountingProviderKind, InvoiceDraftToolStatus } from "../accounting/provider";
import type { TaxTreatmentView } from "../accounting/views";

/** The hand-off area's section listing work changed after invoicing. */
export const CHANGED_AFTER_INVOICING_ANCHOR = "changed-after-invoicing";
/** Where reports send owners and admins to see which work is marked. */
export const CHANGED_AFTER_INVOICING_HREF = `/settings/billable-time/hand-off#${CHANGED_AFTER_INVOICING_ANCHOR}`;

export interface HandOffWorkView {
	workPeriodId: string;
	/** The employee-local day the work started on (ISO). */
	day: string;
	employeeName: string;
	projectName: string;
	/** Recorded hours, two decimals. */
	hours: string;
}

export interface HandOffLineView {
	position: number;
	kind: "work" | "text";
	projectId: string | null;
	projectName: string | null;
	text: string;
	/** Hours with two decimals, the line's quantity. */
	hours: string | null;
	rate: string | null;
	amount: string | null;
}

/** Why the preview cannot be confirmed. */
export type HandOffBlockerView =
	| { kind: "billable_time_off" }
	| { kind: "not_connected" }
	| { kind: "provider_unavailable" }
	| { kind: "no_contact_link" }
	| { kind: "unpriced_work"; count: number }
	| { kind: "nothing_to_hand_off" }
	| { kind: "too_many_lines"; lines: number; maxDraftLines: number }
	| { kind: "currency_not_supported"; currency: string }
	| { kind: "tax_treatment_not_supported"; taxTreatment: string };

export interface HandOffPreview {
	customer: { id: string; name: string };
	period: { from: string; to: string };
	projects: { id: string; name: string; selected: boolean }[];
	currency: string;
	connection: {
		providerKind: AccountingProviderKind;
		accountLabel: string | null;
		maxDraftLines: number | null;
	} | null;
	contact: { contactId: string; contactName: string; contactNumber: string | null } | null;
	taxTreatment: (TaxTreatmentView & { source: "customer" | "connection" }) | null;
	lines: HandOffLineView[];
	netTotal: string;
	/** Sum of the work lines' hours. */
	hours: string;
	included: HandOffWorkView[];
	heldBack: HandOffWorkView[];
	alreadyInvoiced: HandOffWorkView[];
	unpriced: (HandOffWorkView & { unpricedHours: string })[];
	/** Billable work on projects without a customer in the period: never handed off. */
	withoutCustomer: { count: number; hours: string; projects: string[] };
	nonBillable: { count: number; hours: string };
	timesheetLineCount: number;
	/** Periods the timesheet lines leave out to fit the tool (the download has all). */
	timesheetOmitted: number;
	blockers: HandOffBlockerView[];
	/** Identifies exactly this preview; confirm refuses when the work changed since. */
	fingerprint: string;
}

export type InvoiceDraftStatusView = "pending" | "created" | "failed" | "released";

export interface InvoiceDraftSummaryView {
	id: string;
	customerId: string;
	customerName: string;
	providerKind: AccountingProviderKind;
	status: InvoiceDraftStatusView;
	period: { from: string; to: string };
	currency: string;
	netTotal: string;
	externalId: string | null;
	externalUrl: string | null;
	createdAt: string;
	createdByName: string | null;
	workCount: number;
	changedCount: number;
	/** Some call may have reached the tool; a retry finds the draft by its key. */
	outcomeUnknown: boolean;
	lastFailureMessage: string | null;
	toolStatus: string | null;
	toolStatusCheckedAt: string | null;
}

/**
 * What changed about invoiced work after invoicing. `customer`: its project
 * moved to another customer or to none (#1500).
 */
export const CHANGED_FIELDS = [
	"times",
	"project",
	"billability",
	"removed",
	"split",
	"customer",
] as const;

export type ChangedField = (typeof CHANGED_FIELDS)[number];

export interface InvoicedWorkView extends HandOffWorkView {
	invoicedWorkId: string;
	/** The split-off half of invoiced work: invoiced, not in the timesheet. */
	carried: boolean;
	changedAfterInvoicingAt: string | null;
	changedFields: ChangedField[];
}

/** One entry of a comparison item's resolution history (#1499). */
export type ResolutionHistoryEntryView =
	| {
			kind: "resolution";
			id: string;
			/** The item's handed-off invoiced work row. */
			invoicedWorkId: string;
			/** When it was resolved (an instant, ISO). */
			at: string;
			/** Null once the user was deleted. */
			actorName: string | null;
			explanation: string;
			accountingReference: string | null;
			resolvedFields: ChangedField[];
	  }
	| {
			/** A mark cleared before resolutions were recorded: no explanation, no values. */
			kind: "cleared_before_resolutions";
			invoicedWorkId: string;
			at: string;
			actorName: string | null;
	  };

/** What a comparison of invoiced work compares (#1501). */
export const COMPARED_FIELDS = [
	"day",
	"start",
	"end",
	"hours",
	"project",
	"customer",
	"billability",
	"removed",
] as const;

export type ComparedField = (typeof COMPARED_FIELDS)[number];

/** An instant (ISO) with the UTC offset the work recorded for it. */
export interface RecordedTimeView {
	at: string;
	offsetMinutes: number;
}

/** A project or customer; a null id is none, a null name one no longer found. */
export interface ComparedReferenceView {
	id: string | null;
	name: string | null;
}

/**
 * One column of a comparison: a comparison item's values over its pieces that
 * are not removed. Start is the earliest start, end the latest end, each at the
 * offset recorded for it; hours are the sum of the pieces. When every piece is
 * removed, only `removed` and the piece counts carry meaning.
 */
export interface ComparedWorkValuesView {
	removed: boolean;
	pieceCount: number;
	removedPieceCount: number;
	/** The work-local day of the start (ISO). */
	day: string | null;
	start: RecordedTimeView | null;
	/** Null while a piece is still running. */
	end: RecordedTimeView | null;
	/** Recorded minutes, net of breaks. */
	durationMinutes: number;
	/** `durationMinutes` as two-decimal hours. */
	hours: string;
	/** Distinct, in piece order. */
	projects: ComparedReferenceView[];
	customers: ComparedReferenceView[];
	billability: "billable" | "non_billable" | "mixed" | null;
}

/**
 * A comparison item's values as handed off, as last resolved (the latest
 * resolution's snapshot; null when never resolved) and now, with the fields
 * that differ (#1501). Add further per-item figures (such as an amount
 * difference) as fields of their own.
 */
export interface WorkComparisonView {
	handOff: ComparedWorkValuesView;
	lastResolved:
		| (ComparedWorkValuesView & {
				/** When the latest resolution was recorded (an instant, ISO). */
				resolvedAt: string;
				changedFromHandOff: ComparedField[];
		  })
		| null;
	current: ComparedWorkValuesView & {
		changedFromHandOff: ComparedField[];
		/** Null when the item was never resolved. */
		changedSinceResolution: ComparedField[] | null;
	};
}

/**
 * A comparison item marked as changed after invoicing: the handed-off row
 * (its day, employee, project and hours as handed off) with the split-off
 * pieces carried from it. `changedFields` and `changedAfterInvoicingAt` cover
 * all its rows (the earliest open change).
 */
export interface MarkedWorkItemView extends InvoicedWorkView {
	invoiceDraftId: string;
	/** Send it back when resolving: the item is refused when it changed since. */
	markVersion: string;
	/** Newest first. */
	history: ResolutionHistoryEntryView[];
	comparison: WorkComparisonView;
}

/**
 * What resolving did: `stale` names the items (handed-off rows) that changed
 * since they were loaded; then nothing was resolved.
 */
export type ResolveOutcomeView =
	| { status: "resolved"; resolved: number }
	| { status: "stale"; invoicedWorkIds: string[] };

/** One row of the timesheet: the work as it was handed off. */
export interface TimesheetRowView {
	day: string;
	employeeName: string;
	projectName: string;
	/** Local start and end time at the work's captured offset (HH:mm). */
	start: string;
	end: string;
	hours: string;
}

export interface InvoiceDraftDetailView extends InvoiceDraftSummaryView {
	contactName: string;
	contactNumber: string | null;
	taxTreatment: TaxTreatmentView;
	title: string;
	introduction: string | null;
	includeTimesheet: boolean;
	lines: HandOffLineView[];
	work: InvoicedWorkView[];
	/** Its comparison items still marked as changed after invoicing. */
	marked: MarkedWorkItemView[];
	/** Resolutions and earlier clears of all its items, newest first. */
	resolutionHistory: ResolutionHistoryEntryView[];
	timesheet: TimesheetRowView[];
	releaseReason: string | null;
	endedAt: string | null;
	/** Whether the connected tool can report the draft's status. */
	statusCheckSupported: boolean;
}

export type DraftToolStatusView =
	| { kind: "status"; status: InvoiceDraftToolStatus; toolStatus: string }
	| { kind: "gone" }
	| { kind: "unsupported" }
	| { kind: "unavailable"; message: string };

/** A customer the hand-off form offers, with what it still needs. */
export interface HandOffCustomerOption {
	id: string;
	name: string;
	hasContactLink: boolean;
	projects: { id: string; name: string }[];
}
