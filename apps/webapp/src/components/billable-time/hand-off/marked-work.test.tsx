/* @vitest-environment jsdom */

import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type {
	ItemAmountDifferenceView,
	MarkedWorkItemView,
} from "@/lib/billable-time/hand-off/views";
import { render } from "@/test/render-with-translations";
import { MarkedWork } from "./marked-work";

vi.mock("@/hooks/use-display-context", () => ({
	useDisplayContext: () => ({ locale: "en-US", timezone: "UTC", timeFormat: "24h" }),
}));

const handOffValues = {
	removed: false,
	pieceCount: 1,
	removedPieceCount: 0,
	day: "2026-03-02",
	start: { at: "2026-03-02T08:00:00.000Z", offsetMinutes: 60 },
	end: { at: "2026-03-02T10:30:00.000Z", offsetMinutes: 60 },
	durationMinutes: 150,
	hours: "2.50",
	projects: [{ id: "p-web", name: "Website" }],
	customers: [{ id: "c-acme", name: "Acme" }],
	billability: "billable",
} satisfies MarkedWorkItemView["comparison"]["handOff"];

const plus25: ItemAmountDifferenceView = {
	currency: "EUR",
	fromHandOff: { kind: "known", amount: "25.00", reason: "frozen_rate", roundingCaveat: true },
	sinceResolution: null,
	notOnHandOffForNewCustomer: false,
};

const withDifference = (
	base: MarkedWorkItemView,
	amountDifference: ItemAmountDifferenceView,
): MarkedWorkItemView => ({ ...base, comparison: { ...base.comparison, amountDifference } });

const item = (overrides: Partial<MarkedWorkItemView> = {}): MarkedWorkItemView => ({
	invoiceDraftId: "draft-1",
	draft: {
		customerId: "c-acme",
		customerName: "Acme",
		currency: "EUR",
		period: { from: "2026-03-01", to: "2026-03-31" },
		title: "Acme March",
		externalId: null,
		createdAt: "2026-04-01T08:00:00Z",
	},
	invoicedWorkId: "11111111-1111-4111-8111-111111111111",
	workPeriodId: "wp-1",
	day: "2026-03-02",
	employeeName: "Grace",
	projectName: "Website",
	hours: "2.50",
	carried: false,
	changedAfterInvoicingAt: "2026-04-02T08:00:00Z",
	changedFields: ["times"],
	markVersion: "11111111-1111-4111-8111-111111111111:2",
	openWhenReleased: false,
	history: [],
	comparison: {
		amountDifference: plus25,
		handOff: handOffValues,
		lastResolved: null,
		current: {
			...handOffValues,
			end: { at: "2026-03-02T11:00:00.000Z", offsetMinutes: 60 },
			durationMinutes: 180,
			hours: "3.00",
			changedFromHandOff: ["end", "hours"],
			changedSinceResolution: null,
		},
	},
	...overrides,
});

const grace = item();
const linus = item({
	invoicedWorkId: "22222222-2222-4222-8222-222222222222",
	workPeriodId: "wp-2",
	day: "2026-03-03",
	employeeName: "Linus",
	projectName: "App",
	changedFields: ["billability"],
	markVersion: "22222222-2222-4222-8222-222222222222:1",
});

function setup(
	resolve = vi.fn().mockResolvedValue({ success: true, data: { status: "resolved", resolved: 1 } }),
	marked: MarkedWorkItemView[] = [grace, linus],
	grouped = false,
) {
	const onResolved = vi.fn();
	render(
		<MarkedWork marked={marked} resolve={resolve} onResolved={onResolved} grouped={grouped} />,
	);
	return { resolve, onResolved, user: userEvent.setup() };
}

async function openFor(user: ReturnType<typeof userEvent.setup>, name: string) {
	const row = screen.getByText(name).closest("li") as HTMLElement;
	await user.click(within(row).getByRole("button", { name: "Resolve" }));
	return screen.findByRole("dialog");
}

describe("MarkedWork", () => {
	it("resolves one item with its loaded mark version, explanation and reference", async () => {
		const { resolve, onResolved, user } = setup();
		const dialog = await openFor(user, "Grace");

		await user.type(within(dialog).getByLabelText(/Explanation/), "Credit note sent");
		await user.type(within(dialog).getByLabelText(/Accounting reference/), "CN-7");
		await user.click(within(dialog).getByRole("button", { name: "Resolve 1 item" }));

		await waitFor(() => expect(onResolved).toHaveBeenCalled());
		expect(resolve).toHaveBeenCalledWith({
			items: [{ invoicedWorkId: grace.invoicedWorkId, markVersion: grace.markVersion }],
			explanation: "Credit note sent",
			accountingReference: "CN-7",
		});
	});

	it("requires an explanation before anything is sent", async () => {
		const { resolve, user } = setup();
		const dialog = await openFor(user, "Grace");

		await user.click(within(dialog).getByRole("button", { name: "Resolve 1 item" }));

		expect(await within(dialog).findByText("Explain how the change was handled.")).toBeTruthy();
		expect(resolve).not.toHaveBeenCalled();
	});

	it("resolves the selected items together", async () => {
		const { resolve, user } = setup();
		await user.click(screen.getByRole("checkbox", { name: "Select all" }));
		await user.click(screen.getByRole("button", { name: "Resolve selected (2)" }));
		const dialog = await screen.findByRole("dialog");

		await user.type(within(dialog).getByLabelText(/Explanation/), "Both handled");
		await user.click(within(dialog).getByRole("button", { name: "Resolve 2 items" }));

		await waitFor(() =>
			expect(resolve).toHaveBeenCalledWith({
				items: [
					{ invoicedWorkId: grace.invoicedWorkId, markVersion: grace.markVersion },
					{ invoicedWorkId: linus.invoicedWorkId, markVersion: linus.markVersion },
				],
				explanation: "Both handled",
				accountingReference: "",
			}),
		);
	});

	it("names the items that changed meanwhile and offers a reload instead of resolving", async () => {
		const resolve = vi.fn().mockResolvedValue({
			success: true,
			data: { status: "stale", invoicedWorkIds: [linus.invoicedWorkId] },
		});
		const { onResolved, user } = setup(resolve);
		await user.click(screen.getByRole("checkbox", { name: "Select all" }));
		await user.click(screen.getByRole("button", { name: "Resolve selected (2)" }));
		const dialog = await screen.findByRole("dialog");
		await user.type(within(dialog).getByLabelText(/Explanation/), "Both handled");
		await user.click(within(dialog).getByRole("button", { name: "Resolve 2 items" }));

		const alert = await within(dialog).findByRole("alert");
		expect(alert.textContent).toContain("Nothing was resolved");
		expect(alert.textContent).toContain("Linus");
		expect(alert.textContent).not.toContain("Grace");
		expect(onResolved).not.toHaveBeenCalled();

		await user.click(within(dialog).getByRole("button", { name: "Reload" }));
		expect(onResolved).toHaveBeenCalled();
	});

	it("says nothing was resolved when the hand-off was released meanwhile", async () => {
		const resolve = vi.fn().mockResolvedValue({
			success: true,
			data: { status: "released", invoicedWorkIds: [grace.invoicedWorkId] },
		});
		const { onResolved, user } = setup(resolve);
		const dialog = await openFor(user, "Grace");
		await user.type(within(dialog).getByLabelText(/Explanation/), "Handled");
		await user.click(within(dialog).getByRole("button", { name: "Resolve 1 item" }));

		const alert = await within(dialog).findByRole("alert");
		expect(alert.textContent).toContain("Nothing was resolved");
		expect(alert.textContent).toContain("released");
		expect(alert.textContent).toContain("Grace");
		expect(within(dialog).queryByRole("button", { name: "Resolve 1 item" })).toBeNull();

		await user.click(within(dialog).getByRole("button", { name: "Reload" }));
		expect(onResolved).toHaveBeenCalled();
	});

	it("shows a released draft's open marks read-only, as open when released, with their comparison", async () => {
		const released = [item({ openWhenReleased: true }), { ...linus, openWhenReleased: true }];
		const { user } = setup(undefined, released);

		expect(screen.queryByRole("checkbox")).toBeNull();
		expect(screen.queryByRole("button", { name: /Resolve/ })).toBeNull();
		expect(screen.getAllByText("Open when released")).toHaveLength(2);
		expect(screen.getByText(/can no longer be resolved/)).toBeTruthy();

		const row = screen.getByText("Grace").closest("li") as HTMLElement;
		await user.click(within(row).getByRole("button", { name: "Compare" }));
		expect(within(row).getByRole("table", { name: /Comparison of/ })).toBeTruthy();
	});

	it("compares an item with its hand-off values on request", async () => {
		const { user } = setup();
		const row = screen.getByText("Grace").closest("li") as HTMLElement;
		const compare = within(row).getByRole("button", { name: "Compare" });
		expect(compare.getAttribute("aria-expanded")).toBe("false");

		await user.click(compare);

		expect(compare.getAttribute("aria-expanded")).toBe("true");
		const table = within(row).getByRole("table", { name: /Comparison of/ });
		expect(table.textContent).toContain("09:00");
		expect(table.textContent).toContain("12:00");
		expect(table.textContent).toContain("3.00 h");
	});

	it("shows an item's history, including marks cleared before resolutions were recorded", async () => {
		const { user } = setup(undefined, [
			item({
				history: [
					{
						kind: "resolution",
						id: "r-1",
						invoicedWorkId: grace.invoicedWorkId,
						at: "2026-04-03T09:00:00Z",
						actorName: "Ada",
						explanation: "Credit note CN-7",
						accountingReference: "CN-7",
						resolvedFields: ["project"],
					},
					{
						kind: "cleared_before_resolutions",
						invoicedWorkId: grace.invoicedWorkId,
						at: "2026-03-20T09:00:00Z",
						actorName: "Bob",
					},
				],
			}),
		]);

		await user.click(screen.getByRole("button", { name: "History (2)" }));

		expect(screen.getByText("Credit note CN-7")).toBeTruthy();
		expect(screen.getByText("Cleared before resolutions were recorded")).toBeTruthy();
		expect(screen.getByText(/Bob/)).toBeTruthy();
	});

	describe("amount differences", () => {
		const rowOf = (name: string) => screen.getByText(name).closest("li") as HTMLElement;

		it("shows the difference at the frozen rate, with the rounding caveat", () => {
			setup(undefined, [grace]);

			const row = rowOf("Grace");
			expect(row.textContent).toContain("+€25.00");
			expect(row.textContent).toContain("a few cents");
		});

		it("shows an unknown difference with its reason and no amount", () => {
			setup(undefined, [
				withDifference(grace, {
					...plus25,
					fromHandOff: { kind: "unknown", reason: "several_rates" },
				}),
			]);

			const row = rowOf("Grace");
			expect(row.textContent).toContain("Unknown");
			expect(row.textContent).toContain("several rates");
			expect(row.textContent).not.toContain("€");
		});

		it("labels an estimated reversal", () => {
			setup(undefined, [
				withDifference(grace, {
					...plus25,
					fromHandOff: {
						kind: "estimated",
						amount: "-128.25",
						reason: "removed",
						roundingCaveat: false,
					},
				}),
			]);

			const row = rowOf("Grace");
			expect(row.textContent).toContain("-€128.25");
			expect(row.textContent).toContain("Estimated");
		});

		it("warns that work moved to another customer is on no hand-off for it", () => {
			setup(undefined, [
				withDifference(grace, {
					...plus25,
					fromHandOff: {
						kind: "known",
						amount: "-150.00",
						reason: "customer",
						roundingCaveat: false,
					},
					notOnHandOffForNewCustomer: true,
				}),
			]);

			const warning = within(rowOf("Grace")).getByRole("status");
			expect(warning.textContent).toContain("not on any hand-off");
		});

		it("also shows the difference since the last resolution", () => {
			setup(undefined, [
				withDifference(grace, {
					...plus25,
					fromHandOff: {
						kind: "known",
						amount: "50.00",
						reason: "frozen_rate",
						roundingCaveat: true,
					},
					sinceResolution: {
						kind: "known",
						amount: "25.00",
						reason: "frozen_rate",
						roundingCaveat: true,
					},
				}),
			]);

			const row = rowOf("Grace");
			expect(row.textContent).toContain("+€50.00");
			expect(row.textContent).toMatch(/Since the last resolution:?\s*\+€25\.00/);
		});
	});

	describe("grouped by customer and draft", () => {
		const beta = {
			customerId: "c-beta",
			customerName: "Beta",
			currency: "CHF",
			period: { from: "2026-03-01", to: "2026-03-31" },
			title: "Beta March",
			createdAt: "2026-04-01T08:00:00Z",
		};

		it("subtotals each draft's known differences and counts unknown ones apart", () => {
			const unknown = withDifference(linus, {
				...plus25,
				fromHandOff: { kind: "unknown", reason: "other_project" },
			});
			const betaWork = withDifference(
				item({
					invoicedWorkId: "33333333-3333-4333-8333-333333333333",
					invoiceDraftId: "draft-2",
					employeeName: "Ada",
					draft: beta,
					changedAfterInvoicingAt: "2026-04-01T08:00:00Z",
				}),
				{ ...plus25, currency: "CHF" },
			);
			setup(undefined, [grace, unknown, betaWork], true);

			const [first, second] = screen.getAllByRole("region");
			// Beta's change is the oldest.
			expect(within(first).getByRole("heading", { name: "Beta" })).toBeTruthy();
			expect(first.textContent).toContain("CHF");
			const acme = within(second);
			expect(acme.getByRole("heading", { name: "Acme" })).toBeTruthy();
			expect(second.textContent).toContain("Acme March");
			expect(second.textContent).toMatch(/Known amount differences:?\s*\+€25\.00/);
			expect(second.textContent).toContain("1 unknown difference not included");
		});
	});
});
