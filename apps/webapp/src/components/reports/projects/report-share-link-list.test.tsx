// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { queryKeys } from "@/lib/query/keys";
import { render } from "@/test/render-with-translations";

const mocks = vi.hoisted(() => ({
	list: vi.fn(),
	revoke: vi.fn(),
	toastSuccess: vi.fn(),
	scope: { userId: "reader", activeOrganizationId: "A", isLoading: false },
}));
vi.mock("@/app/[locale]/(app)/reports/projects/share-actions", () => ({
	listReportShareLinks: mocks.list,
	revokeReportShareLink: mocks.revoke,
}));
vi.mock("sonner", () => ({
	toast: { success: mocks.toastSuccess, error: vi.fn() },
}));
vi.mock("@/hooks/use-organization", () => ({
	useOrganization: () => mocks.scope,
}));
vi.mock("@/hooks/use-display-context", () => ({
	useDisplayContext: () => ({
		locale: "en-US",
		timezone: "UTC",
		timeFormat: "24h",
	}),
}));

import { ReportShareLinkList } from "./report-share-link-list";

const link = {
	id: "A-link",
	kind: "project",
	reportName: "A report",
	fromDay: "2026-11-01",
	toDay: "2026-11-30",
	status: "active",
	figures: "hours",
	includeEmployees: false,
	createdBy: { id: "reader", name: "A creator" },
	createdAt: "2026-11-01T12:00:00Z",
	expiresAt: "2026-12-01T12:00:00Z",
	viewCount: 0,
	canRevoke: false,
};
beforeEach(() => {
	vi.clearAllMocks();
	mocks.list.mockReset();
	mocks.revoke.mockReset();
	mocks.scope = {
		userId: "reader",
		activeOrganizationId: "A",
		isLoading: false,
	};
});
afterEach(cleanup);
it.each([
	["project", "organization"],
	["settings", "organization"],
	["project", "account"],
	["settings", "account"],
])(
	"keeps cached %s share links in their requesting %s arrival and leaves peer queries intact",
	async (consumer, change) => {
		const client = new QueryClient({
			defaultOptions: { queries: { staleTime: Infinity, retry: false } },
		});
		const peerKey = [...queryKeys.reportShareLinks.all, "unrelated-peer"];
		client.setQueryData(peerKey, "keep");
		mocks.list.mockResolvedValueOnce({ success: true, data: [link] });
		const tree = () => (
			<QueryClientProvider client={client}>
				<ReportShareLinkList
					{...(consumer === "settings"
						? { showReport: true }
						: { target: { kind: "project" as const, projectId: "same-id" } })}
				/>
			</QueryClientProvider>
		);
		const view = render(tree());
		expect(await screen.findByText(/Created by A creator/)).toBeTruthy();
		let finish!: (value: unknown) => void;
		mocks.list.mockReturnValueOnce(
			new Promise((done) => {
				finish = done;
			}),
		);
		mocks.scope = {
			...mocks.scope,
			...(change === "organization" ? { activeOrganizationId: "B" } : { userId: "other" }),
		};
		view.rerender(tree());
		expect(screen.queryByText(/Created by A creator/)).toBeNull();
		await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(2));
		await act(async () => finish({ success: true, data: [] }));
		expect(await screen.findByText("No share links yet.")).toBeTruthy();
		expect(client.getQueryData(peerKey)).toBe("keep");
		mocks.list.mockResolvedValueOnce({ success: true, data: [] });
		mocks.scope = {
			userId: "reader",
			activeOrganizationId: "A",
			isLoading: false,
		};
		view.rerender(tree());
		await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(3));
		expect(screen.queryByText(/Created by A creator/)).toBeNull();
		view.unmount();
		expect(client.getQueryData(peerKey)).toBe("keep");
		expect(
			client.getQueryCache().findAll({ queryKey: queryKeys.reportShareLinks.all }),
		).toHaveLength(1);
	},
);

it("names the link in the revoke confirmation and keeps it open while pending and on failure", async () => {
	const user = userEvent.setup();
	mocks.list.mockResolvedValue({ success: true, data: [{ ...link, canRevoke: true }] });
	let settle!: (value: unknown) => void;
	mocks.revoke.mockReturnValueOnce(
		new Promise((done) => {
			settle = done;
		}),
	);
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	render(
		<QueryClientProvider client={client}>
			<ReportShareLinkList showReport />
		</QueryClientProvider>,
	);

	await user.click(await screen.findByRole("button", { name: "Revoke" }));
	const dialog = await screen.findByRole("alertdialog");
	expect(within(dialog).getByRole("heading").textContent).toMatch(
		/^Revoke the share link for A report, .*2026\?$/,
	);

	await user.click(within(dialog).getByRole("button", { name: "Revoke link" }));
	expect(mocks.revoke).toHaveBeenCalledWith("A-link");
	await waitFor(() =>
		expect(within(dialog).getByRole("button", { name: "Revoke link" })).toHaveProperty(
			"disabled",
			true,
		),
	);
	await user.keyboard("{Escape}");
	expect(screen.getByRole("alertdialog")).toBeTruthy();

	await act(async () => settle({ success: false, error: "Not allowed" }));
	const alert = await within(screen.getByRole("alertdialog")).findByRole("alert");
	expect(alert.textContent).toContain("The link could not be revoked");
	expect(alert.textContent).toContain("Not allowed");

	mocks.revoke.mockResolvedValueOnce({ success: true, data: null });
	await user.click(
		within(screen.getByRole("alertdialog")).getByRole("button", { name: "Revoke link" }),
	);
	await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
	expect(mocks.toastSuccess).toHaveBeenCalledWith("Link revoked");
});

it("does not fetch or expose cached links while organization scope is unresolved", () => {
	mocks.scope = { ...mocks.scope, isLoading: true };
	const client = new QueryClient();
	client.setQueryData(queryKeys.reportShareLinks.list(null), [link]);
	render(
		<QueryClientProvider client={client}>
			<ReportShareLinkList showReport />
		</QueryClientProvider>,
	);
	expect(screen.queryByText(/Created by A creator/)).toBeNull();
	expect(mocks.list).not.toHaveBeenCalled();
});
