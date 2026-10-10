/**
 * The Lexware Office connector (#904): the `AccountingProvider` port over the
 * Lexware Office Public API (https://developers.lexware.io/docs/, read
 * 2026-10-09). An organization connects it with a Public API key (XL plan)
 * that lives only in the org secret store; Z8 passes it in when it opens a
 * provider.
 *
 * - Contacts: `GET /v1/contacts` (customers only, name filter ≥ 3 characters).
 * - Drafts: `POST /v1/invoices` without `finalize`, so Lexware creates a draft.
 *   Lexware has no idempotency key: the draft's remark carries a marker derived
 *   from Z8's key, and before creating, the connector looks for a draft of the
 *   contact carrying it (`GET /v1/voucherlist` + `GET /v1/invoices/{id}`).
 * - Status: `GET /v1/invoices/{id}` → `voucherStatus`; 404 means gone.
 * - EUR only: a connection is refused unless the billable currency is EUR.
 */

import "server-only";

import { createHash } from "node:crypto";
import { type Clock, type PlainDate, systemClock } from "@/lib/datetime/temporal-core";
import { checkInvoiceDraftFits, type InvoiceDraft } from "../invoice-draft";
import {
	type AccountingConnector,
	type AccountingContact,
	type AccountingProvider,
	type AccountingProviderCapabilities,
	AccountingProviderError,
	type CreatedInvoiceDraft,
	type InvoiceDraftToolStatus,
} from "../provider";
import { TAX_TREATMENT_KINDS } from "../tax-treatment";
import {
	customerContactFromLexware,
	encodeContactNameFilter,
	isLexwareId,
	type LexwarePage,
	readPage,
} from "./contacts";
import { lexwareInvoiceRequest, lexwareToday } from "./invoice-request";
import {
	createLexwarePacer,
	LEXWARE_API_BASE_URL,
	type LexwareFetch,
	type LexwarePacer,
	type LexwareTransport,
	lexwareFailure,
	lexwareRequest,
} from "./lexware-client";

export const LEXWARE_OFFICE_CAPABILITIES: AccountingProviderCapabilities = Object.freeze({
	/** "Invoices Endpoint", line items: at most 300 per voucher. */
	maxDraftLines: 300,
	/** `unitPrice.currency` and `totalPrice.currency` accept EUR only. */
	supportedCurrencies: Object.freeze(["EUR"] as const),
	supportedTaxTreatments: TAX_TREATMENT_KINDS,
	draftStatusCheck: true,
	/** "Filtering Contacts": the name filter needs at least 3 characters. */
	contactSearchMinLength: 3,
});

/** Where an admin opens a draft: "{appbaseurl}/permalink/invoices/edit/{id}". */
export const LEXWARE_APP_BASE_URL = "https://app.lexware.de";

export interface LexwareConnectorOptions {
	fetch?: LexwareFetch;
	sleep?: (ms: number) => Promise<void>;
	/** Monotonic milliseconds for request pacing. */
	monotonicNow?: () => number;
	/** Today's date in Lexware's zone (voucher date, look-up window). */
	clock?: Clock;
	baseUrl?: string;
	appBaseUrl?: string;
}

/** Pacers by API key fingerprint: one Lexware rate limit per key, process-wide per connector. */
function keyFingerprint(apiKey: string): string {
	return createHash("sha256").update(apiKey).digest("hex");
}

export function createLexwareOfficeConnector(
	options: LexwareConnectorOptions = {},
): AccountingConnector {
	const transport: LexwareTransport = {
		fetch: options.fetch ?? ((url, init) => fetch(url, init)),
		sleep: options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
		now: options.monotonicNow ?? (() => performance.now()),
		baseUrl: options.baseUrl ?? LEXWARE_API_BASE_URL,
	};
	const clock = options.clock ?? systemClock;
	const appBaseUrl = options.appBaseUrl ?? LEXWARE_APP_BASE_URL;
	const pacers = new Map<string, LexwarePacer>();

	const pacerFor = (apiKey: string): LexwarePacer => {
		const fingerprint = keyFingerprint(apiKey);
		let pacer = pacers.get(fingerprint);
		if (!pacer) {
			pacer = createLexwarePacer(transport);
			pacers.set(fingerprint, pacer);
		}
		return pacer;
	};

	const connector: AccountingConnector = {
		kind: "lexware_office",
		capabilities: LEXWARE_OFFICE_CAPABILITIES,

		async validateConnection({ apiKey, context }) {
			if (context.billableCurrency !== "EUR") {
				return {
					ok: false,
					code: "currency_not_supported",
					message: `Lexware Office only accepts invoices in EUR. This organization's billable currency is ${context.billableCurrency}.`,
				};
			}
			const response = await lexwareRequest(
				transport,
				pacerFor(apiKey),
				apiKey,
				"GET",
				"/v1/profile",
			);
			if (response.status !== 200) {
				throw lexwareFailure(response, "GET", "read the account profile");
			}
			const profile = readProfile(response.body);
			if (!profile) {
				throw new AccountingProviderError(
					"not_performed",
					"Lexware Office sent an unreadable account profile",
				);
			}
			return {
				ok: true,
				accountRef: profile.organizationId,
				accountLabel: profile.companyName,
				settings: {},
			};
		},

		open({ apiKey }) {
			return openLexwareProvider({
				apiKey,
				transport,
				pacer: () => pacerFor(apiKey),
				clock,
				appBaseUrl,
			});
		},
	};
	return connector;
}

function readProfile(body: unknown): { organizationId: string; companyName: string | null } | null {
	if (typeof body !== "object" || body === null) return null;
	const { organizationId, companyName } = body as Record<string, unknown>;
	if (typeof organizationId !== "string" || organizationId.trim() === "") return null;
	return {
		organizationId,
		companyName: typeof companyName === "string" && companyName.trim() !== "" ? companyName : null,
	};
}

interface ProviderContext {
	apiKey: string;
	transport: LexwareTransport;
	pacer: () => LexwarePacer;
	clock: Clock;
	appBaseUrl: string;
}

/** Search results per request; the picker asks the admin to narrow beyond this. */
const CONTACT_SEARCH_PAGE_SIZE = 25;
/** The largest page Lexware serves ("Paging of Resources"). */
const CONTACT_LIST_PAGE_SIZE = 250;

function openLexwareProvider(context: ProviderContext): AccountingProvider {
	const { apiKey, transport } = context;

	const get = (path: string, query?: string) =>
		lexwareRequest(transport, context.pacer(), apiKey, "GET", path, { query });

	const unreadable = (action: string) =>
		new AccountingProviderError(
			"not_performed",
			`Lexware Office sent an unreadable answer to ${action}`,
		);

	async function contactsPage(query: string, action: string): Promise<LexwarePage> {
		const response = await get("/v1/contacts", query);
		if (response.status !== 200) throw lexwareFailure(response, "GET", action);
		const page = readPage(response.body);
		if (!page) throw unreadable(action);
		return page;
	}

	return {
		kind: "lexware_office",
		capabilities: LEXWARE_OFFICE_CAPABILITIES,

		async searchContacts(query) {
			const needle = query.trim();
			if (needle.length < LEXWARE_OFFICE_CAPABILITIES.contactSearchMinLength) {
				throw new AccountingProviderError(
					"rejected",
					"Lexware Office searches need at least 3 characters",
				);
			}
			const paging = `page=0&size=${CONTACT_SEARCH_PAGE_SIZE}`;
			const pages: LexwarePage[] = [];
			if (/^\d{1,9}$/.test(needle)) {
				pages.push(
					await contactsPage(`customer=true&number=${needle}&${paging}`, "search contacts"),
				);
			}
			const byName = await contactsPage(
				`customer=true&name=${encodeContactNameFilter(needle)}&${paging}`,
				"search contacts",
			);
			pages.push(byName);

			const seen = new Set<string>();
			const contacts: AccountingContact[] = [];
			for (const page of pages) {
				for (const item of page.content) {
					const contact = customerContactFromLexware(item);
					if (!contact || seen.has(contact.id)) continue;
					seen.add(contact.id);
					contacts.push(contact);
				}
			}
			return { contacts, truncated: !byName.last };
		},

		async getContact(contactId) {
			if (!isLexwareId(contactId)) return null;
			const response = await get(`/v1/contacts/${contactId}`);
			if (response.status === 404) return null;
			if (response.status !== 200) throw lexwareFailure(response, "GET", "read the contact");
			return customerContactFromLexware(response.body);
		},

		async listCustomerContacts({ cursor }) {
			const pageNumber = cursor === null ? 0 : Number(cursor);
			if (!Number.isSafeInteger(pageNumber) || pageNumber < 0 || cursor === "") {
				throw new AccountingProviderError("rejected", "Not a Lexware Office contact page");
			}
			const page = await contactsPage(
				`customer=true&page=${pageNumber}&size=${CONTACT_LIST_PAGE_SIZE}`,
				"list contacts",
			);
			return {
				contacts: page.content
					.map(customerContactFromLexware)
					.filter((contact): contact is AccountingContact => contact !== null),
				nextCursor: page.last ? null : String(pageNumber + 1),
			};
		},

		async createInvoiceDraft(draft, { idempotencyKey, firstAttemptAt }) {
			const key = idempotencyKey.trim();
			if (key === "") {
				throw new AccountingProviderError("rejected", "An idempotency key is required");
			}
			refuseUnfitDraft(draft);
			const marker = lexwareDraftMarker(key);

			// Lexware has no idempotency key: an earlier attempt with this key may
			// have created the draft before its answer was lost. Find it first.
			const since = lexwareToday(firstAttemptAt ?? context.clock.nowInstant()).subtract({
				days: 1,
			});
			const existing = await findMarkedDraft(draft.contactId, marker, since);
			if (existing) return created(existing);

			const response = await lexwareRequest(
				transport,
				context.pacer(),
				apiKey,
				"POST",
				"/v1/invoices",
				{
					body: lexwareInvoiceRequest(draft, {
						marker,
						today: lexwareToday(context.clock.nowInstant()),
					}),
				},
			);
			if (response.status !== 200 && response.status !== 201) {
				throw lexwareFailure(response, "POST", "create the invoice draft");
			}
			const id = record(response.body)?.id;
			if (typeof id !== "string" || !isLexwareId(id)) {
				throw new AccountingProviderError(
					"outcome_unknown",
					"Lexware Office accepted the invoice draft but its answer was unreadable",
				);
			}
			return created(id);
		},

		async getInvoiceDraftStatus(externalId) {
			if (!isLexwareId(externalId)) return { kind: "gone" };
			const response = await get(`/v1/invoices/${externalId}`);
			if (response.status === 404) return { kind: "gone" };
			if (response.status !== 200) throw lexwareFailure(response, "GET", "read the invoice");
			const voucherStatus = record(response.body)?.voucherStatus;
			if (typeof voucherStatus !== "string") throw unreadable("the invoice status");
			return { kind: "status", status: draftStatus(voucherStatus), toolStatus: voucherStatus };
		},
	};

	function created(externalId: string): CreatedInvoiceDraft {
		return {
			externalId,
			externalUrl: `${context.appBaseUrl}/permalink/invoices/edit/${externalId}`,
		};
	}

	/**
	 * The id of an invoice of `contactId` created since `since` whose remark
	 * carries `marker`, or null. The voucher list has no remark, so each
	 * candidate is read; more candidates than one page refuses to guess.
	 */
	async function findMarkedDraft(
		contactId: string,
		marker: string,
		since: PlainDate,
	): Promise<string | null> {
		const response = await get(
			"/v1/voucherlist",
			[
				"voucherType=invoice",
				"voucherStatus=any",
				`contactId=${contactId}`,
				`createdDateFrom=${since.toString()}`,
				"page=0",
				`size=${MARKER_LOOKUP_PAGE_SIZE}`,
				"sort=createdDate,DESC",
			].join("&"),
		);
		if (response.status !== 200) {
			throw lexwareFailure(response, "GET", "check for an earlier invoice draft");
		}
		const page = readPage(response.body);
		if (!page) throw unreadable("the invoice list");
		if (!page.last) {
			throw new AccountingProviderError(
				"rejected",
				`Too many recent Lexware Office invoices for this contact to rule out a duplicate; look for a draft whose remark ends with "${marker}"`,
			);
		}
		for (const item of page.content) {
			const id = record(item)?.id;
			if (typeof id !== "string" || !isLexwareId(id)) continue;
			const invoice = await get(`/v1/invoices/${id}`);
			if (invoice.status === 404) continue;
			if (invoice.status !== 200) {
				throw lexwareFailure(invoice, "GET", "check for an earlier invoice draft");
			}
			const remark = record(invoice.body)?.remark;
			if (typeof remark === "string" && remark.includes(marker)) return id;
		}
		return null;
	}
}

/** Candidates the duplicate check reads at most (one voucher list page). */
const MARKER_LOOKUP_PAGE_SIZE = 50;

/**
 * The remark line that identifies a Z8 hand-off attempt: derived from the
 * idempotency key (a hash, so the key itself never reaches Lexware).
 */
export function lexwareDraftMarker(idempotencyKey: string): string {
	const digest = createHash("sha256").update(`z8-invoice-draft:${idempotencyKey}`).digest("hex");
	return `Z8-Ref: ${digest.slice(0, 24)}`;
}

/** Lexware `voucherStatus` → the port's draft status ("Invoice Properties"). */
function draftStatus(voucherStatus: string): InvoiceDraftToolStatus {
	if (voucherStatus === "draft") return "draft";
	if (voucherStatus === "voided") return "voided";
	// open, paid, paidoff, overdue: issued in Lexware, no longer an editable draft.
	return "finalized";
}

function refuseUnfitDraft(draft: InvoiceDraft): void {
	for (const problem of checkInvoiceDraftFits(draft, LEXWARE_OFFICE_CAPABILITIES)) {
		switch (problem.problem) {
			case "too_many_lines":
				throw new AccountingProviderError(
					"rejected",
					`Lexware Office takes at most ${problem.maxDraftLines} lines per invoice; this draft has ${problem.lines}`,
				);
			case "currency_not_supported":
				throw new AccountingProviderError(
					"rejected",
					`Lexware Office only accepts invoices in EUR, not ${problem.currency}`,
				);
			case "tax_treatment_not_supported":
				throw new AccountingProviderError(
					"rejected",
					`Lexware Office cannot take the tax treatment ${problem.taxTreatment}`,
				);
		}
	}
	if (!isLexwareId(draft.contactId)) {
		throw new AccountingProviderError(
			"rejected",
			"The customer's contact link does not point to a Lexware Office contact",
		);
	}
}

function record(value: unknown): Record<string, unknown> | null {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}
