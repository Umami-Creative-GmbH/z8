/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Activity, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { briefingFixture } from "@/app/[locale]/(app)/today/today-test-fixture";
import type { TodayArrival } from "@/app/[locale]/(app)/today/today-types";
import { TodayWorkspace } from "@/app/[locale]/(app)/today/today-workspace";
import {
	OrganizationContextProvider,
	useOrganization,
} from "@/components/providers/organization-context-provider";
import {
	useViewRefreshAction,
	ViewRefreshProvider,
} from "@/components/providers/view-refresh-provider";
import type { OrganizationDisplayContext } from "@/lib/auth/organization-display-context";

const h = vi.hoisted(() => ({
	read: vi.fn(),
	fetch: vi.fn(),
	router: { refresh: vi.fn(), replace: vi.fn() },
	session: {
		data: { user: { id: "user-a" }, session: { activeOrganizationId: "org-a" } },
		isPending: false,
	},
}));
vi.mock("@/app/[locale]/(app)/today/actions", () => ({ readTodayBriefing: h.read }));
vi.mock("@/lib/auth-client", () => ({ useSession: () => h.session }));
vi.mock("next/navigation", () => ({ useRouter: () => h.router }));
vi.mock("next-intl", () => ({ useLocale: () => "en" }));
vi.mock("@/navigation", () => ({
	useRouter: () => h.router,
	Link: ({ children, href }: { children: ReactNode; href: string }) => (
		<a href={href}>{children}</a>
	),
}));
vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: Record<string, string | number>) =>
			Object.entries(params ?? {}).reduce(
				(s, [k, v]) => s.replaceAll(`{${k}}`, String(v)),
				fallback,
			),
	}),
}));
const scope = { userId: "user-a", organizationId: "org-a" };
function ctx(
	employeeId = "employee-a",
	role: "admin" | "manager" | "employee" = "manager",
): OrganizationDisplayContext {
	return {
		userId: "user-a",
		organizationId: "org-a",
		employee: { employeeId, organizationId: "org-a", role },
		organizationSettings: null,
		updatedAt: Date.now(),
	};
}
function ready(title = "Old managed employee evidence", producer = transportContext): TodayArrival {
	const briefing = briefingFixture();
	const item = {
		id: "approval-1",
		approvalId: "approval-1",
		approvalType: "absence",
		entityId: "absence-a",
		requesterName: "Managed A",
		title,
		summary: "One day requested",
		description: "Review original request",
		category: "approval" as const,
		severity: "warning" as const,
		href: "/approvals/inbox",
		ownRequest: false,
	};
	briefing.sections.approvals.items = [item];
	briefing.needsAction = [item];
	if (!producer.employee || !producer.organizationId) throw Error("Fixture producer missing");
	return {
		status: "ready",
		briefing,
		view: {
			userId: producer.userId,
			organizationId: producer.organizationId,
			employeeId: producer.employee.employeeId,
			role: producer.employee.role,
		},
	};
}
function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((r) => {
		resolve = r;
	});
	return { promise, resolve };
}
let client: QueryClient,
	transportContext: OrganizationDisplayContext,
	contextCalls: number,
	decisionCalls: number;
function Controls() {
	const org = useOrganization();
	const refresh = useViewRefreshAction();
	return (
		<>
			<output data-testid="actual-context">
				{JSON.stringify({
					employeeId: org.employeeId,
					role: org.role,
					organizationId: org.organizationId,
					error: org.error,
					loading: org.isLoading,
				})}
			</output>
			<button type="button" onClick={() => void org.refetch()}>
				Provider refetch control
			</button>
			<button type="button" onClick={refresh.refresh}>
				Shell refresh control
			</button>
		</>
	);
}
function mount(initial = ready(), initialContext = ctx()) {
	transportContext = initialContext;
	client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
	const content = (mode: "hidden" | "visible" = "visible") => (
		<QueryClientProvider client={client}>
			<OrganizationContextProvider initialContext={initialContext}>
				<ViewRefreshProvider>
					<Controls />
					<Activity mode={mode}>
						<TodayWorkspace scope={scope} initial={initial} />
					</Activity>
				</ViewRefreshProvider>
			</OrganizationContextProvider>
		</QueryClientProvider>
	);
	const view = render(content());
	return { ...view, activity: (mode: "hidden" | "visible") => view.rerender(content(mode)) };
}
async function providerArrival(next: OrganizationDisplayContext) {
	transportContext = next;
	await act(async () => {
		fireEvent.click(screen.getByRole("button", { name: "Provider refetch control" }));
	});
	await waitFor(() =>
		expect(screen.getByTestId("actual-context").textContent).toContain(
			`"employeeId":"${next.employee?.employeeId}"`,
		),
	);
	await waitFor(() =>
		expect(screen.getByTestId("actual-context").textContent).toContain(
			`"role":"${next.employee?.role}"`,
		),
	);
}
async function shellRefresh() {
	await act(async () => {
		fireEvent.click(screen.getByRole("button", { name: "Shell refresh control" }));
	});
}
beforeEach(() => {
	vi.clearAllMocks();
	contextCalls = 0;
	decisionCalls = 0;
	transportContext = ctx();
	h.session.isPending = false;
	h.read.mockImplementation(async () => ready("Fresh current evidence"));
	h.fetch.mockImplementation(async (url: string) => {
		if (url === "/api/auth/context") {
			contextCalls++;
			return new Response(
				JSON.stringify({
					user: { id: "user-a" },
					session: { activeOrganizationId: "org-a" },
					employee: transportContext.employee,
					organizationSettings: null,
				}),
				{ status: 200, headers: { "Content-Type": "application/json" } },
			);
		}
		if (url.includes("/api/approvals/inbox/")) {
			decisionCalls++;
			return {
				ok: true,
				json: async () => ({ success: false, error: "Current authority refused" }),
			};
		}
		throw Error("Unexpected external transport");
	});
	vi.stubGlobal("fetch", h.fetch);
});
afterEach(() => {
	cleanup();
	client?.clear();
	vi.unstubAllGlobals();
});
describe("independent real-provider Today priority", () => {
	it("positive control: real context refetch publishes employee and role, current read Retry recovers", async () => {
		mount();
		await providerArrival(ctx("employee-a", "admin"));
		expect(contextCalls).toBe(1);
		await screen.findAllByText("Fresh current evidence");
		const beforeFailure = h.read.mock.calls.length;
		h.read.mockRejectedValueOnce(Error("offline"));
		await shellRefresh();
		expect(screen.getAllByText("Fresh current evidence")).toHaveLength(2);
		fireEvent.click(screen.getByRole("button", { name: "Retry briefing" }));
		await waitFor(() => expect(h.read).toHaveBeenCalledTimes(beforeFailure + 2));
		expect(h.read).toHaveBeenLastCalledWith(scope);
	});
	it("positive control: one pending decision, refusal retains row, current Retry can succeed", async () => {
		const held = deferred<{
			ok: boolean;
			json: () => Promise<{ success: boolean; error?: string }>;
		}>();
		mount();
		h.fetch.mockImplementationOnce(() => {
			decisionCalls++;
			return held.promise;
		});
		const approve = screen.getByRole("button", { name: "Approve Old managed employee evidence" });
		fireEvent.click(approve);
		fireEvent.click(approve);
		expect(decisionCalls).toBe(1);
		await act(async () =>
			held.resolve({
				ok: false,
				json: async () => ({ success: false, error: "Current authority refused" }),
			}),
		);
		expect(screen.getByRole("alert").textContent).toContain("Current authority refused");
		expect((approve as HTMLButtonElement).disabled).toBe(false);
		h.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ success: true }) });
		fireEvent.click(approve);
		await screen.findAllByText("Fresh current evidence");
		expect(h.read).toHaveBeenCalledTimes(1);
	});
	it("positive control: Activity retirement rejects late reads and decisions and reads afresh", async () => {
		const read = deferred<TodayArrival>(),
			decision = deferred<{
				ok: boolean;
				json: () => Promise<{ success: boolean; error?: string }>;
			}>();
		const view = mount();
		h.fetch.mockImplementationOnce(() => decision.promise);
		fireEvent.click(screen.getByRole("button", { name: "Approve Old managed employee evidence" }));
		h.read.mockReturnValueOnce(read.promise);
		await shellRefresh();
		view.activity("hidden");
		view.activity("visible");
		await screen.findAllByText("Fresh current evidence");
		const calls = h.read.mock.calls.length;
		await act(async () => {
			read.resolve(ready("Late hidden read"));
			decision.resolve({
				ok: false,
				json: async () => ({ success: false, error: "Late hidden decision" }),
			});
		});
		expect(screen.queryByText("Late hidden read")).toBeNull();
		expect(screen.queryByText("Late hidden decision")).toBeNull();
		expect(h.read).toHaveBeenCalledTimes(calls);
	});
	it("employee-only arrival must retire readable evidence, held reads and decision feedback", async () => {
		const read = deferred<TodayArrival>(),
			decision = deferred<{
				ok: boolean;
				json: () => Promise<{ success: boolean; error?: string }>;
			}>();
		mount();
		h.fetch.mockImplementationOnce(() => decision.promise);
		fireEvent.click(screen.getByRole("button", { name: "Approve Old managed employee evidence" }));
		h.read.mockReturnValueOnce(read.promise);
		await shellRefresh();
		const previousCalls = h.read.mock.calls.length;
		await providerArrival(ctx("employee-b", "manager"));
		expect(contextCalls).toBe(2);
		const staleVisible = screen.queryAllByText("Old managed employee evidence").length;
		await act(async () => {
			read.resolve(ready("Late retired employee read"));
			decision.resolve({
				ok: false,
				json: async () => ({ success: false, error: "Late retired employee decision" }),
			});
		});
		const observation = {
			actualContext: JSON.parse(screen.getByTestId("actual-context").textContent!),
			staleVisibleAfterArrival: staleVisible,
			readCallsBeforeArrival: previousCalls,
			readCallsAfterArrival: h.read.mock.calls.length,
			lateReadVisible: screen.queryAllByText("Late retired employee read").length,
			lateDecisionVisible: !!screen.queryByText("Late retired employee decision"),
			contextCalls,
		};
		console.log("R164_EMPLOYEE_ARRIVAL_OBSERVATION", JSON.stringify(observation));
		expect(observation).toMatchObject({
			staleVisibleAfterArrival: 0,
			lateReadVisible: 0,
			lateDecisionVisible: false,
		});
	});

	it.each([
		["role-only", "employee-a", "admin"],
		["employee and role", "employee-b", "admin"],
	] as const)(
		"%s arrivals and returns require fresh evidence",
		async (_label, employeeId, employeeRole) => {
			const old = deferred<TodayArrival>();
			mount();
			h.read.mockReturnValueOnce(old.promise);
			await shellRefresh();
			await providerArrival(ctx(employeeId, employeeRole));
			await screen.findAllByText("Fresh current evidence");
			expect(screen.queryByText("Old managed employee evidence")).toBeNull();
			await act(async () => old.resolve(ready("Retired scope read")));
			expect(screen.queryByText("Retired scope read")).toBeNull();
			h.read.mockImplementationOnce(async () => ready("Returned authorized evidence"));
			await providerArrival(ctx());
			await screen.findAllByText("Returned authorized evidence");
			expect(screen.queryByText("Old managed employee evidence")).toBeNull();
			expect(h.read).toHaveBeenCalledTimes(3);
		},
	);
	it("a first provider identity differing from the server snapshot cannot seed that snapshot", async () => {
		mount(ready(), ctx("employee-b"));
		expect(screen.queryByText("Old managed employee evidence")).toBeNull();
		await screen.findAllByText("Fresh current evidence");
		expect(h.read).toHaveBeenCalledTimes(1);
	});
	it("context failure removes evidence and local Retry really refetches the provider", async () => {
		mount();
		h.fetch.mockImplementationOnce(
			async () =>
				new Response(JSON.stringify({ error: "Context unavailable" }), {
					status: 500,
					headers: { "Content-Type": "application/json" },
				}),
		);
		await act(async () =>
			fireEvent.click(screen.getByRole("button", { name: "Provider refetch control" })),
		);
		await screen.findByText("Could not check your current access. Try again.");
		expect(screen.queryByText("Old managed employee evidence")).toBeNull();
		expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Manager Daily Briefing");
		expect(h.read).not.toHaveBeenCalled();
		const before = h.fetch.mock.calls.length;
		fireEvent.click(screen.getByRole("button", { name: "Retry", exact: true }));
		await screen.findAllByText("Fresh current evidence");
		expect(h.fetch.mock.calls.length).toBeGreaterThan(before);
		expect(h.read).toHaveBeenCalledTimes(1);
	});
	it("a same-identity provider refresh retains current evidence without another briefing read", async () => {
		mount();
		await providerArrival(ctx());
		expect(screen.getAllByText("Old managed employee evidence")).toHaveLength(2);
		expect(h.read).not.toHaveBeenCalled();
	});
	it("pending sessions retire retained evidence and require a fresh read on return", async () => {
		const view = mount();
		h.session.isPending = true;
		view.activity("visible");
		expect(screen.queryByText("Old managed employee evidence")).toBeNull();
		h.session.isPending = false;
		view.activity("visible");
		await screen.findAllByText("Fresh current evidence");
		expect(h.read).toHaveBeenCalledTimes(1);
	});
	it("a missing employee cannot reuse the old manager snapshot and the server decides refusal", async () => {
		h.read.mockResolvedValueOnce({ status: "unavailable" });
		mount(ready(), { ...ctx(), employee: null });
		expect(screen.queryByText("Old managed employee evidence")).toBeNull();
		await screen.findByText(
			"This briefing is unavailable for the current employee and organization.",
		);
		expect(h.read).toHaveBeenCalledTimes(1);
		expect(screen.getByRole("heading", { level: 1 })).toBeTruthy();
	});
});
