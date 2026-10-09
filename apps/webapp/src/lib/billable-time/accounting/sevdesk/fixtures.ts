/**
 * Recorded sevdesk API responses for the connector's contract tests (#905).
 * Test-only: production code never imports this file.
 *
 * Shapes mirror the official API description at https://api.sevdesk.de/openapi.yaml
 * (read 2026-10-09) and the API news at https://tech.sevdesk.com/api_news/. sevdesk
 * has no sandbox, so these are not captures from a live account: each fixture cites
 * the documented schema it follows, and the ones marked UNDOCUMENTED follow
 * community clients and must be confirmed on a trial account (see progress-905 /
 * the PR's verification steps).
 *
 * sevdesk conventions visible in every response schema: payloads are wrapped in
 * `objects`; ids, numbers and statuses come back as strings; references are
 * `{ id, objectName }` pairs.
 */

export const TOKEN = "0123456789abcdef0123456789abcdef";

export const SEV_CLIENT_ID = "77001";

/**
 * `GET /Tools/bookkeepingSystemVersion`, 200. openapi.yaml operation
 * `bookkeepingSystemVersion`: `objects.version` enum `'1.0' | '2.0'`, example `'2.0'`.
 */
export const bookkeepingSystemVersion = (version: "1.0" | "2.0") => ({
	objects: { version },
});

/**
 * `GET /SevUser`, 200. UNDOCUMENTED in openapi.yaml (only referenced as the
 * `contactPerson` / `createUser` object `{ id, objectName: "SevUser" }`). Field
 * names follow the community client `@peerigon/sevdesk` (`getSevUsers`:
 * `fullname`, `hidden`) plus the `sevClient` reference every sevdesk model carries.
 */
export const sevUsers = (
	users: { id: string; fullname: string; hidden?: boolean }[] = [
		{ id: "501", fullname: "Anna Buchhaltung" },
	],
) => ({
	objects: users.map((user) => ({
		id: user.id,
		objectName: "SevUser",
		create: "2025-01-15T09:12:00+01:00",
		fullname: user.fullname,
		hidden: user.hidden ? "1" : "0",
		sevClient: { id: SEV_CLIENT_ID, objectName: "SevClient" },
	})),
});

/**
 * `GET /Unity`, 200. UNDOCUMENTED in openapi.yaml: `unity` appears only as the
 * required `{ id, objectName: "Unity" }` reference on `Model_InvoicePos`.
 * Community clients list ids 1 (Stk) and an hour unit; the connector matches the
 * hour unit by name, never by a hard-coded id.
 */
export const unities = (withHour = true) => ({
	objects: [
		{ id: "1", objectName: "Unity", name: "Stk", translationCode: "UNITY_PIECE" },
		...(withHour
			? [{ id: "9", objectName: "Unity", name: "Std", translationCode: "UNITY_HOUR" }]
			: []),
		{ id: "15", objectName: "Unity", name: "pauschal", translationCode: "UNITY_FLAT_RATE" },
	],
});

/**
 * One `Model_ContactResponse` (openapi.yaml): string ids, `category` example
 * id `'3'` (customer), `customerNumber` example `Customer-1337`, `surename` /
 * `familyname` for persons, `vatNumber`, `sevClient` reference.
 */
export function contactRow(input: {
	id: string;
	name?: string | null;
	surename?: string | null;
	familyname?: string | null;
	customerNumber?: string | null;
	vatNumber?: string | null;
}) {
	return {
		id: input.id,
		objectName: "Contact",
		create: "2025-03-02T10:00:00+01:00",
		update: "2025-03-02T10:00:00+01:00",
		name: input.name ?? null,
		status: "1000",
		customerNumber: input.customerNumber ?? null,
		parent: null,
		surename: input.surename ?? null,
		familyname: input.familyname ?? null,
		titel: null,
		category: { id: "3", objectName: "Category" },
		description: null,
		academicTitle: null,
		gender: null,
		sevClient: { id: SEV_CLIENT_ID, objectName: "SevClient" },
		name2: null,
		birthday: null,
		vatNumber: input.vatNumber ?? null,
		bankAccount: null,
		bankNumber: null,
		defaultCashbackTime: null,
		defaultCashbackPercent: null,
		defaultTimeToPay: null,
		taxNumber: null,
		taxOffice: null,
		exemptVat: "0",
		defaultDiscountAmount: null,
		defaultDiscountPercentage: null,
		buyerReference: null,
		governmentAgency: "0",
		additionalInformation: null,
	};
}

export const contacts = {
	acme: contactRow({
		id: "1001",
		name: "Acme GmbH",
		customerNumber: "10001",
		vatNumber: "DE123456789",
	}),
	acmeSchweiz: contactRow({ id: "1002", name: "Acme Schweiz AG", customerNumber: "10002" }),
	person: contactRow({
		id: "1003",
		surename: "Erika",
		familyname: "Mustermann",
		customerNumber: "10003",
	}),
};

/**
 * One `Model_InvoiceResponse` (openapi.yaml): string id and `status` (enum
 * `'50' | '100' | '200' | '750' | '1000'`), `contact` reference,
 * `customerInternalNote` ("Contains data entered into field
 * 'Referenz/Bestellnummer'"), `sumNet` string.
 */
export function invoiceRow(input: {
	id: string;
	status: "50" | "100" | "200" | "750" | "1000";
	contactId?: string;
	customerInternalNote?: string | null;
	sumNet?: string;
}) {
	return {
		id: input.id,
		objectName: "Invoice",
		invoiceNumber: input.status === "100" ? null : `RE-${input.id}`,
		contact: { id: input.contactId ?? "1001", objectName: "Contact" },
		create: "2026-10-09T10:15:00+02:00",
		invoiceDate: "2026-10-09T00:00:00+02:00",
		header: "Rechnung",
		status: input.status,
		contactPerson: { id: "501", objectName: "SevUser" },
		taxRule: { id: "1", objectName: "TaxRule" },
		currency: "EUR",
		sumNet: input.sumNet ?? "250",
		customerInternalNote: input.customerInternalNote ?? null,
		sevClient: { id: SEV_CLIENT_ID, objectName: "SevClient" },
	};
}

/**
 * `POST /Invoice/Factory/saveInvoice`, 201 "Created - Returns created invoice"
 * (`saveInvoiceResponse`: the invoice and its positions, wrapped in `objects`
 * like every sevdesk response).
 */
export const savedInvoice = (input: {
	id: string;
	customerInternalNote: string;
	sumNet: string;
}) => ({
	objects: {
		invoice: invoiceRow({
			id: input.id,
			status: "100",
			customerInternalNote: input.customerInternalNote,
			sumNet: input.sumNet,
		}),
		invoicePos: [],
	},
});

/** `GET /Invoice/{invoiceId}`, 200: `objects` is an array of `Model_InvoiceResponse`. */
export const invoiceById = (id: string, status: "50" | "100" | "200" | "750" | "1000") => ({
	objects: [invoiceRow({ id, status })],
});

/** `GET /Invoice/{invoiceId}`, 400: openapi.yaml "Bad request. Invoice was not found". */
export const invoiceNotFound = {
	error: { message: "Invoice was not found", code: null, data: null },
};

/** 401 "Authentication required" (every operation in openapi.yaml). */
export const authenticationRequired = {
	error: { message: "Authentication required", code: 401, data: null },
};

/** 429: rate limits are not documented; body shape assumed like other sevdesk errors. */
export const tooManyRequests = {
	error: { message: "Too Many Requests", code: 429, data: null },
};

/** 422 when a position's tax rate is not allowed for the tax rule (openapi.yaml, sevdesk-Update 2.0). */
export const taxRateNotAllowed = {
	error: {
		message: "Der Steuersatz 16 ist für die Steuerregel 1 nicht zulässig",
		code: 422,
		data: null,
	},
};

// ---------------------------------------------------------------------------
// A fixture-backed `fetch` that routes requests to recorded responses and
// records every request it saw.
// ---------------------------------------------------------------------------

export interface RecordedRequest {
	method: string;
	path: string;
	query: URLSearchParams;
	headers: Record<string, string>;
	/** The raw request body text (JSON for POST). */
	bodyText: string | null;
}

export interface FixtureResponse {
	status: number;
	body?: unknown;
	headers?: Record<string, string>;
}

export type FixtureRoute = {
	method: "GET" | "POST";
	path: string;
	/** Answers in order; the last one repeats. A function sees the request. */
	responses: (
		| FixtureResponse
		| ((request: RecordedRequest) => FixtureResponse | "network_error")
	)[];
};

export const BASE_URL = "https://my.sevdesk.de/api/v1";

export function fixtureFetch(routes: FixtureRoute[]) {
	const requests: RecordedRequest[] = [];
	const served = new Map<FixtureRoute, number>();

	const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
		const url = new URL(typeof input === "string" ? input : input.toString());
		if (!url.href.startsWith(`${BASE_URL}/`)) throw new Error(`Unexpected host: ${url.href}`);
		const path = url.pathname.slice(new URL(BASE_URL).pathname.length);
		const headers: Record<string, string> = {};
		new Headers(init?.headers).forEach((value, key) => {
			headers[key] = value;
		});
		const request: RecordedRequest = {
			method: init?.method ?? "GET",
			path,
			query: url.searchParams,
			headers,
			bodyText: typeof init?.body === "string" ? init.body : null,
		};
		requests.push(request);
		const route = routes.find(
			(candidate) => candidate.method === request.method && candidate.path === path,
		);
		if (!route) {
			return new Response(JSON.stringify({ error: { message: `No fixture for ${path}` } }), {
				status: 404,
			});
		}
		const index = served.get(route) ?? 0;
		served.set(route, index + 1);
		const answer = route.responses[Math.min(index, route.responses.length - 1)];
		const response = typeof answer === "function" ? answer(request) : answer;
		if (response === "network_error") throw new TypeError("fetch failed");
		return new Response(response.body === undefined ? null : JSON.stringify(response.body), {
			status: response.status,
			headers: { "content-type": "application/json", ...response.headers },
		});
	};

	return {
		fetch: fetchImpl as typeof fetch,
		requests,
		/** Requests to one path. */
		to: (method: string, path: string) =>
			requests.filter((request) => request.method === method && request.path === path),
	};
}

/** The routes a healthy connection setup needs. */
export function setupRoutes(
	options: {
		version?: "1.0" | "2.0";
		users?: Parameters<typeof sevUsers>[0];
		withHour?: boolean;
	} = {},
): FixtureRoute[] {
	return [
		{
			method: "GET",
			path: "/Tools/bookkeepingSystemVersion",
			responses: [{ status: 200, body: bookkeepingSystemVersion(options.version ?? "2.0") }],
		},
		{
			method: "GET",
			path: "/SevUser",
			responses: [{ status: 200, body: sevUsers(options.users) }],
		},
		{
			method: "GET",
			path: "/Unity",
			responses: [{ status: 200, body: unities(options.withHour ?? true) }],
		},
	];
}
