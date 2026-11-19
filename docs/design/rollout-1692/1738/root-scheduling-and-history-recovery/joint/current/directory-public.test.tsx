// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { Activity, type ComponentProps } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TeamDirectory } from "@/app/[locale]/(app)/team/team-directory";
import { OrganizationContextProvider } from "@/components/providers/organization-context-provider";
import { UserPreferencesProvider } from "@/components/providers/user-preferences-provider";

const boundary = vi.hoisted(() => ({
	fetch: vi.fn(),
	current: vi.fn(),
	managed: vi.fn(),
	presence: vi.fn(),
	refresh: vi.fn(),
	replace: vi.fn(),
	section: vi.fn(),
	session: {
		data: { user: { id: "actor-a" }, session: { activeOrganizationId: "org-a" } },
		isPending: false,
	},
}));
vi.mock("@/lib/auth-client", async () => {
	const { useSyncExternalStore } = await import("react");
	return {
		useSession: () => {
			useSyncExternalStore(
				() => () => {},
				() => JSON.stringify(boundary.session),
			);
			return boundary.session;
		},
		authClient: { $store: { atoms: { session: { subscribe: () => () => {} } } } },
	};
});
vi.mock("@/app/[locale]/(app)/team/actions", () => ({
	getCurrentEmployee: boundary.current,
	getManagedEmployees: boundary.managed,
}));
vi.mock("@/app/[locale]/(app)/settings/employees/employee-clock-status.actions", () => ({
	getEmployeeClockStatuses: boundary.presence,
}));
vi.mock("@/app/[locale]/(app)/settings/employees/work-balance-actions", () => ({
	getEmployeeWorkBalanceSectionAction: boundary.section,
	cancelBalanceAdjustmentAction: vi.fn(),
	recordOvertimePayoutAction: vi.fn(),
	setOpeningBalanceAction: vi.fn(),
}));
vi.mock("@/app/[locale]/(app)/time-tracking/actions", () => ({
	addBreakToActiveSession: vi.fn(),
	resumeBreakInProgress: vi.fn(),
	startBreakInProgress: vi.fn(),
	updateTimeEntryNotes: vi.fn(),
}));
vi.mock("@/navigation", () => ({
	useRouter: () => ({ refresh: boundary.refresh, replace: boundary.replace }),
	Link: (props: ComponentProps<"a">) => <a {...props} />,
}));
vi.mock("@/tolgee/server", () => ({
	getTranslate: async () => (_key: string, fallback: string) => fallback,
}));
vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));
vi.mock("@/lib/navigation/locale-redirect", () => ({ redirectWithLocale: vi.fn() }));

function response() {
	return new Response(
		JSON.stringify({
			user: { id: "actor-a" },
			session: { activeOrganizationId: "org-a" },
			employee: { employeeId: "manager-a", organizationId: "org-a", role: "manager" },
			organizationSettings: null,
		}),
	);
}
const clients: QueryClient[] = [];
beforeEach(() => {
	vi.clearAllMocks();
	boundary.session = {
		data: { user: { id: "actor-a" }, session: { activeOrganizationId: "org-a" } },
		isPending: false,
	};
	boundary.fetch.mockReset().mockImplementation(async () => response());
	vi.stubGlobal("fetch", boundary.fetch);
	boundary.current.mockResolvedValue({
		id: "manager-a",
		userId: "actor-a",
		organizationId: "org-a",
		role: "manager",
	});
	boundary.managed.mockImplementation(async () => ({
		success: true,
		data: [
			{
				id: "report-a",
				role: "employee",
				isFormer: false,
				user: {
					id: "person-a",
					name: "Admitted Synthetic Employee",
					email: "synthetic@example.test",
					image: null,
				},
				timeBalance: null,
				team: null,
			},
		],
	}));
	boundary.presence.mockResolvedValue({ success: true, data: {} });
});
afterEach(() => {
	cleanup();
	for (const client of clients) client.clear();
	clients.length = 0;
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});
async function mount() {
	const client = new QueryClient({
		defaultOptions: {
			queries: { retry: false, staleTime: 60_000, refetchOnWindowFocus: false, retryDelay: 0 },
		},
	});
	clients.push(client);
	const tree = async () => (
		<QueryClientProvider client={client}>
			<NextIntlClientProvider locale="en" messages={{}} timeZone="Europe/Berlin">
				<UserPreferencesProvider timezone="Europe/Berlin">
					<OrganizationContextProvider initialContext={null}>
						{await TeamDirectory({ searchParams: Promise.resolve({}) })}
					</OrganizationContextProvider>
				</UserPreferencesProvider>
			</NextIntlClientProvider>
		</QueryClientProvider>
	);
	const view = render(await tree());
	// Model a successful RSC refresh while preserving the actual shared provider and QueryClient.
	boundary.refresh.mockImplementation(async () => view.rerender(await tree()));
	return { client, view, tree };
}
it("healthy real provider admits the public team directory and its employee link", async () => {
	const errors = vi.spyOn(console, "error");
	await mount();
	expect(await screen.findByRole("link", { name: "Admitted Synthetic Employee" })).toBeTruthy();
	expect(boundary.fetch).toHaveBeenCalledTimes(1);
	expect(boundary.fetch.mock.calls[0][0]).toBe("/api/auth/context");
	expect(
		errors.mock.calls.some((args) => args.some((value) => String(value).includes("nativeButton"))),
	).toBe(false);
});
it("local Retry refetches failed canonical context and admits records after successful RSC refresh", async () => {
	boundary.fetch.mockImplementation(
		async () =>
			new Response(JSON.stringify({ error: "Synthetic context outage" }), { status: 503 }),
	);
	const { client } = await mount();
	await waitFor(() =>
		expect(
			client
				.getQueryCache()
				.findAll({ queryKey: ["organization-context"] })
				.some((q) => q.state.status === "error"),
		).toBe(true),
	);
	expect(screen.queryByRole("link", { name: "Admitted Synthetic Employee" })).toBeNull();
	const retry = screen.getByRole("button", { name: "Retry" });
	boundary.fetch.mockImplementation(async () => response());
	await act(async () => fireEvent.click(retry));
	await waitFor(() => expect(boundary.refresh).toHaveBeenCalledTimes(1));
	await waitFor(() => expect(boundary.managed).toHaveBeenCalledTimes(2));
	await waitFor(() => expect(boundary.fetch).toHaveBeenCalledTimes(2));
	expect(await screen.findByRole("link", { name: "Admitted Synthetic Employee" })).toBeTruthy();
});

it("serializes visible context Retry through a held canonical reread before RSC refresh", async () => {
	boundary.fetch.mockResolvedValue(new Response("{}", { status: 503 }));
	const { client } = await mount();
	await waitFor(() =>
		expect(
			client
				.getQueryCache()
				.findAll({ queryKey: ["organization-context"] })
				.some((q) => q.state.status === "error"),
		).toBe(true),
	);
	let finish!: (r: Response) => void;
	boundary.fetch.mockImplementation(
		() =>
			new Promise<Response>((r) => {
				finish = r;
			}),
	);
	const retry = screen.getByRole("button", { name: "Retry" });
	await userEvent.setup().dblClick(retry);
	await waitFor(() => expect(boundary.fetch).toHaveBeenCalledTimes(2));
	expect(boundary.refresh).toHaveBeenCalledTimes(0);
	expect(screen.getByRole("status", { name: "Loading team members" })).toBeTruthy();
	expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
	await act(async () => {
		finish(response());
	});
	expect(await screen.findByRole("link", { name: "Admitted Synthetic Employee" })).toBeTruthy();
	await waitFor(() => expect(boundary.refresh).toHaveBeenCalledTimes(1));
});

it.each(["actor", "organization", "pending"])(
	"canonical directory withholds a warmed open history on %s arrival",
	async (change) => {
		boundary.section.mockResolvedValue({ success: true, data: { adjustments: [] } });
		const { view, tree } = await mount();
		await screen.findByRole("link", { name: "Admitted Synthetic Employee" });
		const trigger = screen.getByRole("button", { name: "All-time balance: No balance" });
		expect(trigger.tagName).toBe("BUTTON");
		await userEvent.setup().click(trigger);
		expect(await screen.findByText("No balance adjustments yet.")).toBeTruthy();
		if (change === "actor") boundary.session.data.user.id = "actor-b";
		if (change === "organization") boundary.session.data.session.activeOrganizationId = "org-b";
		if (change === "pending") boundary.session.isPending = true;
		await act(async () => view.rerender(await tree()));
		expect(screen.queryByRole("link", { name: "Admitted Synthetic Employee" })).toBeNull();
		expect(screen.queryByRole("dialog")).toBeNull();
		expect(screen.queryByText("No balance adjustments yet.")).toBeNull();
	},
);

it("canonical directory removes history after a successful relationship-narrowed server arrival", async () => {
	boundary.section.mockResolvedValue({ success: true, data: { adjustments: [] } });
	const { view, tree } = await mount();
	await screen.findByRole("link", { name: "Admitted Synthetic Employee" });
	await userEvent
		.setup()
		.click(screen.getByRole("button", { name: "All-time balance: No balance" }));
	expect(await screen.findByText("No balance adjustments yet.")).toBeTruthy();
	boundary.managed.mockResolvedValue({ success: true, data: [] });
	await act(async () => view.rerender(await tree()));
	expect(screen.queryByRole("dialog")).toBeNull();
	expect(screen.queryByRole("link", { name: "Admitted Synthetic Employee" })).toBeNull();
	expect(screen.queryByText("No balance adjustments yet.")).toBeNull();
});

it("real provider checks raw pending session on Activity hide and reveal with retained history", async () => {
	boundary.section.mockResolvedValue({ success: true, data: { adjustments: [] } });
	const { view, tree } = await mount();
	// First move the actual provider subtree under Activity; warm this identity.
	const body = await tree();
	view.rerender(<Activity mode="visible">{body}</Activity>);
	await screen.findByRole("link", { name: "Admitted Synthetic Employee" });
	await userEvent
		.setup()
		.click(screen.getByRole("button", { name: "All-time balance: No balance" }));
	expect(await screen.findByText("No balance adjustments yet.")).toBeTruthy();
	view.rerender(<Activity mode="hidden">{body}</Activity>);
	boundary.session.isPending = true;
	view.rerender(<Activity mode="visible">{body}</Activity>);
	await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
	expect(screen.queryByRole("link", { name: "Admitted Synthetic Employee" })).toBeNull();
});

it("reauthorizes history when a relationship is narrowed and directory recovery retains the last loaded employee", async () => {
	const data = {
		balance: null,
		adjustments: [
			{
				id: "synthetic-row",
				kind: "opening_balance",
				day: "2026-11-01",
				minutes: 120,
				reason: "SYNTHETIC PRE-NARROWING HISTORY",
				recordedAt: "2026-11-01T08:00:00Z",
				recordedBy: { userId: "actor-a", name: "Synthetic Admin" },
				cancellation: null,
			},
		],
		today: "2026-11-17",
		timezone: "Europe/Berlin",
		canManage: false,
	};
	boundary.section.mockResolvedValue({ success: true, data });
	const { view, tree } = await mount();
	await screen.findByRole("link", { name: "Admitted Synthetic Employee" });
	await userEvent
		.setup()
		.click(screen.getByRole("button", { name: "All-time balance: No balance" }));
	expect(await screen.findByText("SYNTHETIC PRE-NARROWING HISTORY")).toBeTruthy();
	expect(boundary.section).toHaveBeenCalledTimes(1);
	await userEvent.setup().keyboard("{Escape}");
	await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
	// Relationship narrowing leaves this actor a manager in the same organization.
	// The authorized history action now refuses. An unexpected directory-read
	// failure legitimately retains its explicitly marked last loaded employees.
	let refuse!: (v: unknown) => void;
	boundary.section.mockImplementation(() => new Promise(resolve => { refuse = resolve; }));
	boundary.managed.mockResolvedValue({
		success: false,
		error: "Synthetic directory transport failure",
	});
	await act(async () => view.rerender(await tree()));
	expect(screen.getByRole("alert").textContent).toContain("Showing the last loaded members");
	await userEvent.setup().click(screen.getByRole("button", { name: "Retry" }));
	await waitFor(() => expect(boundary.refresh).toHaveBeenCalledTimes(1));
	expect(boundary.fetch).toHaveBeenCalledTimes(2);
	await userEvent
		.setup()
		.click(screen.getByRole("button", { name: "All-time balance: No balance" }));
	expect(screen.getByRole("dialog")).toBeTruthy();
	// Reopening must not show any record until the current authorized read resolves.
	expect(screen.queryByText("SYNTHETIC PRE-NARROWING HISTORY")).toBeNull();
	await waitFor(() => expect(boundary.section).toHaveBeenCalledTimes(2));
	expect(screen.getByLabelText("Loading balance adjustments")).toBeTruthy();
	let leaked = false;
	const observer = new MutationObserver(() => { if(document.body.textContent?.includes("SYNTHETIC PRE-NARROWING HISTORY")) leaked = true; });
	observer.observe(document.body, {subtree:true, childList:true, characterData:true});
	try {
	 await act(async () => refuse({success:false, code:"AuthorizationError", error:"Synthetic refusal; never show detail"}));
	 await waitFor(() => expect(screen.getByRole("dialog").textContent).toContain("employees you manage"));
	 expect(leaked).toBe(false);
	 expect(screen.queryByText("SYNTHETIC PRE-NARROWING HISTORY")).toBeNull();
	} finally { observer.disconnect(); }
	expect(boundary.section).toHaveBeenCalledTimes(2);
});
