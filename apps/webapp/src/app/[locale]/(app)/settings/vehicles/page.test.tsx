/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	requireAdmin: vi.fn(),
	vehicles: vi.fn(),
	use: vi.fn(),
	redirect: vi.fn((href: string) => {
		throw new Error(`redirect:${href}`);
	}),
}));
vi.mock("@/lib/auth-helpers", () => ({
	requireOrgAdminSettingsAccess: mocks.requireAdmin,
}));
vi.mock("@/tolgee/server", () => ({
	getTranslate: async () => (_key: string, fallback: string) => fallback,
}));
vi.mock("./actions", () => ({ getVehicleSettings: mocks.vehicles }));
vi.mock("./vehicle-use-actions", () => ({
	getVehicleUseAdminDataAction: mocks.use,
}));
vi.mock("@/lib/navigation/locale-redirect", () => ({
	redirectWithLocale: mocks.redirect,
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
vi.mock("@/components/settings/vehicles/vehicle-settings", () => ({
	VehicleSettings: () => (
		<div>
			<p>Vehicle list loaded</p>
			<input aria-label="Vehicle draft" defaultValue="" />
		</div>
	),
}));
vi.mock("@/components/settings/vehicle-use/vehicle-use-settings", () => ({
	VehicleUseSwitch: () => <p>Recording controls loaded</p>,
	VehicleUseAssignments: () => <p>Assignments loaded</p>,
}));
vi.mock("@/components/settings/settings-load-error", () => ({
	SettingsLoadError: ({ message, onRetry }: { message: string; onRetry?: () => void }) => (
		<div role="alert">
			{message}
			<button type="button" data-retry={onRetry ? "custom" : "route-refresh"}>
				Retry
			</button>
		</div>
	),
}));

import VehiclesPage from "./page";

async function content(page: ReturnType<typeof VehiclesPage>) {
	return page.props.children.type();
}

beforeEach(() => {
	vi.clearAllMocks();
	window.history.replaceState(null, "", "/en/settings/vehicles");
	mocks.requireAdmin.mockResolvedValue({ organizationId: "org-1" });
	mocks.vehicles.mockResolvedValue({
		success: true,
		data: { vehicles: [], employees: [], teams: [] },
	});
	mocks.use.mockResolvedValue({
		success: true,
		data: {
			settings: { enabled: true },
			assignments: [],
			employees: [],
			teams: [],
		},
	});
});

afterEach(() => {
	cleanup();
});

describe("combined Vehicles page", () => {
	it("opens vehicle management inside the shared measured tabbed frame without mounting the other panels", async () => {
		const { container } = render(await content(VehiclesPage()));
		expect(mocks.requireAdmin).toHaveBeenCalledOnce();
		expect(container.querySelector(".page-frame .page-measure")).toBeTruthy();
		expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
		const tablist = screen.getByRole("tablist", { name: "Vehicles" });
		expect(tablist.parentElement?.className).toContain("max-w-full");
		expect(tablist.parentElement?.className).toContain("overflow-x-auto");
		expect(screen.getByRole("tab", { name: "Vehicles" }).getAttribute("aria-selected")).toBe(
			"true",
		);
		expect(screen.getByText("Vehicle list loaded")).toBeTruthy();
		expect(screen.queryByText("Recording controls loaded")).toBeNull();
		expect(screen.queryByText("Assignments loaded")).toBeNull();
	});

	it.each([
		["use", "Recording controls loaded"],
		["assignments", "Assignments loaded"],
	] as const)("opens a direct link to %s", async (tab, text) => {
		window.history.replaceState(null, "", `/en/settings/vehicles?tab=${tab}`);
		render(await content(VehiclesPage()));
		expect(screen.getByRole("tabpanel").textContent).toBe(text);
		expect(screen.queryByLabelText("Vehicle draft")).toBeNull();
	});

	it("falls back to Vehicles for an unknown tab", async () => {
		window.history.replaceState(null, "", "/en/settings/vehicles?tab=unknown");
		render(await content(VehiclesPage()));
		expect(screen.getByLabelText("Vehicle draft")).toBeTruthy();
	});

	it("keeps unfinished edits and other URL state when tabs change", async () => {
		window.history.replaceState(null, "", "/de/settings/vehicles?from=setup#details");
		render(await content(VehiclesPage()));

		fireEvent.change(screen.getByLabelText("Vehicle draft"), {
			target: { value: "Unsaved vehicle" },
		});
		fireEvent.click(screen.getByRole("tab", { name: "Vehicle use" }));
		await waitFor(() =>
			expect(screen.getByRole("tabpanel").textContent).toBe("Recording controls loaded"),
		);
		expect(window.location.pathname).toBe("/de/settings/vehicles");
		expect(window.location.hash).toBe("#details");
		expect(new URLSearchParams(window.location.search).get("from")).toBe("setup");
		expect(new URLSearchParams(window.location.search).get("tab")).toBe("use");

		fireEvent.click(screen.getByRole("tab", { name: "Vehicles" }));
		await waitFor(() =>
			expect(screen.getByRole("tabpanel").querySelector("input")?.value).toBe("Unsaved vehicle"),
		);
	});

	it("keeps the vehicle list usable when recording settings fail to load", async () => {
		mocks.use.mockResolvedValue({ success: false, code: "failed" });
		render(await content(VehiclesPage()));
		expect(screen.getByText("Vehicle list loaded")).toBeTruthy();

		fireEvent.click(screen.getByRole("tab", { name: "Vehicle use" }));
		await waitFor(() =>
			expect(screen.getByText("The vehicle use settings could not be loaded.")).toBeTruthy(),
		);
		// The failure offers an in-place retry of the route's server data.
		expect(screen.getByRole("button", { name: "Retry" }).getAttribute("data-retry")).toBe(
			"route-refresh",
		);
	});

	it("keeps recording controls usable when the vehicle list fails to load", async () => {
		mocks.vehicles.mockResolvedValue({ success: false, error: "failed" });
		render(await content(VehiclesPage()));
		expect(screen.getByText("Vehicles could not be loaded.")).toBeTruthy();
		expect(screen.getByRole("button", { name: "Retry" }).getAttribute("data-retry")).toBe(
			"route-refresh",
		);

		fireEvent.click(screen.getByRole("tab", { name: "Vehicle use" }));
		await waitFor(() => expect(screen.getByText("Recording controls loaded")).toBeTruthy());
	});

	it("does not load either data set when admin access is refused", async () => {
		mocks.requireAdmin.mockRejectedValue(new Error("forbidden"));
		await expect(content(VehiclesPage())).rejects.toThrow("forbidden");
		expect(mocks.vehicles).not.toHaveBeenCalled();
		expect(mocks.use).not.toHaveBeenCalled();
	});
});
