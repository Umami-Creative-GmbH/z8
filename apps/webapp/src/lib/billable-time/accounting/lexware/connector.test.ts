/**
 * Contract tests of the Lexware Office connector (#904) against recorded
 * Public API fixtures (`__fixtures__/lexware-public-api.ts`, each citing the
 * developers.lexware.io section it mirrors). They pin what the connector sends
 * and how it reads Lexware's answers; a trial-account run confirms the
 * fixtures (see the PR).
 */

import { Temporal } from "temporal-polyfill";
import { describe, expect, it } from "vitest";
import { buildInvoiceDraft, type InvoiceDraft, workLine } from "../invoice-draft";
import {
	ACME_CONTACT_ID,
	ARCHIVED_CONTACT_ID,
	acmeContact,
	archivedContact,
	CREATED_INVOICE_ID,
	contactsPage,
	createdInvoiceResponse,
	gatewayTimeoutResponse,
	invoiceResponse,
	LEXWARE_ORGANIZATION_ID,
	legacyError,
	PERSON_CONTACT_ID,
	personContact,
	profileResponse,
	regularError,
	serverErrorResponse,
	tooManyRequestsResponse,
	unauthorizedResponse,
	VENDOR_CONTACT_ID,
	vendorContact,
	voucherListPage,
} from "./__fixtures__/lexware-public-api";
import { type ScriptedLexware, scriptedLexware } from "./__fixtures__/scripted-lexware";
import { createLexwareOfficeConnector, LEXWARE_OFFICE_CAPABILITIES } from "./connector";

const API_KEY = "lx-test-key-5f1c2d9e8b7a";
const context = { organizationId: "org-1", billableCurrency: "EUR" } as const;

function setup(options: { now?: string } = {}) {
	const api = scriptedLexware();
	const connector = createLexwareOfficeConnector({
		fetch: api.fetch,
		sleep: api.time.sleep,
		monotonicNow: api.time.now,
		clock: {
			nowInstant: () => Temporal.Instant.from(options.now ?? "2026-10-09T08:15:00Z"),
		},
	});
	return { api, connector, provider: connector.open({ apiKey: API_KEY, settings: {} }) };
}

function onlyRequest(api: ScriptedLexware) {
	const requests = api.requests();
	expect(requests).toHaveLength(1);
	return requests[0];
}

describe("Lexware Office connector: connection", () => {
	it("declares Lexware's limits as capabilities", () => {
		expect(LEXWARE_OFFICE_CAPABILITIES).toEqual({
			maxDraftLines: 300,
			supportedCurrencies: ["EUR"],
			supportedTaxTreatments: [
				"domestic_standard",
				"domestic_reduced",
				"eu_reverse_charge",
				"third_country_service",
				"vat_free",
			],
			draftStatusCheck: true,
			contactSearchMinLength: 3,
		});
		expect(setup().connector.kind).toBe("lexware_office");
	});

	it("identifies the Lexware account from the profile with the key as a bearer token", async () => {
		const { api, connector } = setup();
		api.on("GET", "/v1/profile", { status: 200, body: profileResponse });

		await expect(
			connector.validateConnection({ apiKey: API_KEY, settings: { ignored: true }, context }),
		).resolves.toEqual({
			ok: true,
			accountRef: LEXWARE_ORGANIZATION_ID,
			accountLabel: "Musterfirma Beratung GmbH",
			settings: {},
		});
		const request = onlyRequest(api);
		expect(request.url.origin).toBe("https://api.lexware.io");
		expect(request.headers.authorization).toBe(`Bearer ${API_KEY}`);
		expect(request.headers.accept).toBe("application/json");
	});

	it("refuses an organization whose billable currency is not EUR, without calling Lexware", async () => {
		const { api, connector } = setup();

		await expect(
			connector.validateConnection({
				apiKey: API_KEY,
				settings: {},
				context: { ...context, billableCurrency: "CHF" },
			}),
		).resolves.toEqual({
			ok: false,
			code: "currency_not_supported",
			message: expect.stringContaining("EUR"),
		});
		expect(api.requests()).toHaveLength(0);
	});

	it("reports a refused key as unauthorized, never echoing it", async () => {
		const { api, connector } = setup();
		api.on("GET", "/v1/profile", { status: 401, body: unauthorizedResponse });

		const error = await connector
			.validateConnection({ apiKey: API_KEY, settings: {}, context })
			.catch((caught: unknown) => caught);
		expect(error).toMatchObject({ name: "AccountingProviderError", failure: "unauthorized" });
		expect(String(error)).not.toContain(API_KEY);
		expect(JSON.stringify(error)).not.toContain(API_KEY);
	});

	it("explains a 402 as the plan lacking Public API access", async () => {
		const { api, connector } = setup();
		api.on("GET", "/v1/profile", { status: 402, body: { message: "Payment Required" } });

		await expect(
			connector.validateConnection({ apiKey: API_KEY, settings: {}, context }),
		).rejects.toMatchObject({ failure: "unauthorized", message: expect.stringContaining("XL") });
	});

	it("refuses a key with characters an HTTP header cannot carry, without echoing it", async () => {
		const { api, connector } = setup();
		const error = await connector
			.validateConnection({ apiKey: "abc\r\nX-Evil: 1", settings: {}, context })
			.catch((caught: unknown) => caught);
		expect(error).toMatchObject({ failure: "unauthorized" });
		expect(String(error)).not.toContain("Evil");
		expect(api.requests()).toHaveLength(0);
	});

	it("opens a provider without calling Lexware", () => {
		const { api, provider } = setup();
		expect(provider.kind).toBe("lexware_office");
		expect(provider.capabilities).toBe(LEXWARE_OFFICE_CAPABILITIES);
		expect(api.requests()).toHaveLength(0);
	});
});

const acmeView = {
	id: ACME_CONTACT_ID,
	customerNumber: "10307",
	name: "Acme Consulting & Partner GmbH",
	address: "Gebäude 10\nMusterstraße 42\n79112 Freiburg",
	vatId: "DE123456789",
};
const personView = {
	id: PERSON_CONTACT_ID,
	customerNumber: "10308",
	name: "Erika Acmeier",
	address: "Ringstraße 7\n1010 Wien\nAT",
	vatId: null,
};

describe("Lexware Office connector: contacts", () => {
	it("searches customers by name and shows number, name and billing address", async () => {
		const { api, provider } = setup();
		api.on("GET", "/v1/contacts", {
			status: 200,
			body: contactsPage([acmeContact, personContact, archivedContact]),
		});

		await expect(provider.searchContacts("acme")).resolves.toEqual({
			contacts: [acmeView, personView],
			truncated: false,
		});
		const request = onlyRequest(api);
		expect(request.url.search).toBe("?customer=true&name=acme&page=0&size=25");
		expect(request.headers.authorization).toBe(`Bearer ${API_KEY}`);
	});

	it("says the result is truncated when Lexware has more pages", async () => {
		const { api, provider } = setup();
		api.on("GET", "/v1/contacts", {
			status: 200,
			body: contactsPage([acmeContact], { totalElements: 40 }),
		});

		await expect(provider.searchContacts("acme")).resolves.toMatchObject({ truncated: true });
	});

	it("HTML-encodes &, < and > and escapes the % and _ wildcards (Search String Encoding)", async () => {
		const { api, provider } = setup();
		api.on("GET", "/v1/contacts", { status: 200, body: contactsPage([]) });

		await provider.searchContacts("johnson & partner");
		await provider.searchContacts("100%_<x>");
		const [first, second] = api.requests();
		expect(first.url.search).toBe(
			"?customer=true&name=johnson%20%26amp%3B%20partner&page=0&size=25",
		);
		expect(second.url.search).toBe(
			"?customer=true&name=100%5C%25%5C_%26lt%3Bx%26gt%3B&page=0&size=25",
		);
	});

	it("also matches a numeric query as the customer number, number matches first", async () => {
		const { api, provider } = setup();
		api.onWhen("GET", "/v1/contacts", (request) => request.url.searchParams.has("number"), {
			status: 200,
			body: contactsPage([acmeContact]),
		});
		api.on("GET", "/v1/contacts", {
			status: 200,
			body: contactsPage([personContact, acmeContact]),
		});

		await expect(provider.searchContacts(" 10307 ")).resolves.toEqual({
			contacts: [acmeView, personView],
			truncated: false,
		});
		expect(api.requests().map((request) => request.url.search)).toEqual([
			"?customer=true&number=10307&page=0&size=25",
			"?customer=true&name=10307&page=0&size=25",
		]);
	});

	it("refuses a query shorter than 3 characters without calling Lexware", async () => {
		const { api, provider } = setup();
		await expect(provider.searchContacts(" ac ")).rejects.toMatchObject({ failure: "rejected" });
		expect(api.requests()).toHaveLength(0);
	});

	it("maps a refused search (legacy error body) to rejected with field names only", async () => {
		const { api, provider } = setup();
		api.on("GET", "/v1/contacts", {
			status: 400,
			body: legacyError([{ i18nKey: "invalid_value", source: "name", type: "validation_failure" }]),
		});

		await expect(provider.searchContacts("acme")).rejects.toMatchObject({
			failure: "rejected",
			message: expect.stringContaining("name invalid_value"),
		});
	});

	it("reads one customer contact; vendors, archived, unknown and malformed ids are null", async () => {
		const { api, provider } = setup();
		api.on("GET", `/v1/contacts/${ACME_CONTACT_ID}`, { status: 200, body: acmeContact });
		api.on("GET", `/v1/contacts/${VENDOR_CONTACT_ID}`, { status: 200, body: vendorContact });
		api.on("GET", `/v1/contacts/${ARCHIVED_CONTACT_ID}`, { status: 200, body: archivedContact });
		api.on("GET", /^\/v1\/contacts\/[0-9a-f-]+$/, {
			status: 404,
			body: legacyError([{ i18nKey: "missing_entity", source: "id", type: "validation_failure" }]),
		});

		await expect(provider.getContact(ACME_CONTACT_ID)).resolves.toEqual(acmeView);
		await expect(provider.getContact(VENDOR_CONTACT_ID)).resolves.toBeNull();
		await expect(provider.getContact(ARCHIVED_CONTACT_ID)).resolves.toBeNull();
		await expect(provider.getContact("5b0b6d2c-1111-4c1e-9a43-2f1d0c0e0d0a")).resolves.toBeNull();
		await expect(provider.getContact("../invoices")).resolves.toBeNull();
		expect(api.requests()).toHaveLength(4);
	});

	it("lists every customer contact in pages of 250 for the import (#906)", async () => {
		const { api, provider } = setup();
		const listCustomerContacts = provider.listCustomerContacts;
		if (!listCustomerContacts) throw new Error("listCustomerContacts missing");
		api.onWhen("GET", "/v1/contacts", (request) => request.url.searchParams.get("page") === "0", {
			status: 200,
			body: contactsPage([acmeContact, archivedContact], { size: 250, totalElements: 251 }),
		});
		api.on("GET", "/v1/contacts", {
			status: 200,
			body: contactsPage([personContact], { number: 1, size: 250, totalElements: 251 }),
		});

		const first = await listCustomerContacts({ cursor: null });
		expect(first).toEqual({ contacts: [acmeView], nextCursor: "1" });
		const second = await listCustomerContacts({ cursor: first.nextCursor });
		expect(second).toEqual({ contacts: [personView], nextCursor: null });
		expect(api.requests().map((request) => request.url.search)).toEqual([
			"?customer=true&page=0&size=250",
			"?customer=true&page=1&size=250",
		]);
		await expect(listCustomerContacts({ cursor: "x" })).rejects.toMatchObject({
			failure: "rejected",
		});
	});
});
function draft(overrides: Partial<InvoiceDraft> = {}): InvoiceDraft {
	const result = buildInvoiceDraft({
		contactId: ACME_CONTACT_ID,
		currency: "EUR",
		taxTreatment: { kind: "domestic_standard", rateBasisPoints: 1900 },
		servicePeriod: {
			from: Temporal.PlainDate.from("2026-09-01"),
			to: Temporal.PlainDate.from("2026-09-30"),
		},
		title: "Rechnung",
		introduction: "Unsere Leistungen im September",
		remark: "Vielen Dank für Ihren Auftrag.",
		lines: [
			workLine({
				projectId: "p-1",
				projectName: "Website relaunch",
				text: "Website relaunch, 01.09.2026–30.09.2026, 1.50 h",
				durationMs: 5_400_000,
				unitPrice: BigInt(9500),
			}),
		],
		...overrides,
	});
	if (!result.ok) throw new Error(result.problem);
	return result.draft;
}

/** No earlier draft of this contact carries the marker. */
function noEarlierDraft(api: ScriptedLexware) {
	api.on("GET", "/v1/voucherlist", { status: 200, body: voucherListPage([]) });
}

function createdOnce(api: ScriptedLexware) {
	api.on("POST", "/v1/invoices", { status: 201, body: createdInvoiceResponse });
}

function postedBodies(api: ScriptedLexware) {
	return api
		.requests()
		.filter((request) => request.method === "POST")
		.map((request) => request.body as Record<string, unknown>);
}

const MARKED_REMARK = /^Vielen Dank für Ihren Auftrag\.\n\nZ8-Ref: [0-9a-f]{24}$/;

describe("Lexware Office connector: invoice drafts", () => {
	it("creates a draft (no finalize) with custom hour lines, the service period and its texts", async () => {
		const { api, provider } = setup();
		noEarlierDraft(api);
		createdOnce(api);

		await expect(
			provider.createInvoiceDraft(draft(), { idempotencyKey: "handoff-1" }),
		).resolves.toEqual({
			externalId: CREATED_INVOICE_ID,
			externalUrl: `https://app.lexware.de/permalink/invoices/edit/${CREATED_INVOICE_ID}`,
		});

		const post = api.requests().find((request) => request.method === "POST");
		expect(post?.url.search).toBe("");
		expect(post?.headers["content-type"]).toBe("application/json");
		const [body] = postedBodies(api);
		expect(body).toEqual({
			archived: false,
			voucherDate: "2026-10-09T00:00:00.000+02:00",
			address: { contactId: ACME_CONTACT_ID },
			lineItems: [
				{
					type: "custom",
					name: "Website relaunch",
					description: "Website relaunch, 01.09.2026–30.09.2026, 1.50 h",
					quantity: 1.5,
					unitName: "Stunde",
					unitPrice: { currency: "EUR", netAmount: 95, taxRatePercentage: 19 },
					discountPercentage: 0,
				},
			],
			totalPrice: { currency: "EUR" },
			taxConditions: { taxType: "net" },
			shippingConditions: {
				shippingDate: "2026-09-01T00:00:00.000+02:00",
				shippingEndDate: "2026-09-30T00:00:00.000+02:00",
				shippingType: "serviceperiod",
			},
			title: "Rechnung",
			introduction: "Unsere Leistungen im September",
			remark: expect.stringMatching(MARKED_REMARK),
		});
		expect(JSON.stringify(body)).not.toContain("handoff-1");
	});

	it.each([
		["domestic_standard", 1900, "net", 19],
		["domestic_reduced", 700, "net", 7],
		["eu_reverse_charge", 0, "externalService13b", 0],
		["third_country_service", 0, "thirdPartyCountryService", 0],
		["vat_free", 0, "vatfree", 0],
	] as const)(
		"translates %s (%i bp) into taxType %s at %s %%",
		async (kind, rateBasisPoints, taxType, rate) => {
			const { api, provider } = setup();
			noEarlierDraft(api);
			createdOnce(api);

			await provider.createInvoiceDraft(draft({ taxTreatment: { kind, rateBasisPoints } }), {
				idempotencyKey: `k-${kind}`,
			});
			const [body] = postedBodies(api);
			expect(body.taxConditions).toEqual({ taxType });
			expect(body.lineItems).toEqual([
				expect.objectContaining({
					unitPrice: { currency: "EUR", netAmount: 95, taxRatePercentage: rate },
				}),
			]);
		},
	);

	it("states quantities and prices exactly, with decimal rates and winter offsets", async () => {
		const { api, provider } = setup({ now: "2026-01-15T23:30:00Z" });
		noEarlierDraft(api);
		createdOnce(api);

		await provider.createInvoiceDraft(
			draft({
				taxTreatment: { kind: "domestic_standard", rateBasisPoints: 1950 },
				servicePeriod: {
					from: Temporal.PlainDate.from("2026-01-01"),
					to: Temporal.PlainDate.from("2026-01-15"),
				},
				lines: [
					workLine({
						projectId: "p-1",
						projectName: "Support",
						text: "Support",
						durationMs: 4_500_000,
						unitPrice: BigInt(12345),
					}),
				],
			}),
			{ idempotencyKey: "k-1" },
		);
		const [body] = postedBodies(api);
		expect(body.voucherDate).toBe("2026-01-16T00:00:00.000+01:00");
		expect(body.shippingConditions).toEqual({
			shippingDate: "2026-01-01T00:00:00.000+01:00",
			shippingEndDate: "2026-01-15T00:00:00.000+01:00",
			shippingType: "serviceperiod",
		});
		expect(body.lineItems).toEqual([
			{
				type: "custom",
				name: "Support",
				description: "Support",
				quantity: 1.25,
				unitName: "Stunde",
				unitPrice: { currency: "EUR", netAmount: 123.45, taxRatePercentage: 19.5 },
				discountPercentage: 0,
			},
		]);
	});

	it("shortens texts to Lexware's limits (title 25, introduction and remark 2000, line name 255)", async () => {
		const { api, provider } = setup();
		noEarlierDraft(api);
		createdOnce(api);

		await provider.createInvoiceDraft(
			draft({
				title: "Leistungsnachweis September 2026",
				introduction: "i".repeat(2100),
				remark: "r".repeat(2100),
				lines: [
					workLine({
						projectId: "p-1",
						projectName: "n".repeat(300),
						text: "d".repeat(2100),
						durationMs: 3_600_000,
						unitPrice: BigInt(100),
					}),
				],
			}),
			{ idempotencyKey: "k-1" },
		);
		const [body] = postedBodies(api);
		expect(body.title).toBe("Leistungsnachweis Septem…");
		expect((body.title as string).length).toBe(25);
		expect((body.introduction as string).length).toBe(2000);
		expect((body.remark as string).length).toBe(2000);
		expect(body.remark).toMatch(/…\n\nZ8-Ref: [0-9a-f]{24}$/);
		const [line] = body.lineItems as Record<string, string>[];
		expect(line.name.length).toBe(255);
		expect(line.description.length).toBe(2000);
	});

	it("leaves out an empty introduction and writes only the marker as remark", async () => {
		const { api, provider } = setup();
		noEarlierDraft(api);
		createdOnce(api);

		await provider.createInvoiceDraft(draft({ introduction: null, remark: null }), {
			idempotencyKey: "k-1",
		});
		const [body] = postedBodies(api);
		expect(body).not.toHaveProperty("introduction");
		expect(body.remark).toMatch(/^Z8-Ref: [0-9a-f]{24}$/);
	});

	it("adds the optional timesheet as text lines", async () => {
		const { api, provider } = setup();
		noEarlierDraft(api);
		createdOnce(api);

		const base = draft();
		await provider.createInvoiceDraft(
			draft({
				lines: [
					...base.lines,
					{ kind: "text", text: "Timesheet\n01.09.2026 Alice 1.50 h Website relaunch" },
					{ kind: "text", text: "All times in hours" },
				],
			}),
			{ idempotencyKey: "k-1" },
		);
		const [body] = postedBodies(api);
		expect((body.lineItems as unknown[]).slice(1)).toEqual([
			{
				type: "text",
				name: "Timesheet",
				description: "01.09.2026 Alice 1.50 h Website relaunch",
			},
			{ type: "text", name: "All times in hours" },
		]);
	});

	it("refuses drafts Lexware cannot take without calling it: 301 lines, non-EUR, a malformed contact", async () => {
		const { api, provider } = setup();
		const base = draft();
		const tooMany = draft({
			lines: [
				...base.lines,
				...Array.from({ length: 300 }, () => ({ kind: "text" as const, text: "x" })),
			],
		});

		await expect(
			provider.createInvoiceDraft(tooMany, { idempotencyKey: "k-1" }),
		).rejects.toMatchObject({
			failure: "rejected",
			message: expect.stringContaining("300"),
		});
		await expect(
			provider.createInvoiceDraft(draft({ currency: "CHF" }), { idempotencyKey: "k-2" }),
		).rejects.toMatchObject({ failure: "rejected", message: expect.stringContaining("EUR") });
		await expect(
			provider.createInvoiceDraft(draft({ contactId: "not-a-lexware-id" }), {
				idempotencyKey: "k-3",
			}),
		).rejects.toMatchObject({ failure: "rejected" });
		await expect(
			provider.createInvoiceDraft(draft(), { idempotencyKey: " " }),
		).rejects.toMatchObject({ failure: "rejected" });
		expect(api.requests()).toHaveLength(0);
	});

	it("reports Lexware's validation refusal (406) by field, without its German messages", async () => {
		const { api, provider } = setup();
		noEarlierDraft(api);
		api.on("POST", "/v1/invoices", {
			status: 406,
			body: regularError(406, "Not Acceptable", "/v1/invoices", [
				{
					violation: "NOTNULL",
					field: "lineItems[0].unitPrice.taxRatePercentage",
					message: "darf nicht leer sein",
				},
			]),
		});

		const error = await provider
			.createInvoiceDraft(draft(), { idempotencyKey: "k-1" })
			.catch((caught: unknown) => caught);
		expect(error).toMatchObject({
			failure: "rejected",
			message: expect.stringContaining("lineItems[0].unitPrice.taxRatePercentage (NOTNULL)"),
		});
		expect(String(error)).not.toContain("darf nicht");
	});
});
const OTHER_INVOICE_ID = "1e5d0a26-3b25-4b0c-a0a4-5f0e1f8c2d33";

/** The marker the connector wrote for `key`, read back from a recorded create. */
async function markerOf(key: string): Promise<string> {
	const { api, provider } = setup();
	noEarlierDraft(api);
	createdOnce(api);
	await provider.createInvoiceDraft(draft({ remark: null }), { idempotencyKey: key });
	return postedBodies(api)[0].remark as string;
}

describe("Lexware Office connector: idempotency without a provider key", () => {
	it("looks for an earlier draft of the contact before creating (since the day before)", async () => {
		const { api, provider } = setup();
		noEarlierDraft(api);
		createdOnce(api);

		await provider.createInvoiceDraft(draft(), { idempotencyKey: "k-1" });
		const [lookup, post] = api.requests();
		expect(lookup.path).toBe("/v1/voucherlist");
		expect(lookup.url.search).toBe(
			`?voucherType=invoice&voucherStatus=any&contactId=${ACME_CONTACT_ID}&createdDateFrom=2026-10-08&page=0&size=50&sort=createdDate,DESC`,
		);
		expect(post.method).toBe("POST");
	});

	it("searches from the recorded first attempt on a later retry", async () => {
		const { api, provider } = setup();
		noEarlierDraft(api);
		createdOnce(api);

		await provider.createInvoiceDraft(draft(), {
			idempotencyKey: "k-1",
			firstAttemptAt: Temporal.Instant.from("2026-10-01T22:30:00Z"),
		});
		expect(api.requests()[0].url.searchParams.get("createdDateFrom")).toBe("2026-10-01");
	});

	it("derives one stable marker per key that never contains the key", async () => {
		const first = await markerOf("handoff-abc");
		expect(first).toMatch(/^Z8-Ref: [0-9a-f]{24}$/);
		expect(await markerOf("handoff-abc")).toBe(first);
		expect(await markerOf("handoff-abd")).not.toBe(first);
		expect(first).not.toContain("handoff");
	});

	it("returns the earlier draft carrying the marker instead of creating a second one", async () => {
		const marker = await markerOf("k-1");
		const { api, provider } = setup();
		api.on("GET", "/v1/voucherlist", {
			status: 200,
			body: voucherListPage([{ id: OTHER_INVOICE_ID }, { id: CREATED_INVOICE_ID }]),
		});
		api.on("GET", `/v1/invoices/${OTHER_INVOICE_ID}`, {
			status: 200,
			body: invoiceResponse({ id: OTHER_INVOICE_ID, remark: "Z8-Ref: 000000000000000000000000" }),
		});
		api.on("GET", `/v1/invoices/${CREATED_INVOICE_ID}`, {
			status: 200,
			body: invoiceResponse({ remark: `Vielen Dank für Ihren Auftrag.\n\n${marker}` }),
		});

		await expect(provider.createInvoiceDraft(draft(), { idempotencyKey: "k-1" })).resolves.toEqual({
			externalId: CREATED_INVOICE_ID,
			externalUrl: `https://app.lexware.de/permalink/invoices/edit/${CREATED_INVOICE_ID}`,
		});
		expect(api.requests().map((request) => `${request.method} ${request.path}`)).toEqual([
			"GET /v1/voucherlist",
			`GET /v1/invoices/${OTHER_INVOICE_ID}`,
			`GET /v1/invoices/${CREATED_INVOICE_ID}`,
		]);
	});

	it("after a timeout on create, the retry with the same key finds the draft: one draft in Lexware", async () => {
		const { api, provider } = setup();
		const marker = await markerOf("k-1");
		api.on(
			"GET",
			"/v1/voucherlist",
			{ status: 200, body: voucherListPage([]) },
			{ status: 200, body: voucherListPage([{ id: CREATED_INVOICE_ID }]) },
		);
		api.on("GET", `/v1/invoices/${CREATED_INVOICE_ID}`, {
			status: 200,
			body: invoiceResponse({ remark: `Vielen Dank für Ihren Auftrag.\n\n${marker}` }),
		});
		api.on("POST", "/v1/invoices", {
			error: new DOMException("The operation timed out.", "TimeoutError"),
		});

		await expect(
			provider.createInvoiceDraft(draft(), { idempotencyKey: "k-1" }),
		).rejects.toMatchObject({
			failure: "outcome_unknown",
		});
		await expect(
			provider.createInvoiceDraft(draft(), { idempotencyKey: "k-1" }),
		).resolves.toMatchObject({
			externalId: CREATED_INVOICE_ID,
		});
		expect(postedBodies(api)).toHaveLength(1);
	});

	it.each([
		[504, "outcome_unknown"],
		[500, "outcome_unknown"],
		[502, "outcome_unknown"],
		[503, "not_performed"],
	] as const)("maps HTTP %i on create to %s", async (status, failure) => {
		const { api, provider } = setup();
		noEarlierDraft(api);
		api.on("POST", "/v1/invoices", {
			status,
			body: status === 504 ? gatewayTimeoutResponse : serverErrorResponse,
		});

		await expect(
			provider.createInvoiceDraft(draft(), { idempotencyKey: "k-1" }),
		).rejects.toMatchObject({
			failure,
		});
	});

	it("treats a created draft with an unreadable answer as outcome unknown", async () => {
		const { api, provider } = setup();
		noEarlierDraft(api);
		api.on("POST", "/v1/invoices", { status: 201, rawBody: "<html>" });

		await expect(
			provider.createInvoiceDraft(draft(), { idempotencyKey: "k-1" }),
		).rejects.toMatchObject({
			failure: "outcome_unknown",
		});
	});

	it("does not create when the duplicate check fails or cannot be complete", async () => {
		const unreachable = setup();
		unreachable.api.on("GET", "/v1/voucherlist", { error: new TypeError("fetch failed") });
		await expect(
			unreachable.provider.createInvoiceDraft(draft(), { idempotencyKey: "k-1" }),
		).rejects.toMatchObject({ failure: "not_performed" });
		expect(postedBodies(unreachable.api)).toHaveLength(0);

		const crowded = setup();
		crowded.api.on("GET", "/v1/voucherlist", {
			status: 200,
			body: voucherListPage([{ id: OTHER_INVOICE_ID }], { totalElements: 51, size: 50 }),
		});
		await expect(
			crowded.provider.createInvoiceDraft(draft(), { idempotencyKey: "k-1" }),
		).rejects.toMatchObject({ failure: "rejected", message: expect.stringContaining("Z8-Ref: ") });
		expect(postedBodies(crowded.api)).toHaveLength(0);
	});
});

describe("Lexware Office connector: draft status", () => {
	it.each([
		["draft", "draft"],
		["open", "finalized"],
		["paid", "finalized"],
		["voided", "voided"],
	] as const)("reads voucherStatus %s as %s", async (voucherStatus, status) => {
		const { api, provider } = setup();
		api.on("GET", `/v1/invoices/${CREATED_INVOICE_ID}`, {
			status: 200,
			body: invoiceResponse({ voucherStatus }),
		});

		await expect(provider.getInvoiceDraftStatus(CREATED_INVOICE_ID)).resolves.toEqual({
			kind: "status",
			status,
			toolStatus: voucherStatus,
		});
	});

	it("reads a deleted draft (404) as gone", async () => {
		const { api, provider } = setup();
		api.on("GET", `/v1/invoices/${CREATED_INVOICE_ID}`, {
			status: 404,
			body: regularError(404, "Not Found", `/v1/invoices/${CREATED_INVOICE_ID}`),
		});

		await expect(provider.getInvoiceDraftStatus(CREATED_INVOICE_ID)).resolves.toEqual({
			kind: "gone",
		});
		await expect(provider.getInvoiceDraftStatus("fake-draft-1")).resolves.toEqual({ kind: "gone" });
		expect(api.requests()).toHaveLength(1);
	});

	it("reports a revoked key and an outage, never as gone", async () => {
		const { api, provider } = setup();
		api.on(
			"GET",
			`/v1/invoices/${CREATED_INVOICE_ID}`,
			{ status: 401, body: unauthorizedResponse },
			{ status: 504, body: gatewayTimeoutResponse },
		);

		await expect(provider.getInvoiceDraftStatus(CREATED_INVOICE_ID)).rejects.toMatchObject({
			failure: "unauthorized",
		});
		await expect(provider.getInvoiceDraftStatus(CREATED_INVOICE_ID)).rejects.toMatchObject({
			failure: "not_performed",
		});
	});
});

describe("Lexware Office connector: 2 requests per second", () => {
	it("starts requests with one key at most every 550 ms", async () => {
		const { api, provider } = setup();
		api.on("GET", /^\/v1\/invoices\//, { status: 200, body: invoiceResponse({}) });

		await Promise.all([
			provider.getInvoiceDraftStatus(CREATED_INVOICE_ID),
			provider.getInvoiceDraftStatus(CREATED_INVOICE_ID),
			provider.getInvoiceDraftStatus(CREATED_INVOICE_ID),
		]);
		const times = api.requests().map((request) => request.at);
		expect(times[1] - times[0]).toBeGreaterThanOrEqual(550);
		expect(times[2] - times[1]).toBeGreaterThanOrEqual(550);
	});

	it("shares the pace between providers opened with the same key", async () => {
		const { api, connector } = setup();
		api.on("GET", /^\/v1\/invoices\//, { status: 200, body: invoiceResponse({}) });
		const first = connector.open({ apiKey: API_KEY, settings: {} });
		const second = connector.open({ apiKey: API_KEY, settings: {} });

		await first.getInvoiceDraftStatus(CREATED_INVOICE_ID);
		await second.getInvoiceDraftStatus(CREATED_INVOICE_ID);
		const [a, b] = api.requests().map((request) => request.at);
		expect(b - a).toBeGreaterThanOrEqual(550);
	});

	it("retries a 429 with exponential back-off; the create then happens once", async () => {
		const { api, provider } = setup();
		noEarlierDraft(api);
		api.on(
			"POST",
			"/v1/invoices",
			{ status: 429, body: tooManyRequestsResponse },
			{ status: 429, body: tooManyRequestsResponse },
			{ status: 201, body: createdInvoiceResponse },
		);

		await expect(
			provider.createInvoiceDraft(draft(), { idempotencyKey: "k-1" }),
		).resolves.toMatchObject({
			externalId: CREATED_INVOICE_ID,
		});
		const posts = api.requests().filter((request) => request.method === "POST");
		expect(posts).toHaveLength(3);
		expect(posts[1].at - posts[0].at).toBeGreaterThanOrEqual(1000);
		expect(posts[2].at - posts[1].at).toBeGreaterThanOrEqual(2000);
	});

	it("honours Retry-After", async () => {
		const { api, provider } = setup();
		api.on(
			"GET",
			`/v1/invoices/${CREATED_INVOICE_ID}`,
			{ status: 429, body: tooManyRequestsResponse, headers: { "retry-after": "7" } },
			{ status: 200, body: invoiceResponse({}) },
		);

		await provider.getInvoiceDraftStatus(CREATED_INVOICE_ID);
		const [first, second] = api.requests();
		expect(second.at - first.at).toBe(7000);
	});

	it("gives up after 4 retries as not performed", async () => {
		const { api, provider } = setup();
		api.on("GET", "/v1/contacts", { status: 429, body: tooManyRequestsResponse });

		await expect(provider.searchContacts("acme")).rejects.toMatchObject({
			failure: "not_performed",
			message: expect.stringContaining("try again"),
		});
		expect(api.requests()).toHaveLength(5);
	});
});

describe("Lexware Office connector: the API key stays secret", () => {
	it("never puts the key into errors of any kind", async () => {
		const { api, provider } = setup();
		api.on("GET", "/v1/contacts", { error: new TypeError(`fetch failed for Bearer ${API_KEY}`) });
		api.on("POST", "/v1/invoices", {
			status: 406,
			body: regularError(406, "Not Acceptable", "/v1/invoices", [
				{ violation: "INVALID", field: "address.contactId", message: `Bearer ${API_KEY}` },
			]),
		});
		noEarlierDraft(api);

		const errors = [
			await provider.searchContacts("acme").catch((caught: unknown) => caught),
			await provider
				.createInvoiceDraft(draft(), { idempotencyKey: "k-1" })
				.catch((caught: unknown) => caught),
		];
		for (const error of errors) {
			expect(error).toMatchObject({ name: "AccountingProviderError" });
			expect(String(error)).not.toContain(API_KEY);
			expect(JSON.stringify(error)).not.toContain(API_KEY);
			expect(String((error as Error).cause ?? "")).not.toContain(API_KEY);
		}
	});
});
