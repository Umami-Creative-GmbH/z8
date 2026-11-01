/* @vitest-environment jsdom */

import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { MarkedWorkItemView } from "@/lib/billable-time/hand-off/views";
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

const item = (overrides: Partial<MarkedWorkItemView> = {}): MarkedWorkItemView => ({
	invoiceDraftId: "draft-1",
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
	history: [],
	comparison: {
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
) {
	const onResolved = vi.fn();
	render(<MarkedWork marked={marked} resolve={resolve} onResolved={onResolved} />);
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
});
