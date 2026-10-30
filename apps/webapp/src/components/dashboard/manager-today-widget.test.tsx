/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	act,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mapManagerTodaySummary } from "./manager-today-summary";

const { readMock, context } = vi.hoisted(() => ({
	readMock: vi.fn(),
	context: {
		userId: "user-a",
		organizationId: "org-a",
		role: "manager",
		isLoading: false,
	},
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback?: string, params?: Record<string, string>) =>
			Object.entries(params ?? {}).reduce(
				(message, [key, value]) => message.replace(`{${key}}`, value),
				fallback ?? _key,
			),
	}),
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

vi.mock("@/hooks/use-organization", () => ({
	useOrganization: () => context,
}));

import { ManagerTodayWidget } from "./manager-today-widget";
import { QuickStatsWidget } from "./quick-stats-widget";

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
	afterEach(() => vi.unstubAllGlobals());
	beforeEach(() => {
		vi.clearAllMocks();
		context.role = "manager";
		vi.stubGlobal(
			"fetch",
			vi.fn(async () =>
				Response.json({
					scope: { userId: "user-a", organizationId: "org-a" },
					updatedAt: Date.now(),
					result: { success: true, data: await readMock() },
				}),
			),
		);
	});

	it("uses the authorized server snapshot immediately without an initial action request", () => {
		const client = createTestQueryClient();
		render(
			<QueryClientProvider client={client}>
				<ManagerTodayWidget
					initialSnapshot={{
						scope: { userId: "user-a", organizationId: "org-a" },
						updatedAt: Date.now(),
						result: {
							success: true,
							data: {
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
							},
						},
					}}
				/>
			</QueryClientProvider>,
		);
		expect(screen.getByTestId("manager-today-metrics")).toBeTruthy();
		expect(readMock).not.toHaveBeenCalled();
		expect(fetch).not.toHaveBeenCalled();
	});
	it("keeps successful Manager Today visible while work hours is pending, then exposes a local retry on failure", async () => {
		let fail!: (error: Error) => void;
		const request = vi
			.fn()
			.mockImplementationOnce(
				() =>
					new Promise((_resolve, reject) => {
						fail = reject;
					}),
			)
			.mockResolvedValueOnce(
				Response.json({
					scope: { userId: "user-a", organizationId: "org-a" },
					updatedAt: Date.now(),
					result: {
						success: true,
						data: {
							thisWeek: { actual: 4, expected: 40, expectedToDate: 4 },
							thisMonth: { actual: 10, expected: 160, expectedToDate: 10 },
						},
					},
				}),
			);
		vi.stubGlobal("fetch", request);
		const client = createTestQueryClient();
		const manager = {
			scope: { userId: "user-a", organizationId: "org-a" },
			updatedAt: Date.now(),
			result: {
				success: true as const,
				data: {
					role: "manager" as const,
					summary: {
						criticalIssues: 2,
						openApprovals: 5,
						attendanceExceptions: 3,
						absencesToday: 1,
						coverageRisks: 7,
						overtimeWarnings: 11,
						payrollIssues: 13,
					},
				},
			},
		};
		render(
			<QueryClientProvider client={client}>
				<ManagerTodayWidget initialSnapshot={manager} />
				<QuickStatsWidget />
			</QueryClientProvider>,
		);
		await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
		expect(screen.getByTestId("manager-today-metrics")).toBeTruthy();
		await act(async () => {
			fail(new Error("Fixture work hours failure"));
		});
		expect(await screen.findByRole("alert")).toBeTruthy();
		expect(screen.getByTestId("manager-today-metrics")).toBeTruthy();
		fireEvent.click(
			screen.getByRole("button", { name: /Retry Time Tracking/i }),
		);
		expect(await screen.findByText("4.0h of 40.0h (10%)")).toBeTruthy();
		expect(request).toHaveBeenCalledTimes(2);
		expect(
			request.mock.calls.every(
				([url]) => url === "/api/dashboard/widgets/quick-stats",
			),
		).toBe(true);
	});
	it("hides a cached manager summary immediately when shared membership role is revoked", async () => {
		readMock.mockResolvedValue({
			role: "manager",
			summary: {
				criticalIssues: 0,
				openApprovals: 1,
				attendanceExceptions: 0,
				absencesToday: 0,
				coverageRisks: 0,
				overtimeWarnings: 0,
				payrollIssues: 0,
			},
		});
		const client = createTestQueryClient();
		const view = renderManagerTodayWidget(client);
		await screen.findByTestId("manager-today-metrics");
		context.role = "employee";
		view.rerender(
			<QueryClientProvider client={client}>
				<ManagerTodayWidget />
			</QueryClientProvider>,
		);
		expect(screen.queryByTestId("manager-today-metrics")).toBeNull();
	});
	it("renders a failed server manager snapshot beside successful work hours and retries only the failed dataset", async () => {
		const scope = { userId: "user-a", organizationId: "org-a" };
		readMock.mockResolvedValue({ role: "manager", summary: { criticalIssues: 0, openApprovals: 1, attendanceExceptions: 0, absencesToday: 0, coverageRisks: 0, overtimeWarnings: 0, payrollIssues: 0 } });
		render(<QueryClientProvider client={createTestQueryClient()}><ManagerTodayWidget initialSnapshot={{ scope, updatedAt: Date.now(), result: { success: false, error: "Fixture briefing failure" } }} /><QuickStatsWidget initialSnapshot={{ scope, updatedAt: Date.now(), result: { success: true, data: {
			thisWeek: { actual: 4, expected: 40, expectedToDate: 4 }, thisMonth: { actual: 10, expected: 160, expectedToDate: 10 },
		} } }} /></QueryClientProvider>);
		expect(screen.getByRole("alert")).toBeTruthy();
		expect(screen.queryByTestId("manager-today-metrics")).toBeNull();
		expect(screen.getByText("4.0h of 40.0h (10%)")).toBeTruthy();
		expect(fetch).not.toHaveBeenCalled();
		fireEvent.click(screen.getByRole("button", { name: "Retry Manager Today" }));
		await screen.findByTestId("manager-today-metrics");
		expect(fetch).toHaveBeenCalledTimes(1);
		expect(vi.mocked(fetch).mock.calls[0][0]).toBe("/api/dashboard/widgets/manager-today");
		expect(screen.getByText("4.0h of 40.0h (10%)")).toBeTruthy();
	});

	it("renders briefing counts for managers", async () => {
		readMock.mockResolvedValue({
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
		expect(
			screen.getByRole("link", { name: /open brief/i }).getAttribute("href"),
		).toBe("/today");
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
		readMock.mockResolvedValue({
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
		context.role = "employee";
		readMock.mockResolvedValue({ role: "employee", summary: null });

		const { container } = renderManagerTodayWidget();

		await waitFor(() => expect(readMock).toHaveBeenCalledTimes(1));
		await waitFor(() => expect(container.firstChild).toBeNull());
	});

	it("shows inline error copy when manager briefing counts fail after authorization", async () => {
		readMock.mockResolvedValue({
			role: "manager",
			summary: null,
			error: "Manager Today counts could not be loaded.",
		});

		renderManagerTodayWidget();

		expect(await screen.findByText("Manager Today")).toBeTruthy();
		expect(
			await screen.findByText("Failed to load manager briefing counts."),
		).toBeTruthy();
	});

	it("shows inline error copy on query failure when a manager role is already known", async () => {
		const queryClient = createTestQueryClient();
		readMock.mockRejectedValue(new Error("Failed"));

		renderManagerTodayWidget(queryClient);

		expect(await screen.findByText("Manager Today")).toBeTruthy();
		expect(
			await screen.findByText("Failed to load manager briefing counts."),
		).toBeTruthy();
	});
});
