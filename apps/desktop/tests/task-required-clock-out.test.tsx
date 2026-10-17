import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Temporal } from "temporal-polyfill";
const native = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: async () => () => {} }));

const ALPHA = "11111111-1111-4111-8111-111111111111";
const BUILD = "22222222-2222-4222-8222-222222222222";

/** The companion while clocked in on a project whose task requirement is active (#1297). */
async function clockedInOn(projects: unknown[]) {
	const context = {
		userId: "user",
		organizationId: "org",
		employeeId: "employee",
		timezone: "Europe/Berlin",
		locale: "en",
		fetchedAt: Temporal.Now.instant().toString(),
		cached: false,
		dayTotalBasis: {
			timezone: "Europe/Berlin",
			completedMinutesByDate: {},
			liveWork: [],
		},
		projectsEnabled: true,
		projects,
		categories: [],
		liveWork: {
			id: "period-1",
			projectId: ALPHA,
			workCategoryId: null,
			workLocationType: "office",
			currentTask: null,
		},
	};
	const journal = {
		busy: false,
		onBreak: false,
		signInRequired: false,
		legacy: {
			total: 0,
			malformed: 0,
			exhausted: 0,
			possiblePartialBreaks: 0,
			breaksWithAcknowledgedClose: 0,
		},
		serverReachable: true,
		commandsEnabled: true,
		onlineClockingEnabled: true,
		breaksEnabled: true,
		commands: [],
		otherContexts: 0,
		projection: null,
	};
	native.invoke.mockImplementation(async (command: string) => {
		if (command === "get_session")
			return {
				isAuthenticated: true,
				credentialError: null,
				sessionRevision: 1,
			};
		if (command === "get_settings")
			return {
				webappUrl: "https://z8.test",
				alwaysOnTop: false,
				autoStartup: false,
				idleEnabled: false,
				idleThresholdMinutes: 15,
				language: "en",
				version: "0.2.0",
			};
		if (command === "get_organizations")
			return {
				organizations: [
					{
						id: "org",
						name: "Example Company",
						slug: "example",
						logo: null,
						memberRole: "member",
						hasEmployeeRecord: true,
					},
				],
				activeOrganizationId: "org",
			};
		if (command === "get_desktop_context") return context;
		if (command === "get_clock_status")
			return {
				hasEmployee: true,
				employeeId: "employee",
				isClockedIn: true,
				activeWorkPeriod: {
					id: "period-1",
					startTime: Temporal.Now.instant().toString(),
				},
			};
		if (command === "sync_clock_commands") return journal;
		if (command === "check_for_updates")
			return { configured: false, version: null };
		if (command === "get_device_timezone") return "Europe/Berlin";
		if (command === "clock_out") return { outcome: "savedOnDevice" };
		throw Error(`Unexpected native command ${command}`);
	});
	// A fresh module per case: the app's query cache is module-level.
	vi.resetModules();
	const { default: App } = await import("../src/App");
	render(<App />);
}

beforeEach(() => {
	native.invoke.mockReset();
	vi.stubGlobal(
		"matchMedia",
		vi.fn(() => ({
			matches: false,
			addEventListener: vi.fn(),
			removeEventListener: vi.fn(),
		})),
	);
});
afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

const clockOut = () => screen.getByRole("button", { name: "Clock out" });
const sentClockOuts = () =>
	native.invoke.mock.calls.filter(([command]) => command === "clock_out");

it("sends no clock-out without a task on a project that requires one, but still takes a break", async () => {
	await clockedInOn([
		{
			id: ALPHA,
			name: "Alpha",
			taskRequired: true,
			tasks: [{ id: BUILD, name: "Build" }],
		},
	]);
	const task = await screen.findByRole("combobox", { name: "Task" });
	await waitFor(() =>
		expect(screen.getByRole("button", { name: "Start break" })).toHaveProperty(
			"disabled",
			false,
		),
	);

	expect(clockOut()).toHaveProperty("disabled", true);
	await userEvent.click(clockOut());
	expect(sentClockOuts()).toHaveLength(0);

	await userEvent.selectOptions(task, BUILD);
	expect(clockOut()).toHaveProperty("disabled", false);
	await userEvent.click(clockOut());
	await waitFor(() => expect(sentClockOuts()).toHaveLength(1));
	expect(sentClockOuts()[0][1]).toMatchObject({
		attribution: {
			project: { kind: "preserve" },
			workCategory: { kind: "preserve" },
			task: { kind: "replace", id: BUILD },
		},
	});
});

it("clocks out without a task where the context has no requirement flag", async () => {
	await clockedInOn([
		{ id: ALPHA, name: "Alpha", tasks: [{ id: BUILD, name: "Build" }] },
	]);
	await screen.findByRole("combobox", { name: "Task" });
	await waitFor(() => expect(clockOut()).toHaveProperty("disabled", false));

	await userEvent.click(clockOut());

	await waitFor(() => expect(sentClockOuts()).toHaveLength(1));
	expect(sentClockOuts()[0][1]).toMatchObject({
		attribution: {
			project: { kind: "preserve" },
			workCategory: { kind: "preserve" },
		},
	});
	expect(sentClockOuts()[0][1].attribution).not.toHaveProperty("task");
});
