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

export type ChangedField = "times" | "project" | "billability" | "removed" | "split";

export interface InvoicedWorkView extends HandOffWorkView {
	invoicedWorkId: string;
	/** The split-off half of invoiced work: invoiced, not in the timesheet. */
	carried: boolean;
	changedAfterInvoicingAt: string | null;
	changedFields: ChangedField[];
}

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
