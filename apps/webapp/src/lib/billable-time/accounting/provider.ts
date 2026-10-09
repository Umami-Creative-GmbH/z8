/**
 * The `AccountingProvider` port (#903): everything Billable Time asks of an
 * organization's accounting tool. Real connectors (Lexware Office #904,
 * sevdesk #905) and the in-memory fake (`fake-provider.ts`) implement it; the
 * hand-off, the contact picker and the draft status check only ever talk to
 * this interface.
 *
 * A connector is plugged in through an `AccountingConnector` (validate a new
 * connection, open a provider for a stored one) registered in `registry.ts`
 * under its `AccountingProviderKind`.
 *
 * Secrets: a provider receives its API key when it is opened and must never put
 * it into an error message, a log line, a returned value or anything else that
 * leaves the connector.
 */

import type { BillableCurrency } from "@/lib/billable-time/currency";
import type { Instant } from "@/lib/datetime/temporal-core";
import type { InvoiceDraft } from "./invoice-draft";
import type { TaxTreatmentKind } from "./tax-treatment";

/**
 * Accounting tools an organization can connect. Keep in sync with the CHECK on
 * `accounting_connection.provider_kind`. The fake provider stands in for any of
 * them in tests; it is never a kind of its own.
 */
export const ACCOUNTING_PROVIDER_KINDS = ["lexware_office", "sevdesk"] as const;

export type AccountingProviderKind = (typeof ACCOUNTING_PROVIDER_KINDS)[number];

export function isAccountingProviderKind(value: unknown): value is AccountingProviderKind {
	return (
		typeof value === "string" && (ACCOUNTING_PROVIDER_KINDS as readonly string[]).includes(value)
	);
}

/** What a provider can do, declared up front so Z8 can refuse a hand-off before calling it. */
export interface AccountingProviderCapabilities {
	/** The most lines one invoice draft may have, work and text lines together (Lexware: 300). */
	maxDraftLines: number;
	/** Currencies a draft may be in (Lexware: EUR only). */
	supportedCurrencies: readonly BillableCurrency[];
	/** Tax treatments the connector can translate into the tool's tax types. */
	supportedTaxTreatments: readonly TaxTreatmentKind[];
	/** Whether `getInvoiceDraftStatus` can ask the tool; otherwise it answers `unsupported`. */
	draftStatusCheck: boolean;
	/** The shortest query `searchContacts` accepts (Lexware's name filter needs 3 characters). */
	contactSearchMinLength: number;
}

/** A contact in the accounting tool, as the contact picker shows it. */
export interface AccountingContact {
	/** The tool's contact id: what a contact link stores and a draft addresses. */
	id: string;
	/** The tool's customer number, if it has one. */
	customerNumber: string | null;
	/** Company name, or the person's name for a private customer. */
	name: string;
	/** The billing address as display text (one line per address line). */
	address: string | null;
	vatId: string | null;
	/**
	 * The contact's email address, if the tool has one. The customer import
	 * (#906) copies it onto a created customer. Optional while connectors add it.
	 */
	email?: string | null;
}

export interface ContactSearchResult {
	contacts: AccountingContact[];
	/** More contacts matched than were returned; the admin should narrow the query. */
	truncated: boolean;
}

/** The tool's state of a draft Z8 created. */
export type InvoiceDraftToolStatus =
	/** Still a draft the accountant can edit. */
	| "draft"
	/** Finalized (issued) in the tool, open or paid. */
	| "finalized"
	/** Voided or cancelled in the tool. */
	| "voided";

export type InvoiceDraftStatus =
	| {
			kind: "status";
			status: InvoiceDraftToolStatus /** The tool's own status word. */;
			toolStatus: string;
	  }
	/** The tool no longer knows the draft (deleted there). Suggests a release; never releases. */
	| { kind: "gone" }
	/** The provider cannot ask (`capabilities.draftStatusCheck` is false). */
	| { kind: "unsupported" };

export interface CreatedInvoiceDraft {
	/** The tool's id of the draft; Z8 stores it on its invoice draft. */
	externalId: string;
	/** A link that opens the draft in the tool, when the tool has one. */
	externalUrl: string | null;
}

/**
 * Why a provider call failed. The hand-off (903b) decides from this whether a
 * retry is safe:
 * - `unauthorized`: the tool refused the API key; the admin must replace the connection.
 * - `rejected`: the tool refused the request itself (validation); retrying the same request fails again.
 * - `not_performed`: the call certainly had no effect (429, 503 before processing, connection refused); retry later.
 * - `outcome_unknown`: the call may have taken effect (timeout, connection lost after sending).
 *   Retry `createInvoiceDraft` with the SAME idempotency key only.
 */
export type AccountingProviderFailure =
	| "unauthorized"
	| "rejected"
	| "not_performed"
	| "outcome_unknown";

/**
 * The only error a provider throws. `message` must be safe to show an admin and
 * must never contain the API key or raw response bodies with personal data.
 */
export class AccountingProviderError extends Error {
	readonly failure: AccountingProviderFailure;

	constructor(failure: AccountingProviderFailure, message: string, options?: { cause?: unknown }) {
		super(message, options);
		this.name = "AccountingProviderError";
		this.failure = failure;
	}
}

export function isAccountingProviderError(error: unknown): error is AccountingProviderError {
	return error instanceof AccountingProviderError;
}

/**
 * One opened connection to an accounting tool. Every method may throw an
 * `AccountingProviderError`; nothing else.
 */
export interface AccountingProvider {
	readonly kind: AccountingProviderKind;
	readonly capabilities: AccountingProviderCapabilities;

	/**
	 * Customer contacts whose name (or customer number, where the tool supports
	 * it) matches `query`. Callers pass a trimmed query of at least
	 * `capabilities.contactSearchMinLength` characters.
	 */
	searchContacts(query: string): Promise<ContactSearchResult>;

	/** One contact by the tool's id, or null when the tool does not know it. */
	getContact(contactId: string): Promise<AccountingContact | null>;

	/**
	 * Creates ONE invoice draft (never a finalized invoice) and returns its id.
	 *
	 * Idempotency contract: every call carries an idempotency key, and calls with
	 * the same key create at most one draft in the tool and return the same
	 * `externalId`. Tools without native idempotency keys (Lexware, sevdesk)
	 * write a marker derived from the key into the draft (e.g. its remark or
	 * internal note) and, before creating, look up a draft carrying that marker.
	 * The caller records the attempt with its key before calling, and after an
	 * `outcome_unknown` failure retries with the same key.
	 *
	 * The draft must already fit `capabilities` (`checkInvoiceDraftFits`).
	 */
	createInvoiceDraft(
		draft: InvoiceDraft,
		options: {
			idempotencyKey: string;
			/**
			 * When the first call with this key was attempted (the recorded attempt).
			 * Connectors that look drafts up by marker search the tool from this
			 * instant; without it they search from now, which only covers retries on
			 * the same day. The hand-off passes it on every retry.
			 */
			firstAttemptAt?: Instant;
		},
	): Promise<CreatedInvoiceDraft>;

	/** The tool's status of a draft Z8 created, `gone`, or `unsupported`. */
	getInvoiceDraftStatus(externalId: string): Promise<InvoiceDraftStatus>;

	/**
	 * Every customer contact, one page at a time, for the customer import (#906).
	 * Start with `cursor: null` and pass each `nextCursor` back until it is null.
	 * Cursors are opaque to callers. Archived contacts are left out.
	 *
	 * Optional while connectors add it: a provider without it cannot import.
	 */
	listCustomerContacts?(page: { cursor: string | null }): Promise<CustomerContactPage>;
}

export interface CustomerContactPage {
	contacts: AccountingContact[];
	/** Pass to the next call; null when this was the last page. */
	nextCursor: string | null;
}

/** A non-secret settings value a connector stores on the connection (JSON). */
export type AccountingConnectionSettings = Record<string, unknown>;

/** The organization facts a connector may refuse a connection on. */
export interface AccountingConnectionContext {
	organizationId: string;
	billableCurrency: BillableCurrency;
}

export type AccountingConnectionValidation =
	| {
			ok: true;
			/**
			 * The tool account the key belongs to (e.g. Lexware's organization id,
			 * sevdesk's client id). Contact links are only valid for this account:
			 * replacing the connection with a key of another account hides them.
			 */
			accountRef: string;
			/** A label for the account shown in settings, e.g. the company name in the tool. */
			accountLabel: string | null;
			/** Normalized non-secret settings to store on the connection. */
			settings: AccountingConnectionSettings;
	  }
	| {
			ok: false;
			/** A stable code for tests and logs, e.g. `currency_not_supported`. */
			code: string;
			/** A message an admin can act on. Never contains the key. */
			message: string;
	  };

/**
 * How a connector plugs into Z8 (#904, #905). Register it in `registry.ts`.
 */
export interface AccountingConnector {
	readonly kind: AccountingProviderKind;
	/** Static capabilities, also shown before a connection exists. */
	readonly capabilities: AccountingProviderCapabilities;

	/**
	 * Checks a new connection before it is stored, and may refuse it (Lexware
	 * refuses a non-EUR billable currency; sevdesk refuses unsupported tax-rule
	 * systems). It should prove the key works with one cheap call and identify
	 * the account. `settings` is untrusted input from the settings form.
	 * Throws `AccountingProviderError` when the tool cannot be reached.
	 */
	validateConnection(input: {
		apiKey: string;
		settings: unknown;
		context: AccountingConnectionContext;
	}): Promise<AccountingConnectionValidation>;

	/** Opens a provider for a stored connection. Must not call the tool yet. */
	open(input: { apiKey: string; settings: AccountingConnectionSettings }): AccountingProvider;
}
