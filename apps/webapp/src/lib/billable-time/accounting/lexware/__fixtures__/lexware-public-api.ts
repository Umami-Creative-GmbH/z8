/**
 * Recorded Lexware Office Public API responses for the connector's contract
 * tests (#904). Lexware has no sandbox, so these mirror the official
 * documentation at https://developers.lexware.io/docs/ (read 2026-10-09); each
 * fixture names the section it follows. Ids, names and amounts are invented.
 * The connector is verified against a real XL trial account afterwards (see the
 * PR's "How to verify on a trial account").
 *
 * Test-only: never imported by production code.
 */

export const LEXWARE_ORGANIZATION_ID = "aa93e8a8-2aa3-470b-b914-caad8a255dd8";

/**
 * `GET /v1/profile` — section "Profile Endpoint", "Retrieve Profile Information"
 * (#profile-endpoint). `organizationId` identifies the Lexware account the key
 * belongs to; `companyName` labels it.
 */
export const profileResponse = {
	organizationId: LEXWARE_ORGANIZATION_ID,
	companyName: "Musterfirma Beratung GmbH",
	created: {
		userId: "1aea4ec5-3ed1-4bd1-b5b2-f2d5d8a8b2c4",
		userName: "Z8 Schnittstelle",
		userEmail: "z8@musterfirma.example",
		date: "2025-03-01T10:00:00.000+01:00",
	},
	connectionId: "3dea098b-fc2e-4e3a-9b1b-30f5f6e3b2a1",
	features: ["cashbox"],
	businessFeatures: ["INVOICING", "INVOICING_PRO", "BOOKKEEPING"],
	subscriptionStatus: "active",
	taxType: "net",
	smallBusiness: false,
	distanceSalesPrinciple: "ORIGIN",
};

export const ACME_CONTACT_ID = "e9066f04-8cc7-4616-93f8-ac9ecc8479c8";
export const PERSON_CONTACT_ID = "313ac5a5-b3ac-4a8a-9ad5-3b7f2a1f8a11";
export const VENDOR_CONTACT_ID = "be1a5c4a-6f73-4f7f-9e85-0d5d5cc0b0e2";
export const ARCHIVED_CONTACT_ID = "0f9f3c1e-6c55-4f0a-8a0e-6b0c8e1b7a44";

/**
 * A company contact with the customer role — section "Contacts Endpoint",
 * "Contact Properties" and the sample "Create a Contact" body
 * (#contacts-endpoint-contact-properties). Names are stored HTML-encoded
 * (section "Search String Encoding": "&" is "&amp;" in Lexware's database).
 */
export const acmeContact = {
	id: ACME_CONTACT_ID,
	organizationId: LEXWARE_ORGANIZATION_ID,
	version: 3,
	roles: { customer: { number: 10307 } },
	company: {
		name: "Acme Consulting &amp; Partner GmbH",
		taxNumber: "12345/12345",
		vatRegistrationId: "DE123456789",
		allowTaxFreeInvoices: true,
		contactPersons: [
			{
				salutation: "Herr",
				firstName: "Inge",
				lastName: "Musterfrau",
				primary: true,
				emailAddress: "inge.musterfrau@acme.example",
				phoneNumber: "08000/1231",
			},
		],
	},
	addresses: {
		billing: [
			{
				supplement: "Gebäude 10",
				street: "Musterstraße 42",
				zip: "79112",
				city: "Freiburg",
				countryCode: "DE",
			},
		],
		shipping: [{ street: "Lieferweg 1", zip: "79112", city: "Freiburg", countryCode: "DE" }],
	},
	xRechnung: { buyerReference: "04011000-1234512345-35", vendorNumberAtCustomer: "70123456" },
	emailAddresses: { business: ["info@acme.example"] },
	note: "Notizen",
	archived: false,
};

/** A private customer (`person` instead of `company`) abroad — same section. */
export const personContact = {
	id: PERSON_CONTACT_ID,
	organizationId: LEXWARE_ORGANIZATION_ID,
	version: 1,
	roles: { customer: { number: 10308 } },
	person: { salutation: "Frau", firstName: "Erika", lastName: "Acmeier" },
	addresses: {
		billing: [{ street: "Ringstraße 7", zip: "1010", city: "Wien", countryCode: "AT" }],
	},
	archived: false,
};

/** A supplier without the customer role: a draft may not address it (#invoices-endpoint). */
export const vendorContact = {
	id: VENDOR_CONTACT_ID,
	organizationId: LEXWARE_ORGANIZATION_ID,
	version: 0,
	roles: { vendor: { number: 70303 } },
	company: { name: "Acme Lieferant AG" },
	addresses: { billing: [] },
	archived: false,
};

/** An archived customer: hidden from the picker and the import. */
export const archivedContact = {
	id: ARCHIVED_CONTACT_ID,
	organizationId: LEXWARE_ORGANIZATION_ID,
	version: 7,
	roles: { customer: { number: 10001 } },
	company: { name: "Acme Alt GmbH" },
	archived: true,
};

/**
 * A page of `GET /v1/contacts` — sections "Contacts Endpoint", "Filtering
 * Contacts" (#contacts-endpoint-filtering-contacts) and "Paging of Resources"
 * (#paging-of-resources): `content` plus `first`, `last`, `totalPages`,
 * `totalElements`, `numberOfElements`, `size`, `number`, `sort`.
 */
export function contactsPage(
	content: readonly unknown[],
	paging: { number?: number; size?: number; totalElements?: number } = {},
) {
	const size = paging.size ?? 25;
	const number = paging.number ?? 0;
	const totalElements = paging.totalElements ?? content.length;
	const totalPages = Math.max(1, Math.ceil(totalElements / size));
	return {
		content,
		first: number === 0,
		last: number >= totalPages - 1,
		totalPages,
		totalElements,
		numberOfElements: content.length,
		size,
		number,
		sort: [
			{
				direction: "ASC",
				property: "name",
				ignoreCase: false,
				nullHandling: "NATIVE",
				ascending: true,
			},
		],
	};
}

export const CREATED_INVOICE_ID = "66196c43-baf3-4335-bfee-d610367059db";

/**
 * `POST /v1/invoices` response — section "Invoices Endpoint", "Create an
 * Invoice" (#invoices-endpoint-create-an-invoice). Without `?finalize=true`
 * the invoice is created as a draft.
 */
export const createdInvoiceResponse = {
	id: CREATED_INVOICE_ID,
	resourceUri: `https://api.lexware.io/v1/invoices/${CREATED_INVOICE_ID}`,
	createdDate: "2026-10-09T10:15:00.000+02:00",
	updatedDate: "2026-10-09T10:15:00.000+02:00",
	version: 1,
};

/**
 * `GET /v1/invoices/{id}` — section "Invoices Endpoint", "Retrieve an Invoice"
 * (#invoices-endpoint-retrieve-an-invoice). `voucherStatus` is one of draft,
 * open, paid, voided ("Invoice Properties").
 */
export function invoiceResponse(input: {
	id?: string;
	voucherStatus?: string;
	remark?: string | null;
	contactId?: string;
}) {
	return {
		id: input.id ?? CREATED_INVOICE_ID,
		organizationId: LEXWARE_ORGANIZATION_ID,
		createdDate: "2026-10-09T10:15:00.000+02:00",
		updatedDate: "2026-10-09T10:15:00.000+02:00",
		version: 1,
		language: "de",
		archived: false,
		voucherStatus: input.voucherStatus ?? "draft",
		voucherNumber: "RE1019",
		voucherDate: "2026-10-09T00:00:00.000+02:00",
		address: {
			contactId: input.contactId ?? ACME_CONTACT_ID,
			name: "Acme Consulting &amp; Partner GmbH",
			street: "Musterstraße 42",
			city: "Freiburg",
			zip: "79112",
			countryCode: "DE",
		},
		lineItems: [
			{
				id: "97b98491-e953-4dc9-97a9-ae437a8052b4",
				type: "custom",
				name: "Website relaunch",
				description: "Website relaunch, 01.09.2026–30.09.2026, 1.50 h",
				quantity: 1.5,
				unitName: "Stunde",
				unitPrice: { currency: "EUR", netAmount: 95.0, grossAmount: 113.05, taxRatePercentage: 19 },
				discountPercentage: 0,
				lineItemAmount: 142.5,
			},
		],
		totalPrice: {
			currency: "EUR",
			totalNetAmount: 142.5,
			totalGrossAmount: 169.58,
			totalTaxAmount: 27.08,
		},
		taxAmounts: [{ taxRatePercentage: 19, taxAmount: 27.08, netAmount: 142.5 }],
		taxConditions: { taxType: "net" },
		shippingConditions: {
			shippingDate: "2026-09-01T00:00:00.000+02:00",
			shippingEndDate: "2026-09-30T00:00:00.000+02:00",
			shippingType: "serviceperiod",
		},
		title: "Rechnung",
		introduction: "Unsere Leistungen im September",
		remark: input.remark === undefined ? "Vielen Dank für Ihren Auftrag." : input.remark,
		files: { documentFileId: null },
	};
}

/**
 * A page of `GET /v1/voucherlist` — section "Voucherlist Endpoint"
 * (#voucherlist-endpoint): `voucherType` and `voucherStatus` are mandatory,
 * `contactId` and `createdDateFrom` (yyyy-MM-dd, CET/CEST day) optional, size
 * up to 250. Items carry no remark, so the marker check reads each invoice.
 */
export function voucherListPage(
	items: readonly { id: string; voucherStatus?: string; contactId?: string }[],
	paging: { totalElements?: number; size?: number } = {},
) {
	const size = paging.size ?? 25;
	const totalElements = paging.totalElements ?? items.length;
	return {
		content: items.map((item, index) => ({
			id: item.id,
			voucherType: "invoice",
			voucherStatus: item.voucherStatus ?? "draft",
			voucherNumber: `RE10${20 + index}`,
			voucherDate: "2026-10-09T00:00:00.000+02:00",
			createdDate: "2026-10-09T10:15:00.000+02:00",
			updatedDate: "2026-10-09T10:15:00.000+02:00",
			dueDate: null,
			contactId: item.contactId ?? ACME_CONTACT_ID,
			contactName: "Acme Consulting &amp; Partner GmbH",
			totalAmount: 169.58,
			openAmount: 169.58,
			currency: "EUR",
			archived: false,
		})),
		first: true,
		last: totalElements <= size,
		totalPages: Math.max(1, Math.ceil(totalElements / size)),
		totalElements,
		numberOfElements: items.length,
		size,
		number: 0,
		sort: [
			{
				property: "createdDate",
				direction: "DESC",
				ignoreCase: false,
				nullHandling: "NATIVE",
				ascending: false,
			},
		],
	};
}

/**
 * Section "Error Codes", "Authorization and Connection Error Responses"
 * (#error-codes-authorization-and-connection-error-responses).
 */
export const unauthorizedResponse = { message: "Unauthorized" };
export const gatewayTimeoutResponse = { message: "Endpoint request timed out" };
export const serverErrorResponse = { message: "Internal server error or rate limit exceeded" };

/**
 * Section "HTTP Status Codes": 429 "Too Many Requests" — the call was not
 * performed and should be retried later (#api-rate-limits). The docs do not
 * show the body; this is the gateway's message form.
 */
export const tooManyRequestsResponse = { message: "Too Many Requests" };

/**
 * Section "Error Codes", "Regular Error Response" (#error-codes-regular-error-response),
 * used by the invoices, profile and voucherlist endpoints. `details[].message`
 * is not meant for end users.
 */
export function regularError(status: number, error: string, path: string, details?: unknown[]) {
	return {
		timestamp: "2026-10-09T10:15:00.233+02:00",
		status,
		error,
		path,
		traceId: "90d78d0777be",
		message:
			status === 406
				? "Validation failed for request. Please see details list for specific causes."
				: error,
		...(details ? { details } : {}),
	};
}

/**
 * Section "Error Codes", "Legacy Error Response"
 * (#error-codes-legacy-error-response), used by the contacts endpoint.
 */
export function legacyError(issues: { i18nKey: string; source: string; type: string }[]) {
	return {
		IssueList: issues.map((issue) => ({ ...issue, additionalData: null, args: null })),
	};
}
