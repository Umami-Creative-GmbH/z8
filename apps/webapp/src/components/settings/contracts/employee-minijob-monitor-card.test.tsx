/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	getEmployeeMinijobMonitorAction: vi.fn(),
	recordMinijobExternalOffsetAction: vi.fn(),
	voidMinijobExternalOffsetAction: vi.fn(),
	toastSuccess: vi.fn(),
	toastError: vi.fn(),
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: Record<string, unknown>) =>
			Object.entries(params ?? {}).reduce(
				(text, [k, v]) => text.replaceAll(`{${k}}`, String(v)),
				fallback,
			),
	}),
	useTolgee: () => ({ getLanguage: () => "en" }),
}));

vi.mock("sonner", () => ({
	toast: { success: mocks.toastSuccess, error: mocks.toastError },
}));

vi.mock("@/app/[locale]/(app)/settings/employees/minijob-actions", () => ({
	getEmployeeMinijobMonitorAction: mocks.getEmployeeMinijobMonitorAction,
	recordMinijobExternalOffsetAction: mocks.recordMinijobExternalOffsetAction,
	voidMinijobExternalOffsetAction: mocks.voidMinijobExternalOffsetAction,
}));

const { EmployeeMinijobMonitorCard } = await import("./employee-minijob-monitor-card");
const { MINIJOB_REVIEWS_QUERY_KEY } = await import("./minijob-query-keys");

const EMPLOYEE_ID = "00000000-0000-4000-8000-000000000001";

function renderCard() {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return {
		client,
		...render(
			<QueryClientProvider client={client}>
				<EmployeeMinijobMonitorCard employeeId={EMPLOYEE_ID} />
			</QueryClientProvider>,
		),
	};
}

/** Reviews & Conflicts' cached exceedances, as that tab keys them. */
const REVIEWS_KEY = [...MINIJOB_REVIEWS_QUERY_KEY, "org-1", false];

const fullMonth = {
	month: "2026-11",
	isMinijob: true,
	tier: "exceeded",
	rollingTier: "ok",
	usedPercent: 116,
	rollingUsedPercent: 9,
	earnedCents: 60_000,
	plannedCents: 5_000,
	externalCents: 5_000,
	totalCents: 70_000,
	capCents: 60_300,
	doubleCapCents: 120_600,
	rollingTotalCents: 70_000,
	rollingCapCents: 723_600,
	rollingExcludedCents: 0,
	missingWageMinutes: 0,
	exceedance: { status: "unacknowledged", acknowledgeable: true },
};

describe("EmployeeMinijobMonitorCard (#1989)", () => {
	afterEach(cleanup);
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("shows org admins the amounts against the monthly limit and the exceedance status", async () => {
		mocks.getEmployeeMinijobMonitorAction.mockResolvedValue({
			success: true,
			data: {
				audience: "full",
				applies: true,
				currentMonth: "2026-11",
				months: [fullMonth],
				externalOffsets: [],
			},
		});

		renderCard();

		expect(await screen.findByText("Minijob earnings limit")).toBeTruthy();
		expect(screen.getByText("Over limit")).toBeTruthy();
		expect(screen.getByText(/€700\.00 of €603\.00/)).toBeTruthy();
		expect(screen.getByText("Not documented")).toBeTruthy();
		expect(screen.getByText("Earnings from other Minijobs")).toBeTruthy();
	});

	it("shows scoped managers the tier only, without amounts or the offset editor", async () => {
		mocks.getEmployeeMinijobMonitorAction.mockResolvedValue({
			success: true,
			data: {
				audience: "restricted",
				applies: true,
				currentMonth: "2026-11",
				months: [{ month: "2026-11", isMinijob: true, tier: "critical", rollingTier: "ok" }],
			},
		});

		const { container } = renderCard();

		expect(await screen.findByText("Close to limit")).toBeTruthy();
		expect(container.textContent).not.toMatch(/€|EUR|%/);
		expect(screen.queryByText("Earnings from other Minijobs")).toBeNull();
		expect(screen.queryByText("Exceedance")).toBeNull();
	});

	it("renders nothing for employees without Minijob terms", async () => {
		mocks.getEmployeeMinijobMonitorAction.mockResolvedValue({
			success: true,
			data: { audience: "restricted", applies: false, currentMonth: "2026-11", months: [] },
		});

		const { container } = renderCard();

		await waitFor(() => expect(mocks.getEmployeeMinijobMonitorAction).toHaveBeenCalled());
		expect(container.textContent).toBe("");
	});

	it("records external Minijob earnings in cents for whole months", async () => {
		mocks.getEmployeeMinijobMonitorAction.mockResolvedValue({
			success: true,
			data: {
				audience: "full",
				applies: true,
				currentMonth: "2026-11",
				months: [fullMonth],
				externalOffsets: [],
			},
		});
		mocks.recordMinijobExternalOffsetAction.mockResolvedValue({
			success: true,
			data: { id: "o1" },
		});

		const { container, client } = renderCard();
		client.setQueryData(REVIEWS_KEY, []);
		fireEvent.click(await screen.findByRole("button", { name: /Add earnings/ }));
		const input = (name: string) =>
			container.querySelector(`input[name="${name}"]`) as HTMLInputElement;
		fireEvent.change(input("fromMonth"), { target: { value: "2026-10" } });
		fireEvent.change(input("amountEuro"), { target: { value: "120.5" } });
		fireEvent.change(input("note"), { target: { value: "Payslip" } });
		fireEvent.click(screen.getByRole("button", { name: /Save earnings/ }));

		await waitFor(() =>
			expect(mocks.recordMinijobExternalOffsetAction).toHaveBeenCalledWith({
				employeeId: EMPLOYEE_ID,
				fromMonth: "2026-10",
				lastMonth: null,
				amountCents: 12_050,
				sourceEmployer: null,
				note: "Payslip",
			}),
		);
		// The month's exceedance may appear or go away in Reviews & Conflicts.
		await waitFor(() => expect(client.getQueryState(REVIEWS_KEY)?.isInvalidated).toBe(true));
	});

	it("voids external Minijob earnings and refreshes Reviews & Conflicts", async () => {
		mocks.getEmployeeMinijobMonitorAction.mockResolvedValue({
			success: true,
			data: {
				audience: "full",
				applies: true,
				currentMonth: "2026-11",
				months: [fullMonth],
				externalOffsets: [
					{
						id: "o1",
						fromMonth: "2026-10",
						lastMonth: null,
						amountCents: 12_050,
						currency: "EUR",
						sourceEmployer: null,
						note: "Payslip",
						createdAt: new Date("2026-10-01T00:00:00Z"),
					},
				],
			},
		});
		mocks.voidMinijobExternalOffsetAction.mockResolvedValue({ success: true, data: { id: "o1" } });

		const { client } = renderCard();
		client.setQueryData(REVIEWS_KEY, []);
		fireEvent.click(await screen.findByRole("button", { name: /^Void$/ }));
		fireEvent.change(screen.getByRole("textbox", { name: "Why void these earnings?" }), {
			target: { value: "Typo" },
		});
		fireEvent.click(screen.getByRole("button", { name: /^Void$/ }));

		await waitFor(() =>
			expect(mocks.voidMinijobExternalOffsetAction).toHaveBeenCalledWith({
				employeeId: EMPLOYEE_ID,
				offsetId: "o1",
				reason: "Typo",
			}),
		);
		await waitFor(() => expect(client.getQueryState(REVIEWS_KEY)?.isInvalidated).toBe(true));
	});
});
