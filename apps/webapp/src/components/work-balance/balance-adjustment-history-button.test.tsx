// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TolgeeProvider } from "@tolgee/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { UserPreferencesProvider } from "@/components/providers/user-preferences-provider";
import { createTestTolgee } from "@/test/render-with-translations";
import { BalanceAdjustmentHistoryButton } from "./balance-adjustment-history-button";

const transport = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("@/app/[locale]/(app)/settings/employees/work-balance-actions", () => ({
	getEmployeeWorkBalanceSectionAction: transport.read,
	cancelBalanceAdjustmentAction: vi.fn(),
	recordOvertimePayoutAction: vi.fn(),
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
});
afterEach(() => {
	cleanup();
	for (const client of clients.splice(0)) client.clear();
});

async function openHistory() {
	const client = new QueryClient({
		defaultOptions: { queries: { gcTime: 0, retryDelay: 0 } },
	});
	clients.push(client);
	render(
		<NextIntlClientProvider locale="en" messages={{}} timeZone="Europe/Berlin">
			<TolgeeProvider tolgee={createTestTolgee()}>
				<UserPreferencesProvider timezone="Europe/Berlin">
					<QueryClientProvider client={client}>
						<BalanceAdjustmentHistoryButton employeeId="employee-a" />
					</QueryClientProvider>
				</UserPreferencesProvider>
			</TolgeeProvider>
		</NextIntlClientProvider>,
	);
	await userEvent.setup().click(screen.getByRole("button", { name: "Balance adjustments" }));
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
