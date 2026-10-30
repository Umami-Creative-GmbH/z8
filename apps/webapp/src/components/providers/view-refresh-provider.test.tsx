/* @vitest-environment jsdom */

import {
	QueryClient,
	QueryClientProvider,
	useQuery,
} from "@tanstack/react-query";
import {
	act,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { useState } from "react";
import useSWR, { SWRConfig } from "swr";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
	DashboardWidgetData,
	DashboardWidgetSnapshot,
} from "@/components/dashboard/dashboard-types";
import { useDashboardWidget } from "@/components/dashboard/use-dashboard-widget";
import { HeaderRefreshButton } from "@/components/header-refresh-button";
import { useServerDataState } from "@/hooks/use-server-data-state";
import { useViewRefresh, ViewRefreshProvider } from "./view-refresh-provider";

const mocks = vi.hoisted(() => ({ refresh: vi.fn(), error: vi.fn() }));
vi.mock("next/navigation", () => ({
	useRouter: () => ({ refresh: mocks.refresh }),
}));
vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));
vi.mock("sonner", () => ({ toast: { error: mocks.error } }));
vi.mock("@/hooks/use-organization", () => ({
	useOrganization: () => ({
		userId: "user-a",
		organizationId: "org-a",
		role: "manager",
		isLoading: false,
	}),
}));

function setup(content: React.ReactNode) {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false, staleTime: Infinity } },
	});
	const inactive = vi.fn(async () => "other route");
	client.setQueryDefaults(["inactive"], { queryFn: inactive });
	client.setQueryData(["inactive"], "cached");
	render(
		<QueryClientProvider client={client}>
			<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
				<ViewRefreshProvider>
					<HeaderRefreshButton />
					{content}
				</ViewRefreshProvider>
			</SWRConfig>
		</QueryClientProvider>,
	);
	return { client, inactive };
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe("View refresh", () => {
	it("starts server refresh while independent custom data is still pending", async () => {
		let finish!: () => void;
		const pending = new Promise<void>((resolve) => {
			finish = resolve;
		});
		function View() {
			useViewRefresh(() => pending);
			return (
				<input
					aria-label="Pending refresh draft"
					defaultValue="Prepared edit"
				/>
			);
		}
		setup(<View />);
		const button = screen.getByRole("button", { name: "Refresh data" });
		fireEvent.click(button);
		try {
			await waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1));
			expect(button.hasAttribute("disabled")).toBe(true);
			expect(
				(screen.getByLabelText("Pending refresh draft") as HTMLInputElement)
					.value,
			).toBe("Prepared edit");
		} finally {
			await act(async () => finish());
		}
		await waitFor(() => expect(button.hasAttribute("disabled")).toBe(false));
	});
	it("shares an active client read instead of cancelling it and starting the same dataset again", async () => {
		const pending: Array<(value: string) => void> = [];
		const load = vi
			.fn()
			.mockResolvedValueOnce("Old status")
			.mockImplementation(
				() =>
					new Promise<string>((resolve) => {
						pending.push(resolve);
					}),
			);
		function View() {
			const status = useQuery({ queryKey: ["job-status"], queryFn: load });
			return (
				<>
					<p>{status.data}</p>
					<button type="button" onClick={() => void status.refetch()}>
						Check job
					</button>
				</>
			);
		}
		setup(<View />);
		await screen.findByText("Old status");
		fireEvent.click(screen.getByRole("button", { name: "Check job" }));
		await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
		fireEvent.click(screen.getByRole("button", { name: "Refresh data" }));
		await act(async () => Promise.resolve());
		await act(async () => {
			pending.forEach((finish) => { finish("Accepted status"); });
		});
		await screen.findByText("Accepted status");
		expect(load).toHaveBeenCalledTimes(2);
		await waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1));
	});
	it("accepts newer server props after a local retry and cancels the older pending GET without losing drafts", async () => {
		type Snapshot = DashboardWidgetSnapshot<DashboardWidgetData["quick-stats"]>;
		const snapshot = (hours: number, updatedAt: number): Snapshot => ({
			scope: { userId: "user-a", organizationId: "org-a" },
			updatedAt,
			result: {
				success: true,
				data: {
					thisWeek: { actual: hours, expected: 40, expectedToDate: 8 },
					thisMonth: { actual: hours, expected: 160, expectedToDate: 8 },
				},
			},
		});
		const now = Date.now();
		let finish!: (response: Response) => void;
		let pendingSignal: AbortSignal | undefined;
		const request = vi
			.fn()
			.mockResolvedValueOnce(Response.json(snapshot(2, now + 1)))
			.mockImplementationOnce((_url: string, options: RequestInit) => {
				pendingSignal = options.signal ?? undefined;
				return new Promise<Response>((resolve) => {
					finish = resolve;
				});
			});
		vi.stubGlobal("fetch", request);
		function View({ saved }: { saved: Snapshot }) {
			const widget = useDashboardWidget("quick-stats", saved);
			return (
				<>
					<input aria-label="Dashboard draft" defaultValue="" />
					<p>Hours: {widget.data?.thisWeek.actual}</p>
					<button type="button" onClick={() => void widget.refetch()}>
						Retry widget
					</button>
				</>
			);
		}
		const client = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});
		function Frame({ saved }: { saved: Snapshot }) {
			return (
				<QueryClientProvider client={client}>
					<SWRConfig value={{ provider: () => new Map() }}>
						<ViewRefreshProvider>
							<HeaderRefreshButton />
							<View saved={saved} />
						</ViewRefreshProvider>
					</SWRConfig>
				</QueryClientProvider>
			);
		}
		const view = render(<Frame saved={snapshot(1, now)} />);
		expect(request).not.toHaveBeenCalled();
		fireEvent.change(screen.getByLabelText("Dashboard draft"), {
			target: { value: "Unsaved layout note" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Retry widget" }));
		await screen.findByText("Hours: 2");
		// TanStack's client data clock is deliberately newer than the next server snapshot.
		client.setQueryData(
			["dashboard", "widget", "quick-stats", "user-a", "org-a"],
			snapshot(2, now + 1),
			{ updatedAt: now + 86_400_000 },
		);
		fireEvent.click(screen.getByRole("button", { name: "Retry widget" }));
		await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
		fireEvent.click(screen.getByRole("button", { name: "Refresh data" }));
		await waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1));
		expect(pendingSignal?.aborted).toBe(true);
		view.rerender(<Frame saved={snapshot(3, now + 2)} />);
		await screen.findByText("Hours: 3");
		await act(async () => {
			finish(Response.json(snapshot(99, now + 3)));
		});
		expect(screen.getByText("Hours: 3")).toBeTruthy();
		expect(
			(screen.getByLabelText("Dashboard draft") as HTMLInputElement).value,
		).toBe("Unsaved layout note");
		expect(request).toHaveBeenCalledTimes(2);
		expect(
			client.getQueryData<Snapshot>([
				"dashboard",
				"widget",
				"quick-stats",
				"user-a",
				"org-a",
			])?.result,
		).toEqual(snapshot(3, now + 2).result);
		vi.unstubAllGlobals();
	});
	it("refreshes server, active query, SWR and manual data without resetting view state or drafts", async () => {
		const query = vi
			.fn()
			.mockResolvedValueOnce("old query")
			.mockResolvedValue("new query");
		const swr = vi
			.fn()
			.mockResolvedValueOnce("old SWR")
			.mockResolvedValue("new SWR");
		function View() {
			const [year, setYear] = useState("2027");
			const [manual, setManual] = useState("old manual");
			const data = useQuery({ queryKey: ["visible"], queryFn: query });
			const { data: swrData } = useSWR("visible-swr", swr);
			useViewRefresh(async () => {
				setManual("new manual");
			});
			return (
				<>
					<select
						aria-label="Year"
						value={year}
						onChange={(e) => setYear(e.target.value)}
					>
						<option>2027</option>
						<option>2028</option>
					</select>
					<input aria-label="Draft" defaultValue="" />
					<p>{data.data}</p>
					<p>{swrData}</p>
					<p>{manual}</p>
				</>
			);
		}
		const { inactive } = setup(<View />);
		await screen.findByText("old query");
		await screen.findByText("old SWR");
		fireEvent.change(screen.getByLabelText("Year"), {
			target: { value: "2028" },
		});
		fireEvent.change(screen.getByLabelText("Draft"), {
			target: { value: "Unsaved note" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Refresh data" }));
		await screen.findByText("new query");
		await screen.findByText("new SWR");
		await screen.findByText("new manual");
		await waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1));
		expect((screen.getByLabelText("Year") as HTMLSelectElement).value).toBe(
			"2028",
		);
		expect((screen.getByLabelText("Draft") as HTMLInputElement).value).toBe(
			"Unsaved note",
		);
		expect(inactive).not.toHaveBeenCalled();
	});

	it("stays busy until manual data finishes and prevents duplicate refresh clicks", async () => {
		let finish!: () => void;
		const pending = new Promise<void>((resolve) => {
			finish = resolve;
		});
		const refresh = vi.fn(() => pending);
		function View() {
			useViewRefresh(refresh);
			return null;
		}
		setup(<View />);
		const button = screen.getByRole("button", { name: "Refresh data" });
		fireEvent.click(button);
		fireEvent.click(button);
		await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
		expect(button.getAttribute("aria-busy")).toBe("true");
		expect(button.hasAttribute("disabled")).toBe(true);
		await act(async () => finish());
		await waitFor(() => expect(button.hasAttribute("disabled")).toBe(false));
		expect(mocks.refresh).toHaveBeenCalledTimes(1);
	});

	it("reports failures while keeping existing content and permitting a retry", async () => {
		function View() {
			useViewRefresh(async () => {
				throw new Error("Network failure");
			});
			return <p>Existing data</p>;
		}
		setup(<View />);
		const button = screen.getByRole("button", { name: "Refresh data" });
		fireEvent.click(button);
		await waitFor(() => expect(mocks.error).toHaveBeenCalledTimes(1));
		expect(screen.getByText("Existing data")).toBeTruthy();
		await waitFor(() => expect(button.hasAttribute("disabled")).toBe(false));
	});

	it("does not refresh a different route opened while data is pending", async () => {
		let finish!: () => void;
		const pending = new Promise<void>((resolve) => {
			finish = resolve;
		});
		function View() {
			useViewRefresh(() => pending);
			return null;
		}
		setup(<View />);
		fireEvent.click(screen.getByRole("button", { name: "Refresh data" }));
		window.history.pushState(null, "", "/another-view");
		await act(async () => finish());
		await waitFor(() =>
			expect(
				screen
					.getByRole("button", { name: "Refresh data" })
					.hasAttribute("disabled"),
			).toBe(false),
		);
		expect(mocks.refresh).not.toHaveBeenCalled();
		window.history.replaceState(null, "", "/");
	});

	it("accepts fresh saved data without replacing an open draft", () => {
		function View({ saved }: { saved: string[] }) {
			const [items] = useServerDataState(saved);
			const [draft, setDraft] = useState("");
			return (
				<>
					<p>{items.join(", ")}</p>
					<input
						aria-label="Draft"
						value={draft}
						onChange={(e) => setDraft(e.target.value)}
					/>
				</>
			);
		}
		const { rerender } = render(<View saved={["Old vehicle"]} />);
		fireEvent.change(screen.getByLabelText("Draft"), {
			target: { value: "Unsaved vehicle" },
		});
		rerender(<View saved={["Updated vehicle"]} />);
		expect(screen.getByText("Updated vehicle")).toBeTruthy();
		expect((screen.getByLabelText("Draft") as HTMLInputElement).value).toBe(
			"Unsaved vehicle",
		);
	});
});
