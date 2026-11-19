/* @vitest-environment jsdom */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { OrganizationContextProvider } from "@/components/providers/organization-context-provider";
import {
	useViewRefreshAction,
	ViewRefreshProvider,
} from "@/components/providers/view-refresh-provider";
import type { ReportHistoryRow } from "@/lib/travel-expenses/expense-history";
import { TravelExpenseManagement } from "./travel-expense-management";

const edge = vi.hoisted(() => ({
	history: vi.fn(),
	receipt: vi.fn(),
	mileage: vi.fn(),
	trip: vi.fn(),
	push: vi.fn(),
	refresh: vi.fn(),
	replace: vi.fn(),
	session: { pending: false, user: "fixture-user", org: "fixture-org" },
}));
vi.mock("@/app/[locale]/(app)/travel-expenses/history-actions", () => ({
	getMyTravelExpenseHistory: edge.history,
}));
vi.mock("@/app/[locale]/(app)/travel-expenses/report-actions", () => ({
	createStandaloneReceiptReportAction: edge.receipt,
	createTripReportAction: edge.trip,
	deleteDraftTravelExpenseReportAction: vi.fn(),
}));
vi.mock("@/app/[locale]/(app)/travel-expenses/mileage-actions", () => ({
	createStandaloneMileageReportAction: edge.mileage,
}));
vi.mock("@/app/[locale]/(app)/travel-expenses/legacy-draft-actions", () => ({
	getLegacyTravelExpenseConversion: vi.fn(),
	convertLegacyTravelExpenseDraftAction: vi.fn(),
}));
vi.mock("@/lib/auth-client", () => ({
	useSession: () => ({
		isPending: edge.session.pending,
		data: { user: { id: edge.session.user }, session: { activeOrganizationId: edge.session.org } },
	}),
	authClient: { getSession: vi.fn() },
}));
vi.mock("@/navigation", () => ({
	Link: ({ children, ...props }: ComponentProps<"a">) => <a {...props}>{children}</a>,
	useRouter: () => ({ push: edge.push, refresh: edge.refresh, replace: edge.replace }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: edge.refresh }) }));
vi.mock("@tolgee/react", () => ({ useTranslate: () => ({ t: (_k: string, f: string) => f }) }));
vi.mock("next-intl", () => ({ useLocale: () => "en-US", useTranslations: () => (k: string) => k }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const initial = {
	userId: "fixture-user",
	organizationId: "fixture-org",
	employee: {
		employeeId: "fixture-employee",
		organizationId: "fixture-org",
		role: "employee" as const,
	},
	organizationSettings: null,
	updatedAt: 1,
};
const row: ReportHistoryRow = {
	source: "report",
	id: "fixture-report",
	href: "/travel-expenses/reports/fixture-report",
	stage: "needs_action",
	activityAt: "2026-10-05T10:00:00.000Z",
	balance: null,
	reimbursement: null,
	dates: { start: "2026-09-14", end: "2026-09-14" },
	kind: "standalone",
	status: "draft",
	itemType: "receipt",
	title: "Public fixture receipt",
	itemCount: 1,
	receiptCount: 1,
	totals: { currency: "EUR", reimbursable: "129.90", companyPaid: "0.00", excludedItemCount: 0 },
	adjustmentOf: null,
	continuedFromClaimId: null,
	deletable: false,
};
const success = () => ({ success: true, data: [row] });
const clients: QueryClient[] = [];
function Refresh() {
	const { refresh } = useViewRefreshAction();
	return (
		<button type="button" onClick={refresh}>
			Review header refresh
		</button>
	);
}
function mount(child?: ReactNode) {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
	clients.push(client);
	const view = render(
		<QueryClientProvider client={client}>
			<OrganizationContextProvider initialContext={initial}>
				<ViewRefreshProvider>
					<Refresh />
					{child ?? (
						<TravelExpenseManagement
							userId="fixture-user"
							organizationId="fixture-org"
							employeeId="fixture-employee"
						/>
					)}
				</ViewRefreshProvider>
			</OrganizationContextProvider>
		</QueryClientProvider>,
	);
	return { client, view };
}
beforeEach(() => {
	vi.clearAllMocks();
	edge.session.pending = false;
	edge.history.mockReset();
	edge.history.mockResolvedValue(success());
	vi.stubGlobal(
		"fetch",
		vi.fn(async (url) => {
			expect(String(url)).toBe("/api/auth/context");
			return new Response(
				JSON.stringify({
					user: { id: "fixture-user" },
					session: { activeOrganizationId: "fixture-org" },
					employee: initial.employee,
					organizationSettings: null,
				}),
				{ status: 200 },
			);
		}),
	);
});
afterEach(() => {
	cleanup();
	for (const c of clients.splice(0)) c.clear();
	vi.unstubAllGlobals();
});
it.each([
	["New receipt", "receipt"],
	["New mileage", "mileage"],
	["New trip", "trip"],
] as const)(
	"healthy actual-provider personal history and distinct %s creation",
	async (label, action) => {
		edge[action].mockResolvedValueOnce({ success: true, data: { reportId: `fixture-${action}` } });
		mount();
		expect(await screen.findByRole("link", { name: "Public fixture receipt" })).toBeTruthy();
		expect(screen.getAllByRole("heading", { level: 1, name: "Travel Expenses" })).toHaveLength(1);
		expect(fetch).toHaveBeenCalled();
		for (const name of ["New receipt", "New mileage", "New trip"])
			expect(screen.getByRole("button", { name })).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: label }));
		await vi.waitFor(() =>
			expect(edge.push).toHaveBeenCalledWith(`/travel-expenses/reports/fixture-${action}`),
		);
		expect(edge[action]).toHaveBeenCalledTimes(1);
	},
);
it("header refresh and local Retry reach the actual failed history owner; transport outage retains authorized rows", async () => {
	mount();
	await screen.findByText("Public fixture receipt");
	edge.history.mockRejectedValueOnce(new Error("Fixture transport offline"));
	fireEvent.click(screen.getByRole("button", { name: "Review header refresh" }));
	expect(await screen.findByRole("alert")).toBeTruthy();
	expect(screen.getByText("Public fixture receipt")).toBeTruthy();
	expect(edge.history).toHaveBeenCalledTimes(2);
	expect(edge.refresh).toHaveBeenCalled();
	fireEvent.click(screen.getByRole("button", { name: "Retry" }));
	await vi.waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
	expect(edge.history).toHaveBeenCalledTimes(3);
	expect(screen.getByText("Public fixture receipt")).toBeTruthy();
});
it("canonical personal-history refusal withdraws formerly authorized rows", async () => {
	mount();
	await screen.findByText("Public fixture receipt");
	edge.history.mockResolvedValueOnce({ success: false, error: "Unauthorized" });
	fireEvent.click(screen.getByRole("button", { name: "Review header refresh" }));
	await screen.findByRole("alert");
	expect(edge.history).toHaveBeenCalledTimes(2);
	expect(screen.queryByRole("link", { name: "Public fixture receipt" })).toBeNull();
});

async function waitForHistory(client: QueryClient, calls: number) {
	await vi.waitFor(() => {
		expect(edge.history).toHaveBeenCalledTimes(calls);
		expect(client.isFetching()).toBe(0);
	});
}

it("initial canonical refusal remains unknown and local Retry restores fresh evidence", async () => {
	edge.history.mockResolvedValueOnce({ success: false, error: "Unauthorized" });
	const { client } = mount();
	await screen.findByRole("alert");
	expect(screen.queryByText("No travel expenses yet")).toBeNull();
	expect(screen.queryByRole("link", { name: "Public fixture receipt" })).toBeNull();
	await waitForHistory(client, 1);
	fireEvent.click(screen.getByRole("button", { name: "Retry" }));
	expect(await screen.findByRole("link", { name: "Public fixture receipt" })).toBeTruthy();
	expect(screen.queryByRole("alert")).toBeNull();
	expect(edge.history).toHaveBeenCalledTimes(2);
});

it("refusal stays withdrawn through structured and rejected outages until fresh success", async () => {
	const { client } = mount();
	await screen.findByRole("link", { name: "Public fixture receipt" });
	await waitForHistory(client, 1);
	edge.history.mockResolvedValueOnce({ success: false, error: "Unauthorized" });
	fireEvent.click(screen.getByRole("button", { name: "Review header refresh" }));
	await screen.findByRole("alert");
	await waitForHistory(client, 2);
	expect(screen.queryByRole("link", { name: "Public fixture receipt" })).toBeNull();
	for (const fail of [
		() =>
			edge.history.mockResolvedValueOnce({
				success: false,
				error: "Failed to load your travel expenses",
			}),
		() => edge.history.mockRejectedValueOnce(new Error("Fixture transport offline")),
	]) {
		const calls = edge.history.mock.calls.length;
		fail();
		fireEvent.click(screen.getByRole("button", { name: "Retry" }));
		await waitForHistory(client, calls + 1);
		expect(screen.getByRole("alert")).toBeTruthy();
		expect(screen.queryByRole("link", { name: "Public fixture receipt" })).toBeNull();
		expect(screen.queryByText("No travel expenses yet")).toBeNull();
	}
	edge.history.mockResolvedValueOnce({
		success: true,
		data: [{ ...row, title: "Fresh authorized receipt" }],
	});
	fireEvent.click(screen.getByRole("button", { name: "Retry" }));
	expect(await screen.findByRole("link", { name: "Fresh authorized receipt" })).toBeTruthy();
	expect(screen.queryByRole("link", { name: "Public fixture receipt" })).toBeNull();
	expect(screen.queryByRole("alert")).toBeNull();
	expect(edge.history).toHaveBeenCalledTimes(5);
});

it("ordinary structured read failure retains authorized history and Retry", async () => {
	const { client } = mount();
	await screen.findByRole("link", { name: "Public fixture receipt" });
	await waitForHistory(client, 1);
	edge.history.mockResolvedValueOnce({
		success: false,
		error: "Failed to load your travel expenses",
	});
	fireEvent.click(screen.getByRole("button", { name: "Review header refresh" }));
	await screen.findByRole("alert");
	await waitForHistory(client, 2);
	expect(screen.getByRole("link", { name: "Public fixture receipt" })).toBeTruthy();
	fireEvent.click(screen.getByRole("button", { name: "Retry" }));
	await vi.waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
	expect(screen.getByRole("link", { name: "Public fixture receipt" })).toBeTruthy();
});

it("fresh empty success after refusal replaces withdrawn evidence with a healthy empty history", async () => {
	const { client } = mount();
	await screen.findByRole("link", { name: "Public fixture receipt" });
	await waitForHistory(client, 1);
	edge.history.mockResolvedValueOnce({ success: false, error: "Unauthorized" });
	fireEvent.click(screen.getByRole("button", { name: "Review header refresh" }));
	await screen.findByRole("alert");
	await waitForHistory(client, 2);
	edge.history.mockResolvedValueOnce({ success: true, data: [] });
	fireEvent.click(screen.getByRole("button", { name: "Retry" }));
	expect(await screen.findByText("No travel expenses yet")).toBeTruthy();
	expect(screen.queryByRole("link", { name: "Public fixture receipt" })).toBeNull();
	expect(screen.queryByRole("alert")).toBeNull();
	expect(edge.history).toHaveBeenCalledTimes(3);
});
