/**
 * Plans the staged rows of a customer import (#906) from the accounting tool's
 * customer contacts and the organization's customers and contact links. Pure.
 *
 * - Contacts already linked to a customer for this tool account are left out,
 *   so re-running the import only offers contacts that are not linked yet.
 * - Each other contact gets a suggestion when Z8 has a matching customer that
 *   is not linked for this account yet: a customer whose existing contact link
 *   (to another tool or account) has the same customer number first, then a
 *   customer with the same name ignoring case. Suggestions are only offered;
 *   the admin decides per row.
 */

import type { AccountingContact } from "@/lib/billable-time/accounting/provider";
import { type CustomerSuggestion, customerNameKey } from "./staged-customer";
import type { ImportIssueSeverity, NormalizedImportRow } from "./types";

export interface CustomerImportAccount {
	connectionId: string;
	providerKind: string;
	accountRef: string;
}

export interface CustomerImportExistingLink {
	customerId: string;
	providerKind: string;
	accountRef: string;
	contactId: string;
	contactNumber: string | null;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function clean(value: string | null | undefined): string | null {
	const trimmed = value?.trim();
	return trimmed ? trimmed : null;
}

export function planCustomerImportRows(input: {
	account: CustomerImportAccount;
	contacts: readonly AccountingContact[];
	customers: readonly { id: string; name: string }[];
	links: readonly CustomerImportExistingLink[];
}): NormalizedImportRow[] {
	const { account } = input;
	const sameAccount = (link: CustomerImportExistingLink) =>
		link.providerKind === account.providerKind && link.accountRef === account.accountRef;
	const linkedContacts = new Set(
		input.links.filter(sameAccount).map((link) => link.contactId),
	);
	const linkedCustomers = new Set(
		input.links.filter(sameAccount).map((link) => link.customerId),
	);
	const customerById = new Map(input.customers.map((entry) => [entry.id, entry]));

	const seen = new Set<string>();
	const contacts = input.contacts.filter((entry) => {
		if (seen.has(entry.id) || linkedContacts.has(entry.id)) return false;
		seen.add(entry.id);
		return clean(entry.name) !== null;
	});
	const nameCounts = new Map<string, number>();
	for (const entry of contacts) {
		const key = customerNameKey(entry.name);
		nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1);
	}

	function byCustomerNumber(customerNumber: string | null): CustomerSuggestion | null {
		if (!customerNumber) return null;
		const candidates = new Set(
			input.links
				.filter((link) => link.contactNumber === customerNumber && !sameAccount(link))
				.map((link) => link.customerId)
				.filter((customerId) => !linkedCustomers.has(customerId) && customerById.has(customerId)),
		);
		if (candidates.size !== 1) return null;
		const [customerId] = candidates;
		const found = customerById.get(customerId);
		return found ? { customerId, customerName: found.name, reason: "customer_number" } : null;
	}

	return contacts.map((entry): NormalizedImportRow => {
		const name = clean(entry.name) ?? "";
		const key = customerNameKey(name);
		const sameName = input.customers.filter(
			(candidate) => customerNameKey(candidate.name) === key,
		);
		const unlinkedSameName = sameName.filter((candidate) => !linkedCustomers.has(candidate.id));
		const customerNumber = clean(entry.customerNumber);
		const suggestion: CustomerSuggestion | null =
			byCustomerNumber(customerNumber) ??
			(unlinkedSameName.length === 1
				? { customerId: unlinkedSameName[0].id, customerName: unlinkedSameName[0].name, reason: "name" }
				: null);
		const nameTakenBy = sameName[0]
			? { customerId: sameName[0].id, customerName: sameName[0].name }
			: null;
		const duplicateNameInTool = (nameCounts.get(key) ?? 0) > 1;
		const email = clean(entry.email);
		const issueSeverity: ImportIssueSeverity = suggestion
			? "info"
			: nameTakenBy || duplicateNameInTool
				? "warning"
				: "none";

		return {
			entityType: "customer",
			providerSourceId: entry.id,
			sourcePayload: {
				id: entry.id,
				customerNumber: entry.customerNumber,
				name: entry.name,
				address: entry.address,
				vatId: entry.vatId,
				email: entry.email ?? null,
			},
			normalizedPayload: {
				contactId: entry.id,
				customerNumber,
				name,
				vatId: clean(entry.vatId),
				email: email && EMAIL.test(email) ? email : null,
				address: clean(entry.address),
				providerKind: account.providerKind,
				accountRef: account.accountRef,
				connectionId: account.connectionId,
			},
			matchTarget: { suggestion, nameTakenBy, duplicateNameInTool },
			issueSeverity,
			rowStatus: "staged",
		};
	});
}
