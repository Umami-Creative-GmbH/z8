/** @vitest-environment jsdom */
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TolgeeProvider } from "@tolgee/react";
import { act as preactAct } from "preact/test-utils";
import { type ReactNode, useEffect } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { UserPreferencesProvider } from "@/components/providers/user-preferences-provider";
import { ShiftScheduler } from "@/components/scheduling/scheduler/shift-scheduler";
import { ThemeProvider } from "@/components/theme-provider";
import { ApiError } from "@/lib/api-error";
import { QueryProvider } from "@/lib/query/provider";
import { createTestTolgee } from "@/test/render-with-translations";

// Explicit action transport and authenticated caller-context boundary. No internal hook,
// query state, component or scheduler/calendar implementation is replaced or preloaded.
const transport = vi.hoisted(() => ({
	coverage: vi.fn(),
	shifts: vi.fn(),
	templates: vi.fn(),
	compliance: vi.fn(),
	publish: vi.fn(),
	upsert: vi.fn(),
	remove: vi.fn(),
	replace: vi.fn(),
}));
vi.mock("@tanstack/react-query-devtools", () => ({ ReactQueryDevtools: () => null }));
vi.mock("next/navigation", async (importOriginal) => ({
	...(await importOriginal<typeof import("next/navigation")>()),
	useRouter: () => ({ replace: transport.replace, refresh: vi.fn() }),
}));
vi.mock("@/app/[locale]/(app)/scheduling/actions", () => ({
	getShifts: transport.shifts,
	getShiftTemplates: transport.templates,
	getScheduleComplianceSummary: transport.compliance,
	getPendingShiftRequests: async () => ({ success: true, data: [] }),
	getLocationsWithSubareas: async () => ({ success: true, data: [] }),
	suggestStaffingForShift: async () => ({ success: true, data: [] }),
	publishShifts: transport.publish,
	upsertShift: transport.upsert,
	deleteShift: transport.remove,
	approveShiftRequest: vi.fn(),
	rejectShiftRequest: vi.fn(),
}));
vi.mock("@/app/[locale]/(app)/settings/coverage-rules/actions", () => ({
	getTargetHeatmapData: transport.coverage,
}));
vi.mock("@/app/[locale]/(app)/settings/employees/actions", () => ({
	listEmployeesForSelect: async () => ({ success: true, data: { employees: [] } }),
}));
vi.mock("@/app/[locale]/(app)/settings/skills/actions", () => ({
	validateEmployeeForShift: vi.fn(),
}));

const clients: QueryClient[] = [];
const draft = {
	id: "synthetic-shift-a",
	organizationId: "synthetic-org-a",
	employeeId: null,
	status: "draft",
	date: new Date("2026-11-15T23:00:00Z"),
	startTime: "09:00",
	endTime: "17:00",
	templateId: null,
	subareaId: "synthetic-reception",
	recurrenceId: null,
	publishedAt: null,
	publishedBy: null,
	notes: null,
	color: null,
	createdAt: new Date("2026-11-01T00:00:00Z"),
	updatedAt: new Date("2026-11-01T00:00:00Z"),
	createdBy: "synthetic-planner",
	subarea: {
		id: "synthetic-reception",
		name: "Reception",
		location: { id: "synthetic-office", name: "Office" },
	},
};

beforeEach(() => {
	vi.clearAllMocks();
	vi.stubGlobal("matchMedia", () => ({
		matches: false,
		addEventListener() {},
		removeEventListener() {},
	}));
	vi.stubGlobal(
		"ResizeObserver",
		class {
			observe() {}
			unobserve() {}
			disconnect() {}
		},
	);
	transport.shifts.mockResolvedValue({ success: true, data: [draft] });
	transport.templates.mockResolvedValue({ success: true, data: [] });
	transport.compliance.mockResolvedValue({
		success: true,
		data: { summary: { totalFindings: 0 } },
	});
});

afterEach(async () => {
	preactAct(() => cleanup());
	for (const client of clients.splice(0)) client.clear();
	await new Promise((resolve) => setTimeout(resolve, 50));
	vi.unstubAllGlobals();
});

function CaptureProviderClient() {
	const client = useQueryClient();
	useEffect(() => {
		clients.push(client);
	}, [client]);
	return null;
}

function mountPlanner(globalErrors = false) {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
	clients.push(client);
	const withClient = (children: ReactNode) =>
		globalErrors ? (
			<QueryProvider>
				<CaptureProviderClient />
				{children}
			</QueryProvider>
		) : (
			<QueryClientProvider client={client}>{children}</QueryClientProvider>
		);
	const draw = (employeeId = "synthetic-planner-a") => (
		<TolgeeProvider tolgee={createTestTolgee()}>
			<ThemeProvider defaultTheme="light" enableSystem={false}>
				<UserPreferencesProvider timezone="Europe/Berlin" weekStartDay="monday">
					{withClient(
						<ShiftScheduler
							organizationId="synthetic-org-a"
							organizationTimezone="Europe/Berlin"
							employeeId={employeeId}
							isManager
							focusEmployeeId={null}
							focusDate="2026-11-16"
						/>,
					)}
				</UserPreferencesProvider>
			</ThemeProvider>
		</TolgeeProvider>
	);
	const view = render(draw());
	return { client, view, draw };
}

it("keeps an admitted planner on the schedule when template settings refuse access", async () => {
	transport.coverage.mockResolvedValue({ success: true, data: [] });
	transport.templates.mockResolvedValue({ success: false, error: "Unauthorized" });
	mountPlanner(true);
	await screen.findByRole("button", { name: "Publish (1)" });
	await waitFor(
		() => {
			expect(screen.getByRole("alert").textContent).toContain("Templates or compliance");
		},
		{ timeout: 10_000 },
	);
	expect(transport.replace).not.toHaveBeenCalled();
	expect(screen.getByRole("button", { name: "Create Shift" })).toBeTruthy();
	transport.templates.mockResolvedValue({ success: true, data: [] });
	await userEvent.setup().click(screen.getByRole("button", { name: "Retry" }));
	await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
	expect(transport.replace).not.toHaveBeenCalled();
	expect(transport.publish).not.toHaveBeenCalled();
}, 15_000);

it("still redirects an expired template transport session to sign-in", async () => {
	transport.coverage.mockResolvedValue({ success: true, data: [] });
	transport.templates.mockRejectedValue(new ApiError("Session expired", 401));
	mountPlanner(true);
	await waitFor(() => expect(transport.replace).toHaveBeenCalledWith("/sign-in"));
	expect(transport.publish).not.toHaveBeenCalled();
});

it("keeps combined coverage and template permission refusals local to the planner", async () => {
	transport.coverage.mockResolvedValue({
		success: false,
		code: "AuthorizationError",
		error: "Unauthorized",
	});
	transport.templates.mockResolvedValue({ success: false, error: "Unauthorized" });
	mountPlanner(true);
	await screen.findByRole("button", { name: "Publish (1)" });
	await waitFor(() => expect(screen.getAllByRole("alert")).toHaveLength(2), { timeout: 10_000 });
	expect(transport.replace).not.toHaveBeenCalled();
	expect(screen.getByRole("button", { name: "Create Shift" })).toBeTruthy();
	const coverageAlert = screen
		.getAllByRole("alert")
		.find((alert) => alert.textContent?.includes("Coverage could not be loaded"));
	if (!coverageAlert) throw Error("Expected local coverage failure");
	transport.coverage.mockResolvedValue({ success: true, data: [] });
	await userEvent.setup().click(within(coverageAlert).getByRole("button", { name: "Retry" }));
	await waitFor(() => expect(screen.getAllByRole("alert")).toHaveLength(1));
	expect(screen.getByRole("alert").textContent).toContain("Templates or compliance");
	expect(transport.replace).not.toHaveBeenCalled();
	expect(transport.publish).not.toHaveBeenCalled();
}, 15_000);

it("still redirects a coverage authentication refusal to sign-in", async () => {
	transport.coverage.mockResolvedValue({
		success: false,
		code: "AuthenticationError",
		error: "Unauthorized",
	});
	mountPlanner(true);
	await waitFor(() => expect(transport.replace).toHaveBeenCalledWith("/sign-in"));
	expect(transport.publish).not.toHaveBeenCalled();
});

async function observe() {
	const mounted = mountPlanner();
	const { client } = mounted;
	const publish = await screen.findByRole("button", { name: "Publish (1)" });
	if (!(publish instanceof HTMLButtonElement)) throw Error("Expected native Publish button");
	await waitFor(() => expect(transport.coverage).toHaveBeenCalled());
	await waitFor(() => expect(client.isFetching()).toBe(0));
	const user = userEvent.setup();
	await user.hover(publish);
	await waitFor(() => expect(document.querySelector('[data-slot="tooltip-content"]')).toBeTruthy());
	const tooltip = document.querySelector('[data-slot="tooltip-content"]');
	if (!tooltip) throw Error("Expected visible publish description");
	const alerts = screen.queryAllByRole("alert").map((element) => element.textContent);
	const coverageErrors = alerts.filter((text) => /coverage|staffing/i.test(text ?? ""));
	const receipt = {
		coverageCalls: transport.coverage.mock.calls.length,
		publishEnabled: !publish.disabled,
		tooltip: tooltip.textContent,
		alerts,
		coverageErrorCount: coverageErrors.length,
		retryButtons: screen.queryAllByRole("button", { name: /retry/i }).length,
		visibleBodyText: document.body.textContent,
		writes: {
			publish: transport.publish.mock.calls.length,
			upsert: transport.upsert.mock.calls.length,
			remove: transport.remove.mock.calls.length,
		},
		boundary:
			"real ShiftScheduler/QueryClient/provider/hooks/overlay/PublishFab; mocked action transport and admitted caller props; jsdom, no browser or server-authorization claim",
	};
	return { receipt, coverageErrors, ...mounted };
}

it("healthy successful empty coverage offers the ordinary publish description", async () => {
	transport.coverage.mockResolvedValue({ success: true, data: [] });
	const { receipt } = await observe();
	expect(receipt.coverageCalls).toBe(1);
	expect(receipt.publishEnabled).toBe(true);
	expect(receipt.tooltip).toContain("Publish 1 draft shift and notify employees");
	expect(receipt.coverageErrorCount).toBe(0);
});

it("healthy understaffed coverage exposes the actual coverage warning", async () => {
	transport.coverage.mockResolvedValue({
		success: true,
		data: [
			{
				date: new Date("2026-11-16T00:00:00Z"),
				subareaId: "synthetic-reception",
				subareaName: "Reception",
				locationName: "Office",
				status: "under",
				gapCount: 1,
				utilizationPercent: 0,
				totalRequired: 1,
				totalActual: 0,
				totalShortfall: 1,
			},
		],
	});
	const { receipt } = await observe();
	expect(receipt.tooltip).toContain("Warnings detected before publish");
	expect(receipt.tooltip).toContain("minimum staffing requirements");
	expect(receipt.visibleBodyText).toContain("1 understaffed");
});

it("failed coverage stays visibly unavailable and offers local read Retry", async () => {
	transport.coverage.mockResolvedValue({
		success: false,
		error: "Synthetic coverage transport unavailable",
	});
	const { receipt, coverageErrors } = await observe();
	expect(receipt.coverageCalls).toBe(1);
	expect(receipt.writes).toEqual({ publish: 0, upsert: 0, remove: 0 });
	expect(
		coverageErrors.length,
		"failed coverage must remain visibly unknown instead of sharing healthy-empty publish feedback",
	).toBeGreaterThan(0);
	expect(receipt.retryButtons, "failed coverage needs local read Retry").toBeGreaterThan(0);
	expect(receipt.publishEnabled).toBe(true);
	expect(receipt.tooltip).toContain("Coverage is unavailable");
	expect(receipt.tooltip).not.toContain("Publish 1 draft shift and notify employees");
});

it("does not display the previous planner's subarea coverage while the next planner loads", async () => {
	transport.coverage.mockResolvedValueOnce({
		success: true,
		data: [
			{
				date: new Date("2026-11-16T00:00:00Z"),
				subareaId: "synthetic-reception",
				subareaName: "Reception",
				locationName: "Office",
				status: "under",
				gapCount: 1,
				utilizationPercent: 0,
				totalRequired: 1,
				totalActual: 0,
				totalShortfall: 1,
			},
		],
	});
	const { client, view, draw } = await observe();
	expect(screen.getByText(/^1 understaffed/)).toBeTruthy();
	let finish: (value: unknown) => void = () => {};
	transport.coverage.mockImplementation(
		() =>
			new Promise((resolve) => {
				finish = resolve;
			}),
	);
	view.rerender(draw("synthetic-planner-b"));
	try {
		expect(screen.queryByText(/^1 understaffed/)).toBeNull();
		await waitFor(() => expect(transport.coverage).toHaveBeenCalledTimes(2));
	} finally {
		await act(async () => finish({ success: true, data: [] }));
		await waitFor(() => expect(client.isFetching()).toBe(0));
	}
});

it("recovers coverage through one pending local Retry without writing the schedule", async () => {
	transport.coverage.mockResolvedValueOnce({ success: false, error: "Synthetic unavailable" });
	const { client } = await observe();
	let finish: (value: unknown) => void = () => {};
	transport.coverage.mockImplementation(
		() =>
			new Promise((resolve) => {
				finish = resolve;
			}),
	);
	const user = userEvent.setup();
	const retry = screen.getByRole("button", { name: "Retry" });
	await user.click(retry);
	try {
		await waitFor(() => expect(screen.queryByRole("button", { name: "Retry" })).toBeNull());
		expect(screen.getByText("Loading coverage…")).toBeTruthy();
		expect(transport.coverage).toHaveBeenCalledTimes(2);
	} finally {
		await act(async () => finish({ success: true, data: [] }));
		await waitFor(() => expect(client.isFetching()).toBe(0));
	}
	await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
	expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
	expect(transport.publish).not.toHaveBeenCalled();
	expect(transport.upsert).not.toHaveBeenCalled();
	expect(transport.remove).not.toHaveBeenCalled();
});

it("keeps the failed Retry recoverable after a rejected transport", async () => {
	transport.coverage.mockRejectedValue(new Error("Synthetic rejected read"));
	const { client } = await observe();
	const user = userEvent.setup();
	await user.click(screen.getByRole("button", { name: "Retry" }));
	await waitFor(() => expect(transport.coverage).toHaveBeenCalledTimes(2));
	await waitFor(() => expect(client.isFetching()).toBe(0));
	expect(screen.getByRole("alert").textContent).toContain("Coverage could not be loaded");
	expect(screen.getByRole("button", { name: "Retry" }).hasAttribute("disabled")).toBe(false);
});

it("retains matching coverage as last loaded when a background refresh fails", async () => {
	transport.coverage.mockResolvedValue({
		success: true,
		data: [
			{
				date: new Date("2026-11-16T00:00:00Z"),
				subareaId: "synthetic-reception",
				subareaName: "Reception",
				locationName: "Office",
				status: "under",
				gapCount: 1,
				utilizationPercent: 0,
				totalRequired: 1,
				totalActual: 0,
				totalShortfall: 1,
			},
		],
	});
	const { client } = await observe();
	transport.coverage.mockResolvedValue({ success: false, error: "Synthetic refresh refusal" });
	await act(async () => {
		await client.invalidateQueries();
	});
	await waitFor(() =>
		expect(screen.getByRole("alert").textContent).toContain("Coverage could not be loaded"),
	);
	expect(screen.getByText("Last loaded coverage")).toBeTruthy();
	expect(screen.getByText(/^1 understaffed/)).toBeTruthy();
	const user = userEvent.setup();
	await user.unhover(screen.getByRole("button", { name: "Publish (1)" }));
	await user.hover(screen.getByRole("button", { name: "Publish (1)" }));
	await waitFor(() =>
		expect(document.querySelector('[data-slot="tooltip-content"]')?.textContent).toContain(
			"Coverage is unavailable",
		),
	);
});

it("disables supporting-data Retry while the retained template refresh is pending", async () => {
	transport.coverage.mockResolvedValue({ success: true, data: [] });
	const { client } = await observe();
	transport.templates.mockResolvedValue({
		success: false,
		error: "Synthetic template refresh refusal",
	});
	await act(async () => {
		await client.invalidateQueries();
	});
	await waitFor(() =>
		expect(screen.getByRole("alert").textContent).toContain("Templates or compliance"),
	);
	let finish: (value: unknown) => void = () => {};
	transport.templates.mockImplementation(
		() =>
			new Promise((resolve) => {
				finish = resolve;
			}),
	);
	const user = userEvent.setup();
	await user.click(screen.getByRole("button", { name: "Retry" }));
	try {
		await waitFor(() =>
			expect(screen.getByRole("button", { name: "Retry" }).hasAttribute("disabled")).toBe(true),
		);
	} finally {
		await act(async () => finish({ success: true, data: [] }));
		await waitFor(() => expect(client.isFetching()).toBe(0));
	}
	await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
});

it.each([["templates","templates"],["templates","compliance"],["compliance","templates"],["compliance","compliance"]] as const)(
	"independent initial %s refusal Retry survives %s completing first",
	async (failedRead, first) => {
		transport.coverage.mockResolvedValue({ success: true, data: [] });
		transport[failedRead].mockResolvedValue({
			success: false,
			error: "Synthetic initial read refusal",
		});
		const { client } = await observe();
		expect(screen.getByRole("alert").textContent).toContain("Templates or compliance");
		const beforeTemplates = transport.templates.mock.calls.length;
		const beforeCompliance = transport.compliance.mock.calls.length;
		let finishTemplates: (value: unknown) => void = () => {};
		let finishCompliance: (value: unknown) => void = () => {};
		transport.templates.mockImplementation(
			() =>
				new Promise((resolve) => {
					finishTemplates = resolve;
				}),
		);
		transport.compliance.mockImplementation(
			() =>
				new Promise((resolve) => {
					finishCompliance = resolve;
				}),
		);
		await userEvent.setup().click(screen.getByRole("button", { name: "Retry" }));
		try {
			await waitFor(() => expect(transport.templates).toHaveBeenCalledTimes(beforeTemplates + 1));
			await waitFor(() => expect(transport.compliance).toHaveBeenCalledTimes(beforeCompliance + 1));
			expect(screen.getByRole("alert").textContent).toContain("Templates or compliance");
			const retry = screen.getByRole("button", { name: "Retry" });
			expect(retry).toBeInstanceOf(HTMLButtonElement);
			expect((retry as HTMLButtonElement).disabled).toBe(true);
			await userEvent.setup().click(retry);
			expect(transport.templates).toHaveBeenCalledTimes(beforeTemplates + 1);
			expect(transport.compliance).toHaveBeenCalledTimes(beforeCompliance + 1);
			await act(async () => first === "templates" ? finishTemplates({ success: true, data: [] }) : finishCompliance({ success: true, data: { summary: { totalFindings: 0 } } }));
			expect(screen.getByRole("button", { name: "Retry" }).hasAttribute("disabled")).toBe(true);
		} finally {
			await act(async () => {
				finishTemplates({ success: true, data: [] });
				finishCompliance({ success: true, data: { summary: { totalFindings: 0 } } });
			});
			await waitFor(() => expect(client.isFetching()).toBe(0));
		}
		await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
		expect(transport.publish).not.toHaveBeenCalled();
		expect(transport.upsert).not.toHaveBeenCalled();
		expect(transport.remove).not.toHaveBeenCalled();
	},
);
