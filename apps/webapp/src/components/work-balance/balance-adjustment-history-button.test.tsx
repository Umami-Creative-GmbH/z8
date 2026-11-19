// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TolgeeProvider } from "@tolgee/react";
import { NextIntlClientProvider } from "next-intl";
import { Activity, type ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { UserPreferencesProvider } from "@/components/providers/user-preferences-provider";
import { useEmployeeWorkBalance } from "@/components/settings/work-balance/use-employee-work-balance";
import { createTestTolgee } from "@/test/render-with-translations";
import { BalanceAdjustmentHistoryButton } from "./balance-adjustment-history-button";

const transport = vi.hoisted(() => ({ read: vi.fn(), record: vi.fn() }));
vi.mock("@/app/[locale]/(app)/settings/employees/work-balance-actions", () => ({
	getEmployeeWorkBalanceSectionAction: transport.read,
	cancelBalanceAdjustmentAction: vi.fn(),
	recordOvertimePayoutAction: transport.record,
	setOpeningBalanceAction: vi.fn(),
}));

const clients: QueryClient[] = [];
const emptySection = {
	success: true,
	data: {
		balance: null,
		adjustments: [],
		today: "2026-11-17",
		timezone: "Europe/Berlin",
		canManage: false,
	},
};

beforeEach(() => {
	transport.read.mockReset();
	transport.record.mockReset();
});
afterEach(() => {
	cleanup();
	for (const client of clients.splice(0)) client.clear();
});

function mountHistory(extra?: ReactNode) {
	const client = new QueryClient({
		defaultOptions: {
			queries: { gcTime: 0, staleTime: 60_000, refetchOnWindowFocus: false, retryDelay: 0 },
		},
	});
	clients.push(client);
	const tolgee = createTestTolgee();
	const tree = (mode: "visible" | "hidden" = "visible") => (
		<NextIntlClientProvider locale="en" messages={{}} timeZone="Europe/Berlin">
			<TolgeeProvider tolgee={tolgee}>
				<UserPreferencesProvider timezone="Europe/Berlin">
					<QueryClientProvider client={client}>
						{extra}
						<Activity mode={mode}>
							<BalanceAdjustmentHistoryButton employeeId="employee-a" />
						</Activity>
					</QueryClientProvider>
				</UserPreferencesProvider>
			</TolgeeProvider>
		</NextIntlClientProvider>
	);
	const view = render(tree());
	return { client, view, tree };
}
async function openHistory() {
	const mounted = mountHistory();
	await userEvent.setup().click(screen.getByRole("button", { name: "Balance adjustments" }));
	return mounted;
}
function records(reason: string) {
	return {
		...emptySection,
		data: {
			...emptySection.data,
			adjustments: [
				{
					id: reason,
					kind: "opening_balance",
					day: "2026-11-01",
					minutes: 120,
					reason,
					recordedAt: "2026-11-01T08:00:00Z",
					recordedBy: { userId: "actor-a", name: "Synthetic Administrator" },
					cancellation: null,
				},
			],
		},
	};
}

it("retries a failed history read in the same open dialog and shows the recovered records", async () => {
	transport.read.mockRejectedValue(new Error("Synthetic transport failure"));
	await openHistory();
	expect(await screen.findByRole("alert")).toBeTruthy();
	expect(screen.queryByText("No balance adjustments yet.")).toBeNull();
	const retry = screen.getByRole("button", { name: "Retry" });
	const previousCalls = transport.read.mock.calls.length;
	let finish: (value: unknown) => void = () => {};
	transport.read.mockImplementation(() => new Promise((resolve) => (finish = resolve)));
	await userEvent.setup().click(retry);
	try {
		await waitFor(() => expect(transport.read).toHaveBeenCalledTimes(previousCalls + 1));
		expect(screen.getByLabelText("Loading balance adjustments")).toBeTruthy();
		expect(screen.getByRole("dialog")).toBeTruthy();
	} finally {
		await act(async () =>
			finish({
				...emptySection,
				data: {
					...emptySection.data,
					adjustments: [
						{
							id: "adjustment-a",
							kind: "opening_balance",
							day: "2026-11-01",
							minutes: 120,
							reason: "Carried balance correction",
							recordedAt: "2026-11-01T08:00:00Z",
							recordedBy: { userId: "actor-a", name: "Synthetic Administrator" },
							cancellation: null,
						},
					],
				},
			}),
		);
	}
	expect(await screen.findByText("Carried balance correction")).toBeTruthy();
	expect(screen.queryByRole("alert")).toBeNull();
	expect(screen.getByRole("dialog")).toBeTruthy();
});

it("distinguishes an empty successful history and returns focus on Escape", async () => {
	transport.read.mockResolvedValue(emptySection);
	await openHistory();
	expect(await screen.findByText("No balance adjustments yet.")).toBeTruthy();
	expect(screen.queryByRole("alert")).toBeNull();
	expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
	await userEvent.setup().keyboard("{Escape}");
	await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
	expect(document.activeElement).toBe(screen.getByRole("button", { name: "Balance adjustments" }));
});

it("retains the canonical access refusal without offering an ineffective read Retry", async () => {
	transport.read.mockResolvedValue({
		success: false,
		code: "AuthorizationError",
		error: "Private refusal detail",
	});
	await openHistory();
	expect((await screen.findByRole("alert")).textContent).toContain("employees you manage");
	expect(screen.queryByText("Private refusal detail")).toBeNull();
	expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
	expect(transport.read).toHaveBeenCalledTimes(1);
});

it("discards a closed opening's late result while a replacement history read is pending", async () => {
	let finishOld: (value: unknown) => void = () => {};
	let finishNew: (value: unknown) => void = () => {};
	transport.read
		.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					finishOld = resolve;
				}),
		)
		.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					finishNew = resolve;
				}),
		);
	await openHistory();
	expect(screen.getByLabelText("Loading balance adjustments")).toBeTruthy();
	await userEvent.setup().keyboard("{Escape}");
	await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
	await userEvent.setup().click(screen.getByRole("button", { name: "Balance adjustments" }));
	await waitFor(() => expect(transport.read).toHaveBeenCalledTimes(2));
	await act(async () => finishOld(records("Retired opening")));
	expect(screen.queryByText("Retired opening")).toBeNull();
	expect(screen.getByLabelText("Loading balance adjustments")).toBeTruthy();
	await act(async () => finishNew(records("Current opening")));
	expect(await screen.findByText("Current opening")).toBeTruthy();
	expect(screen.queryByText("Retired opening")).toBeNull();
});

it("reauthorizes a retained history after Activity hide and reveal", async () => {
	transport.read.mockResolvedValue(records("Before Activity retirement"));
	const { view, tree } = await openHistory();
	expect(await screen.findByText("Before Activity retirement")).toBeTruthy();
	let finish: (value: unknown) => void = () => {};
	transport.read.mockImplementation(
		() =>
			new Promise((resolve) => {
				finish = resolve;
			}),
	);
	view.rerender(tree("hidden"));
	view.rerender(tree("visible"));
	await waitFor(() => expect(transport.read).toHaveBeenCalledTimes(2));
	expect(screen.queryByText("Before Activity retirement")).toBeNull();
	expect(screen.getByLabelText("Loading balance adjustments")).toBeTruthy();
	await act(async () =>
		finish({ success: false, code: "AuthorizationError", error: "Synthetic refusal" }),
	);
	expect((await screen.findByRole("alert")).textContent).toContain("employees you manage");
	expect(screen.queryByText("Before Activity retirement")).toBeNull();
});

function WorkBalanceOwner() {
	const { section, recordPayout } = useEmployeeWorkBalance("employee-a");
	return (
		<>
			<output aria-label="Default work balance adjustments">
				{section.data?.adjustments.length ?? "Loading"}
			</output>
			<button
				type="button"
				onClick={() =>
					recordPayout.mutate({
						day: "2026-11-17",
						hours: 1,
						minutes: 0,
						reason: "Canonical payout",
					})
				}
			>
				Record payout through owner
			</button>
		</>
	);
}

it("preserves employee-prefix mutation refresh for the default section and the open history", async () => {
	const initial = records("Existing opening balance");
	transport.read.mockResolvedValue(initial);
	let finish: (value: unknown) => void = () => {};
	transport.record.mockImplementation(
		() =>
			new Promise((resolve) => {
				finish = resolve;
			}),
	);
	mountHistory(<WorkBalanceOwner />);
	await waitFor(() =>
		expect(screen.getByLabelText("Default work balance adjustments").textContent).toBe("1"),
	);
	await userEvent
		.setup()
		.click(screen.getByRole("button", { name: "Record payout through owner" }));
	await waitFor(() => expect(transport.record).toHaveBeenCalledTimes(1));
	await userEvent.setup().click(screen.getByRole("button", { name: "Balance adjustments" }));
	expect(await screen.findByText("Existing opening balance")).toBeTruthy();
	expect(transport.read).toHaveBeenCalledTimes(2);
	const updated = {
		...initial,
		data: {
			...initial.data,
			adjustments: [
				...initial.data.adjustments,
				{
					...initial.data.adjustments[0],
					id: "payout-a",
					kind: "overtime_payout",
					minutes: -60,
					reason: "Canonical payout",
				},
			],
		},
	};
	transport.read.mockResolvedValue(updated);
	await act(async () => finish({ success: true, data: undefined }));
	await waitFor(() =>
		expect(screen.getByLabelText("Default work balance adjustments").textContent).toBe("2"),
	);
	expect(await screen.findByText("Canonical payout")).toBeTruthy();
	expect(screen.getByText("Existing opening balance")).toBeTruthy();
	expect(transport.read).toHaveBeenCalledTimes(4);
});
