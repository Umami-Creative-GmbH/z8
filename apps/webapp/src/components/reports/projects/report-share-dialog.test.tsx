// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { Activity } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { render } from "@/test/render-with-translations";

const mocks = vi.hoisted(() => ({
	create: vi.fn(),
	list: vi.fn(),
	success: vi.fn(),
	error: vi.fn(),
	scope: { userId: "reader", activeOrganizationId: "A", isLoading: false },
}));
vi.mock("@/app/[locale]/(app)/reports/projects/share-actions", () => ({
	createReportShareLink: mocks.create,
	listReportShareLinks: mocks.list,
}));
vi.mock("next-intl", () => ({ useLocale: () => "en" }));
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
vi.mock("sonner", () => ({
	toast: { success: mocks.success, error: mocks.error },
}));

import { ReportShareDialog } from "./report-share-dialog";

const props = {
	target: { kind: "project" as const, projectId: "project-A" },
	reportName: "Project A",
	period: { fromDay: "2026-11-01", toDay: "2026-11-30" },
	canShareRevenue: true,
};
beforeEach(() => {
	vi.clearAllMocks();
	mocks.create.mockReset();
	mocks.scope = {
		userId: "reader",
		activeOrganizationId: "A",
		isLoading: false,
	};
	mocks.list.mockResolvedValue({ success: true, data: [] });
});

it.each(["organization", "account", "Activity"])(
	"retires the TanStack submit continuation across %s before invoking the action",
	async (kind) => {
		const client = new QueryClient();
		const tree = (mode: "visible" | "hidden" = "visible") => (
			<QueryClientProvider client={client}>
				<Activity mode={mode}>
					<ReportShareDialog {...props} />
				</Activity>
			</QueryClientProvider>
		);
		const view = render(tree());
		fireEvent.click(screen.getByRole("button", { name: "Share" }));
		const form = (await screen.findByRole("button", { name: "Create link" })).closest("form");
		if (!form) throw Error("Missing share form");
		await act(async () => {
			fireEvent.submit(form);
			if (kind === "Activity") {
				view.rerender(tree("hidden"));
			} else {
				mocks.scope = {
					...mocks.scope,
					...(kind === "organization" ? { activeOrganizationId: "B" } : { userId: "other" }),
				};
				view.rerender(tree());
			}
		});
		expect(mocks.create).not.toHaveBeenCalled();
	},
);

it("retains failed share options and uses the report's calendar days, then reveals the successful secret only until dismissal", async () => {
	mocks.create
		.mockResolvedValueOnce({ success: false, error: "Temporary failure" })
		.mockResolvedValueOnce({
			success: true,
			data: { path: "/share/synthetic-test-token" },
		});
	render(
		<QueryClientProvider client={new QueryClient()}>
			<ReportShareDialog {...props} />
		</QueryClientProvider>,
	);
	fireEvent.click(screen.getByRole("button", { name: "Share" }));
	const employees = await screen.findByRole("switch", {
		name: "Employee breakdown",
	});
	fireEvent.click(employees);
	fireEvent.click(screen.getByRole("button", { name: "Create link" }));
	await waitFor(() => expect(mocks.error).toHaveBeenCalled());
	expect(employees.getAttribute("aria-checked")).toBe("true");
	fireEvent.click(screen.getByRole("button", { name: "Create link" }));
	expect(await screen.findByRole("textbox", { name: "Share link" })).toBeTruthy();
	expect(mocks.create.mock.calls[1][0]).toEqual({
		kind: "project",
		projectId: "project-A",
		fromDay: "2026-11-01",
		toDay: "2026-11-30",
		figures: "hours",
		includeEmployees: true,
		expiresInDays: 30,
		locale: "en",
	});
	fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
	await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
	fireEvent.click(screen.getByRole("button", { name: "Share" }));
	expect(screen.queryByRole("textbox", { name: "Share link" })).toBeNull();
});
afterEach(cleanup);

it("forgets a dismissed creation instead of revealing its secret in a reopened dialog", async () => {
	let finish!: (value: unknown) => void;
	mocks.create.mockReturnValueOnce(
		new Promise((done) => {
			finish = done;
		}),
	);
	render(
		<QueryClientProvider client={new QueryClient()}>
			<ReportShareDialog {...props} />
		</QueryClientProvider>,
	);
	fireEvent.click(screen.getByRole("button", { name: "Share" }));
	fireEvent.click(await screen.findByRole("button", { name: "Create link" }));
	await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1));
	fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
	await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
	fireEvent.click(screen.getByRole("button", { name: "Share" }));
	await act(async () => finish({ success: true, data: { path: "/share/synthetic-test-token" } }));
	expect(screen.queryByRole("textbox", { name: "Share link" })).toBeNull();
	expect(screen.getByRole("button", { name: "Create link" })).toBeTruthy();
});
