/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));
vi.mock("next-intl", () => ({ useLocale: () => "de-DE" }));

import { TravelExpenseClaimDetail } from "./travel-expense-claim-detail";

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});
const storedDetail = {
	claim: {
		id: "old-claim",
		type: "receipt",
		status: "approved",
		tripStartDate: null,
		tripEndDate: null,
		tripDateTimeZone: null,
		originalAmount: "120.50",
		originalCurrency: "EUR",
		calculatedAmount: "120.50",
		calculatedCurrency: "EUR",
		destinationCity: "Hamburg",
		destinationCountry: "DE",
		notes: "Original context",
		submittedAt: "2026-03-29T10:00:00Z",
		createdAt: "2026-03-28T10:00:00Z",
	},
	attachments: [{ id: "receipt", fileName: "hotel.pdf", checksumSha256: null }],
	decisions: [
		{
			id: "decision",
			action: "approved",
			comment: "Original approval note",
			reason: "Original decision reason",
			createdAt: "2026-04-01T10:00:00Z",
			actorName: "Morgan Manager",
		},
	],
};
function mount() {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	render(
		<QueryClientProvider client={client}>
			<TravelExpenseClaimDetail
				claimId="old-claim"
				organizationId="org"
				employeeId="owner"
			/>
		</QueryClientProvider>,
	);
	return client;
}
describe("stored travel claim detail", () => {
	it("shows an intermediate approval alongside the original final decision", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () =>
				Response.json({
					...storedDetail,
					intermediateDecisions: [
						{
							id: "step-one",
							action: "approval_recorded",
							actorName: "First reviewer",
							createdAt: "2026-03-30T10:00:00Z",
							reason: null,
							comment: null,
						},
					],
				}),
			),
		);
		const client = mount();
		expect(
			await screen.findByText(/Approval recorded — awaiting further approval/),
		).toBeTruthy();
		expect(screen.getByText(/First reviewer/)).toBeTruthy();
		expect(screen.getByText("Original approval note")).toBeTruthy();
		client.clear();
	});
	it("formats persisted currency amounts for the active locale", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => Response.json(storedDetail)),
		);
		const client = mount();
		expect(await screen.findAllByText(/120,50\s*€/)).toHaveLength(2);
		client.clear();
	});
	it("shows the stored decision timestamp when a legacy claim has no decision log", async () => {
		const decidedAt = "2026-04-01T10:00:00Z";
		vi.stubGlobal(
			"fetch",
			vi.fn(async () =>
				Response.json({
					...storedDetail,
					claim: { ...storedDetail.claim, decidedAt },
					decisions: [],
				}),
			),
		);
		const client = mount();
		const event = await screen.findByText("Decision recorded");
		expect(
			event.parentElement?.querySelector("time")?.getAttribute("datetime"),
		).toBe(decidedAt);
		client.clear();
	});
	it("opens an existing claim with unknown legacy dates, original notes, receipts and decision history", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => Response.json(storedDetail)),
		);
		const client = mount();
		expect(await screen.findByText("Original context")).toBeTruthy();
		expect(
			screen.getByText("Trip date context not recorded (legacy claim)"),
		).toBeTruthy();
		expect(screen.getByText("Original approval note")).toBeTruthy();
		expect(screen.getByText("Original decision reason")).toBeTruthy();
		expect(
			screen
				.getByRole("link", { name: "Preview hotel.pdf" })
				.getAttribute("href"),
		).toBe("/api/travel-expenses/old-claim/receipts/receipt");
		expect(
			screen
				.getByRole("link", { name: "Download hotel.pdf" })
				.getAttribute("href"),
		).toBe("/api/travel-expenses/old-claim/receipts/receipt?download=1");
		client.clear();
	});
	it("offers retry after a failed detail load and restores the claim", async () => {
		vi.stubGlobal(
			"fetch",
			vi
				.fn()
				.mockResolvedValueOnce(
					Response.json({ error: "Unavailable" }, { status: 503 }),
				)
				.mockResolvedValueOnce(Response.json(storedDetail)),
		);
		const client = mount();
		expect(await screen.findByRole("alert")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Retry" }));
		expect(await screen.findByText("Original approval note")).toBeTruthy();
		client.clear();
	});
	it("keeps loaded detail and its receipts visible when a refresh fails", async () => {
		vi.stubGlobal(
			"fetch",
			vi
				.fn()
				.mockResolvedValueOnce(Response.json(storedDetail))
				.mockResolvedValueOnce(
					Response.json({ error: "Unavailable" }, { status: 503 }),
				),
		);
		const client = mount();
		await screen.findByText("Original context");
		await act(async () => {
			await client.invalidateQueries({
				queryKey: ["travel-expenses", "detail", "old-claim"],
			});
		});
		expect(await screen.findByRole("alert")).toBeTruthy();
		expect(screen.getByText("Original context")).toBeTruthy();
		expect(
			screen.getByRole("link", { name: "Preview hotel.pdf" }),
		).toBeTruthy();
		client.clear();
	});
});
