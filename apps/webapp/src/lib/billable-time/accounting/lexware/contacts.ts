/**
 * Lexware Office contacts as the port's `AccountingContact` (#904), and the
 * query strings for `GET /v1/contacts`. Sections "Contacts Endpoint",
 * "Filtering Contacts", "Contact Properties" and the FAQ "Search String
 * Encoding" of https://developers.lexware.io/docs/ (read 2026-10-09).
 */

import type { AccountingContact } from "../provider";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Lexware ids are UUIDs; anything else never goes into a request path. */
export function isLexwareId(value: string): boolean {
	return UUID.test(value);
}

/**
 * The name filter value: `&`, `<` and `>` HTML-encoded as stored in Lexware's
 * database, the `%` and `_` wildcards escaped with a backslash, then
 * URL-encoded ("johnson & partner" → `johnson%20%26amp%3B%20partner`).
 */
export function encodeContactNameFilter(query: string): string {
	const html = query.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
	return encodeURIComponent(html.replace(/[%_]/g, (wildcard) => `\\${wildcard}`));
}

/** Lexware returns stored text HTML-encoded; show it as typed. */
function decodeStoredText(value: string): string {
	return value.replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&");
}

function text(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const trimmed = decodeStoredText(value).trim();
	return trimmed === "" ? null : trimmed;
}

function record(value: unknown): Record<string, unknown> | null {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

/** Lines of the first billing address; the country only when it is not Germany. */
function billingAddress(contact: Record<string, unknown>): string | null {
	const billing = record(contact.addresses)?.billing;
	const address = Array.isArray(billing) ? record(billing[0]) : null;
	if (!address) return null;
	const cityLine = [text(address.zip), text(address.city)].filter(Boolean).join(" ");
	const country = text(address.countryCode);
	const lines = [
		text(address.supplement),
		text(address.street),
		cityLine === "" ? null : cityLine,
		country && country !== "DE" ? country : null,
	].filter((line): line is string => line !== null);
	return lines.length === 0 ? null : lines.join("\n");
}

function contactName(contact: Record<string, unknown>): string | null {
	const company = record(contact.company);
	if (company) return text(company.name);
	const person = record(contact.person);
	if (!person) return null;
	const name = [text(person.firstName), text(person.lastName)].filter(Boolean).join(" ");
	return name === "" ? null : name;
}

/**
 * A contact Z8 may address a draft to: it has the customer role (Lexware
 * requires it for `address.contactId`) and is not archived. Anything else, or
 * an unreadable contact, is null.
 */
export function customerContactFromLexware(value: unknown): AccountingContact | null {
	const contact = record(value);
	if (!contact || typeof contact.id !== "string" || !isLexwareId(contact.id)) return null;
	if (contact.archived === true) return null;
	const customer = record(record(contact.roles)?.customer);
	if (!customer) return null;
	const name = contactName(contact);
	if (!name) return null;
	const number = customer.number;
	return {
		id: contact.id,
		customerNumber:
			typeof number === "number" || typeof number === "string" ? String(number) : null,
		name,
		address: billingAddress(contact),
		vatId: text(record(contact.company)?.vatRegistrationId),
	};
}

export interface LexwarePage {
	content: unknown[];
	last: boolean;
	number: number;
}

/** A page of a paged resource ("Paging of Resources"), or null when unreadable. */
export function readPage(body: unknown): LexwarePage | null {
	const page = record(body);
	if (!page || !Array.isArray(page.content)) return null;
	return {
		content: page.content,
		last: page.last !== false,
		number: typeof page.number === "number" ? page.number : 0,
	};
}
