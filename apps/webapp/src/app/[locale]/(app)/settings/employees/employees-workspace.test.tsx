// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { OrganizationContextProvider } from "@/components/providers/organization-context-provider";
import { ViewRefreshProvider } from "@/components/providers/view-refresh-provider";
import { SiteHeader } from "@/components/site-header";
import { SidebarProvider } from "@/components/ui/sidebar";
import { appPageOwnsHeading } from "@/lib/navigation/route-metadata";
import { queryKeys } from "@/lib/query/keys";
import { render } from "@/test/render-with-translations";
import { EmployeesPageClient } from "./employees-page-client";

const boundary = vi.hoisted(() => ({
	fetch: vi.fn(),
	refresh: vi.fn(),
	role: "manager" as "manager" | "employee",
	failDirectory: false,
	session: {
		data: { user: { id: "actor" }, session: { activeOrganizationId: "org" } },
		isPending: false,
	},
}));
vi.mock("@/lib/auth-client", () => ({
	useSession: () => boundary.session,
	authClient: { $store: { atoms: { session: { subscribe: () => () => {} } } } },
}));
vi.mock("next/navigation", () => ({
	useRouter: () => ({ refresh: boundary.refresh, replace: vi.fn() }),
	usePathname: () => "/en/settings/employees",
	useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/navigation", () => ({
	useRouter: () => ({ refresh: boundary.refresh, replace: vi.fn() }),
	usePathname: () => "/en/settings/employees",
	Link: ({ children, ...props }: ComponentProps<"a">) => <a {...props}>{children}</a>,
}));
vi.mock("@/app/[locale]/(app)/settings/employees/employee-clock-status.actions", () => ({
	getEmployeeClockStatuses: async () => ({ success: true, data: {} }),
}));
const clients: QueryClient[] = [];
beforeEach(() => {
	boundary.refresh.mockClear();
	boundary.failDirectory = false;
	boundary.role = "manager";
	boundary.session = {
		data: { user: { id: "actor" }, session: { activeOrganizationId: "org" } },
		isPending: false,
	};
	boundary.fetch.mockReset().mockImplementation(async (url: string) => {
		if (url === "/api/auth/context")
			return Response.json({
				user: { id: "actor" },
				session: { activeOrganizationId: "org" },
				employee: { employeeId: "manager", organizationId: "org", role: boundary.role },
				organizationSettings: null,
			});
		if (url.startsWith("/api/settings/employees/read/directory"))
			if (boundary.failDirectory)
				return Response.json({ error: "Synthetic directory refusal" }, { status: 403 });
			else
				return Response.json({
					scope: { userId: "actor", organizationId: "org" },
					data: { employees: [], total: 0, hasMore: false },
				});
		return Response.json({ data: [], unreadCount: 0 });
	});
	vi.stubGlobal("fetch", boundary.fetch);
	vi.stubGlobal("matchMedia", () => ({
		matches: false,
		addEventListener() {},
		removeEventListener() {},
	}));
});
afterEach(() => {
	cleanup();
	for (const client of clients) client.clear();
	clients.length = 0;
	vi.unstubAllGlobals();
});
function mount(admin = false) {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	clients.push(client);
	const tree = () => (
		<QueryClientProvider client={client}>
			<NextIntlClientProvider locale="en" messages={{}} timeZone="UTC">
				<OrganizationContextProvider initialContext={null}>
					<ViewRefreshProvider>
						<SidebarProvider>
							<SiteHeader />
							<EmployeesPageClient
								settingsAccess={admin ? "orgAdmin" : "scopedManager"}
								organizationId="org"
								currentUserId="actor"
								currentEmployee={{ id: "manager", role: "manager" }}
								people={
									admin
										? {
												organizationName: "Synthetic organization",
												organizationToday: "2026-11-17",
												members: [],
												invitations: [],
												currentUserId: "actor",
												settingsAccess: "orgAdmin",
											}
										: undefined
								}
							/>
						</SidebarProvider>
					</ViewRefreshProvider>
				</OrganizationContextProvider>
			</NextIntlClientProvider>
		</QueryClientProvider>
	);
	const view = render(tree());
	return { ...view, client, redraw: () => view.rerender(tree()) };
}
it("assembled header and employee workspace expose one page heading", async () => {
	mount();
	await screen.findByRole("textbox", { name: "Search employees" });
	expect(screen.getAllByRole("heading", { level: 1 }).map((node) => node.textContent)).toEqual([
		"Employees",
	]);
});
it("switching record categories retains the employee filter draft", async () => {
	mount(true);
	const input = await screen.findByRole("textbox", { name: "Search employees" });
	fireEvent.change(input, { target: { value: "Synthetic filter" } });
	fireEvent.click(screen.getByRole("tab", { name: "Members" }));
	fireEvent.click(screen.getByRole("tab", { name: "Employees" }));
	expect(
		(screen.getByRole("textbox", { name: "Search employees" }) as HTMLInputElement).value,
	).toBe("Synthetic filter");
});
it("a different active organization retires the old administration controls", async () => {
	const view = mount(true);
	fireEvent.click(await screen.findByRole("tab", { name: "Invitations" }));
	expect(screen.getAllByRole("button", { name: "Invite Member" }).length).toBeGreaterThan(0);
	boundary.session = {
		data: { user: { id: "actor" }, session: { activeOrganizationId: "other-org" } },
		isPending: false,
	};
	view.redraw();
	await waitFor(() => expect(screen.queryByRole("button", { name: "Invite Member" })).toBeNull());
});
it("header Refresh retains a typed directory search", async () => {
	mount();
	const input = await screen.findByRole("textbox", { name: "Search employees" });
	fireEvent.change(input, { target: { value: "Synthetic person" } });
	fireEvent.click(screen.getAllByRole("button", { name: "Refresh data" })[0]);
	await waitFor(() => expect(boundary.refresh).toHaveBeenCalled());
	expect(
		(screen.getByRole("textbox", { name: "Search employees" }) as HTMLInputElement).value,
	).toBe("Synthetic person");
});

it("the member refresh button refreshes the authoritative server snapshot", async () => {
	mount(true);
	fireEvent.click(await screen.findByRole("tab", { name: "Members" }));
	fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
	await waitFor(() => expect(boundary.refresh).toHaveBeenCalledTimes(1));
});

it("directory refusal is distinct from an empty result and retry retains search", async () => {
	boundary.failDirectory = true;
	mount();
	await screen.findByRole("alert");
	expect(screen.queryByText("No employees found")).toBeNull();
	const input = screen.getByRole("textbox", { name: "Search employees" });
	fireEvent.change(input, { target: { value: "Retained filter" } });
	boundary.failDirectory = false;
	fireEvent.click(screen.getByRole("button", { name: "Try again" }));
	await screen.findByText("No employees found");
	expect((input as HTMLInputElement).value).toBe("Retained filter");
});

it("a narrowed provider role retires stale server administration until refreshed", async () => {
	const view = mount(true);
	await screen.findByRole("tab", { name: "Invitations" });
	boundary.role = "employee";
	await view.client.invalidateQueries({ queryKey: queryKeys.organizationContext.all });
	await waitFor(() => expect(screen.queryByRole("button", { name: "Invite Member" })).toBeNull());
	expect(
		screen.getByText("Employee context is unavailable or changed. Refresh to continue."),
	).toBeTruthy();
});

it.each([
	"/settings/employees",
	"/en/settings/employees",
	"/de/settings/employees/",
	// The employee detail page renders its own PageHeader h1.
	"/en/settings/employees/person",
])("owns the page heading at %s", (path) => {
	expect(appPageOwnsHeading(path)).toBe(true);
});
it.each(["/en/settings/employees/new", "/settings/employees/person/edit"])(
	"retains descendant shell ownership at %s",
	(path) => {
		expect(appPageOwnsHeading(path)).toBe(false);
	},
);
