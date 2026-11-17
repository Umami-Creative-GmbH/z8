// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ErrorBoundaryHandler } from "next/dist/client/components/error-boundary";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import React, { Activity, type ComponentProps, type ReactNode, useState } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import LocationPresenceError from "@/app/[locale]/(app)/team/presence/[locationId]/error";
import { LocationPresenceLoading } from "@/app/[locale]/(app)/team/presence/[locationId]/location-presence-loading";
import LocationPresenceNotFound from "@/app/[locale]/(app)/team/presence/[locationId]/not-found";
import { LocationPresenceList } from "@/app/[locale]/(app)/team/presence/location-presence-list";
import {
	LocationPresenceView,
	type LocationPresenceViewScope,
} from "@/app/[locale]/(app)/team/presence/location-presence-view";
import {
	OrganizationContextProvider,
	useOrganization,
} from "@/components/providers/organization-context-provider";
import { UserPreferencesProvider } from "@/components/providers/user-preferences-provider";
import { ViewRefreshProvider } from "@/components/providers/view-refresh-provider";
import { SiteHeader } from "@/components/site-header";
import { PageHeader } from "@/components/ui/page-header";
import { SidebarProvider } from "@/components/ui/sidebar";
import type { OrganizationDisplayContext } from "@/lib/auth/organization-display-context";

const transport = vi.hoisted(() => ({
	session: {
		data: { user: { id: "actor-a" }, session: { activeOrganizationId: "org-a" } },
		isPending: false,
	},
	router: {
		refresh: vi.fn(),
		replace: vi.fn(),
		back: vi.fn(),
		forward: vi.fn(),
		bfcacheId: "synthetic-arrival",
		push: vi.fn(),
		prefetch: vi.fn(),
	},
	pathname: "/en/team/presence/af981290-0000-4000-8000-000000000001",
}));
vi.mock("@/lib/auth-client", () => ({ useSession: () => transport.session, authClient: {} }));
vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
	useTolgee: () => ({ getLanguage: () => "en" }),
}));
vi.mock("next-intl", () => ({ useLocale: () => "en" }));
vi.mock("@/navigation", () => ({
	Link: ({ href, ...props }: ComponentProps<"a">) => <a href={href} {...props} />,
	useRouter: () => transport.router,
	usePathname: () => transport.pathname,
}));
vi.mock("next/navigation", () => ({
	useRouter: () => transport.router,
	usePathname: () => transport.pathname,
	useSearchParams: () => new URLSearchParams(),
}));

let contextTime = 0;
const clients: QueryClient[] = [];
function context(
	userId = "actor-a",
	organizationId = "org-a",
	role: "admin" | "manager" | "employee" = "manager",
	employeeId = "viewer-a",
) {
	return {
		userId,
		organizationId,
		employee: { employeeId, organizationId, role },
		organizationSettings: null,
		updatedAt: contextTime,
	};
}
function PublishedScope() {
	const c = useOrganization();
	return (
		<output data-testid="canonical-display">
			{JSON.stringify([c.userId, c.activeOrganizationId, c.employeeId, c.role, c.isLoading])}
		</output>
	);
}
function Providers({
	children,
	initial = context(),
	client,
}: {
	children: ReactNode;
	initial?: OrganizationDisplayContext;
	client?: QueryClient;
}) {
	const [owned] = useState(() => {
		const c =
			client ?? new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
		clients.push(c);
		return c;
	});
	return (
		<QueryClientProvider client={owned}>
			<OrganizationContextProvider initialContext={initial}>
				<ViewRefreshProvider>
					<UserPreferencesProvider timeFormat="24h" timezone="Europe/Berlin">
						<SidebarProvider>{children}</SidebarProvider>
					</UserPreferencesProvider>
				</ViewRefreshProvider>
			</OrganizationContextProvider>
		</QueryClientProvider>
	);
}
const rowsA = [
	{
		employeeId: "employee-a",
		name: "Roster A Employee",
		state: "clocked_in" as const,
		sinceText: "08:15 +02:00",
	},
];
const rowsB = [
	{
		employeeId: "employee-b",
		name: "Roster B Employee",
		state: "on_break" as const,
		sinceText: "10:30 +01:00",
	},
];
const viewA: LocationPresenceViewScope = { userId: "actor-a", organizationId: "org-a" };
const viewB: LocationPresenceViewScope = { userId: "actor-a", organizationId: "org-b" };
function Snapshot({
	rows = rowsA,
	view = viewA,
}: {
	rows?: typeof rowsA | typeof rowsB;
	view?: LocationPresenceViewScope;
}) {
	return (
		<LocationPresenceView view={view}>
			<PageHeader title="Who is in: synthetic selected location" />
			<LocationPresenceList rows={rows} />
		</LocationPresenceView>
	);
}
beforeEach(() => {
	contextTime = Date.now() + 1000;
	transport.session = {
		data: { user: { id: "actor-a" }, session: { activeOrganizationId: "org-a" } },
		isPending: false,
	};
	transport.router.refresh.mockReset();
	Object.defineProperty(window, "matchMedia", {
		configurable: true,
		value: (query: string) => ({
			matches: false,
			media: query,
			addEventListener() {},
			removeEventListener() {},
			addListener() {},
			removeListener() {},
			dispatchEvent() {
				return true;
			},
		}),
	});
	vi.stubGlobal(
		"fetch",
		vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = String(input);
			if (url.includes("/api/auth/context")) {
				const h = new Headers(init?.headers);
				const user = h.get("x-z8-context-user") ?? transport.session.data.user.id;
				const org =
					h.get("x-z8-context-organization") ?? transport.session.data.session.activeOrganizationId;
				const c = context(user, org);
				return Response.json({
					user: { id: user },
					session: { activeOrganizationId: org },
					employee: c.employee,
					organizationSettings: null,
				});
			}
			if (url.includes("/api/time-clock/status"))
				return Response.json({
					hasEmployee: false,
					employeeId: null,
					isClockedIn: false,
					activeWorkPeriod: null,
				});
			if (url.includes("/api/notifications/count")) return Response.json({ count: 0 });
			return Response.json({ success: false, code: "Unavailable" }, { status: 503 });
		}),
	);
});
afterEach(() => {
	cleanup();
	for (const c of clients.splice(0)) c.clear();
	vi.unstubAllGlobals();
});

it("priority 1: actual SiteHeader shares exactly one safe h1 with real route loading/error/not-found/roster", () => {
	for (const state of [
		<LocationPresenceLoading key="loading" />,
		<LocationPresenceError key="error" error={new Error("synthetic failure")} retry={() => {}} />,
		<LocationPresenceNotFound key="not-found" />,
		<Snapshot key="roster" />,
	]) {
		const ui = render(
			<Providers>
				<SiteHeader />
				{state}
			</Providers>,
		);
		expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
		expect(screen.queryByText("synthetic failure")).toBeNull();
		ui.unmount();
	}
});

function ReadTransportResult({ read }: { read: () => ReactNode }) {
	return read();
}

it("priority 2: installed Next retry refreshes the request and reset-only control does not", () => {
	let failed = true;
	const reads = vi.fn(() => {
		if (failed) throw new Error("synthetic safe refusal");
		return <p>Fresh authorized read transport result</p>;
	});
	const refresh = vi.fn(() => {
		failed = false;
	});
	const router = { ...transport.router, refresh };
	const spy = vi.spyOn(console, "error").mockImplementation(() => {});
	try {
		render(
			<AppRouterContext value={router}>
				<ErrorBoundaryHandler pathname={transport.pathname} errorComponent={LocationPresenceError}>
					<ReadTransportResult read={reads} />
				</ErrorBoundaryHandler>
			</AppRouterContext>,
		);
		expect(screen.queryByRole("table")).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "Retry" }));
		expect(refresh).toHaveBeenCalledOnce();
		expect(screen.getByText("Fresh authorized read transport result")).toBeTruthy();
		const handler = new ErrorBoundaryHandler({
			pathname: transport.pathname,
			errorComponent: LocationPresenceError,
		});
		handler.context = router;
		handler.setState = vi.fn();
		handler.reset();
		expect(refresh).toHaveBeenCalledOnce();
	} finally {
		spy.mockRestore();
	}
});

it("priority 3: fresh incoming roster props replace old rows and employee destinations", () => {
	const ui = render(
		<Providers>
			<PublishedScope />
			<Snapshot />
		</Providers>,
	);
	expect(screen.getByRole("link", { name: "Roster A Employee" }).getAttribute("href")).toBe(
		"/settings/employees/employee-a",
	);
	ui.rerender(
		<Providers>
			<PublishedScope />
			<Snapshot rows={rowsB} />
		</Providers>,
	);
	expect(screen.queryByRole("link", { name: "Roster A Employee" })).toBeNull();
	expect(screen.getByRole("link", { name: "Roster B Employee" }).getAttribute("href")).toBe(
		"/settings/employees/employee-b",
	);
});

it("priority 4: retained RSC rows cannot remain current after a new canonical organization display publishes", async () => {
	const ui = render(
		<Providers>
			<PublishedScope />
			<Snapshot />
		</Providers>,
	);
	expect(screen.getByRole("link", { name: "Roster A Employee" })).toBeTruthy();
	transport.session = {
		data: { user: { id: "actor-a" }, session: { activeOrganizationId: "org-b" } },
		isPending: false,
	};
	ui.rerender(
		<Providers initial={context("actor-a", "org-b")}>
			<PublishedScope />
			<Snapshot />
		</Providers>,
	);
	await waitFor(() =>
		expect(screen.getByTestId("canonical-display").textContent).toContain('"org-b"'),
	);
	expect(screen.queryByRole("link", { name: "Roster A Employee" })).toBeNull();
	expect(screen.queryByText("Who is in: synthetic selected location")).toBeNull();
	expect(screen.queryByText("08:15 +02:00")).toBeNull();
});

it.each(["role", "employee"] as const)(
	"retires retained rows after a published %s replacement within one organization",
	async (variant) => {
		const ui = render(
			<Providers>
				<PublishedScope />
				<Snapshot />
			</Providers>,
		);
		contextTime += 1000;
		const updated = context(
			"actor-a",
			"org-a",
			variant === "role" ? "employee" : "manager",
			variant === "employee" ? "viewer-new" : "viewer-a",
		);
		ui.rerender(
			<Providers initial={updated}>
				<PublishedScope />
				<Snapshot />
			</Providers>,
		);
		await waitFor(() =>
			expect(screen.getByTestId("canonical-display").textContent).toContain(
				variant === "role" ? '"employee"' : '"viewer-new"',
			),
		);
		expect(screen.queryByRole("link", { name: "Roster A Employee" })).toBeNull();
		expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Who is in");
	},
);
it("does not revive old rows on organization A→B→A and accepts only a fresh authorized server view", async () => {
	const ui = render(
		<Providers>
			<PublishedScope />
			<Snapshot />
		</Providers>,
	);
	transport.session = {
		data: { user: { id: "actor-a" }, session: { activeOrganizationId: "org-b" } },
		isPending: false,
	};
	ui.rerender(
		<Providers initial={context("actor-a", "org-b")}>
			<PublishedScope />
			<Snapshot />
		</Providers>,
	);
	await waitFor(() =>
		expect(screen.getByTestId("canonical-display").textContent).toContain('"org-b"'),
	);
	expect(screen.queryByRole("link", { name: "Roster A Employee" })).toBeNull();
	contextTime += 1000;
	transport.session = {
		data: { user: { id: "actor-a" }, session: { activeOrganizationId: "org-a" } },
		isPending: false,
	};
	ui.rerender(
		<Providers initial={context()}>
			<PublishedScope />
			<Snapshot />
		</Providers>,
	);
	await waitFor(() =>
		expect(screen.getByTestId("canonical-display").textContent).toContain('"org-a"'),
	);
	expect(screen.queryByRole("link", { name: "Roster A Employee" })).toBeNull();
	fireEvent.click(screen.getByRole("button", { name: "Retry" }));
	expect(transport.router.refresh).toHaveBeenCalledOnce();
	expect(screen.queryByRole("link", { name: "Roster A Employee" })).toBeNull();
	ui.rerender(
		<Providers initial={context()}>
			<PublishedScope />
			<Snapshot view={{ ...viewA }} />
		</Providers>,
	);
	expect(screen.getByRole("link", { name: "Roster A Employee" })).toBeTruthy();
});
it("retires the old account view across an actor A→B→A return", async () => {
	const ui = render(
		<Providers>
			<PublishedScope />
			<Snapshot />
		</Providers>,
	);
	transport.session = {
		data: { user: { id: "actor-b" }, session: { activeOrganizationId: "org-a" } },
		isPending: false,
	};
	ui.rerender(
		<Providers initial={context("actor-b")}>
			<PublishedScope />
			<Snapshot />
		</Providers>,
	);
	await waitFor(() =>
		expect(screen.getByTestId("canonical-display").textContent).toContain('"actor-b"'),
	);
	expect(screen.queryByRole("link", { name: "Roster A Employee" })).toBeNull();
	contextTime += 1000;
	transport.session = {
		data: { user: { id: "actor-a" }, session: { activeOrganizationId: "org-a" } },
		isPending: false,
	};
	ui.rerender(
		<Providers initial={context()}>
			<PublishedScope />
			<Snapshot />
		</Providers>,
	);
	await waitFor(() =>
		expect(screen.getByTestId("canonical-display").textContent).toContain('"actor-a"'),
	);
	expect(screen.queryByRole("link", { name: "Roster A Employee" })).toBeNull();
	ui.rerender(
		<Providers initial={context()}>
			<PublishedScope />
			<Snapshot view={{ ...viewA }} />
		</Providers>,
	);
	expect(screen.getByRole("link", { name: "Roster A Employee" })).toBeTruthy();
});
it("withdraws retained rows during a pending session and requires a fresh server view on return", () => {
	const ui = render(
		<Providers>
			<Snapshot />
		</Providers>,
	);
	transport.session = { ...transport.session, isPending: true };
	ui.rerender(
		<Providers>
			<Snapshot />
		</Providers>,
	);
	expect(screen.queryByRole("link", { name: "Roster A Employee" })).toBeNull();
	transport.session = { ...transport.session, isPending: false };
	ui.rerender(
		<Providers>
			<Snapshot />
		</Providers>,
	);
	expect(screen.queryByRole("link", { name: "Roster A Employee" })).toBeNull();
	ui.rerender(
		<Providers>
			<Snapshot view={{ ...viewA }} />
		</Providers>,
	);
	expect(screen.getByRole("link", { name: "Roster A Employee" })).toBeTruthy();
});
it("admits fresh B props only when the published display and session match that server view", async () => {
	const ui = render(
		<Providers>
			<PublishedScope />
			<Snapshot view={viewB} rows={rowsB} />
		</Providers>,
	);
	expect(screen.queryByRole("link", { name: "Roster B Employee" })).toBeNull();
	transport.session = {
		data: { user: { id: "actor-a" }, session: { activeOrganizationId: "org-b" } },
		isPending: false,
	};
	ui.rerender(
		<Providers initial={context("actor-a", "org-b")}>
			<PublishedScope />
			<Snapshot view={viewB} rows={rowsB} />
		</Providers>,
	);
	await waitFor(() => expect(screen.getByRole("link", { name: "Roster B Employee" })).toBeTruthy());
	expect(screen.queryByRole("link", { name: "Roster A Employee" })).toBeNull();
});
it("keeps valid same-arrival rows through StrictMode and ordinary rerenders", () => {
	const ui = render(
		<React.StrictMode>
			<Providers>
				<Snapshot />
			</Providers>
		</React.StrictMode>,
	);
	expect(screen.getByRole("link", { name: "Roster A Employee" })).toBeTruthy();
	ui.rerender(
		<React.StrictMode>
			<Providers>
				<Snapshot />
			</Providers>
		</React.StrictMode>,
	);
	expect(screen.getByRole("link", { name: "Roster A Employee" })).toBeTruthy();
	expect(transport.router.refresh).not.toHaveBeenCalled();
});
it("preserves canonical server admission for an administrator without an employee", () => {
	const admin = { ...context(), employee: null };
	render(
		<Providers initial={admin}>
			<Snapshot />
		</Providers>,
	);
	expect(screen.getByRole("link", { name: "Roster A Employee" })).toBeTruthy();
});
it("retires changed display identity while Activity is hidden and does not revive its old rows", async () => {
	const tree = (initial: OrganizationDisplayContext, visible: boolean, view = viewA) => (
		<Providers initial={initial}>
			<PublishedScope />
			<Activity mode={visible ? "visible" : "hidden"}>
				<Snapshot view={view} />
			</Activity>
		</Providers>
	);
	const ui = render(tree(context(), true));
	ui.rerender(tree(context(), false));
	transport.session = {
		data: { user: { id: "actor-a" }, session: { activeOrganizationId: "org-b" } },
		isPending: false,
	};
	ui.rerender(tree(context("actor-a", "org-b"), false));
	await waitFor(() =>
		expect(screen.getByTestId("canonical-display").textContent).toContain('"org-b"'),
	);
	contextTime += 1000;
	transport.session = {
		data: { user: { id: "actor-a" }, session: { activeOrganizationId: "org-a" } },
		isPending: false,
	};
	ui.rerender(tree(context(), false));
	await waitFor(() =>
		expect(screen.getByTestId("canonical-display").textContent).toContain('"org-a"'),
	);
	ui.rerender(tree(context(), true));
	expect(screen.queryByRole("link", { name: "Roster A Employee" })).toBeNull();
	ui.rerender(tree(context(), true, { ...viewA }));
	expect(screen.getByRole("link", { name: "Roster A Employee" })).toBeTruthy();
});

it("allows a fresh authorized server view when the ancillary display read is unavailable", async () => {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
	const ui = render(
		<Providers client={client}>
			<PublishedScope />
			<Snapshot />
		</Providers>,
	);
	expect(screen.getByRole("link", { name: "Roster A Employee" })).toBeTruthy();
	vi.mocked(fetch).mockImplementation(async () =>
		Response.json({ message: "Synthetic context read failure" }, { status: 503 }),
	);
	await act(async () => {
		await client.invalidateQueries({ queryKey: ["organization-context"] });
	});
	await waitFor(() =>
		expect(screen.getByTestId("canonical-display").textContent).toContain("null"),
	);
	expect(screen.queryByRole("link", { name: "Roster A Employee" })).toBeNull();
	ui.rerender(
		<Providers client={client}>
			<PublishedScope />
			<Snapshot view={{ ...viewA }} />
		</Providers>,
	);
	expect(screen.getByRole("link", { name: "Roster A Employee" })).toBeTruthy();
});
