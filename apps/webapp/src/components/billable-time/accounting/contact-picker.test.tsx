/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const searchContacts = vi.hoisted(() => vi.fn());

vi.mock("@/app/[locale]/(app)/settings/billable-time/accounting/actions", () => ({
	searchContacts,
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: Record<string, unknown>) =>
			params
				? fallback.replace(/\{(\w+)\}/g, (match, name: string) => String(params[name] ?? match))
				: fallback,
	}),
}));

const { ContactPicker } = await import("./contact-picker");

const acme = {
	id: "c-1",
	customerNumber: "10001",
	name: "Acme GmbH",
	address: "Hauptstr. 1\n10115 Berlin",
	vatId: "DE123456789",
};

function renderPicker(currentContactId: string | null = null) {
	const onPick = vi.fn();
	render(
		<QueryClientProvider
			client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
		>
			<ContactPicker
				minLength={3}
				currentContactId={currentContactId}
				pending={false}
				onPick={onPick}
			/>
		</QueryClientProvider>,
	);
	return { onPick };
}

describe("ContactPicker", () => {
	beforeEach(() => {
		searchContacts.mockReset();
		searchContacts.mockResolvedValue({
			success: true,
			data: { contacts: [acme], truncated: false },
		});
	});

	it("does not search below the provider's minimum query length", async () => {
		renderPicker();
		await userEvent.type(screen.getByLabelText("Search contacts in the tool"), "ac");
		expect(screen.getByText("Enter at least 3 characters")).toBeTruthy();
		await new Promise((resolve) => setTimeout(resolve, 400));
		expect(searchContacts).not.toHaveBeenCalled();
	});

	it("shows matching contacts with number, VAT ID and address, and picks one", async () => {
		const { onPick } = renderPicker();
		await userEvent.type(screen.getByLabelText("Search contacts in the tool"), "acme");

		expect(await screen.findByText("Acme GmbH")).toBeTruthy();
		expect(screen.getByText("Customer no. 10001 · DE123456789")).toBeTruthy();
		expect(searchContacts).toHaveBeenLastCalledWith({ query: "acme" });

		await userEvent.click(screen.getByRole("button", { name: "Link" }));
		expect(onPick).toHaveBeenCalledWith(acme);
	});

	it("never offers to create a contact when nothing matches", async () => {
		searchContacts.mockResolvedValue({ success: true, data: { contacts: [], truncated: false } });
		renderPicker();
		await userEvent.type(screen.getByLabelText("Search contacts in the tool"), "nobody");

		expect(
			await screen.findByText(
				"No contact matches. Create the contact in the accounting tool first; Z8 never creates contacts there.",
			),
		).toBeTruthy();
		expect(screen.queryByRole("button")).toBeNull();
	});

	it("marks the contact that is already linked", async () => {
		renderPicker("c-1");
		await userEvent.type(screen.getByLabelText("Search contacts in the tool"), "acme");
		const linked = await screen.findByRole("button", { name: "Linked" });
		expect((linked as HTMLButtonElement).disabled).toBe(true);
	});

	it("shows the tool's error", async () => {
		searchContacts.mockResolvedValue({
			success: false,
			error: "The accounting tool could not be reached: timeout",
		});
		renderPicker();
		await userEvent.type(screen.getByLabelText("Search contacts in the tool"), "acme");
		expect(
			await screen.findByText("The accounting tool could not be reached: timeout"),
		).toBeTruthy();
	});
});
