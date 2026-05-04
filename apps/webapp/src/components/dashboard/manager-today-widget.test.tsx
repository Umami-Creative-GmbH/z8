/* @vitest-environment jsdom */

import { render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mapManagerTodaySummary } from "./manager-today-summary";

const { getManagerTodaySummaryMock } = vi.hoisted(() => ({
	getManagerTodaySummaryMock: vi.fn(),
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback?: string) => fallback ?? _key }),
}));

vi.mock("@/navigation", () => ({
	Link: ({ children, href }: { children: ReactNode; href: string }) => (
		<a href={href}>{children}</a>
	),
}));

vi.mock("@dnd-kit/sortable", () => ({
	useSortable: () => ({
		attributes: {},
		listeners: {},
		setNodeRef: vi.fn(),
		transform: null,
		transition: undefined,
		isDragging: false,
	}),
}));

vi.mock("@dnd-kit/utilities", () => ({
	CSS: { Translate: { toString: () => undefined } },
}));

vi.mock("./actions", () => ({
	getManagerTodaySummary: getManagerTodaySummaryMock,
}));

import { ManagerTodayWidget } from "./manager-today-widget";

function createTestQueryClient() {
	return new QueryClient({
		defaultOptions: {
			queries: { retry: false },
		},
	});
}

function renderManagerTodayWidget(queryClient = createTestQueryClient()) {
	return render(
		<QueryClientProvider client={queryClient}>
			<ManagerTodayWidget />
		</QueryClientProvider>,
	);
}

describe("mapManagerTodaySummary", () => {
	it("maps briefing summary counts into dashboard metrics", () => {
		expect(
			mapManagerTodaySummary({
				criticalIssues: 2,
				openApprovals: 5,
				attendanceExceptions: 3,
				absencesToday: 4,
				coverageRisks: 7,
				overtimeWarnings: 11,
				payrollIssues: 13,
			}),
		).toEqual({
			critical: 2,
			approvals: 5,
			clockIns: 3,
			risks: 31,
			allClear: false,
		});
	});

	it("reports all clear when every displayed count is zero", () => {
		expect(
			mapManagerTodaySummary({
				criticalIssues: 0,
				openApprovals: 0,
				attendanceExceptions: 0,
				absencesToday: 4,
				coverageRisks: 0,
				overtimeWarnings: 0,
				payrollIssues: 0,
			}).allClear,
		).toBe(true);
	});
});

describe("ManagerTodayWidget", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("renders briefing counts for managers", async () => {
		getManagerTodaySummaryMock.mockResolvedValue({
			role: "manager",
			summary: {
				criticalIssues: 2,
				openApprovals: 5,
				attendanceExceptions: 3,
				absencesToday: 1,
				coverageRisks: 7,
				overtimeWarnings: 11,
				payrollIssues: 13,
			},
		});

		renderManagerTodayWidget();

		const metrics = await screen.findByTestId("manager-today-metrics");
		expect(screen.getByText("Manager Today")).toBeTruthy();
		expect(screen.getByRole("link", { name: /open brief/i }).getAttribute("href")).toBe(
			"/today",
		);
		expect(within(metrics).getByText("Critical")).toBeTruthy();
		expect(within(metrics).getByText("2")).toBeTruthy();
		expect(within(metrics).getByText("Approvals")).toBeTruthy();
		expect(within(metrics).getByText("5")).toBeTruthy();
		expect(within(metrics).getByText("Clock-ins")).toBeTruthy();
		expect(within(metrics).getByText("3")).toBeTruthy();
		expect(within(metrics).getByText("Risks")).toBeTruthy();
		expect(within(metrics).getByText("31")).toBeTruthy();
	});

	it("shows all-clear copy for zero displayed counts", async () => {
		getManagerTodaySummaryMock.mockResolvedValue({
			role: "admin",
			summary: {
				criticalIssues: 0,
				openApprovals: 0,
				attendanceExceptions: 0,
				absencesToday: 4,
				coverageRisks: 0,
				overtimeWarnings: 0,
				payrollIssues: 0,
			},
		});

		renderManagerTodayWidget();

		expect(
			await screen.findByText("No manager action is flagged right now."),
		).toBeTruthy();
	});

	it("does not render for employees", async () => {
		getManagerTodaySummaryMock.mockResolvedValue({ role: "employee", summary: null });

		const { container } = renderManagerTodayWidget();

		await waitFor(() => expect(getManagerTodaySummaryMock).toHaveBeenCalledTimes(1));
		await waitFor(() => expect(container.firstChild).toBeNull());
	});

	it("shows inline error copy when manager briefing counts fail after authorization", async () => {
		getManagerTodaySummaryMock.mockResolvedValue({
			role: "manager",
			summary: null,
			error: "Manager Today counts could not be loaded.",
		});

		renderManagerTodayWidget();

		expect(await screen.findByText("Manager Today")).toBeTruthy();
		expect(await screen.findByText("Failed to load manager briefing counts.")).toBeTruthy();
	});

	it("shows inline error copy on query failure when a manager role is already known", async () => {
		const queryClient = createTestQueryClient();
		queryClient.setQueryData(["dashboard", "manager-today", "summary"], {
			role: "manager",
			summary: {
				criticalIssues: 0,
				openApprovals: 0,
				attendanceExceptions: 0,
				absencesToday: 0,
				coverageRisks: 0,
				overtimeWarnings: 0,
				payrollIssues: 0,
			},
		});
		getManagerTodaySummaryMock.mockRejectedValue(new Error("Failed"));

		renderManagerTodayWidget(queryClient);

		expect(await screen.findByText("Manager Today")).toBeTruthy();
		expect(await screen.findByText("Failed to load manager briefing counts.")).toBeTruthy();
	});
});
