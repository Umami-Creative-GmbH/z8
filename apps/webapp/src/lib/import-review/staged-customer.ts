/**
 * A staged customer row of the customer import (#906), as the review screen
 * and the committer read it. Client-safe.
 *
 * - `normalizedPayload`: the contact as the accounting tool returned it
 *   (name, customer number, VAT ID, email, formatted address) plus the tool
 *   account it came from.
 * - `matchTarget`: what the scan found in Z8. `suggestion` is the customer the
 *   admin is offered to link (an existing contact link with the same customer
 *   number first, then the same name ignoring case); it is never applied
 *   without the admin's decision. `nameTakenBy` is a customer whose name equals
 *   the contact's ignoring case: creating a new customer is not possible then.
 */

export type CustomerSuggestionReason = "customer_number" | "name";

export interface CustomerSuggestion {
	customerId: string;
	customerName: string;
	reason: CustomerSuggestionReason;
}

export interface StagedCustomer {
	contactId: string;
	customerNumber: string | null;
	name: string;
	vatId: string | null;
	email: string | null;
	address: string | null;
	providerKind: string;
	accountRef: string;
	connectionId: string;
	suggestion: CustomerSuggestion | null;
	nameTakenBy: { customerId: string; customerName: string } | null;
	/** Another contact in the tool has the same name; only one of them can be created. */
	duplicateNameInTool: boolean;
}

function record(value: unknown): Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

function text(value: unknown): string | null {
	return typeof value === "string" && value !== "" ? value : null;
}

function suggestionOf(value: unknown): CustomerSuggestion | null {
	const entry = record(value);
	const customerId = text(entry.customerId);
	const customerName = text(entry.customerName);
	const reason = entry.reason;
	if (!customerId || customerName === null) return null;
	if (reason !== "customer_number" && reason !== "name") return null;
	return { customerId, customerName, reason };
}

function nameTakenOf(value: unknown): StagedCustomer["nameTakenBy"] {
	const entry = record(value);
	const customerId = text(entry.customerId);
	const customerName = text(entry.customerName);
	return customerId && customerName !== null ? { customerId, customerName } : null;
}

/** Reads a staged customer row; unknown or missing fields read as empty. */
export function readStagedCustomer(row: {
	normalizedPayload: Record<string, unknown>;
	matchTarget?: Record<string, unknown> | null;
}): StagedCustomer {
	const payload = record(row.normalizedPayload);
	const match = record(row.matchTarget);
	return {
		contactId: text(payload.contactId) ?? "",
		customerNumber: text(payload.customerNumber),
		name: text(payload.name) ?? "",
		vatId: text(payload.vatId),
		email: text(payload.email),
		address: text(payload.address),
		providerKind: text(payload.providerKind) ?? "",
		accountRef: text(payload.accountRef) ?? "",
		connectionId: text(payload.connectionId) ?? "",
		suggestion: suggestionOf(match.suggestion),
		nameTakenBy: nameTakenOf(match.nameTakenBy),
		duplicateNameInTool: match.duplicateNameInTool === true,
	};
}

/** The name comparison of the customer import: trimmed, ignoring case. */
export function customerNameKey(name: string): string {
	return name.trim().toLowerCase();
}
