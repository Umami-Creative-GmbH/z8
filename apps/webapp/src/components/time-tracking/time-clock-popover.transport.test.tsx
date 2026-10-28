/* @vitest-environment jsdom */

import { onlineManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useTranslate } from "@tolgee/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { BrowserClockCommandCapabilities } from "@/lib/time-tracking/browser-clock-command";

const boundary = vi.hoisted(() => ({
	status: vi.fn(),
	projects: vi.fn(),
	categories: vi.fn(),
	vehicleStatus: vi.fn(),
	vehicles: vi.fn(),
	queue: vi.fn(),
	offline: false,
	capabilities: null as BrowserClockCommandCapabilities | null,
	driving: vi.fn(),
	subject: {
		userId: "user-a",
		organizationId: "org-a",
		employeeId: "employee-a",
		role: "employee",
		isLoading: false,
	},
}));
vi.mock("@/lib/auth-client", () => ({
	useSession: () => ({
		data: {
			user: { id: boundary.subject.userId },
			session: { activeOrganizationId: boundary.subject.organizationId },
		},
		isPending: false,
	}),
}));
vi.mock("@/hooks/use-organization", () => ({ useOrganization: () => boundary.subject }));
vi.mock("@/hooks/use-offline-clock", () => ({
	useOfflineClock: () => ({
		isOnline: !boundary.offline,
		isOffline: boundary.offline,
		pendingCount: 0,
		waitingCount: 0,
		isSyncing: false,
		queueClockEvent: boundary.queue,
		commandCapabilities: boundary.capabilities,
		workerCommandVersions: [],
	}),
}));
vi.mock("@/lib/time-tracking/web-clock-status-client",()=>({getWebClockStatus:boundary.status}));
vi.mock("@/app/[locale]/(app)/time-tracking/actions", () => ({
	getTimeClockStatus: boundary.status,
	getAssignedProjects: boundary.projects,
	addBreakToActiveSession: vi.fn(),
	startBreakInProgress: vi.fn(),
	resumeBreakInProgress: vi.fn(),
	updateTimeEntryNotes: vi.fn(),
}));
vi.mock("@/app/[locale]/(app)/settings/work-categories/actions", () => ({
	getAvailableCategoriesForEmployee: boundary.categories,
}));
vi.mock("@/app/[locale]/(app)/time-tracking/actions/clock-vehicle-use", () => ({
	getClockVehicleUseContext: boundary.vehicles,
	getClockVehicleUseStatus: boundary.vehicleStatus,
	changeLiveVehicleUse: vi.fn(),
}));
vi.mock("@/app/[locale]/(app)/time-tracking/actions/vehicle-use-warnings", () => ({
	checkVehicleUseWarnings: async () => ({ success: true, data: { warnings: [] } }),
}));
vi.mock("@/app/[locale]/(app)/settings/position-stamps/actions", () => ({
	getOwnPositionCaptureAction: async () => ({ success: false, error: "off" }),
}));
vi.mock("@/components/driving-licence/operational-client", () => ({
	loadDrivingAuthorizationStatus: boundary.driving,
}));
vi.mock("@/components/providers/user-preferences-provider", () => ({
	useUserTimezone: () => "Europe/Berlin",
}));
vi.mock("next-intl", () => ({ useLocale: () => "en" }));
vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: Record<string, string | number>) =>
			Object.entries(params ?? {}).reduce(
				(text, [key, value]) => text.replaceAll(`{${key}}`, String(value)),
				fallback,
			),
	}),
	useTolgee: () => ({ getLanguage: () => "en" }),
}));
vi.mock("sonner", () => ({
	toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));

import { queryKeys } from "@/lib/query/keys";
import { ClockInVehicleUse, useClockVehicleUse } from "./clock-vehicle-use";
import { ProjectSelector } from "./project-selector";
import { TimeClockPopover } from "./time-clock-popover";
import { WorkCategorySelector } from "./work-category-selector";

const live = {
	hasEmployee: true,
	employeeId: "employee-a",
	isClockedIn: true,
	activeWorkPeriod: {
		id: "work-a",
		startTime: new Date("2026-10-24T08:00:00Z"),
		currentTask: null,
		breakStartedAt: null,
	},
};
beforeEach(() => {
	vi.clearAllMocks();
	boundary.offline = false;
	boundary.capabilities = null;
	boundary.subject.userId = "user-a";
	boundary.subject.organizationId = "org-a";
	boundary.subject.employeeId = "employee-a";
	boundary.driving.mockResolvedValue({ success: true, data: null });
	onlineManager.setOnline(true);
	boundary.status.mockResolvedValue(live);
	boundary.projects.mockResolvedValue({ success: true, data: [] });
	boundary.categories.mockResolvedValue({ success: true, data: [] });
	boundary.vehicleStatus.mockResolvedValue({ success: true, data: { mode: "off", live: null } });
	boundary.vehicles.mockResolvedValue({
		success: true,
		data: { mode: "off", live: null, vehicles: [] },
	});
	vi.stubGlobal("fetch", vi.fn());
	vi.stubGlobal(
		"ResizeObserver",
		class {
			observe() {}
			unobserve() {}
			disconnect() {}
		},
	);
	HTMLElement.prototype.scrollIntoView = vi.fn();
	localStorage.clear();
});
afterEach(() => {
	vi.unstubAllGlobals();
	onlineManager.setOnline(true);
});
function showClock(client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
	return render(
		<QueryClientProvider client={client}>
			<input aria-label="Clock draft" defaultValue="Unsaved" />
			<TimeClockPopover />
		</QueryClientProvider>,
	);
}
it("keeps closed clock status and open-break evidence eager without optional choice reads", async () => {
	showClock();
	await screen.findByRole("button", { name: "Clock Out" });
	expect(boundary.status).toHaveBeenCalledTimes(1);
	await act(async () => {});
	expect(boundary.projects).not.toHaveBeenCalled();
	expect(boundary.categories).not.toHaveBeenCalled();
	expect(boundary.vehicles).not.toHaveBeenCalled();
	expect(boundary.vehicleStatus).toHaveBeenCalledTimes(1);
});

it("shows unknown status as loading rather than a clocked-out action", async () => {
	boundary.status.mockReturnValue(new Promise(() => {}));
	showClock();
	const loading = screen.getByRole("button", { name: "Loading clock status" });
	expect(loading.hasAttribute("disabled")).toBe(true);
	expect(screen.queryByRole("button", { name: "Clock In" })).toBeNull();
	expect(boundary.projects).not.toHaveBeenCalled();
});

it("keeps failed current status unavailable until explicit retry succeeds", async () => {
	boundary.status.mockRejectedValueOnce(new Error("Status unavailable"));
	showClock();
	const retry = await screen.findByRole("button", { name: "Retry clock status" });
	expect(screen.queryByRole("button", { name: "Clock In" })).toBeNull();
	expect(screen.queryByRole("button", { name: "Clock Out" })).toBeNull();
	fireEvent.click(retry);
	await screen.findByRole("button", { name: "Clock Out" });
	expect(boundary.status).toHaveBeenCalledTimes(2);
	expect(boundary.projects).not.toHaveBeenCalled();
});
it.each(["open", "focus", "pointer"])(
	"loads choices once on %s intent while retaining eager current state",
	async (intent) => {
		boundary.vehicleStatus.mockResolvedValue({
			success: true,
			data: { mode: "asked", live: null },
		});
		boundary.vehicles.mockResolvedValue({
			success: true,
			data: { mode: "asked", live: null, vehicles: [] },
		});
		const projects = [{ id: "project-a", name: "Project Alpha", tasks: [] }];
		boundary.projects.mockResolvedValue({ success: true, data: projects });
		boundary.categories.mockResolvedValue({
			success: true,
			data: [{ id: "category-a", name: "Field work", factor: "1.00", color: null }],
		});
		showClock();
		const trigger = await screen.findByRole("button", { name: "Clock Out" });
		expect(boundary.projects).not.toHaveBeenCalled();
		if (intent === "open") fireEvent.click(trigger);
		else if (intent === "focus") await act(async () => trigger.focus());
		else fireEvent.pointerEnter(trigger);
		await waitFor(() => expect(boundary.projects).toHaveBeenCalledTimes(1));
		await waitFor(() => expect(boundary.categories).toHaveBeenCalledTimes(1));
		await waitFor(() => expect(boundary.vehicles).toHaveBeenCalledTimes(1));
		expect(boundary.status).toHaveBeenCalledTimes(1);
		expect((screen.getByLabelText("Clock draft") as HTMLInputElement).value).toBe("Unsaved");
	},
);

it.each([false, true])(
	"shows authoritative known clock state and an open break eagerly (break=%s)",
	async (onBreak) => {
		boundary.status.mockResolvedValue(
			onBreak
				? {
						...live,
						activeWorkPeriod: {
							...live.activeWorkPeriod,
							breakStartedAt: new Date("2026-10-24T09:00:00Z"),
							breakStartedZone: "Europe/Berlin",
						},
					}
				: { ...live, isClockedIn: false, activeWorkPeriod: null },
		);
		showClock();
		const trigger = await screen.findByRole("button", { name: onBreak ? "On break" : "Clock In" });
		expect(boundary.projects).not.toHaveBeenCalled();
		fireEvent.click(trigger);
		expect(
			await screen.findByText(onBreak ? "You're on a break" : "Ready to start working?"),
		).toBeTruthy();
		if (onBreak) expect(screen.getByRole("button", { name: "Resume" })).toBeTruthy();
	},
);
it("keeps clock controls and driving advice usable while selectors are held, fail and retry", async () => {
	let finish: (value: unknown) => void = () => {};
	boundary.projects.mockImplementationOnce(
		() =>
			new Promise((resolve) => {
				finish = resolve;
			}),
	);
	boundary.categories.mockResolvedValueOnce({ success: false, error: "Categories unavailable" });
	boundary.driving.mockResolvedValue({
		success: true,
		data: {
			employeeId: "employee-a",
			status: "suspended",
			authorizedClasses: [],
			classes: [{ code: "B", status: "suspended", restrictions: "Code 01" }],
		},
	});
	showClock();
	fireEvent.click(await screen.findByRole("button", { name: "Clock Out" }));
	const panel = screen.getByRole("dialog");
	await screen.findByRole("button", { name: "Retry Work Category" });
	expect(within(panel).getByRole("button", { name: "Clock Out" }).hasAttribute("disabled")).toBe(
		false,
	);
	expect(await screen.findByText("Driving authorization suspended")).toBeTruthy();
	expect(screen.getByText("Code 01")).toBeTruthy();
	fireEvent.click(screen.getByRole("button", { name: "Retry Work Category" }));
	await waitFor(() => expect(boundary.categories).toHaveBeenCalledTimes(2));
	await act(async () => finish({ success: false, error: "Projects unavailable" }));
	fireEvent.click(await screen.findByRole("button", { name: "Retry Project" }));
	await waitFor(() => expect(boundary.projects).toHaveBeenCalledTimes(2));
	expect((screen.getByLabelText("Clock draft") as HTMLInputElement).value).toBe("Unsaved");
});
it("keeps vehicle expectations visible and permits a real clock command while optional vehicle choices are held", async () => {
	boundary.status.mockResolvedValue({ ...live, isClockedIn: false, activeWorkPeriod: null });
	boundary.vehicleStatus.mockResolvedValue({
		success: true,
		data: { mode: "expected", live: null },
	});
	boundary.vehicles.mockReturnValue(new Promise(() => {}));
	const request = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
		Response.json({ success: true, data: { id: "clock-in-a" } }),
	);
	vi.stubGlobal("fetch", request);
	showClock();
	fireEvent.click(await screen.findByRole("button", { name: "Clock In" }));
	expect(
		await screen.findByText(
			"Your organization expects you to record the vehicle you drove and its readings.",
		),
	).toBeTruthy();
	expect(screen.getByText("Loading vehicle choices…")).toBeTruthy();
	const panel = screen.getByRole("dialog");
	expect(within(panel).getByRole("button", { name: "Clock In" }).hasAttribute("disabled")).toBe(
		false,
	);
	fireEvent.click(within(panel).getByRole("button", { name: "Clock In" }));
	await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
	expect(request.mock.calls[0][0]).toBe("/api/time-clock");
	const body = JSON.parse(String(request.mock.calls[0][1]?.body));
	expect(body.action).toBe("clock_in");
	expect(typeof body.submissionId).toBe("string");
	expect(body.vehicleUse).toBeUndefined();
});
function FullClockChoices() {
	const state = useClockVehicleUse({ enabled: true });
	const { t } = useTranslate();
	return (
		<section aria-label="Full clock choices">
			<ProjectSelector value={undefined} onValueChange={() => {}} />
			<WorkCategorySelector
				employeeId={boundary.subject.employeeId}
				value={undefined}
				onValueChange={() => {}}
			/>
			<ClockInVehicleUse state={state} t={t} />
		</section>
	);
}
it("shares in-flight and fresh choice requests with the full clock selectors", async () => {
	boundary.vehicleStatus.mockResolvedValue({ success: true, data: { mode: "asked", live: null } });
	boundary.vehicles.mockResolvedValue({
		success: true,
		data: { mode: "asked", live: null, vehicles: [] },
	});
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	let finish: (value: unknown) => void = () => {};
	boundary.projects.mockImplementationOnce(
		() =>
			new Promise((resolve) => {
				finish = resolve;
			}),
	);
	const view = showClock(client);
	fireEvent.click(await screen.findByRole("button", { name: "Clock Out" }));
	await waitFor(() => expect(boundary.projects).toHaveBeenCalledTimes(1));
	view.rerender(
		<QueryClientProvider client={client}>
			<TimeClockPopover />
			<FullClockChoices />
		</QueryClientProvider>,
	);
	await act(async () => finish({ success: true, data: [] }));
	expect(boundary.projects).toHaveBeenCalledTimes(1);
	expect(boundary.categories).toHaveBeenCalledTimes(1);
	expect(boundary.vehicles).toHaveBeenCalledTimes(1);
	expect(boundary.vehicleStatus).toHaveBeenCalledTimes(1);
});
it("retains offline admission and device-only capture without fetching choice lists", async () => {
	boundary.offline = true;
	boundary.capabilities = {
		submit: "available",
		commandVersions: [2],
		context: {
			userId: "user-a",
			organizationId: "org-a",
			employeeId: "employee-a",
			server: "https://other.example",
		},
	};
	boundary.queue.mockResolvedValue({ success: true });
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	client.setQueryData(queryKeys.timeClock.status(), live);
	onlineManager.setOnline(false);
	showClock(client);
	fireEvent.click(await screen.findByRole("button", { name: "Clock Out" }));
	fireEvent.click(await screen.findByRole("button", { name: "Save clock-out for review" }));
	await waitFor(() => expect(boundary.queue).toHaveBeenCalledTimes(1));
	expect(boundary.queue.mock.calls[0][0]).toMatchObject({
		type: "clock_out",
		organizationId: "org-a",
	});
	expect(boundary.projects).not.toHaveBeenCalled();
	expect(boundary.categories).not.toHaveBeenCalled();
	expect(boundary.vehicles).not.toHaveBeenCalled();
	expect(fetch).not.toHaveBeenCalled();
});

it("keeps a failed cached clocked-out status unavailable instead of enabling Clock In", async () => {
	boundary.status.mockRejectedValue(new Error("Status unavailable"));
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	client.setQueryData(
		queryKeys.timeClock.status(),
		{ ...live, isClockedIn: false, activeWorkPeriod: null },
		{ updatedAt: 1 },
	);
	showClock(client);
	await screen.findByRole("button", { name: "Retry clock status" });
	expect(screen.queryByRole("button", { name: "Clock In" })).toBeNull();
});
it("refuses offline capture in a non-adopted organization before storing or sending anything", async () => {
	boundary.offline = true;
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	client.setQueryData(queryKeys.timeClock.status(), {
		...live,
		isClockedIn: false,
		activeWorkPeriod: null,
	});
	onlineManager.setOnline(false);
	showClock(client);
	fireEvent.click(await screen.findByRole("button", { name: "Clock In" }));
	fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Clock In" }));
	expect(
		await screen.findByText(
			"Clocking needs a connection in this organization. Reconnect and try again.",
		),
	).toBeTruthy();
	expect(boundary.queue).not.toHaveBeenCalled();
	expect(fetch).not.toHaveBeenCalled();
});
it("keeps a chosen project's task requirement through list failure and local retry", async () => {
	localStorage.setItem("z8-last-project-id", "project-required");
	const projects = {
		success: true,
		data: [
			{
				id: "project-required",
				name: "Required project",
				requiresTask: true,
				tasks: [{ id: "task-design", name: "Design", state: "open" }],
			},
		],
	};
	boundary.projects.mockResolvedValue(projects);
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	showClock(client);
	fireEvent.click(await screen.findByRole("button", { name: "Clock Out" }));
	await screen.findByText("Choose a task");
	const clockOut = () =>
		within(screen.getByRole("dialog")).getByRole("button", { name: "Clock Out" });
	expect(clockOut().hasAttribute("disabled")).toBe(true);
	boundary.projects.mockResolvedValueOnce({ success: false, error: "List unavailable" });
	await act(async () => {
		await client.invalidateQueries({ queryKey: queryKeys.projects.assignable("org-a", "user-a") });
	});
	const retry = await screen.findByRole("button", { name: "Retry Project" });
	expect(clockOut().hasAttribute("disabled")).toBe(true);
	fireEvent.click(retry);
	await screen.findByText("Choose a task");
	expect(clockOut().hasAttribute("disabled")).toBe(true);
});
it("preserves an entered vehicle reading across choice-list failure and retry, then sends it with one refresh owner", async () => {
	const vehicleLive = {
		workPeriodId: "work-a",
		vehicleUse: { vehicle: { kind: "own" }, startKm: 100, endKm: null, distanceKm: null },
	};
	boundary.vehicleStatus.mockResolvedValue({
		success: true,
		data: { mode: "expected", live: vehicleLive },
	});
	boundary.vehicles
		.mockResolvedValue({
			success: true,
			data: { mode: "expected", live: vehicleLive, vehicles: [] },
		})
		.mockResolvedValueOnce({ success: false, error: "Unavailable" });
	const request = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
		Response.json({ success: true, data: { id: "clock-out-a" } }),
	);
	vi.stubGlobal("fetch", request);
	showClock();
	fireEvent.click(await screen.findByRole("button", { name: "Clock Out" }));
	const retry = await screen.findByRole("button", { name: "Retry Vehicle choices" });
	fireEvent.change(screen.getByLabelText("End reading (km)"), { target: { value: "120" } });
	fireEvent.click(retry);
	await waitFor(() => expect(boundary.vehicles).toHaveBeenCalledTimes(2));
	expect((screen.getByLabelText("End reading (km)") as HTMLInputElement).value).toBe("120");
	fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Clock Out" }));
	await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
	expect(JSON.parse(String(request.mock.calls[0][1]?.body)).vehicleUse).toEqual({ endKm: 120 });
	await waitFor(() => expect(boundary.vehicles).toHaveBeenCalledTimes(3));
	expect(boundary.vehicleStatus).toHaveBeenCalledTimes(2);
});
it("keeps optional choice caches scoped to the current account and organization", async () => {
	const user = userEvent.setup();
	boundary.projects.mockImplementation(async () => ({
		success: true,
		data: [
			{
				id: `project-${boundary.subject.organizationId}`,
				name: `Project ${boundary.subject.organizationId}`,
				tasks: [],
			},
		],
	}));
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	const frame = () => (
		<QueryClientProvider client={client}>
			<FullClockChoices />
		</QueryClientProvider>
	);
	const view = render(frame());
	await waitFor(() => expect(boundary.projects).toHaveBeenCalledTimes(1));
	await user.click(await screen.findByLabelText("Project"));
	expect(await screen.findByRole("option", { name: /Project org-a/ })).toBeTruthy();
	await user.keyboard("{Escape}");
	boundary.subject.organizationId = "org-b";
	boundary.subject.userId = "user-b";
	boundary.subject.employeeId = "employee-b";
	view.rerender(frame());
	await waitFor(() => expect(boundary.projects).toHaveBeenCalledTimes(2));
	await user.click(await screen.findByLabelText("Project"));
	expect(await screen.findByRole("option", { name: /Project org-b/ })).toBeTruthy();
	expect(screen.queryByRole("option", { name: /Project org-a/ })).toBeNull();
	expect(boundary.categories).toHaveBeenCalledTimes(2);
	expect(boundary.vehicles).toHaveBeenCalledTimes(2);
});

it("does not fetch an optional vehicle list on intent when eager policy already established it is off", async () => {
	showClock();
	const trigger = await screen.findByRole("button", { name: "Clock Out" });
	await waitFor(() => expect(boundary.vehicleStatus).toHaveBeenCalledTimes(1));
	await act(async () => {});
	fireEvent.click(trigger);
	await screen.findByText("You're currently clocked in");
	expect(boundary.vehicles).not.toHaveBeenCalled();
});

it("does not promote a bootstrap identity into an authorized clocked-out action when fresh admission denies it", async () => {
	boundary.status.mockResolvedValue({
		hasEmployee: false,
		employeeId: null,
		isClockedIn: false,
		activeWorkPeriod: null,
	});
	showClock();
	await waitFor(() =>
		expect(screen.queryByRole("button", { name: "Loading clock status" })).toBeNull(),
	);
	expect(screen.queryByRole("button", { name: "Clock In" })).toBeNull();
	expect(screen.queryByRole("button", { name: "Clock Out" })).toBeNull();
	expect(boundary.vehicleStatus).not.toHaveBeenCalled();
	expect(boundary.projects).not.toHaveBeenCalled();
});
