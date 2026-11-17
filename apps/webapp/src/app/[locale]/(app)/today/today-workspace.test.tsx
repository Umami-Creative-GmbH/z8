/* @vitest-environment jsdom */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render as renderView, screen, waitFor } from "@testing-library/react";
import { Activity, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { briefingFixture } from "./today-test-fixture";
import type { TodayArrival } from "./today-types";
import { TodayWorkspace } from "./today-workspace";

const harness = vi.hoisted(() => ({
	organizationId: "org-a",
	read: vi.fn(),
	refresh: undefined as undefined | (() => unknown),
	session: {
		data: { user: { id: "user-a" }, session: { activeOrganizationId: "org-a" } },
		isPending: false,
	},
}));
vi.mock("./actions", () => ({ readTodayBriefing: harness.read }));
vi.mock("@/lib/auth-client", () => ({ useSession: () => harness.session }));
vi.mock("@/hooks/use-organization", () => ({
	useOrganization: () => ({
		userId: harness.session.data.user.id,
		activeOrganizationId: harness.organizationId,
		organizationId: harness.organizationId,
		employeeId: "employee-a",
		role: "manager",
		isLoading: false,
		error: null,
	}),
}));
vi.mock("@/components/providers/view-refresh-provider", () => ({
	useViewRefresh: (handler: () => unknown) => {
		harness.refresh = handler;
	},
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("next-intl", () => ({ useLocale: () => "en" }));
vi.mock("@/navigation", () => ({
	Link: ({ children, href }: { children: React.ReactNode; href: string }) => (
		<a href={href}>{children}</a>
	),
}));
vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: Record<string, string | number>) =>
			Object.entries(params ?? {}).reduce(
				(text, [key, value]) => text.replaceAll(`{${key}}`, String(value)),
				fallback,
			),
	}),
}));

const scope = { userId: "user-a", organizationId: "org-a" };
function render(ui: ReactNode) {
	const client = new QueryClient();
	return renderView(ui, {
		wrapper: ({ children }) => (
			<QueryClientProvider client={client}>{children}</QueryClientProvider>
		),
	});
}
function ready(title = "Known payroll issue"): TodayArrival {
	const briefing = briefingFixture();
	briefing.needsAction = [
		{
			id: "payroll-1",
			title,
			description: "Review mapping",
			category: "payroll",
			severity: "warning",
			href: "/settings/payroll-readiness",
		},
	];
	briefing.sections.payroll.items = briefing.needsAction;
	return { status: "ready", briefing };
}
function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason: Error) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}
describe("Today scoped arrivals and recovery", () => {
	beforeEach(() => {
		harness.organizationId = "org-a";
		vi.clearAllMocks();
		harness.session.data.user.id = "user-a";
		harness.session.data.session.activeOrganizationId = "org-a";
		harness.session.isPending = false;
		harness.read.mockResolvedValue(ready("Fresh payroll issue"));
	});
	it("hides the old briefing when shell organization context changes before session resolution", () => {
		const initial = ready();
		const view = render(
			<TodayWorkspace
				initialEmployee={{ id: "employee-a", role: "manager" }}
				scope={scope}
				initial={initial}
			/>,
		);
		harness.organizationId = "org-b";
		view.rerender(
			<TodayWorkspace
				initialEmployee={{ id: "employee-a", role: "manager" }}
				scope={scope}
				initial={initial}
			/>,
		);
		expect(screen.queryAllByText("Known payroll issue")).toHaveLength(0);
		expect(screen.getByRole("heading", { level: 1 })).toBeTruthy();
	});
	it("retains readable results after rejected refresh and recovers through Retry", async () => {
		harness.read.mockRejectedValueOnce(new Error("offline"));
		render(
			<TodayWorkspace
				initialEmployee={{ id: "employee-a", role: "manager" }}
				scope={scope}
				initial={ready()}
			/>,
		);
		await act(async () => {
			await harness.refresh?.();
		});
		expect(screen.getAllByText("Known payroll issue")).toHaveLength(2);
		expect(screen.getByRole("alert").textContent).toContain("Previous results");
		fireEvent.click(screen.getByRole("button", { name: "Retry briefing" }));
		await screen.findAllByText("Fresh payroll issue");
		expect(screen.queryByRole("alert")).toBeNull();
	});
	it("does not mix prior section rows into a fresh partial result and Retry recovers", async () => {
		const partial = ready("Other results");
		if (partial.status !== "ready") throw Error("fixture");
		partial.briefing.sections.payroll = {
			...partial.briefing.sections.payroll,
			error: "Section could not be loaded.",
			items: [],
		};
		partial.briefing.needsAction = [];
		harness.read.mockResolvedValueOnce(partial);
		render(
			<TodayWorkspace
				initialEmployee={{ id: "employee-a", role: "manager" }}
				scope={scope}
				initial={ready()}
			/>,
		);
		await act(async () => {
			await harness.refresh?.();
		});
		expect(screen.queryByText("Known payroll issue")).toBeNull();
		expect(screen.getAllByText("Unavailable").length).toBeGreaterThan(0);
		fireEvent.click(screen.getByRole("button", { name: "Retry Payroll" }));
		await screen.findAllByText("Fresh payroll issue");
	});
	it("does not restore a pending-session snapshot on A to B to A or accept the late A read", async () => {
		const late = deferred<TodayArrival>();
		harness.read.mockReturnValueOnce(late.promise);
		const initial = ready();
		const view = render(
			<TodayWorkspace
				initialEmployee={{ id: "employee-a", role: "manager" }}
				scope={scope}
				initial={initial}
			/>,
		);
		act(() => {
			void harness.refresh?.();
		});
		harness.session.isPending = true;
		view.rerender(
			<TodayWorkspace
				initialEmployee={{ id: "employee-a", role: "manager" }}
				scope={scope}
				initial={initial}
			/>,
		);
		expect(screen.queryByText("Known payroll issue")).toBeNull();
		expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Manager Daily Briefing");
		harness.session.isPending = false;
		harness.session.data.session.activeOrganizationId = "org-b";
		view.rerender(
			<TodayWorkspace
				initialEmployee={{ id: "employee-a", role: "manager" }}
				scope={scope}
				initial={initial}
			/>,
		);
		harness.session.data.session.activeOrganizationId = "org-a";
		view.rerender(
			<TodayWorkspace
				initialEmployee={{ id: "employee-a", role: "manager" }}
				scope={scope}
				initial={initial}
			/>,
		);
		await screen.findAllByText("Fresh payroll issue");
		await act(async () => {
			late.resolve(ready("Late old evidence"));
		});
		expect(screen.queryByText("Late old evidence")).toBeNull();
	});
	it("clears retained records on refused read and keeps a safe title", async () => {
		harness.read.mockResolvedValue({ status: "unavailable" });
		render(
			<TodayWorkspace
				initialEmployee={{ id: "employee-a", role: "manager" }}
				scope={scope}
				initial={ready()}
			/>,
		);
		await act(async () => {
			await harness.refresh?.();
		});
		expect(screen.queryByText("Known payroll issue")).toBeNull();
		expect(screen.getByRole("heading", { level: 1 })).toBeTruthy();
		expect(screen.getByRole("alert").textContent).toContain("unavailable");
	});
	it("re-authorizes Activity reactivation and refuses pre-hide completion", async () => {
		const late = deferred<TodayArrival>();
		harness.read.mockReturnValueOnce(late.promise);
		const initial = ready();
		const view = render(
			<Activity mode="visible">
				<TodayWorkspace
					initialEmployee={{ id: "employee-a", role: "manager" }}
					scope={scope}
					initial={initial}
				/>
			</Activity>,
		);
		act(() => {
			void harness.refresh?.();
		});
		view.rerender(
			<Activity mode="hidden">
				<TodayWorkspace
					initialEmployee={{ id: "employee-a", role: "manager" }}
					scope={scope}
					initial={initial}
				/>
			</Activity>,
		);
		view.rerender(
			<Activity mode="visible">
				<TodayWorkspace
					initialEmployee={{ id: "employee-a", role: "manager" }}
					scope={scope}
					initial={initial}
				/>
			</Activity>,
		);
		await screen.findAllByText("Fresh payroll issue");
		await act(async () => late.resolve(ready("Late hidden read")));
		expect(screen.queryByText("Late hidden read")).toBeNull();
	});
	it("admits one refresh while a read is pending", async () => {
		const late = deferred<TodayArrival>();
		harness.read.mockReturnValueOnce(late.promise);
		render(
			<TodayWorkspace
				initialEmployee={{ id: "employee-a", role: "manager" }}
				scope={scope}
				initial={ready()}
			/>,
		);
		act(() => {
			void harness.refresh?.();
			void harness.refresh?.();
		});
		expect(harness.read).toHaveBeenCalledTimes(1);
		await act(async () => late.resolve(ready()));
		await waitFor(() => expect(screen.queryByText(/Refreshing briefing/)).toBeNull());
	});
	it("retains results when the shell's RSC refresh supplies new props during the registered read", async () => {
		const late = deferred<TodayArrival>();
		harness.read.mockReturnValue(late.promise);
		const view = render(
			<TodayWorkspace
				initialEmployee={{ id: "employee-a", role: "manager" }}
				scope={scope}
				initial={ready()}
			/>,
		);
		act(() => {
			void harness.refresh?.();
		});
		view.rerender(
			<TodayWorkspace
				initialEmployee={{ id: "employee-a", role: "manager" }}
				scope={{ ...scope }}
				initial={ready("Server refresh snapshot")}
			/>,
		);
		expect(screen.getAllByText("Known payroll issue")).toHaveLength(2);
		await act(async () => late.resolve(ready("Current registered snapshot")));
		expect(screen.getAllByText("Current registered snapshot")).toHaveLength(2);
	});
});
