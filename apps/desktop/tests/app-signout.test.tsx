import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Temporal } from "temporal-polyfill";
const native = vi.hoisted(() => ({
	invoke: vi.fn(),
	listeners: new Map<string, Set<(event: { payload: unknown }) => void>>(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke }));
vi.mock("@tauri-apps/api/event", () => ({
	listen: async (
		name: string,
		handler: (event: { payload: unknown }) => void,
	) => {
		let listeners = native.listeners.get(name);
		if (!listeners) {
			listeners = new Set();
			native.listeners.set(name, listeners);
		}
		listeners.add(handler);
		return () => listeners.delete(handler);
	},
}));
import App from "../src/App";
afterEach(cleanup);
it("signs out from the real settings dialog and replaces the company clock with sign-in", async () => {
	let signedIn = true;
	vi.stubGlobal(
		"matchMedia",
		vi.fn(() => ({
			matches: false,
			addEventListener: vi.fn(),
			removeEventListener: vi.fn(),
		})),
	);
	HTMLDialogElement.prototype.showModal = function () {
		this.setAttribute("open", "");
	};
	HTMLDialogElement.prototype.close = function () {
		this.removeAttribute("open");
	};
	const settings = {
		webappUrl: "https://z8.test",
		alwaysOnTop: false,
		autoStartup: false,
		idleEnabled: false,
		idleThresholdMinutes: 15,
		language: "en",
		version: "0.2.0",
	};
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
		projectsEnabled: false,
		projects: [],
		categories: [],
		liveWork: null,
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
		commandsEnabled: false,
		onlineClockingEnabled: true,
		breaksEnabled: false,
		commands: [],
		otherContexts: 0,
		projection: null,
	};
	native.invoke.mockImplementation(async (command: string) => {
		if (command === "get_session")
			return {
				isAuthenticated: signedIn,
				credentialError: null,
				sessionRevision: 1,
			};
		if (command === "get_settings") return settings;
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
				isClockedIn: false,
				activeWorkPeriod: null,
			};
		if (command === "sync_clock_commands") return journal;
		if (command === "check_for_updates")
			return { configured: false, version: null };
		if (command === "logout") {
			signedIn = false;
			for (const handler of native.listeners.get("logout") ?? [])
				handler({ payload: null });
			return;
		}
		throw Error("Unexpected native command " + command);
	});
	render(<App />);
	await screen.findByText("Example Company");
	await userEvent.click(screen.getByRole("button", { name: "Open settings" }));
	await screen.findByRole("button", { name: "Sign out" });
	await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
	await screen.findByRole("button", { name: "Sign in with Z8" });
	await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
	expect(screen.queryByText("Example Company")).toBeNull();
	expect(screen.queryByText("Clock actions paused")).toBeNull();
	expect(screen.queryByText(/Day summary could not be loaded/)).toBeNull();
	vi.unstubAllGlobals();
});
