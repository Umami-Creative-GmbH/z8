/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	getShortTermMonitorAction: vi.fn(),
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

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock("@/navigation", () => ({
	Link: ({ children, href }: { children: React.ReactNode; href: string }) => (
		<a href={href}>{children}</a>
	),
}));

vi.mock("@/app/[locale]/(app)/settings/contracts/short-term-actions", () => ({
	getShortTermMonitorAction: mocks.getShortTermMonitorAction,
	recordShortTermPriorEmploymentAction: vi.fn(),
	voidShortTermPriorEmploymentAction: vi.fn(),
}));

const { ShortTermMonitorCard } = await import("./short-term-monitor-card");

function monitorOf(year: number) {
	return {
		employeeId: "emp-1",
		year,
		audience: "restricted",
		applies: true,
		allowance: {
			employeeId: "emp-1",
			year,
			limitKind: "work_days",
			used: 12,
			ownUsed: 12,
			priorEmployerUsed: 0,
			limit: 70,
			remaining: 58,
			tier: "ok",
			usedPercent: 17,
			firstDay: `${year}-03-02`,
			lastDay: `${year}-04-10`,
		},
		findings: [],
		priorEmployment: null,
	};
}

function renderCard() {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return render(
		<QueryClientProvider client={client}>
			<ShortTermMonitorCard organizationId="org-1" employeeId="emp-1" isOrgAdmin={false} />
		</QueryClientProvider>,
	);
}

describe("ShortTermMonitorCard (#1990)", () => {
	afterEach(cleanup);

	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("stays on screen with the year selector while another year loads", async () => {
		mocks.getShortTermMonitorAction.mockImplementation(({ year }: { year?: number }) =>
			year === undefined
				? Promise.resolve({ success: true, data: monitorOf(2026) })
				: new Promise(() => {}),
		);
		renderCard();
		const selector = await screen.findByRole("combobox", { name: "Calendar year" });

		fireEvent.click(selector);
		fireEvent.click(await screen.findByRole("option", { name: "2025" }));

		expect(mocks.getShortTermMonitorAction).toHaveBeenLastCalledWith({
			employeeId: "emp-1",
			year: 2025,
		});
		expect(screen.getByText("Short-term employment")).toBeTruthy();
		expect(screen.getByRole("combobox", { name: "Calendar year" })).toBe(selector);
		expect(selector.textContent).toContain("2025");
		expect(await screen.findByRole("status", { name: "Loading…" })).toBeTruthy();
	});

	it("stays on screen to open last year when only last year applies", async () => {
		mocks.getShortTermMonitorAction.mockImplementation(({ year }: { year?: number }) =>
			Promise.resolve({
				success: true,
				data: year === 2026 ? monitorOf(2026) : notApplicable(2027),
			}),
		);
		renderCard();
		const selector = await screen.findByRole("combobox", { name: "Calendar year" });
		expect(screen.getByText("Not employed short-term in 2027.")).toBeTruthy();

		fireEvent.click(selector);
		fireEvent.click(await screen.findByRole("option", { name: "2026" }));

		expect(mocks.getShortTermMonitorAction).toHaveBeenLastCalledWith({
			employeeId: "emp-1",
			year: 2026,
		});
		expect(selector.textContent).toContain("2026");
		await waitFor(() => expect(screen.queryByText(/Not employed short-term/)).toBeNull());
	});

	it("stays on screen to open next year when only a fixed term agreed for next year applies", async () => {
		// December 2026: a fixed term from 1 January to 31 May 2027 is agreed, and already exceeded.
		const nextYear = {
			...monitorOf(2027),
			allowance: {
				...monitorOf(2027).allowance,
				limitKind: "months",
				used: 151,
				ownUsed: 151,
				limit: 90,
				remaining: 0,
				tier: "exceeded",
				usedPercent: 168,
				firstDay: null,
				lastDay: null,
			},
		};
		mocks.getShortTermMonitorAction.mockImplementation(({ year }: { year?: number }) =>
			Promise.resolve({
				success: true,
				data: year === 2027 ? nextYear : notApplicable(year ?? 2026),
			}),
		);
		renderCard();
		const selector = await screen.findByRole("combobox", { name: "Calendar year" });
		expect(screen.getByText("Not employed short-term in 2026.")).toBeTruthy();

		fireEvent.click(selector);
		fireEvent.click(await screen.findByRole("option", { name: "2027" }));

		expect(selector.textContent).toContain("2027");
		expect(await screen.findByText("Limit exceeded")).toBeTruthy();
		expect(screen.getByText("151")).toBeTruthy();
	});

	it("shows nothing when neither this year, last year nor next year applies", async () => {
		mocks.getShortTermMonitorAction.mockImplementation(({ year }: { year?: number }) =>
			Promise.resolve({ success: true, data: notApplicable(year ?? 2027) }),
		);
		const { container } = renderCard();

		await waitFor(() => {
			expect(mocks.getShortTermMonitorAction).toHaveBeenCalledWith({
				employeeId: "emp-1",
				year: 2026,
			});
			expect(mocks.getShortTermMonitorAction).toHaveBeenCalledWith({
				employeeId: "emp-1",
				year: 2028,
			});
		});
		await waitFor(() => expect(container.innerHTML).toBe(""));
		expect(screen.queryByText("Short-term employment")).toBeNull();
	});

	it("refetches when it mounts again, so changes made in other tabs show at once", async () => {
		mocks.getShortTermMonitorAction.mockResolvedValue({ success: true, data: monitorOf(2026) });
		// The app's 60 s stale time: switching tabs remounts the card within it, and a leaving date
		// or terms change recorded meanwhile must not be hidden behind the cached figures.
		const client = new QueryClient({
			defaultOptions: { queries: { retry: false, staleTime: 60_000 } },
		});
		const card = () => (
			<QueryClientProvider client={client}>
				<ShortTermMonitorCard organizationId="org-1" employeeId="emp-1" isOrgAdmin={false} />
			</QueryClientProvider>
		);
		const { unmount } = render(card());
		await waitFor(() => expect(mocks.getShortTermMonitorAction).toHaveBeenCalledTimes(1));
		unmount();

		render(card());

		await waitFor(() => expect(mocks.getShortTermMonitorAction).toHaveBeenCalledTimes(2));
	});
});

function notApplicable(year: number) {
	return { ...monitorOf(year), applies: false, allowance: null };
}
