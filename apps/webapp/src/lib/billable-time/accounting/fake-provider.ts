/**
 * An in-memory accounting tool for unit and PostgreSQL tests (#903). It
 * implements the `AccountingProvider` port and its connector like a real tool
 * would, including the idempotency contract, and can simulate failures:
 *
 * - `simulateTimeout()`: the next `createInvoiceDraft` creates the draft in the
 *   tool, then fails with `outcome_unknown` (a timeout after sending). A retry
 *   with the same idempotency key returns that draft.
 * - `failNext(method, failure)`: the next call of `method` fails with `failure`
 *   without any effect.
 *
 * Never imported by production code. Register it with
 * `fakeAccountingProviderRegistry(tool)`.
 */

import { BILLABLE_CURRENCIES } from "@/lib/billable-time/currency";
import { checkInvoiceDraftFits, type InvoiceDraft } from "./invoice-draft";
import {
	type AccountingConnector,
	type AccountingContact,
	type AccountingProvider,
	type AccountingProviderCapabilities,
	AccountingProviderError,
	type AccountingProviderFailure,
	type AccountingProviderKind,
	type CreatedInvoiceDraft,
	type InvoiceDraftStatus,
	type InvoiceDraftToolStatus,
} from "./provider";
import { type AccountingProviderRegistry, createAccountingProviderRegistry } from "./registry";
import { TAX_TREATMENT_KINDS } from "./tax-treatment";

type ProviderMethod =
	| "searchContacts"
	| "getContact"
	| "createInvoiceDraft"
	| "getInvoiceDraftStatus"
	| "listCustomerContacts"
	| "validateConnection";

export interface FakeInvoiceDraft {
	externalId: string;
	idempotencyKey: string;
	draft: InvoiceDraft;
	status: InvoiceDraftToolStatus;
	/** The API key the creating provider was opened with. */
	apiKey: string;
}

export interface FakeAccountingTool {
	readonly connector: AccountingConnector;
	/** Drafts in the tool, oldest first (deleted ones excluded). */
	drafts(): FakeInvoiceDraft[];
	/** How often `createInvoiceDraft` was called, failed calls included. */
	createCalls(): number;
	/** Every API key a provider was opened with, in order. */
	openedWithKeys(): string[];
	simulateTimeout(): void;
	failNext(method: ProviderMethod, failure: AccountingProviderFailure): void;
	setDraftStatus(externalId: string, status: InvoiceDraftToolStatus): void;
	/** Deletes a draft in the tool: its status reads `gone` from now on. */
	deleteDraft(externalId: string): void;
	addContact(contact: AccountingContact): void;
}

export const FAKE_CAPABILITIES: AccountingProviderCapabilities = {
	maxDraftLines: 300,
	supportedCurrencies: BILLABLE_CURRENCIES,
	supportedTaxTreatments: TAX_TREATMENT_KINDS,
	draftStatusCheck: true,
	contactSearchMinLength: 3,
};

const SEARCH_LIMIT = 25;

export function createFakeAccountingTool(
	options: {
		kind?: AccountingProviderKind;
		contacts?: readonly AccountingContact[];
		capabilities?: Partial<AccountingProviderCapabilities>;
		/** When set, only this key is accepted; otherwise any non-blank key is. */
		apiKey?: string;
		accountRef?: string;
		accountLabel?: string | null;
		/** Contacts per `listCustomerContacts` page (default 100). */
		contactPageSize?: number;
	} = {},
): FakeAccountingTool {
	const kind = options.kind ?? "lexware_office";
	const capabilities: AccountingProviderCapabilities = {
		...FAKE_CAPABILITIES,
		...options.capabilities,
	};
	const contacts = [...(options.contacts ?? [])];
	const drafts: (FakeInvoiceDraft & { deleted: boolean })[] = [];
	const byKey = new Map<string, FakeInvoiceDraft & { deleted: boolean }>();
	const pendingFailures = new Map<ProviderMethod, AccountingProviderFailure>();
	const openedWith: string[] = [];
	let timeoutNextCreate = false;
	let createCount = 0;
	let nextDraftNumber = 1;

	const takeFailure = (method: ProviderMethod) => {
		const failure = pendingFailures.get(method);
		if (!failure) return;
		pendingFailures.delete(method);
		throw new AccountingProviderError(failure, `Simulated ${failure} failure of ${method}`);
	};

	const keyAccepted = (apiKey: string) =>
		options.apiKey === undefined ? apiKey.trim() !== "" : apiKey === options.apiKey;

	const unauthorized = () =>
		new AccountingProviderError("unauthorized", "The accounting tool refused the API key");

	function open(apiKey: string): AccountingProvider {
		openedWith.push(apiKey);
		return {
			kind,
			capabilities,
			async searchContacts(query) {
				takeFailure("searchContacts");
				if (!keyAccepted(apiKey)) throw unauthorized();
				const needle = query.trim().toLowerCase();
				if (needle.length < capabilities.contactSearchMinLength) {
					throw new AccountingProviderError("rejected", "The search query is too short");
				}
				const matches = contacts.filter(
					(contact) =>
						contact.name.toLowerCase().includes(needle) ||
						(contact.customerNumber ?? "").toLowerCase().includes(needle),
				);
				return {
					contacts: matches.slice(0, SEARCH_LIMIT).map((contact) => ({ ...contact })),
					truncated: matches.length > SEARCH_LIMIT,
				};
			},
			async getContact(contactId) {
				takeFailure("getContact");
				if (!keyAccepted(apiKey)) throw unauthorized();
				const contact = contacts.find((entry) => entry.id === contactId);
				return contact ? { ...contact } : null;
			},
			async createInvoiceDraft(draft, { idempotencyKey }): Promise<CreatedInvoiceDraft> {
				createCount += 1;
				takeFailure("createInvoiceDraft");
				if (!keyAccepted(apiKey)) throw unauthorized();
				if (idempotencyKey.trim() === "") {
					throw new AccountingProviderError("rejected", "An idempotency key is required");
				}
				const existing = byKey.get(idempotencyKey);
				if (existing) {
					return { externalId: existing.externalId, externalUrl: urlOf(existing.externalId) };
				}
				if (checkInvoiceDraftFits(draft, capabilities).length > 0) {
					throw new AccountingProviderError("rejected", "The draft does not fit the tool");
				}
				if (!contacts.some((contact) => contact.id === draft.contactId)) {
					throw new AccountingProviderError("rejected", "The contact does not exist");
				}
				const created = {
					externalId: `fake-draft-${nextDraftNumber++}`,
					idempotencyKey,
					draft,
					status: "draft" as const,
					apiKey,
					deleted: false,
				};
				drafts.push(created);
				byKey.set(idempotencyKey, created);
				if (timeoutNextCreate) {
					timeoutNextCreate = false;
					throw new AccountingProviderError("outcome_unknown", "The accounting tool timed out");
				}
				return { externalId: created.externalId, externalUrl: urlOf(created.externalId) };
			},
			async listCustomerContacts({ cursor }) {
				takeFailure("listCustomerContacts");
				if (!keyAccepted(apiKey)) throw unauthorized();
				const start = cursor === null ? 0 : Number(cursor);
				if (!Number.isSafeInteger(start) || start < 0) {
					throw new AccountingProviderError("rejected", "Unknown contact page");
				}
				const end = start + (options.contactPageSize ?? 100);
				return {
					contacts: contacts.slice(start, end).map((contact) => ({ ...contact })),
					nextCursor: end < contacts.length ? String(end) : null,
				};
			},
			async getInvoiceDraftStatus(externalId): Promise<InvoiceDraftStatus> {
				if (!capabilities.draftStatusCheck) return { kind: "unsupported" };
				takeFailure("getInvoiceDraftStatus");
				if (!keyAccepted(apiKey)) throw unauthorized();
				const entry = drafts.find((candidate) => candidate.externalId === externalId);
				if (!entry || entry.deleted) return { kind: "gone" };
				return { kind: "status", status: entry.status, toolStatus: entry.status };
			},
		};
	}

	const connector: AccountingConnector = {
		kind,
		capabilities,
		async validateConnection({ apiKey, context }) {
			takeFailure("validateConnection");
			if (!keyAccepted(apiKey)) throw unauthorized();
			if (!capabilities.supportedCurrencies.includes(context.billableCurrency)) {
				return {
					ok: false,
					code: "currency_not_supported",
					message: `This accounting tool cannot take drafts in ${context.billableCurrency}`,
				};
			}
			return {
				ok: true,
				accountRef: options.accountRef ?? "fake-account",
				accountLabel: options.accountLabel === undefined ? "Fake tool" : options.accountLabel,
				settings: {},
			};
		},
		open: ({ apiKey }) => open(apiKey),
	};

	const find = (externalId: string) => {
		const entry = drafts.find((candidate) => candidate.externalId === externalId);
		if (!entry) throw new Error(`No fake draft ${externalId}`);
		return entry;
	};

	return {
		connector,
		drafts: () =>
			drafts
				.filter((entry) => !entry.deleted)
				.map(({ deleted: _deleted, ...entry }) => ({ ...entry })),
		createCalls: () => createCount,
		openedWithKeys: () => [...openedWith],
		simulateTimeout: () => {
			timeoutNextCreate = true;
		},
		failNext: (method, failure) => {
			pendingFailures.set(method, failure);
		},
		setDraftStatus: (externalId, status) => {
			find(externalId).status = status;
		},
		deleteDraft: (externalId) => {
			find(externalId).deleted = true;
		},
		addContact: (contact) => {
			contacts.push(contact);
		},
	};
}

function urlOf(externalId: string): string {
	return `https://fake-accounting.test/drafts/${externalId}`;
}

/** A registry holding the fake tools' connectors, for `vi.mock` of `registry.ts`. */
export function fakeAccountingProviderRegistry(
	...tools: readonly FakeAccountingTool[]
): AccountingProviderRegistry {
	return createAccountingProviderRegistry(tools.map((tool) => tool.connector));
}
