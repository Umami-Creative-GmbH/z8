/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import useSWR, { SWRConfig } from "swr";
import { beforeEach, describe, expect, it, vi } from "vitest";
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
	it("refreshes server, active query, SWR and manual data without resetting view state or drafts", async () => {
		const query = vi.fn().mockResolvedValueOnce("old query").mockResolvedValue("new query");
		const swr = vi.fn().mockResolvedValueOnce("old SWR").mockResolvedValue("new SWR");
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
					<select aria-label="Year" value={year} onChange={(e) => setYear(e.target.value)}>
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
		expect((screen.getByLabelText("Year") as HTMLSelectElement).value).toBe("2028");
		expect((screen.getByLabelText("Draft") as HTMLInputElement).value).toBe("Unsaved note");
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
		const pending = new Promise<void>(resolve => { finish = resolve; });
		function View() { useViewRefresh(() => pending); return null; }
		setup(<View />);
		fireEvent.click(screen.getByRole("button", { name: "Refresh data" }));
		window.history.pushState(null, "", "/another-view");
		await act(async () => finish());
		await waitFor(() => expect(screen.getByRole("button", { name: "Refresh data" }).hasAttribute("disabled")).toBe(false));
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
					<input aria-label="Draft" value={draft} onChange={(e) => setDraft(e.target.value)} />
				</>
			);
		}
		const { rerender } = render(<View saved={["Old vehicle"]} />);
		fireEvent.change(screen.getByLabelText("Draft"), {
			target: { value: "Unsaved vehicle" },
		});
		rerender(<View saved={["Updated vehicle"]} />);
		expect(screen.getByText("Updated vehicle")).toBeTruthy();
		expect((screen.getByLabelText("Draft") as HTMLInputElement).value).toBe("Unsaved vehicle");
	});
});
