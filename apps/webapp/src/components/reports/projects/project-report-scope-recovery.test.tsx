// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { queryKeys } from "@/lib/query/keys";

const mocks = vi.hoisted(() => ({
	list: vi.fn(),
	views: vi.fn(),
	revoke: vi.fn(),
	refetch: vi.fn(),
	scope: {
		userId: "reader" as string | null,
		activeOrganizationId: "A" as string | null,
		isLoading: false,
		error: null as string | null,
	},
}));
vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, values?: Record<string, unknown>) =>
			fallback.replace(/\{(\w+)\}/g, (whole, key) =>
				values?.[key] === undefined ? whole : String(values[key]),
			),
	}),
}));
vi.mock("next-intl", () => ({ useLocale: () => "en" }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/hooks/use-organization", () => ({
	useOrganization: () => ({ ...mocks.scope, refetch: mocks.refetch }),
}));
vi.mock("@/hooks/use-display-context", () => ({
	useDisplayContext: () => ({ locale: "en-US", timezone: "UTC", timeFormat: "24h" }),
}));
vi.mock("@/components/providers/view-refresh-provider", () => ({ useViewRefresh: () => {} }));
vi.mock("@/app/[locale]/(app)/reports/projects/actions", () => ({
	getProjectsOverview: vi.fn(),
	getProjectDetailedReport: vi.fn(),
	getCustomerBillableReport: vi.fn(),
}));
vi.mock("@/app/[locale]/(app)/reports/projects/share-actions", () => ({
	listReportShareLinks: mocks.list,
	listReportShareLinkViews: mocks.views,
	revokeReportShareLink: mocks.revoke,
}));
vi.mock("@/navigation", () => ({
	Link: ({ href, children }: { href: string; children: import("react").ReactNode }) => (
		<a href={href}>{children}</a>
	),
}));
vi.mock("next/dynamic", () => ({ default: () => () => null }));

import { ProjectReportsContainer } from "@/components/reports/projects/project-reports-container";
import { ReportShareLinkList } from "@/components/reports/projects/report-share-link-list";

const link = {
	id: "link-a",
	kind: "project",
	reportName: "Project A",
	fromDay: "2026-11-01",
	toDay: "2026-11-30",
	status: "active",
	figures: "hours",
	includeEmployees: false,
	createdBy: { id: "reader", name: "A creator" },
	createdAt: "2026-11-01T12:00:00Z",
	expiresAt: "2026-12-01T12:00:00Z",
	viewCount: 0,
	canRevoke: true,
};
beforeEach(() => {
	vi.clearAllMocks();
	mocks.scope = { userId: "reader", activeOrganizationId: "A", isLoading: false, error: null };
	mocks.list.mockReset();
	mocks.revoke.mockReset();
	mocks.views.mockReset();
});
afterEach(cleanup);

it("offers local recovery when the current report scope read fails instead of announcing perpetual loading", async () => {
	mocks.scope = {
		userId: null,
		activeOrganizationId: null,
		isLoading: false,
		error: "Scope read failed",
	};
	let finish!: () => void;
	mocks.refetch.mockReturnValueOnce(
		new Promise<void>((done) => {
			finish = done;
		}),
	);
	const client = new QueryClient();
	const tree = () => (
		<QueryClientProvider client={client}>
			<ProjectReportsContainer />
		</QueryClientProvider>
	);
	const view = render(tree());
	const retry = screen.getByRole("button", { name: "Retry" });
	fireEvent.click(retry);
	await waitFor(() => expect(mocks.refetch).toHaveBeenCalledTimes(1));
	expect(retry).toHaveProperty("disabled", true);
	expect(screen.queryByText(/Loading the current report scope/)).toBeNull();
	await act(async () => finish());
	mocks.scope = { userId: "reader", activeOrganizationId: "A", isLoading: false, error: null };
	view.rerender(tree());
	expect(screen.getByRole("button", { name: "Generate Report" })).toBeTruthy();
	expect(screen.queryByRole("alert")).toBeNull();
});

it("offers local recovery when the current share-link scope read fails in the settings consumer", async () => {
	mocks.scope = {
		userId: null,
		activeOrganizationId: null,
		isLoading: false,
		error: "Scope read failed",
	};
	const client = new QueryClient();
	const tree = () => (
		<QueryClientProvider client={client}>
			<ReportShareLinkList showReport />
		</QueryClientProvider>
	);
	const view = render(tree());
	fireEvent.click(screen.getByRole("button", { name: "Retry" }));
	await waitFor(() => expect(mocks.refetch).toHaveBeenCalledTimes(1));
	expect(mocks.list).not.toHaveBeenCalled();
	mocks.list.mockResolvedValueOnce({ success: true, data: [] });
	mocks.scope = { userId: "reader", activeOrganizationId: "A", isLoading: false, error: null };
	view.rerender(tree());
	expect(await screen.findByText("No share links yet.")).toBeTruthy();
	expect(mocks.list).toHaveBeenCalledTimes(1);
});

it("does not start a second revoke when Refresh updates the same link while its first revoke is pending", async () => {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	mocks.list.mockResolvedValueOnce({ success: true, data: [link] });
	let finish!: (value: unknown) => void;
	mocks.revoke.mockReturnValue(
		new Promise((done) => {
			finish = done;
		}),
	);
	render(
		<QueryClientProvider client={client}>
			<ReportShareLinkList showReport />
		</QueryClientProvider>,
	);
	fireEvent.click(await screen.findByRole("button", { name: "Revoke", exact: true }));
	fireEvent.click(await screen.findByRole("button", { name: "Revoke link", exact: true }));
	await waitFor(() => expect(mocks.revoke).toHaveBeenCalledTimes(1));
	mocks.list.mockResolvedValueOnce({
		success: true,
		data: [{ ...link, viewCount: 1, createdBy: { id: "reader", name: "Refreshed creator" } }],
	});
	await act(async () => {
		await client.invalidateQueries({ queryKey: queryKeys.reportShareLinks.all });
	});
	await screen.findByText(/Created by Refreshed creator/);
	fireEvent.click(screen.getByRole("button", { name: "Revoke link", exact: true }));
	expect(mocks.revoke).toHaveBeenCalledTimes(1);
	await act(async () => finish({ success: true }));
});

it("refuses an open revoke confirmation after refreshed metadata withdraws revoke rights", async () => {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	mocks.list.mockResolvedValueOnce({ success: true, data: [link] });
	render(
		<QueryClientProvider client={client}>
			<ReportShareLinkList showReport />
		</QueryClientProvider>,
	);
	fireEvent.click(await screen.findByRole("button", { name: "Revoke", exact: true }));
	mocks.list.mockResolvedValueOnce({
		success: true,
		data: [
			{ ...link, canRevoke: false, createdBy: { id: "reader", name: "Current read-only creator" } },
		],
	});
	await act(async () => {
		await client.invalidateQueries({ queryKey: queryKeys.reportShareLinks.all });
	});
	await screen.findByText(/Created by Current read-only creator/);
	fireEvent.click(screen.getByRole("button", { name: "Revoke link", exact: true }));
	expect(mocks.revoke).not.toHaveBeenCalled();
});
