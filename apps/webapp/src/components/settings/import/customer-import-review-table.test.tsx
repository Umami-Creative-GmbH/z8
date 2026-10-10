/* @vitest-environment jsdom */

import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { applyImportDecisionAction } from "@/app/[locale]/(app)/settings/import/review-actions";
import type { StagedCustomer } from "@/lib/import-review/staged-customer";
import { render } from "@/test/render-with-translations";
import { currentCustomerDecision, customerDecisionOptions } from "./customer-import-decisions";
import {
	type CustomerImportReviewRow,
	CustomerImportReviewTable,
} from "./customer-import-review-table";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/app/[locale]/(app)/settings/import/review-actions", () => ({
	applyImportDecisionAction: vi.fn(),
}));
const refresh = vi.fn();
vi.mock("@/navigation", () => ({
	useRouter: () => ({ refresh, push: vi.fn() }),
	Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
		<a href={href} {...props}>
			{children}
		</a>
	),
}));

function staged(overrides: Partial<StagedCustomer> = {}): StagedCustomer {
	return {
		contactId: "contact",
		customerNumber: null,
		name: "Contact",
		vatId: null,
		email: null,
		address: null,
		providerKind: "lexware_office",
		accountRef: "account",
		connectionId: "connection",
		suggestion: null,
		nameTakenBy: null,
		duplicateNameInTool: false,
		...overrides,
	};
}

function row(
	id: string,
	overrides: Partial<CustomerImportReviewRow> = {},
): CustomerImportReviewRow {
	return {
		id,
		rowStatus: "staged",
		issueSeverity: "none",
		commitChoice: null,
		commitHold: null,
		customer: staged({ contactId: id, name: `Contact ${id}` }),
		...overrides,
	};
}

const targets = [
	{ customerId: "cust-erika", name: "Erika Acmeier" },
	{ customerId: "cust-other", name: "Other GmbH" },
];

describe("customer import decisions (#906)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(applyImportDecisionAction).mockResolvedValue({
			success: true,
			data: { updatedCount: 1 },
		});
	});

	it("offers create, the suggested link first, other customers and skip", () => {
		const suggested = row("r1", {
			customer: staged({
				suggestion: { customerId: "cust-erika", customerName: "Erika Acmeier", reason: "name" },
				nameTakenBy: { customerId: "cust-erika", customerName: "Erika Acmeier" },
			}),
		});

		expect(customerDecisionOptions(suggested, targets)).toEqual([
			{ value: "create", kind: "create", disabled: true },
			{
				value: "link:cust-erika",
				kind: "suggested_link",
				customerName: "Erika Acmeier",
				disabled: false,
			},
			{ value: "link:cust-other", kind: "link", customerName: "Other GmbH", disabled: false },
			{ value: "skip", kind: "skip", disabled: false },
		]);
		expect(customerDecisionOptions(row("r2"), [])[0]).toMatchObject({
			value: "create",
			disabled: false,
		});
	});

	it("reads the current decision from the row", () => {
		expect(currentCustomerDecision(row("a"))).toBeNull();
		expect(currentCustomerDecision(row("a", { rowStatus: "accepted" }))).toBe("create");
		expect(currentCustomerDecision(row("a", { rowStatus: "rejected" }))).toBe("skip");
		expect(
			currentCustomerDecision(
				row("a", { rowStatus: "accepted", commitChoice: { kind: "link", targetId: "cust-x" } }),
			),
		).toBe("link:cust-x");
	});

	it("shows each contact, its match and why a row was held", () => {
		render(
			<CustomerImportReviewTable
				organizationId="org_1"
				batchId="batch_1"
				editable
				linkTargets={targets}
				rows={[
					row("acme", {
						customer: staged({
							name: "Acme GmbH",
							customerNumber: "10307",
							vatId: "DE123456789",
							email: "info@acme.example",
							suggestion: {
								customerId: "cust-old",
								customerName: "Acme (old books)",
								reason: "customer_number",
							},
						}),
					}),
					row("held", {
						rowStatus: "blocked",
						commitHold: { reason: "customer_name_taken" },
						customer: staged({ name: "Held AG", duplicateNameInTool: true }),
					}),
				]}
			/>,
		);

		const acme = within(screen.getByText("Acme GmbH").closest("tr") as HTMLElement);
		expect(acme.getByText("10307")).toBeTruthy();
		expect(acme.getByText("info@acme.example")).toBeTruthy();
		expect(
			acme.getByText("Acme (old books) has a contact link with the same customer number"),
		).toBeTruthy();
		const held = within(screen.getByText("Held AG").closest("tr") as HTMLElement);
		expect(
			held.getByText(
				"A customer with this name already exists. Link it instead, or skip the contact.",
			),
		).toBeTruthy();
		expect(
			held.getByText(
				"Another contact in the accounting tool has the same name; only one customer can have it.",
			),
		).toBeTruthy();
	});

	it("creates customers for every staged contact without a match in one decision", async () => {
		render(
			<CustomerImportReviewTable
				organizationId="org_1"
				batchId="batch_1"
				editable
				linkTargets={[]}
				rows={[
					row("new-1"),
					row("new-2"),
					row("suggested", {
						customer: staged({
							suggestion: { customerId: "c", customerName: "C", reason: "name" },
						}),
					}),
					row("decided", { rowStatus: "rejected" }),
				]}
			/>,
		);

		fireEvent.click(
			screen.getByRole("button", { name: "Create customers for 2 contacts without a match" }),
		);

		await waitFor(() => expect(refresh).toHaveBeenCalled());
		expect(applyImportDecisionAction).toHaveBeenCalledWith({
			organizationId: "org_1",
			batchId: "batch_1",
			rowIds: ["new-1", "new-2"],
			decision: "accepted",
			choice: undefined,
		});
	});

	it("words the bulk decision for a single contact in the singular", () => {
		render(
			<CustomerImportReviewTable
				organizationId="org_1"
				batchId="batch_1"
				editable
				linkTargets={[]}
				rows={[row("only")]}
			/>,
		);

		expect(
			screen.getByRole("button", { name: "Create a customer for 1 contact without a match" }),
		).toBeTruthy();
	});

	it("offers no bulk decision once the batch left review", () => {
		render(
			<CustomerImportReviewTable
				organizationId="org_1"
				batchId="batch_1"
				editable={false}
				linkTargets={[]}
				rows={[row("new-1")]}
			/>,
		);

		expect(screen.queryByRole("button", { name: /Create customers/ })).toBeNull();
	});

	it("pages through a long import instead of cutting it off", () => {
		const { rerender } = render(
			<CustomerImportReviewTable
				organizationId="org_1"
				batchId="batch_1"
				editable
				linkTargets={[]}
				rows={[row("r101")]}
				paging={{ page: 2, pageCount: 3 }}
			/>,
		);

		expect(screen.getByText("Page 2 of 3")).toBeTruthy();
		expect(screen.getByRole("link", { name: "Previous page" }).getAttribute("href")).toBe(
			"/settings/import/batch_1?page=1",
		);
		expect(screen.getByRole("link", { name: "Next page" }).getAttribute("href")).toBe(
			"/settings/import/batch_1?page=3",
		);

		rerender(
			<CustomerImportReviewTable
				organizationId="org_1"
				batchId="batch_1"
				editable
				linkTargets={[]}
				rows={[row("r1")]}
				paging={{ page: 1, pageCount: 1 }}
			/>,
		);
		expect(screen.queryByText(/Page 1 of 1/)).toBeNull();
		expect(screen.queryByRole("link", { name: "Next page" })).toBeNull();
	});
});
