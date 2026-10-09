import { Temporal } from "temporal-polyfill";
import { describe, expect, it } from "vitest";
import { buildInvoiceDraft, type InvoiceDraft, workLine } from "../invoice-draft";
import { getAccountingProviderRegistry } from "../registry";
import { createSevdeskConnector } from "./connector";
import {
	authenticationRequired,
	contactRow,
	contacts,
	type FixtureRoute,
	fixtureFetch,
	invoiceById,
	invoiceNotFound,
	invoiceRow,
	SEV_CLIENT_ID,
	savedInvoice,
	setupRoutes,
	TOKEN,
	taxRateNotAllowed,
	tooManyRequests,
} from "./fixtures";

const context = { organizationId: "org-1", billableCurrency: "EUR" } as const;
const NOW = Temporal.Instant.from("2026-10-09T08:00:00Z");

function connectorWith(routes: FixtureRoute[]) {
	const http = fixtureFetch(routes);
	const sleeps: number[] = [];
	const connector = createSevdeskConnector({
		fetch: http.fetch,
		clock: { nowInstant: () => NOW },
		sleep: async (ms) => {
			sleeps.push(ms);
		},
	});
	return { connector, http, sleeps };
}

const netSettings = { netPrices: true };

describe("sevdesk connector: connection setup", () => {
	it("reads the tax-rule system, picks the only sevdesk user as contact person and finds the hour unit", async () => {
		const { connector, http } = connectorWith(setupRoutes());

		const result = await connector.validateConnection({
			apiKey: TOKEN,
			settings: netSettings,
			context,
		});

		expect(result).toEqual({
			ok: true,
			accountRef: SEV_CLIENT_ID,
			accountLabel: null,
			settings: {
				bookkeepingSystemVersion: "2.0",
				prices: "net",
				contactPersonId: "501",
				contactPersonName: "Anna Buchhaltung",
				hourUnityId: "9",
			},
		});
		// The token goes raw into the Authorization header, never into the URL.
		for (const request of http.requests) {
			expect(request.headers.authorization).toBe(TOKEN);
			expect(request.query.toString()).not.toContain(TOKEN);
		}
	});

	it("throws unauthorized when sevdesk refuses the token", async () => {
		const { connector } = connectorWith([
			{
				method: "GET",
				path: "/Tools/bookkeepingSystemVersion",
				responses: [{ status: 401, body: authenticationRequired }],
			},
		]);

		const error = await connector
			.validateConnection({ apiKey: TOKEN, settings: netSettings, context })
			.catch((caught: unknown) => caught);

		expect(error).toMatchObject({ name: "AccountingProviderError", failure: "unauthorized" });
		expect(String(error)).not.toContain(TOKEN);
	});

	it("refuses unsupported account setups with a clear message", async () => {
		const refusal = async (
			routes: FixtureRoute[],
			settings: unknown,
			currency: "EUR" | "CHF" = "EUR",
		) =>
			connectorWith(routes).connector.validateConnection({
				apiKey: TOKEN,
				settings,
				context: { ...context, billableCurrency: currency },
			});

		await expect(refusal(setupRoutes(), netSettings, "CHF")).resolves.toMatchObject({
			ok: false,
			code: "currency_not_supported",
			message: expect.stringContaining("EUR"),
		});
		await expect(refusal(setupRoutes({ version: "1.0" }), netSettings)).resolves.toMatchObject({
			ok: false,
			code: "tax_rule_system_not_supported",
			message: expect.stringContaining("sevdesk-Update 2.0"),
		});
		await expect(refusal(setupRoutes(), {})).resolves.toMatchObject({
			ok: false,
			code: "gross_prices_not_supported",
		});
		await expect(refusal(setupRoutes({ withHour: false }), netSettings)).resolves.toMatchObject({
			ok: false,
			code: "hour_unit_missing",
		});
	});

	it("needs a choice of contact person when the account has several users", async () => {
		const users = [
			{ id: "501", fullname: "Anna Buchhaltung" },
			{ id: "502", fullname: "Ben Inhaber" },
			{ id: "503", fullname: "Old Account", hidden: true },
		];
		const { connector } = connectorWith(setupRoutes({ users }));

		await expect(connector.listContactPersons?.({ apiKey: TOKEN })).resolves.toEqual([
			{ id: "501", name: "Anna Buchhaltung" },
			{ id: "502", name: "Ben Inhaber" },
		]);
		await expect(
			connector.validateConnection({ apiKey: TOKEN, settings: netSettings, context }),
		).resolves.toMatchObject({ ok: false, code: "contact_person_required" });
		await expect(
			connector.validateConnection({
				apiKey: TOKEN,
				settings: { ...netSettings, contactPersonId: "999" },
				context,
			}),
		).resolves.toMatchObject({ ok: false, code: "contact_person_unknown" });
		await expect(
			connector.validateConnection({
				apiKey: TOKEN,
				settings: { ...netSettings, contactPersonId: "502" },
				context,
			}),
		).resolves.toMatchObject({
			ok: true,
			settings: { contactPersonId: "502", contactPersonName: "Ben Inhaber" },
		});
	});
});

const storedSettings = {
	bookkeepingSystemVersion: "2.0",
	prices: "net",
	contactPersonId: "501",
	contactPersonName: "Anna Buchhaltung",
	hourUnityId: "9",
};

function providerWith(routes: FixtureRoute[]) {
	const setup = connectorWith(routes);
	return { ...setup, provider: setup.connector.open({ apiKey: TOKEN, settings: storedSettings }) };
}

describe("sevdesk connector: contacts", () => {
	it("searches customer contacts by name and shows number, name and VAT id", async () => {
		const { provider, http } = providerWith([
			{
				method: "GET",
				path: "/Contact",
				responses: [{ status: 200, body: { objects: [contacts.acme, contacts.person] } }],
			},
		]);

		await expect(provider.searchContacts("Acme")).resolves.toEqual({
			contacts: [
				{
					id: "1001",
					customerNumber: "10001",
					name: "Acme GmbH",
					address: null,
					vatId: "DE123456789",
				},
				{
					id: "1003",
					customerNumber: "10003",
					name: "Erika Mustermann",
					address: null,
					vatId: null,
				},
			],
			truncated: false,
		});
		const [request] = http.to("GET", "/Contact");
		expect(Object.fromEntries(request.query)).toEqual({
			name: "Acme",
			"category[id]": "3",
			depth: "1",
			limit: "26",
			offset: "0",
		});
	});

	it("marks a search as truncated when more customers match than it shows", async () => {
		const many = Array.from({ length: 26 }, (_, index) =>
			contactRow({ id: String(2000 + index), name: `Acme ${index}` }),
		);
		const { provider } = providerWith([
			{ method: "GET", path: "/Contact", responses: [{ status: 200, body: { objects: many } }] },
		]);

		const result = await provider.searchContacts("Acme");
		expect(result.truncated).toBe(true);
		expect(result.contacts).toHaveLength(25);
	});

	it("reads one contact by id and answers null for an unknown one", async () => {
		const { provider } = providerWith([
			{
				method: "GET",
				path: "/Contact/1001",
				responses: [{ status: 200, body: { objects: [contacts.acme] } }],
			},
			{ method: "GET", path: "/Contact/4040", responses: [{ status: 200, body: { objects: [] } }] },
			{
				method: "GET",
				path: "/Contact/4041",
				responses: [{ status: 400, body: { error: { message: "Contact was not found" } } }],
			},
		]);

		await expect(provider.getContact("1001")).resolves.toMatchObject({
			id: "1001",
			name: "Acme GmbH",
		});
		await expect(provider.getContact("4040")).resolves.toBeNull();
		await expect(provider.getContact("4041")).resolves.toBeNull();
		await expect(provider.getContact("../Invoice")).resolves.toBeNull();
	});

	it("lists every customer contact page by page with limit and offset", async () => {
		const page = (from: number, count: number) =>
			Array.from({ length: count }, (_, index) =>
				contactRow({ id: String(from + index), name: `Customer ${from + index}` }),
			);
		const { provider, http } = providerWith([
			{
				method: "GET",
				path: "/Contact",
				responses: [
					{ status: 200, body: { objects: page(1, 100) } },
					{ status: 200, body: { objects: page(101, 3) } },
				],
			},
		]);
		const lister = provider as typeof provider & {
			listCustomerContacts(page: { cursor: string | null }): Promise<{
				contacts: unknown[];
				nextCursor: string | null;
			}>;
		};

		const first = await lister.listCustomerContacts({ cursor: null });
		expect(first.contacts).toHaveLength(100);
		expect(first.nextCursor).toBe("100");
		const second = await lister.listCustomerContacts({ cursor: first.nextCursor });
		expect(second.contacts).toHaveLength(3);
		expect(second.nextCursor).toBeNull();

		expect(http.to("GET", "/Contact").map((request) => Object.fromEntries(request.query))).toEqual([
			{ "category[id]": "3", depth: "1", limit: "100", offset: "0" },
			{ "category[id]": "3", depth: "1", limit: "100", offset: "100" },
		]);
	});
});

function draftWith(
	taxTreatment: InvoiceDraft["taxTreatment"] = { kind: "domestic_standard", rateBasisPoints: 1900 },
	overrides: Partial<InvoiceDraft> = {},
): InvoiceDraft {
	const result = buildInvoiceDraft({
		contactId: "1001",
		currency: "EUR",
		taxTreatment,
		servicePeriod: {
			from: Temporal.PlainDate.from("2026-09-01"),
			to: Temporal.PlainDate.from("2026-09-30"),
		},
		title: "Leistungen September 2026",
		introduction: "Wir berechnen Ihnen die folgenden Leistungen:",
		remark: "Zahlbar innerhalb von 14 Tagen.",
		lines: [
			workLine({
				projectId: "p-1",
				projectName: "Website <Relaunch>",
				text: "Website Relaunch, 01.09.–30.09.2026, 2.50 h",
				durationMs: 9_000_000,
				unitPrice: BigInt(9500),
			}),
			workLine({
				projectId: "p-2",
				projectName: "Support",
				text: "Support, 01.09.–30.09.2026, 1.25 h",
				durationMs: 4_500_000,
				unitPrice: BigInt(8000),
			}),
			{ kind: "text", text: "12.09.2026 Anna: Kick-off & Workshop (2.50 h)" },
		],
		...overrides,
	});
	if (!result.ok) throw new Error(result.problem);
	return result.draft;
}

/** Routes for a draft creation: the marker lookup finds nothing, then saveInvoice creates 9001. */
function creationRoutes(
	options: { lookup?: FixtureRoute["responses"]; save?: FixtureRoute["responses"] } = {},
): FixtureRoute[] {
	return [
		{
			method: "GET",
			path: "/Invoice",
			responses: options.lookup ?? [{ status: 200, body: { objects: [] } }],
		},
		{
			method: "POST",
			path: "/Invoice/Factory/saveInvoice",
			responses: options.save ?? [
				(request) => ({
					status: 201,
					body: savedInvoice({
						id: "9001",
						customerInternalNote: JSON.parse(request.bodyText ?? "{}").invoice.customerInternalNote,
						sumNet: "337.5",
					}),
				}),
			],
		},
	];
}

function savedBody(http: ReturnType<typeof fixtureFetch>, index = 0) {
	const request = http.to("POST", "/Invoice/Factory/saveInvoice")[index];
	return JSON.parse(request.bodyText ?? "null");
}

describe("sevdesk connector: invoice drafts", () => {
	it("creates a draft (status 100) through saveInvoice in the documented field order", async () => {
		const { provider, http } = providerWith(creationRoutes());

		const created = await provider.createInvoiceDraft(draftWith(), { idempotencyKey: "handoff-1" });

		expect(created).toEqual({ externalId: "9001", externalUrl: null });
		const body = savedBody(http);
		// openapi.yaml `saveInvoice`: "the order of the last four attributes always needs to be kept".
		expect(Object.keys(body)).toEqual([
			"invoice",
			"invoicePosSave",
			"invoicePosDelete",
			"discountSave",
			"discountDelete",
			"takeDefaultAddress",
		]);
		expect(body).toMatchObject({
			invoicePosDelete: null,
			discountSave: null,
			discountDelete: null,
			takeDefaultAddress: true,
		});
		// Model_Invoice property order (openapi.yaml), only the properties Z8 sends.
		expect(Object.keys(body.invoice)).toEqual([
			"id",
			"objectName",
			"invoiceNumber",
			"contact",
			"contactPerson",
			"invoiceDate",
			"header",
			"headText",
			"footText",
			"discount",
			"deliveryDate",
			"deliveryDateUntil",
			"status",
			"taxRate",
			"taxRule",
			"taxText",
			"taxSet",
			"invoiceType",
			"currency",
			"showNet",
			"customerInternalNote",
			"mapAll",
		]);
		expect(body.invoice).toMatchObject({
			id: null,
			objectName: "Invoice",
			invoiceNumber: null,
			contact: { id: 1001, objectName: "Contact" },
			contactPerson: { id: 501, objectName: "SevUser" },
			// 2026-10-09T08:00Z is 9 October in Berlin.
			invoiceDate: "09.10.2026",
			header: "Leistungen September 2026",
			headText: "Wir berechnen Ihnen die folgenden Leistungen:",
			discount: 0,
			// The hand-off period: from 1 September; until 30 September 00:00 Berlin as a Unix timestamp.
			deliveryDate: "01.09.2026",
			deliveryDateUntil: 1790719200,
			status: "100",
			taxRate: 0,
			taxRule: { id: 1, objectName: "TaxRule" },
			taxText: "Umsatzsteuer 19%",
			taxSet: null,
			invoiceType: "RE",
			currency: "EUR",
			showNet: true,
			mapAll: true,
		});
		expect(body.invoice.footText).toBe(
			"Zahlbar innerhalb von 14 Tagen.<br><br>12.09.2026 Anna: Kick-off &amp; Workshop (2.50 h)",
		);
		expect(body.invoice.customerInternalNote).toMatch(/^Z8-[0-9a-f]{24}$/);
		expect(body.invoicePosSave).toEqual([
			{
				objectName: "InvoicePos",
				mapAll: true,
				quantity: 2.5,
				price: 95,
				name: "Website <Relaunch>",
				unity: { id: 9, objectName: "Unity" },
				positionNumber: 1,
				text: "Website Relaunch, 01.09.–30.09.2026, 2.50 h",
				taxRate: 19,
			},
			{
				objectName: "InvoicePos",
				mapAll: true,
				quantity: 1.25,
				price: 80,
				name: "Support",
				unity: { id: 9, objectName: "Unity" },
				positionNumber: 2,
				text: "Support, 01.09.–30.09.2026, 1.25 h",
				taxRate: 19,
			},
		]);
		expect(http.to("POST", "/Invoice/Factory/saveInvoice")[0].headers["content-type"]).toBe(
			"application/json",
		);
	});

	it.each([
		["domestic_reduced", 700, 1, 7, "Umsatzsteuer 7%"],
		[
			"eu_reverse_charge",
			0,
			21,
			0,
			"Steuerschuldnerschaft des Leistungsempfängers (Reverse Charge)",
		],
		["third_country_service", 0, 17, 0, "Nicht im Inland steuerbare Leistung"],
		["vat_free", 0, 4, 0, "Steuerfreie Umsätze §4 UStG"],
	] as const)(
		"translates %s into sevdesk tax rule %i",
		async (kind, rate, ruleId, positionRate, taxText) => {
			const { provider, http } = providerWith(creationRoutes());

			await provider.createInvoiceDraft(draftWith({ kind, rateBasisPoints: rate }), {
				idempotencyKey: `handoff-${kind}`,
			});

			const body = savedBody(http);
			expect(body.invoice.taxRule).toEqual({ id: ruleId, objectName: "TaxRule" });
			expect(body.invoice.taxText).toBe(taxText);
			expect(body.invoicePosSave.map((position: { taxRate: number }) => position.taxRate)).toEqual([
				positionRate,
				positionRate,
			]);
		},
	);

	it("refuses a domestic rate sevdesk's tax rule 1 does not allow, without calling sevdesk", async () => {
		const { provider, http } = providerWith(creationRoutes());

		await expect(
			provider.createInvoiceDraft(draftWith({ kind: "domestic_standard", rateBasisPoints: 1600 }), {
				idempotencyKey: "handoff-16",
			}),
		).rejects.toMatchObject({
			failure: "rejected",
			message: expect.stringContaining("7 % or 19 %"),
		});
		expect(http.requests).toHaveLength(0);
	});

	it("passes sevdesk's validation message on as a rejection", async () => {
		const { provider } = providerWith(
			creationRoutes({ save: [{ status: 422, body: taxRateNotAllowed }] }),
		);

		await expect(
			provider.createInvoiceDraft(draftWith(), { idempotencyKey: "handoff-422" }),
		).rejects.toMatchObject({
			failure: "rejected",
			message: expect.stringContaining("Steuerregel 1 nicht zulässig"),
		});
	});

	it("refuses to create a draft when the stored connection settings are incomplete", async () => {
		const { connector, http } = connectorWith(creationRoutes());
		const provider = connector.open({ apiKey: TOKEN, settings: {} });

		await expect(
			provider.createInvoiceDraft(draftWith(), { idempotencyKey: "handoff-1" }),
		).rejects.toMatchObject({ failure: "rejected", message: expect.stringContaining("Replace") });
		expect(http.requests).toHaveLength(0);
	});
});

describe("sevdesk connector: idempotency without a provider key", () => {
	it("looks up a draft carrying the hand-off's marker by contact and date before creating", async () => {
		const { provider, http } = providerWith(creationRoutes());

		await provider.createInvoiceDraft(draftWith(), { idempotencyKey: "handoff-1" });

		const [lookup] = http.to("GET", "/Invoice");
		expect(Object.fromEntries(lookup.query)).toEqual({
			"contact[id]": "1001",
			"contact[objectName]": "Contact",
			// From the end of the hand-off period (30 September 00:00 Berlin): the draft is dated later.
			startDate: "1790719200",
			limit: "100",
			offset: "0",
		});
	});

	it("after an ambiguous failure, a retry with the same key finds the draft instead of creating another", async () => {
		let note: string | null = null;
		const { provider, http } = providerWith(
			creationRoutes({
				lookup: [
					{ status: 200, body: { objects: [invoiceRow({ id: "8000", status: "200" })] } },
					() => ({
						status: 200,
						body: {
							objects: [
								invoiceRow({ id: "8000", status: "200" }),
								invoiceRow({ id: "9001", status: "100", customerInternalNote: note }),
							],
						},
					}),
				],
				save: [
					(request) => {
						note = JSON.parse(request.bodyText ?? "{}").invoice.customerInternalNote;
						return "network_error";
					},
				],
			}),
		);

		await expect(
			provider.createInvoiceDraft(draftWith(), { idempotencyKey: "handoff-1" }),
		).rejects.toMatchObject({ failure: "outcome_unknown" });

		await expect(
			provider.createInvoiceDraft(draftWith(), { idempotencyKey: "handoff-1" }),
		).resolves.toEqual({ externalId: "9001", externalUrl: null });
		expect(http.to("POST", "/Invoice/Factory/saveInvoice")).toHaveLength(1);
	});

	it("uses a different marker for a different key", async () => {
		const { provider, http } = providerWith(creationRoutes());

		await provider.createInvoiceDraft(draftWith(), { idempotencyKey: "handoff-1" });
		await provider.createInvoiceDraft(draftWith(), { idempotencyKey: "handoff-2" });

		const notes = [savedBody(http, 0), savedBody(http, 1)].map(
			(body) => body.invoice.customerInternalNote,
		);
		expect(notes[0]).not.toBe(notes[1]);
		expect(notes.join(" ")).not.toContain("handoff");
	});

	it("pages through the contact's invoices while looking for the marker", async () => {
		const page = (from: number, count: number) =>
			Array.from({ length: count }, (_, index) =>
				invoiceRow({ id: String(from + index), status: "200" }),
			);
		const { provider, http } = providerWith(
			creationRoutes({
				lookup: [
					{ status: 200, body: { objects: page(1, 100) } },
					{ status: 200, body: { objects: page(101, 2) } },
				],
			}),
		);

		await provider.createInvoiceDraft(draftWith(), { idempotencyKey: "handoff-1" });

		expect(http.to("GET", "/Invoice").map((request) => request.query.get("offset"))).toEqual([
			"0",
			"100",
		]);
		expect(http.to("POST", "/Invoice/Factory/saveInvoice")).toHaveLength(1);
	});
});

describe("sevdesk connector: rate limits", () => {
	it("backs off on 429 and retries; the call was not performed", async () => {
		const { provider, http, sleeps } = providerWith(
			creationRoutes({
				save: [
					{ status: 429, body: tooManyRequests },
					{ status: 429, body: tooManyRequests, headers: { "Retry-After": "3" } },
					(request) => ({
						status: 201,
						body: savedInvoice({
							id: "9001",
							customerInternalNote: JSON.parse(request.bodyText ?? "{}").invoice
								.customerInternalNote,
							sumNet: "337.5",
						}),
					}),
				],
			}),
		);

		await expect(
			provider.createInvoiceDraft(draftWith(), { idempotencyKey: "handoff-1" }),
		).resolves.toMatchObject({ externalId: "9001" });
		expect(sleeps).toEqual([1000, 3000]);
		expect(http.to("POST", "/Invoice/Factory/saveInvoice")).toHaveLength(3);
	});

	it("gives up after a few 429s with not_performed", async () => {
		const { provider, sleeps } = providerWith([
			{ method: "GET", path: "/Contact", responses: [{ status: 429, body: tooManyRequests }] },
		]);

		await expect(provider.searchContacts("Acme")).rejects.toMatchObject({
			failure: "not_performed",
		});
		expect(sleeps).toEqual([1000, 2000, 4000]);
	});
});

describe("sevdesk connector: draft status", () => {
	it.each([
		["100", "draft"],
		["200", "finalized"],
		["750", "finalized"],
		["1000", "finalized"],
	] as const)("reads status %s as %s", async (status, expected) => {
		const { provider } = providerWith([
			{
				method: "GET",
				path: "/Invoice/9001",
				responses: [{ status: 200, body: invoiceById("9001", status) }],
			},
		]);

		await expect(provider.getInvoiceDraftStatus("9001")).resolves.toEqual({
			kind: "status",
			status: expected,
			toolStatus: status,
		});
	});

	it("reads 400 'Invoice was not found' as gone", async () => {
		const { provider } = providerWith([
			{
				method: "GET",
				path: "/Invoice/9001",
				responses: [{ status: 400, body: invoiceNotFound }],
			},
		]);

		await expect(provider.getInvoiceDraftStatus("9001")).resolves.toEqual({ kind: "gone" });
	});

	it("does not read another 400 as gone", async () => {
		const { provider } = providerWith([
			{
				method: "GET",
				path: "/Invoice/9001",
				responses: [{ status: 400, body: { error: { message: "Something else" } } }],
			},
		]);

		await expect(provider.getInvoiceDraftStatus("9001")).rejects.toMatchObject({
			failure: "rejected",
		});
	});
});

describe("sevdesk connector: registration", () => {
	it("is a production connector", () => {
		const registry = getAccountingProviderRegistry();
		expect(registry.get("sevdesk")).toMatchObject({ kind: "sevdesk" });
		expect(registry.availableKinds()).toContain("sevdesk");
	});
});

describe("sevdesk connector: the token stays secret", () => {
	it("never puts the token into errors, even when sevdesk echoes it", async () => {
		const { provider } = providerWith([
			{
				method: "GET",
				path: "/Contact",
				responses: [{ status: 400, body: { error: { message: `Bad token ${TOKEN}` } } }],
			},
		]);

		const error = await provider.searchContacts("Acme").catch((caught: unknown) => caught);
		expect(error).toMatchObject({ failure: "rejected" });
		expect(String(error)).not.toContain(TOKEN);
		expect(JSON.stringify(error)).not.toContain(TOKEN);
	});
});
