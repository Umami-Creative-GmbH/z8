/* @vitest-environment jsdom */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));
vi.mock("next-intl", () => ({ useLocale: () => "en-US" }));
vi.mock("@/lib/auth-client", () => ({
	useSession: () => ({
		isPending: false,
		data: { user: { id: "review-reader" }, session: { activeOrganizationId: "review-org" } },
	}),
	authClient: {
		$store: {
			atoms: {
				session: {
					get: () => ({
						isPending: false,
						data: {
							user: { id: "review-reader" },
							session: { activeOrganizationId: "review-org" },
						},
					}),
					subscribe: () => () => {},
				},
			},
		},
	},
}));
vi.mock("@/navigation", () => ({
	useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
	Link: ({ children, ...props }: { children: ReactNode; href: string }) => (
		<a {...props}>{children}</a>
	),
}));
// The case uses a submitted claim: conversion and settlement are not mounted.
vi.mock("@/app/[locale]/(app)/travel-expenses/legacy-draft-actions", () => ({
	convertLegacyTravelExpenseDraftAction: vi.fn(),
	getLegacyTravelExpenseConversion: vi.fn(),
}));

import { OrganizationContextProvider } from "@/components/providers/organization-context-provider";
import { TravelExpenseClaimDetail } from "@/components/travel-expenses/travel-expense-claim-detail";
import { TravelExpenseClaimDetail as BaselineDetail } from "@/components/travel-expenses/review1748-independent-baseline-detail";

const claimId = "4053401f-806e-4839-ae66-96b9fa36c054";
const record = {
	claim: {
		id: claimId,
		organizationId: "review-org",
		employeeId: "review-employee",
		type: "receipt",
		status: "submitted",
		tripStartDate: null,
		tripEndDate: null,
		tripDateTimeZone: null,
		originalAmount: "120.50",
		originalCurrency: "EUR",
		calculatedAmount: "120.50",
		calculatedCurrency: "EUR",
		destinationCity: "Hamburg",
		destinationCountry: "DE",
		notes: "REVIEW retained original evidence",
		submittedAt: "2026-04-01T10:00:00Z",
		createdAt: "2026-03-28T10:00:00Z",
		decidedAt: null,
	},
	attachments: [{ id: "receipt", fileName: "review-receipt.pdf", checksumSha256: null }],
	decisions: [],
	intermediateDecisions: [],
};
const bootstrap = {
	userId: "review-reader",
	organizationId: "review-org",
	employee: {
		employeeId: "review-employee",
		organizationId: "review-org",
		role: "employee" as const,
	},
	organizationSettings: null,
	updatedAt: Date.now(),
};
const clients: QueryClient[] = [];
afterEach(() => {
	cleanup();
	for (const client of clients) client.clear();
	clients.length = 0;
	vi.unstubAllGlobals();
});
function mount(statuses: (number | Error)[], baseline = false) {
 const Component = baseline ? BaselineDetail : TravelExpenseClaimDetail;
	const fetchBoundary = vi.fn(async (url: string) => {
		if (url === "/api/auth/context")
			return Response.json({
				user: { id: "review-reader" },
				session: { activeOrganizationId: "review-org" },
				employee: bootstrap.employee,
				organizationSettings: null,
			});
		expect(url).toBe(`/api/travel-expenses/${claimId}`);
		const status = statuses.shift();
		if (status === undefined) throw Error("Unexpected extra request");
		if (status instanceof Error) throw status;
		return Response.json(status === 200 ? record : { error: "Review response" }, { status });
	});
	vi.stubGlobal("fetch", fetchBoundary);
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	clients.push(client);
	render(
		<QueryClientProvider client={client}>
			<OrganizationContextProvider initialContext={bootstrap}>
				<Component
					userId="review-reader"
					organizationId="review-org"
					employeeId="review-employee"
					claimId={claimId}
				/>
			</OrganizationContextProvider>
		</QueryClientProvider>,
	);
	return client;
}

it("original detail authorized outage control retains original notes and receipt links",async()=>{
 const client=mount([200,503]); await screen.findByText(record.claim.notes); await act(()=>client.invalidateQueries({queryKey:["travel-expenses"]})); await screen.findByText("Unable to load this claim. Please retry.");
 expect(screen.getByText(record.claim.notes)).toBeTruthy(); expect(screen.getByRole("link",{name:"Download review-receipt.pdf"})).toBeTruthy();
});
it("original detail critical sequence 200 -> 404 -> 503 keeps evidence withdrawn",async()=>{
 const client=mount([200,404,503]); await screen.findByText(record.claim.notes); await act(()=>client.invalidateQueries({queryKey:["travel-expenses"]})); await screen.findByText("Claim not found or access is no longer available.");
 expect(screen.queryByText(record.claim.notes)).toBeNull(); expect(screen.queryByRole("link",{name:"Download review-receipt.pdf"})).toBeNull();
 await act(()=>client.invalidateQueries({queryKey:["travel-expenses"]})); await screen.findByText("Unable to load this claim. Please retry."); await vi.waitFor(()=>expect(client.isFetching()).toBe(0));
 expect(screen.queryByText(record.claim.notes)).toBeNull(); expect(screen.queryByRole("link",{name:"Download review-receipt.pdf"})).toBeNull();
});
it("pinned baseline detail control confirms inherited evidence retention on 404 and later outage",async()=>{
 const client=mount([200,404,503],true); await screen.findByText(record.claim.notes); await act(()=>client.invalidateQueries({queryKey:["travel-expenses"]})); await vi.waitFor(()=>expect(client.isFetching()).toBe(0));
 expect(screen.getByText(record.claim.notes)).toBeTruthy(); expect(screen.getByRole("link",{name:"Download review-receipt.pdf"})).toBeTruthy();
 await act(()=>client.invalidateQueries({queryKey:["travel-expenses"]})); await vi.waitFor(()=>expect(client.isFetching()).toBe(0));
 expect(screen.getByText(record.claim.notes)).toBeTruthy(); expect(screen.getByRole("link",{name:"Download review-receipt.pdf"})).toBeTruthy();
});
