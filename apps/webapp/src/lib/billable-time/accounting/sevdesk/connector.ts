/**
 * The sevdesk connector (#905): implements the `AccountingProvider` port against
 * the sevdesk API v1 (https://api.sevdesk.de/openapi.yaml). See `client.ts` for
 * transport, auth and back-off, and `invoice-request.ts` for the draft body.
 *
 * Connection setup (`validateConnection`) refuses what the connector does not
 * support: the old tax system (sevdesk-Update 1.0 `taxType`), accounts whose
 * prices are entered gross, and accounts without an hour unit. It picks the sevdesk user that becomes every draft's required
 * `contactPerson`.
 */

import "server-only";
import { createHash } from "node:crypto";
import { BILLABLE_CURRENCIES } from "@/lib/billable-time/currency";
import {
	type Clock,
	comparePlainDates,
	type PlainDate,
	systemClock,
} from "@/lib/datetime/temporal-core";
import { createLogger } from "@/lib/logger";
import { normalizeDecimalInput, parseUnits } from "@/lib/money/exact-decimal";
import { type InvoiceDraft, invoiceDraftNetTotal } from "../invoice-draft";
import {
	type AccountingConnectionValidation,
	type AccountingConnector,
	type AccountingContact,
	type AccountingContactPerson,
	type AccountingProvider,
	type AccountingProviderCapabilities,
	AccountingProviderError,
	type InvoiceDraftStatus,
	type InvoiceDraftToolStatus,
} from "../provider";
import {
	createSevdeskClient,
	type SevdeskClient,
	type SevdeskTransportOptions,
	sevdeskErrorMessage,
} from "./client";
import { buildSaveInvoiceRequest, SEVDESK_TIME_ZONE, sevdeskTimestamp } from "./invoice-request";

const logger = createLogger("SevdeskConnector");

/** sevdesk ids are integers (sent as JSON numbers); anything else never reaches a URL path. */
const SEVDESK_ID = /^\d{1,15}$/;

export const SEVDESK_CAPABILITIES: AccountingProviderCapabilities = {
	// Not documented by sevdesk; conservative until confirmed on a trial account.
	maxDraftLines: 100,
	// openapi.yaml `Model_Invoice.currency`: "Needs to be currency code according to
	// ISO-4217", with foreign-currency sums; no EUR-only rule (that is Lexware's).
	supportedCurrencies: BILLABLE_CURRENCIES,
	supportedTaxTreatments: [
		"domestic_standard",
		"domestic_reduced",
		"eu_reverse_charge",
		"third_country_service",
		"vat_free",
	],
	draftStatusCheck: true,
	contactSearchMinLength: 2,
};

/** Non-secret settings stored on a sevdesk connection. */
export interface SevdeskConnectionSettings {
	bookkeepingSystemVersion: "2.0";
	prices: "net";
	/** The sevdesk user (`SevUser`) every draft names as `contactPerson`. */
	contactPersonId: string;
	contactPersonName: string;
	/** The `Unity` id of the hour unit, used on every work position. */
	hourUnityId: string;
}

/** A sevdesk user an admin can pick as the drafts' contact person. */
type SevdeskContactPerson = AccountingContactPerson;

export interface SevdeskConnectorOptions extends SevdeskTransportOptions {
	clock?: Clock;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

/** sevdesk wraps payloads in `objects`; list endpoints return an array there. */
function objectsOf(body: unknown): unknown {
	return isRecord(body) ? body.objects : undefined;
}

function rowsOf(body: unknown): Record<string, unknown>[] {
	const objects = objectsOf(body);
	return Array.isArray(objects) ? objects.filter(isRecord) : [];
}

function text(value: unknown): string | null {
	if (typeof value === "string") return value.trim() === "" ? null : value.trim();
	if (typeof value === "number" && Number.isFinite(value)) return String(value);
	return null;
}

function refId(value: unknown): string | null {
	return isRecord(value) ? text(value.id) : null;
}

function isHidden(row: Record<string, unknown>): boolean {
	return row.hidden === true || row.hidden === "1" || row.hidden === 1;
}

function userName(row: Record<string, unknown>, id: string): string {
	const full = text(row.fullname);
	if (full) return full;
	const parts = [text(row.firstName), text(row.lastName)].filter(Boolean);
	if (parts.length > 0) return parts.join(" ");
	return text(row.username) ?? text(row.email) ?? `sevdesk user ${id}`;
}

async function readContactPersons(client: SevdeskClient): Promise<{
	persons: SevdeskContactPerson[];
	sevClientId: string | null;
}> {
	const response = await client({ method: "GET", path: "/SevUser" });
	const rows = rowsOf(response.body);
	const persons: SevdeskContactPerson[] = [];
	let sevClientId: string | null = null;
	for (const row of rows) {
		sevClientId ??= refId(row.sevClient);
		const id = text(row.id);
		if (!id || !SEVDESK_ID.test(id) || isHidden(row)) continue;
		persons.push({ id, name: userName(row, id) });
	}
	return { persons, sevClientId };
}

const HOUR_UNIT_NAMES = new Set(["std", "stunde", "stunden", "h", "hour", "hours"]);

function isHourUnit(row: Record<string, unknown>): boolean {
	const code = text(row.translationCode)?.toUpperCase() ?? "";
	if (code === "UNITY_HOUR" || code.endsWith("_HOUR") || code.endsWith("_HOURS")) return true;
	const name = text(row.name)?.toLowerCase().replace(/\.$/, "") ?? "";
	return HOUR_UNIT_NAMES.has(name);
}

/** The settings form's untrusted input: `{ contactPersonId?, netPrices? }`. */
function parseSetupInput(settings: unknown): {
	contactPersonId: string | null;
	netPrices: boolean;
} {
	if (!isRecord(settings)) return { contactPersonId: null, netPrices: false };
	return {
		contactPersonId: text(settings.contactPersonId),
		netPrices: settings.netPrices === true,
	};
}

function refuse(code: string, message: string): AccountingConnectionValidation {
	return { ok: false, code, message };
}

/** Stored settings, or null when the connection was stored without them. */
export function parseSevdeskSettings(settings: unknown): SevdeskConnectionSettings | null {
	if (!isRecord(settings)) return null;
	const contactPersonId = text(settings.contactPersonId);
	const hourUnityId = text(settings.hourUnityId);
	if (
		settings.bookkeepingSystemVersion !== "2.0" ||
		settings.prices !== "net" ||
		!contactPersonId ||
		!hourUnityId ||
		!SEVDESK_ID.test(contactPersonId) ||
		!SEVDESK_ID.test(hourUnityId)
	) {
		return null;
	}
	return {
		bookkeepingSystemVersion: "2.0",
		prices: "net",
		contactPersonId,
		contactPersonName: text(settings.contactPersonName) ?? contactPersonId,
		hourUnityId,
	};
}

export function createSevdeskConnector(
	options: SevdeskConnectorOptions = {},
): AccountingConnector & Required<Pick<AccountingConnector, "listContactPersons">> {
	const clock = options.clock ?? systemClock;
	const clientFor = (apiKey: string) => createSevdeskClient(apiKey.trim(), options);

	return {
		kind: "sevdesk",
		capabilities: SEVDESK_CAPABILITIES,

		async listContactPersons({ apiKey }) {
			return (await readContactPersons(clientFor(apiKey))).persons;
		},

		async validateConnection({ apiKey, settings }) {
			const input = parseSetupInput(settings);
			const client = clientFor(apiKey);

			const version = await client({ method: "GET", path: "/Tools/bookkeepingSystemVersion" });
			const objects = objectsOf(version.body);
			const systemVersion = isRecord(objects) ? text(objects.version) : null;
			if (systemVersion !== "2.0") {
				return refuse(
					"tax_rule_system_not_supported",
					"This sevdesk account still uses the old tax system (sevdesk-Update 1.0). Z8 supports accounts on sevdesk-Update 2.0 with tax rules only",
				);
			}
			if (!input.netPrices) {
				return refuse(
					"gross_prices_not_supported",
					"Z8 hands off net prices. Confirm that this sevdesk account enters invoice prices as net prices",
				);
			}

			const { persons, sevClientId } = await readContactPersons(client);
			let contactPerson: SevdeskContactPerson | undefined;
			if (input.contactPersonId) {
				contactPerson = persons.find((person) => person.id === input.contactPersonId);
				if (!contactPerson) {
					return refuse(
						"contact_person_unknown",
						"The chosen sevdesk user does not exist in this account. Load the users again and choose one",
					);
				}
			} else if (persons.length === 1) {
				contactPerson = persons[0];
			} else {
				return refuse(
					"contact_person_required",
					"Choose the sevdesk user that appears as contact person on the invoice drafts",
				);
			}

			const unityResponse = await client({ method: "GET", path: "/Unity" });
			const hourUnit = rowsOf(unityResponse.body).find(isHourUnit);
			const hourUnityId = hourUnit ? text(hourUnit.id) : null;
			if (!hourUnityId || !SEVDESK_ID.test(hourUnityId)) {
				return refuse(
					"hour_unit_missing",
					"This sevdesk account has no hour unit (Std). Add one in sevdesk and connect again",
				);
			}

			const accountRef = sevClientId;
			if (!accountRef) {
				return refuse(
					"account_not_identified",
					"Z8 could not identify the sevdesk account of this API token",
				);
			}

			const stored: SevdeskConnectionSettings = {
				bookkeepingSystemVersion: "2.0",
				prices: "net",
				contactPersonId: contactPerson.id,
				contactPersonName: contactPerson.name,
				hourUnityId,
			};
			return { ok: true, accountRef, accountLabel: null, settings: { ...stored } };
		},

		open({ apiKey, settings }): AccountingProvider {
			return openSevdeskProvider(clientFor(apiKey), parseSevdeskSettings(settings), clock);
		},
	};
}

const SEARCH_LIMIT = 25;
const LIST_PAGE_SIZE = 100;
/** sevdesk's contact category for customers (`category[id]=3`, Model_ContactResponse example). */
const CUSTOMER_CATEGORY_ID = "3";

function contactOf(row: Record<string, unknown>): AccountingContact | null {
	const id = text(row.id);
	if (!id) return null;
	const person = [text(row.surename), text(row.familyname)].filter(Boolean).join(" ");
	return {
		id,
		customerNumber: text(row.customerNumber),
		name: text(row.name) ?? (person || `sevdesk contact ${id}`),
		// Addresses live in `ContactAddress`; the picker does not need them.
		address: null,
		vatId: text(row.vatNumber),
	};
}

function contactsOf(body: unknown): AccountingContact[] {
	return rowsOf(body).flatMap((row) => contactOf(row) ?? []);
}

/**
 * openapi.yaml `Model_ContactResponse.status`: "100 <-> Lead - 500 <-> Pending -
 * 1000 <-> Active". sevdesk documents no archived flag or status, so the import
 * keeps exactly these (and rows without a status) and leaves out any other
 * status as archived or deactivated. To confirm on a trial account.
 */
const LIVE_CONTACT_STATUSES = new Set(["100", "500", "1000"]);

function isLiveContact(row: Record<string, unknown>): boolean {
	const status = text(row.status);
	return status === null || LIVE_CONTACT_STATUSES.has(status);
}

/** Contact addresses and emails by sevdesk contact id, for the customer import. */
interface ImportDetails {
	addresses: Map<string, string>;
	emails: Map<string, string>;
}

/** openapi.yaml "Pagination": `limit` "must be between 1 and 1000". */
const DETAIL_PAGE_SIZE = 1_000;
/** 100,000 rows; beyond that the import goes on without the rest of the details. */
const MAX_DETAIL_PAGES = 100;

async function readAll(
	client: SevdeskClient,
	path: string,
	query: Record<string, string> = {},
): Promise<Record<string, unknown>[]> {
	const all: Record<string, unknown>[] = [];
	for (let page = 0; page < MAX_DETAIL_PAGES; page += 1) {
		const response = await client({
			method: "GET",
			path,
			query: { ...query, limit: DETAIL_PAGE_SIZE, offset: page * DETAIL_PAGE_SIZE },
		});
		const rows = rowsOf(response.body);
		all.push(...rows);
		if (rows.length < DETAIL_PAGE_SIZE) return all;
	}
	logger.warn({ path }, "sevdesk listing stopped after the page limit; some contacts lack details");
	return all;
}

function numericId(row: Record<string, unknown>): number {
	const raw = text(row.id);
	const id = raw === null ? Number.NaN : Number(raw);
	return Number.isFinite(id) ? id : Number.MAX_SAFE_INTEGER;
}

function byNumericId(left: Record<string, unknown>, right: Record<string, unknown>): number {
	return numericId(left) - numericId(right);
}

/** "Street", "zip city": `Model_ContactAddressResponse`. The country is only a `StaticCountry` id. */
function addressText(row: Record<string, unknown>): string | null {
	const cityLine = [text(row.zip), text(row.city)].filter(Boolean).join(" ");
	const lines = [text(row.street), cityLine === "" ? null : cityLine].filter(
		(line): line is string => line !== null,
	);
	return lines.length === 0 ? null : lines.join("\n");
}

/**
 * Every contact address (`GET /ContactAddress`, "Retrieve all contact
 * addresses") and every email communication way (`GET /CommunicationWay` with
 * `type=EMAIL`) of the account, read in pages of 1,000. Per contact: the first
 * address by id (as `takeDefaultAddress` on a draft), and the main email, else
 * the first one by id.
 */
async function readImportDetails(client: SevdeskClient): Promise<ImportDetails> {
	const [addressRows, emailRows] = await Promise.all([
		readAll(client, "/ContactAddress"),
		readAll(client, "/CommunicationWay", { type: "EMAIL" }),
	]);
	const addresses = new Map<string, string>();
	for (const row of [...addressRows].sort(byNumericId)) {
		const contactId = refId(row.contact);
		const address = addressText(row);
		if (contactId && address && !addresses.has(contactId)) addresses.set(contactId, address);
	}
	const emails = new Map<string, string>();
	const isMain = (row: Record<string, unknown>) => text(row.main) === "1" || row.main === true;
	const ordered = [...emailRows]
		.filter((row) => text(row.type) === "EMAIL")
		.sort(
			(left, right) => Number(isMain(right)) - Number(isMain(left)) || byNumericId(left, right),
		);
	for (const row of ordered) {
		const contactId = refId(row.contact);
		const email = text(row.value);
		if (contactId && email && !emails.has(contactId)) emails.set(contactId, email);
	}
	return { addresses, emails };
}

/** The listing cursor is the next offset Z8 handed out; anything else is refused. */
function listOffset(cursor: string): number {
	const offset = /^\d{1,9}$/.test(cursor) ? Number(cursor) : Number.NaN;
	if (!Number.isSafeInteger(offset) || offset % LIST_PAGE_SIZE !== 0) {
		throw new AccountingProviderError("rejected", "Not a sevdesk contact page");
	}
	return offset;
}

/** A sevdesk provider always has the port's paged customer listing (#906's import). */
export type SevdeskProvider = AccountingProvider &
	Required<Pick<AccountingProvider, "listCustomerContacts">>;

function openSevdeskProvider(
	client: SevdeskClient,
	settings: SevdeskConnectionSettings | null,
	clock: Clock,
): SevdeskProvider {
	const customerQuery = { "category[id]": CUSTOMER_CATEGORY_ID, depth: 1 };
	// The customer import pages through contacts on one opened provider: read the
	// addresses and emails once for all pages instead of once per contact.
	let details: Promise<ImportDetails> | null = null;
	const importDetails = () => {
		details ??= readImportDetails(client).catch((error: unknown) => {
			details = null;
			throw error;
		});
		return details;
	};
	return {
		kind: "sevdesk",
		capabilities: SEVDESK_CAPABILITIES,

		async searchContacts(query) {
			const response = await client({
				method: "GET",
				path: "/Contact",
				query: { name: query, ...customerQuery, limit: SEARCH_LIMIT + 1, offset: 0 },
			});
			const found = contactsOf(response.body);
			return { contacts: found.slice(0, SEARCH_LIMIT), truncated: found.length > SEARCH_LIMIT };
		},

		async getContact(contactId) {
			if (!SEVDESK_ID.test(contactId)) return null;
			const response = await client({
				method: "GET",
				path: `/Contact/${contactId}`,
				accept: [400, 404],
			});
			if (response.status !== 200) return null;
			return contactsOf(response.body)[0] ?? null;
		},

		async listCustomerContacts({ cursor }) {
			const offset = cursor === null ? 0 : listOffset(cursor);
			const response = await client({
				method: "GET",
				path: "/Contact",
				query: { ...customerQuery, limit: LIST_PAGE_SIZE, offset },
			});
			const rows = rowsOf(response.body);
			const details = await importDetails();
			return {
				contacts: rows
					.filter(isLiveContact)
					.flatMap((row) => contactOf(row) ?? [])
					.map((contact) => ({
						...contact,
						address: details.addresses.get(contact.id) ?? null,
						email: details.emails.get(contact.id) ?? null,
					})),
				nextCursor: rows.length === LIST_PAGE_SIZE ? String(offset + LIST_PAGE_SIZE) : null,
			};
		},

		async createInvoiceDraft(draft, { idempotencyKey }) {
			if (!settings) {
				throw new AccountingProviderError(
					"rejected",
					"The sevdesk connection is missing its setup (contact person, hour unit). Replace the connection",
				);
			}
			if (idempotencyKey.trim() === "") {
				throw new AccountingProviderError("rejected", "An idempotency key is required");
			}
			if (!SEVDESK_ID.test(draft.contactId)) {
				throw new AccountingProviderError("rejected", "The linked sevdesk contact id is not valid");
			}
			const marker = draftMarker(idempotencyKey);
			const today = clock.nowInstant().toZonedDateTimeISO(SEVDESK_TIME_ZONE).toPlainDate();
			const invoiceDate =
				comparePlainDates(today, draft.servicePeriod.to) < 0 ? draft.servicePeriod.to : today;
			const request = buildSaveInvoiceRequest({
				draft,
				contactPersonId: settings.contactPersonId,
				hourUnityId: settings.hourUnityId,
				invoiceDate,
				marker,
			});
			if (!request.ok) throw new AccountingProviderError("rejected", request.message);

			const existing = await findDraftByMarker(client, {
				contactId: draft.contactId,
				from: draft.servicePeriod.to,
				marker,
			});
			if (existing) return { externalId: existing, externalUrl: null };

			const response = await client({
				method: "POST",
				path: "/Invoice/Factory/saveInvoice",
				body: request.json,
			});
			const objects = objectsOf(response.body);
			const invoice = isRecord(objects) && isRecord(objects.invoice) ? objects.invoice : null;
			const externalId = invoice ? text(invoice.id) : null;
			if (!invoice || !externalId) {
				// sevdesk answered 2xx without an id: the draft may exist; the retry's lookup finds it.
				throw new AccountingProviderError(
					"outcome_unknown",
					"sevdesk saved the draft but did not return its id",
				);
			}
			warnOnNetTotalMismatch(invoice, draft, externalId);
			return { externalId, externalUrl: null };
		},

		async getInvoiceDraftStatus(externalId): Promise<InvoiceDraftStatus> {
			if (!SEVDESK_ID.test(externalId)) {
				throw new AccountingProviderError("rejected", "Not a sevdesk invoice id");
			}
			const response = await client({
				method: "GET",
				path: `/Invoice/${externalId}`,
				accept: [400, 404],
			});
			if (response.status === 404) return { kind: "gone" };
			if (response.status === 400) {
				// openapi.yaml: "Bad request. Invoice was not found".
				if (/not found/i.test(sevdeskErrorMessage(response.body, "") ?? "")) {
					return { kind: "gone" };
				}
				throw new AccountingProviderError(
					"rejected",
					`sevdesk refused the status request: ${sevdeskErrorMessage(response.body, "") ?? "bad request"}`,
				);
			}
			const row = rowsOf(response.body)[0];
			if (!row) return { kind: "gone" };
			const toolStatus = text(row.status) ?? "unknown";
			return { kind: "status", status: draftStatusOf(toolStatus), toolStatus };
		},
	};
}

/**
 * sevdesk invoice status (openapi.yaml "Types and status of invoices"):
 * 100 draft; 200 open/due, 750 partially paid, 1000 paid. Anything else
 * (e.g. 50, a deactivated recurring invoice) counts as finalized, so it never
 * suggests a release.
 */
function draftStatusOf(toolStatus: string): InvoiceDraftToolStatus {
	return toolStatus === "100" ? "draft" : "finalized";
}

/**
 * The Z8 marker in `customerInternalNote`: derived from the hand-off's
 * idempotency key, so a retry finds the draft an ambiguous attempt created.
 * Hashed to keep Z8's ids out of the customer's books.
 */
export function draftMarker(idempotencyKey: string): string {
	return `Z8-${createHash("sha256").update(idempotencyKey).digest("hex").slice(0, 24)}`;
}

const LOOKUP_PAGE_SIZE = 100;
const MAX_LOOKUP_PAGES = 20;

/**
 * The id of an invoice of this contact dated from `from` on that carries the
 * marker, or null. Uses `GET /Invoice` with `contact[id]`, `contact[objectName]`
 * and `startDate` (openapi.yaml), paging with limit/offset. Throws `rejected`
 * when the page limit is reached without ruling out a marked draft.
 */
async function findDraftByMarker(
	client: SevdeskClient,
	input: { contactId: string; from: PlainDate; marker: string },
): Promise<string | null> {
	for (let page = 0; page < MAX_LOOKUP_PAGES; page += 1) {
		const response = await client({
			method: "GET",
			path: "/Invoice",
			query: {
				"contact[id]": input.contactId,
				"contact[objectName]": "Contact",
				startDate: sevdeskTimestamp(input.from),
				limit: LOOKUP_PAGE_SIZE,
				offset: page * LOOKUP_PAGE_SIZE,
			},
		});
		const rows = rowsOf(response.body);
		const match = rows.find((row) => text(row.customerInternalNote) === input.marker);
		if (match) return text(match.id);
		if (rows.length < LOOKUP_PAGE_SIZE) return null;
	}
	logger.warn(
		{ contactId: input.contactId },
		"sevdesk draft lookup stopped after the page limit without finding the marker",
	);
	// Creating now could duplicate a draft an earlier attempt made: refuse, as Lexware does.
	throw new AccountingProviderError(
		"rejected",
		`Too many sevdesk invoices for this contact to rule out a duplicate; look for a draft whose reference (customerInternalNote) is "${input.marker}"`,
	);
}

/** A safety net for the net-price assumption: logs (ids only) when sevdesk's net total differs. */
function warnOnNetTotalMismatch(
	invoice: Record<string, unknown>,
	draft: InvoiceDraft,
	externalId: string,
) {
	const sumNet = text(invoice.sumNet);
	const toolNet = sumNet === null ? null : parseUnits(normalizeDecimalInput(sumNet), 2);
	if (toolNet !== null && toolNet !== invoiceDraftNetTotal(draft)) {
		logger.warn(
			{ externalId },
			"sevdesk draft net total differs from Z8's; check that the account enters net prices",
		);
	}
}
