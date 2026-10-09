import { describe, expect, it } from "vitest";
import type { AccountingContact } from "@/lib/billable-time/accounting/provider";
import { planCustomerImportRows } from "./customer-import-plan";
import { readStagedCustomer } from "./staged-customer";

const account = {
	connectionId: "c0000000-0000-4000-8000-000000000001",
	providerKind: "lexware_office",
	accountRef: "lexware-account-1",
} as const;

function contact(overrides: Partial<AccountingContact> & { id: string }): AccountingContact {
	return {
		customerNumber: null,
		name: `Contact ${overrides.id}`,
		address: null,
		vatId: null,
		email: null,
		...overrides,
	};
}

const acme = contact({
	id: "contact-acme",
	customerNumber: "10307",
	name: "Acme Consulting & Partner GmbH",
	address: "Musterstraße 42\n79112 Freiburg",
	vatId: "DE123456789",
	email: "info@acme.example",
});

function plan(input: {
	contacts: AccountingContact[];
	customers?: { id: string; name: string }[];
	links?: {
		customerId: string;
		providerKind: string;
		accountRef: string;
		contactId: string;
		contactNumber: string | null;
	}[];
}) {
	return planCustomerImportRows({
		account,
		contacts: input.contacts,
		customers: input.customers ?? [],
		links: input.links ?? [],
	});
}

const view = (rows: ReturnType<typeof plan>) =>
	rows.map((row) => ({ ...readStagedCustomer(row), severity: row.issueSeverity }));

describe("planCustomerImportRows", () => {
	it("stages an unmatched contact as a customer row with the contact's details", () => {
		const rows = plan({ contacts: [acme] });

		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({
			entityType: "customer",
			providerSourceId: "contact-acme",
			rowStatus: "staged",
			issueSeverity: "none",
		});
		expect(readStagedCustomer(rows[0])).toEqual({
			contactId: "contact-acme",
			customerNumber: "10307",
			name: "Acme Consulting & Partner GmbH",
			vatId: "DE123456789",
			email: "info@acme.example",
			address: "Musterstraße 42\n79112 Freiburg",
			providerKind: "lexware_office",
			accountRef: "lexware-account-1",
			connectionId: account.connectionId,
			suggestion: null,
			nameTakenBy: null,
			duplicateNameInTool: false,
		});
	});

	it("leaves out contacts already linked for this tool account, but not links of other accounts", () => {
		const other = contact({ id: "contact-other", name: "Other GmbH" });
		const rows = plan({
			contacts: [acme, other],
			customers: [
				{ id: "cust-acme", name: "Acme" },
				{ id: "cust-old", name: "Old" },
			],
			links: [
				{ ...account, customerId: "cust-acme", contactId: "contact-acme", contactNumber: "10307" },
				{
					customerId: "cust-old",
					providerKind: "lexware_office",
					accountRef: "another-account",
					contactId: "contact-other",
					contactNumber: null,
				},
			],
		});

		expect(rows.map((row) => row.providerSourceId)).toEqual(["contact-other"]);
	});

	it("suggests the customer whose existing contact link carries the same customer number first", () => {
		const rows = plan({
			contacts: [acme],
			customers: [
				{ id: "cust-by-number", name: "Acme (old books)" },
				{ id: "cust-by-name", name: "acme consulting & partner gmbh" },
			],
			links: [
				{
					customerId: "cust-by-number",
					providerKind: "sevdesk",
					accountRef: "sevdesk-1",
					contactId: "17",
					contactNumber: "10307",
				},
			],
		});

		expect(view(rows)).toMatchObject([
			{
				suggestion: {
					customerId: "cust-by-number",
					customerName: "Acme (old books)",
					reason: "customer_number",
				},
				nameTakenBy: { customerId: "cust-by-name" },
				severity: "info",
			},
		]);
	});

	it("suggests an existing customer with the same name, ignoring case, as a link", () => {
		const rows = plan({
			contacts: [acme],
			customers: [{ id: "cust-acme", name: "  ACME Consulting & Partner GmbH " }],
		});

		expect(view(rows)).toMatchObject([
			{
				suggestion: { customerId: "cust-acme", reason: "name" },
				nameTakenBy: { customerId: "cust-acme", customerName: "  ACME Consulting & Partner GmbH " },
				severity: "info",
			},
		]);
	});

	it("never suggests a customer already linked for this account; a taken name is a warning", () => {
		const rows = plan({
			contacts: [acme],
			customers: [{ id: "cust-acme", name: "Acme Consulting & Partner GmbH" }],
			links: [
				{
					...account,
					customerId: "cust-acme",
					contactId: "another-contact",
					contactNumber: "10307",
				},
			],
		});

		expect(view(rows)).toMatchObject([
			{ suggestion: null, nameTakenBy: { customerId: "cust-acme" }, severity: "warning" },
		]);
	});

	it("does not suggest by number when the number points at several customers", () => {
		const rows = plan({
			contacts: [acme],
			customers: [
				{ id: "a", name: "A" },
				{ id: "b", name: "B" },
			],
			links: [
				{
					customerId: "a",
					providerKind: "sevdesk",
					accountRef: "s1",
					contactId: "1",
					contactNumber: "10307",
				},
				{
					customerId: "b",
					providerKind: "sevdesk",
					accountRef: "s2",
					contactId: "2",
					contactNumber: "10307",
				},
			],
		});

		expect(view(rows)).toMatchObject([{ suggestion: null, severity: "none" }]);
	});

	it("flags contacts that share a name in the tool, since only one can be created", () => {
		const rows = plan({
			contacts: [
				contact({ id: "m1", name: "Müller GmbH" }),
				contact({ id: "m2", name: "müller gmbh" }),
				contact({ id: "x", name: "Schmidt AG" }),
			],
		});

		expect(view(rows).map((row) => [row.contactId, row.duplicateNameInTool, row.severity])).toEqual(
			[
				["m1", true, "warning"],
				["m2", true, "warning"],
				["x", false, "none"],
			],
		);
	});

	it("keeps a contact only once when the tool lists it twice, and drops an unusable email", () => {
		const rows = plan({
			contacts: [
				contact({ id: "dup", name: "Dup", email: "not an email" }),
				contact({ id: "dup", name: "Dup", email: "not an email" }),
			],
		});

		expect(view(rows)).toMatchObject([{ contactId: "dup", email: null }]);
	});
});
