/* @vitest-environment jsdom */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const remote = vi.hoisted(() => ({ tasks: vi.fn() }));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, values: Record<string, unknown> = {}) =>
			fallback.replace(/\{(\w+)\}/g, (_match, key) => String(values[key] ?? key)),
	}),
}));
vi.mock("next/navigation", async () => {
	const { useSyncExternalStore } = await import("react");
	const listeners = new Set<() => void>();
	const replaceState = window.history.replaceState.bind(window.history);
	window.history.replaceState = (...args: Parameters<History["replaceState"]>) => {
		replaceState(...args);
		for (const listener of listeners) listener();
	};
	return {
		useSearchParams: () =>
			new URLSearchParams(
				useSyncExternalStore(
					(listener) => {
						listeners.add(listener);
						return () => {
							listeners.delete(listener);
						};
					},
					() => window.location.search,
				),
			),
	};
});
vi.mock("@/lib/auth-client", () => ({
	useSession: () => ({
		data: { user: { id: "admin" }, session: { activeOrganizationId: "org" } },
	}),
}));
vi.mock("@/lib/organization/driving-licence/task-actions", () => ({
	getDrivingLicenceTasksAction: remote.tasks,
}));
// The assignment cards have their own test; here only their placement matters.
vi.mock("./intended-driver-settings", () => ({
	IntendedDriverSettings: () => <p>Assignment cards</p>,
}));

import { DrivingLicenceIntendedDriversPanel, DrivingLicenceSettingsTabs } from "./settings-tabs";

const panels = {
	policy: <p>Policy content</p>,
	"intended-drivers": <p>Intended drivers content</p>,
	verifiers: <p>Verifiers content</p>,
	retention: <p>Retention content</p>,
};

function mount(element: ReactNode) {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return render(<QueryClientProvider client={client}>{element}</QueryClientProvider>);
}

function reassignmentTask(id: string, employeeName: string, state = "pending") {
	return {
		id,
		employeeId: `employee-${id}`,
		employeeName,
		kind: "reassignment",
		state,
		completedAt: null,
	};
}

beforeEach(() => {
	window.history.replaceState(null, "", "/en/settings/driving-licence");
	remote.tasks.mockReset().mockResolvedValue({ success: true, data: [] });
});
afterEach(cleanup);

describe("driving licence settings tabs", () => {
	it("offers Policy, Intended drivers, Verifiers and Retention & holds, starting with Policy", () => {
		mount(<DrivingLicenceSettingsTabs settings="full" panels={panels} />);
		expect(screen.getByRole("heading", { level: 1, name: "Driving licence control" })).toBeTruthy();
		expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
			"Policy",
			"Intended drivers",
			"Verifiers",
			"Retention & holds",
		]);
		expect(screen.getByRole("tabpanel").textContent).toBe("Policy content");
		expect(screen.queryByText("Verifiers content")).toBeNull();
	});

	it("opens a linked tab and keeps the selection in the address", () => {
		window.history.replaceState(null, "", "/en/settings/driving-licence?tab=verifiers");
		mount(<DrivingLicenceSettingsTabs settings="full" panels={panels} />);
		expect(screen.getByRole("tabpanel").textContent).toBe("Verifiers content");
		fireEvent.click(screen.getByRole("tab", { name: "Retention & holds" }));
		expect(window.location.search).toBe("?tab=retention");
		expect(screen.getByText("Retention content")).toBeTruthy();
	});

	it("offers only Retention & holds, with the off notice, while control is off", () => {
		window.history.replaceState(null, "", "/en/settings/driving-licence?tab=policy");
		mount(
			<DrivingLicenceSettingsTabs
				settings="retention_only"
				panels={{ retention: <p>Retention content</p> }}
			/>,
		);
		expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Retention & holds"]);
		expect(screen.getByRole("tabpanel").textContent).toBe("Retention content");
		expect(screen.getByText("Driving licence control is off")).toBeTruthy();
		expect(screen.getByText(/evidence cleanup continues/)).toBeTruthy();
		expect(remote.tasks).not.toHaveBeenCalled();
	});

	it("shows open verifier-responsibility tasks above the tabs and leads to Verifiers", async () => {
		remote.tasks.mockResolvedValue({
			success: true,
			data: [
				reassignmentTask("1", "Dana Driver"),
				reassignmentTask("2", "Sam Settled", "completed"),
			],
		});
		mount(<DrivingLicenceSettingsTabs settings="full" panels={panels} />);
		const alert = await screen.findByRole("alert");
		expect(alert.textContent).toContain("Employees without a responsible verifier");
		expect(alert.textContent).toContain("Dana Driver");
		expect(alert.textContent).not.toContain("Sam Settled");
		expect(
			alert.compareDocumentPosition(screen.getByRole("tablist")) & Node.DOCUMENT_POSITION_FOLLOWING,
		).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Assign responsibility" }));
		expect(window.location.search).toBe("?tab=verifiers");
		expect(screen.getByText("Verifiers content")).toBeTruthy();
	});

	it("shows no alert while every employee has a responsible verifier", async () => {
		remote.tasks.mockResolvedValue({
			success: true,
			data: [reassignmentTask("2", "Sam Settled", "completed")],
		});
		mount(<DrivingLicenceSettingsTabs settings="full" panels={panels} />);
		await vi.waitFor(() => expect(remote.tasks).toHaveBeenCalled());
		expect(screen.queryByRole("alert")).toBeNull();
	});

	it("lands on Intended drivers after the first activation, explaining the choices", () => {
		window.history.replaceState(null, "", "/en/settings/driving-licence?tab=intended-drivers");
		mount(
			<DrivingLicenceSettingsTabs
				settings="full"
				panels={{
					...panels,
					"intended-drivers": (
						<DrivingLicenceIntendedDriversPanel
							data={{ assignments: [], teams: [], employees: [] }}
						/>
					),
				}}
			/>,
		);
		const panel = screen.getByRole("tabpanel");
		expect(screen.getByRole("tab", { name: "Intended drivers", selected: true })).toBeTruthy();
		expect(panel.textContent).toContain("Nobody is an intended driver yet");
		expect(panel.textContent).toContain("whole organization");
		expect(panel.textContent).toContain("primary team");
		expect(panel.textContent).toContain("one employee");
		expect(panel.textContent).toContain("Assignment cards");
	});

	it("drops the empty state once anyone is assigned", () => {
		window.history.replaceState(null, "", "/en/settings/driving-licence?tab=intended-drivers");
		mount(
			<DrivingLicenceIntendedDriversPanel
				data={{
					assignments: [
						{
							id: "a",
							assignmentType: "organization",
							teamId: null,
							employeeId: null,
							value: "required",
							createdAt: "2026-10-20T08:00:00Z",
							createdBy: "admin",
							updatedAt: "2026-10-20T08:00:00Z",
							updatedBy: "admin",
						},
					],
					teams: [],
					employees: [],
				}}
			/>,
		);
		expect(screen.queryByText("Nobody is an intended driver yet")).toBeNull();
		expect(screen.getByText("Assignment cards")).toBeTruthy();
	});
});
