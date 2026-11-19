/* @vitest-environment jsdom */

import { onlineManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Activity } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const actor = vi.hoisted(() => ({
	userId: "user",
	activeOrganizationId: "org",
	employeeId: "owner",
	isPending: false,
}));
vi.mock("@/hooks/use-organization", () => ({
	useOrganization: () => ({
		...actor,
		isLoading: false,
		error: null,
		refetch: vi.fn(),
	}),
}));
vi.mock("@/lib/auth-client", () => ({
	useSession: () => ({
		isPending: actor.isPending,
		data: {
			user: { id: actor.userId },
			session: { activeOrganizationId: actor.activeOrganizationId },
		},
	}),
	authClient: {
		$store: {
			atoms: {
				session: {
					get: () => ({
						data: {
							user: { id: actor.userId },
							session: { activeOrganizationId: actor.activeOrganizationId },
						},
					}),
					subscribe: () => () => {},
				},
			},
		},
	},
}));

const catalog = vi.hoisted(() => ({ messages: {} as Record<string, string> }));
vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (key: string, fallback: string, params?: Record<string, unknown>) =>
			(catalog.messages[key] ?? fallback).replace(/\{(\w+)\}/g, (match, name: string) =>
				params && name in params ? String(params[name]) : match,
			),
	}),
}));
vi.mock("next-intl", () => ({ useLocale: () => "de-DE" }));
// The settlement of an approved claim (#612) has its own tests.
vi.mock("./finance/settlement-panel", () => ({ SettlementPanel: () => null }));
const legacyDraft = vi.hoisted(() => ({
	push: vi.fn(),
	convert: vi.fn(),
	conversion: vi.fn(async () => ({ success: true, data: null as unknown })),
}));
vi.mock("@/navigation", () => ({
	Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
		<a href={href} {...props}>
			{children}
		</a>
	),
	useRouter: () => ({ push: legacyDraft.push }),
}));
vi.mock("@/app/[locale]/(app)/travel-expenses/legacy-draft-actions", () => ({
	convertLegacyTravelExpenseDraftAction: legacyDraft.convert,
	getLegacyTravelExpenseConversion: legacyDraft.conversion,
}));

import { TravelExpenseClaimDetail } from "./travel-expense-claim-detail";

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	catalog.messages = {};
	actor.userId = "user";
	actor.activeOrganizationId = "org";
	actor.employeeId = "owner";
	actor.isPending = false;
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
			<TravelExpenseClaimDetail claimId="old-claim" organizationId="org" employeeId="owner" />
		</QueryClientProvider>,
	);
	return client;
}
describe("stored travel claim detail", () => {
	it.each(["claim", "organization", "employee", "account"])(
		"does not revive earlier evidence after a late %s arrival and return",
		async (changed) => {
			let finish!: (value: Response) => void;
			vi.stubGlobal(
				"fetch",
				vi
					.fn()
					.mockResolvedValueOnce(Response.json(storedDetail))
					.mockImplementationOnce(
						() =>
							new Promise<Response>((resolve) => {
								finish = resolve;
							}),
					)
					.mockResolvedValueOnce(
						Response.json({
							...storedDetail,
							claim: { ...storedDetail.claim, notes: "Current evidence" },
						}),
					),
			);
			const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
			const view = (claimId = "old-claim") => (
				<QueryClientProvider client={client}>
					<TravelExpenseClaimDetail
						claimId={claimId}
						organizationId={actor.activeOrganizationId}
						employeeId={actor.employeeId}
						userId={actor.userId}
					/>
				</QueryClientProvider>
			);
			const mounted = render(view());
			await screen.findByText("Original context");
			if (changed === "organization") actor.activeOrganizationId = "other-org";
			if (changed === "employee") actor.employeeId = "other-employee";
			if (changed === "account") actor.userId = "other-user";
			mounted.rerender(view(changed === "claim" ? "other-claim" : "old-claim"));
			await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
			expect(screen.queryByText("Original context")).toBeNull();
			actor.activeOrganizationId = "org";
			actor.employeeId = "owner";
			actor.userId = "user";
			mounted.rerender(view());
			await screen.findByText("Current evidence");
			await act(async () => {
				finish(
					Response.json({
						...storedDetail,
						claim: { ...storedDetail.claim, notes: "Retired evidence" },
					}),
				);
			});
			expect(screen.queryByText("Retired evidence")).toBeNull();
			expect(screen.queryByText("Original context")).toBeNull();
			client.clear();
		},
	);
	it("does not revive a late read after pending retained-session data and Activity restoration", async () => {
		let finish!: (response: Response) => void;
		vi.stubGlobal(
			"fetch",
			vi
				.fn()
				.mockImplementationOnce(
					() =>
						new Promise<Response>((resolve) => {
							finish = resolve;
						}),
				)
				.mockResolvedValue(
					Response.json({
						...storedDetail,
						claim: { ...storedDetail.claim, notes: "Fresh evidence" },
					}),
				),
		);
		const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
		const view = (mode: "visible" | "hidden") => (
			<QueryClientProvider client={client}>
				<Activity mode={mode}>
					<TravelExpenseClaimDetail claimId="old-claim" organizationId="org" employeeId="owner" />
				</Activity>
			</QueryClientProvider>
		);
		const mounted = render(view("visible"));
		actor.isPending = true;
		mounted.rerender(view("visible"));
		expect(
			await screen.findByText("Confirming the current organization and employee…"),
		).toBeTruthy();
		await act(async () => {
			finish(Response.json(storedDetail));
		});
		expect(screen.queryByText("Original context")).toBeNull();
		mounted.rerender(view("hidden"));
		actor.isPending = false;
		mounted.rerender(view("visible"));
		expect(await screen.findByText("Fresh evidence")).toBeTruthy();
		expect(screen.queryByText("Original context")).toBeNull();
		client.clear();
	});
	it("withdraws retained receipts when a refresh is canonically refused", async () => {
		vi.stubGlobal(
			"fetch",
			vi
				.fn()
				.mockResolvedValueOnce(Response.json(storedDetail))
				.mockResolvedValueOnce(Response.json({}, { status: 404 })),
		);
		const client = mount();
		await screen.findByText("Original context");
		await act(() => client.invalidateQueries({ queryKey: ["travel-expenses"] }));
		expect(
			await screen.findByText("Claim not found or access is no longer available."),
		).toBeTruthy();
		expect(screen.queryByRole("link", { name: "Download hotel.pdf" })).toBeNull();
		client.clear();
	});
	it("keeps a terminal timestamp when only intermediate approval evidence survived", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () =>
				Response.json({
					...storedDetail,
					claim: { ...storedDetail.claim, decidedAt: "2026-04-01T10:00:00Z" },
					decisions: [],
					intermediateDecisions: [
						{
							id: "partial",
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
		expect(await screen.findByText("Decision recorded")).toBeTruthy();
		expect(screen.getByText(/First reviewer/)).toBeTruthy();
		client.clear();
	});
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
		expect(await screen.findByText(/Approval recorded — awaiting further approval/)).toBeTruthy();
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
		expect(event.parentElement?.querySelector("time")?.getAttribute("datetime")).toBe(decidedAt);
		client.clear();
	});
	it("opens an existing claim with unknown legacy dates, original notes, receipts and decision history", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => Response.json(storedDetail)),
		);
		const client = mount();
		expect(await screen.findByText("Original context")).toBeTruthy();
		expect(screen.getByText("Trip date context not recorded (legacy claim)")).toBeTruthy();
		expect(screen.getByText("Original approval note")).toBeTruthy();
		expect(screen.getByText("Original decision reason")).toBeTruthy();
		expect(screen.getByRole("link", { name: "Preview hotel.pdf" }).getAttribute("href")).toBe(
			"/api/travel-expenses/old-claim/receipts/receipt",
		);
		expect(screen.getByRole("link", { name: "Download hotel.pdf" }).getAttribute("href")).toBe(
			"/api/travel-expenses/old-claim/receipts/receipt?download=1",
		);
		client.clear();
	});
	it("labels the claim type, status and decisions with catalog keys (#680)", async () => {
		catalog.messages = {
			"travelExpenses.report.receipts.title": "Beleg",
			"travelExpenses.report.status.approved": "Genehmigt",
		};
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => Response.json(storedDetail)),
		);
		const client = mount();
		expect(await screen.findByRole("heading", { name: "Beleg · Genehmigt" })).toBeTruthy();
		// The decision's timeline step: its catalog label, then who decided.
		expect(screen.getByText("Genehmigt")).toBeTruthy();
		expect(screen.getByText("By Morgan Manager")).toBeTruthy();
		client.clear();
	});
	it("offers retry after a failed detail load and restores the claim", async () => {
		vi.stubGlobal(
			"fetch",
			vi
				.fn()
				.mockResolvedValueOnce(Response.json({ error: "Unavailable" }, { status: 503 }))
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
				.mockResolvedValueOnce(Response.json({ error: "Unavailable" }, { status: 503 })),
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
		expect(screen.getByRole("link", { name: "Preview hotel.pdf" })).toBeTruthy();
		client.clear();
	});
});

describe("legacy draft continuation (#616)", () => {
	const ownDraft = {
		...storedDetail,
		claim: {
			...storedDetail.claim,
			status: "draft",
			employeeId: "owner",
			submittedAt: null,
		},
		decisions: [],
	};
	it("withdraws a converted report link when the conversion owner refuses the read", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => Response.json(ownDraft)),
		);
		legacyDraft.conversion
			.mockResolvedValueOnce({ success: true, data: { reportId: "refused-report" } })
			.mockResolvedValueOnce({ success: false, error: "Unauthorized" });
		const client = mount();
		await screen.findByRole("link", { name: /Open the report/ });
		await act(() => client.invalidateQueries({ queryKey: ["travel-expenses"] }));
		expect(
			await screen.findByText("Draft continuation is not available for the current reader."),
		).toBeTruthy();
		expect(screen.queryByRole("link", { name: /Open the report/ })).toBeNull();
		expect(screen.queryByRole("button", { name: "Continue as report" })).toBeNull();
		client.clear();
	});
	it("does not start a queued conversion after the claim reader is retired", async () => {
		legacyDraft.convert.mockClear();
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => Response.json(ownDraft)),
		);
		const client = mount();
		const button = await screen.findByRole("button", { name: "Continue as report" });
		onlineManager.setOnline(false);
		fireEvent.click(button);
		cleanup();
		onlineManager.setOnline(true);
		await act(() => client.resumePausedMutations());
		expect(legacyDraft.convert).not.toHaveBeenCalled();
		client.clear();
	});

	it("reserves one conversion when two activations arrive before rendering", async () => {
		legacyDraft.convert.mockClear();
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => Response.json(ownDraft)),
		);
		let finish!: (value: unknown) => void;
		legacyDraft.convert.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					finish = resolve;
				}),
		);
		const client = mount();
		const button = await screen.findByRole("button", { name: "Continue as report" });
		act(() => {
			button.click();
			button.click();
		});
		await vi.waitFor(() => expect(legacyDraft.convert).toHaveBeenCalledTimes(1));
		await act(async () => finish({ success: true, data: { kind: "not_draft" } }));
		expect(await screen.findByText(/already submitted/)).toBeTruthy();
		client.clear();
	});
	it("ignores a conversion success after the reader leaves the claim", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => Response.json(ownDraft)),
		);
		let finish!: (value: unknown) => void;
		legacyDraft.convert.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					finish = resolve;
				}),
		);
		const client = mount();
		fireEvent.click(await screen.findByRole("button", { name: "Continue as report" }));
		await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
		cleanup();
		await act(async () =>
			finish({ success: true, data: { kind: "converted", reportId: "late-report" } }),
		);
		expect(legacyDraft.push).not.toHaveBeenCalledWith("/travel-expenses/reports/late-report");
		client.clear();
	});

	it("keeps the known converted report link during a transient conversion-read failure", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => Response.json(ownDraft)),
		);
		legacyDraft.conversion
			.mockResolvedValueOnce({ success: true, data: { reportId: "retained-report" } })
			.mockRejectedValueOnce(new Error("offline"));
		const client = mount();
		await screen.findByRole("link", { name: /Open the report/ });
		await act(() => client.invalidateQueries({ queryKey: ["travel-expenses"] }));
		expect(await screen.findByRole("alert")).toBeTruthy();
		expect(screen.getByRole("link", { name: /Open the report/ }).getAttribute("href")).toBe(
			"/travel-expenses/reports/retained-report",
		);
		client.clear();
	});

	it("continues the owner's draft as a report and opens it", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => Response.json(ownDraft)),
		);
		legacyDraft.convert.mockResolvedValueOnce({
			success: true,
			data: { kind: "converted", reportId: "new-report", replayed: false },
		});
		const client = mount();
		fireEvent.click(await screen.findByRole("button", { name: "Continue as report" }));
		await vi.waitFor(() =>
			expect(legacyDraft.push).toHaveBeenCalledWith("/travel-expenses/reports/new-report"),
		);
		expect(legacyDraft.convert).toHaveBeenCalledWith("old-claim");
		client.clear();
	});

	it("explains a refused conversion and changes nothing", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => Response.json(ownDraft)),
		);
		legacyDraft.convert.mockResolvedValueOnce({
			success: true,
			data: {
				kind: "receipt_unavailable",
				attachments: [{ attachmentId: "a", fileName: "hotel.pdf", reason: "unreadable" }],
			},
		});
		const client = mount();
		fireEvent.click(await screen.findByRole("button", { name: "Continue as report" }));
		// The test translator returns the default text without parameters.
		expect(await screen.findByText(/a receipt could not be carried over safely/)).toBeTruthy();
		expect(legacyDraft.push).not.toHaveBeenCalledWith("/travel-expenses/reports/new-report");
		client.clear();
	});

	it("links a converted draft to its report", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => Response.json(ownDraft)),
		);
		legacyDraft.conversion.mockResolvedValueOnce({
			success: true,
			data: { reportId: "existing-report" },
		});
		const client = mount();
		expect(
			(await screen.findByRole("link", { name: /Open the report/ })).getAttribute("href"),
		).toBe("/travel-expenses/reports/existing-report");
		expect(screen.queryByRole("button", { name: "Continue as report" })).toBeNull();
		client.clear();
	});

	it("never offers continuation for a submitted claim or someone else's draft", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () =>
				Response.json({ ...ownDraft, claim: { ...ownDraft.claim, employeeId: "colleague" } }),
			),
		);
		const client = mount();
		await screen.findByText("Original context");
		expect(screen.queryByRole("button", { name: "Continue as report" })).toBeNull();
		client.clear();
	});
});
