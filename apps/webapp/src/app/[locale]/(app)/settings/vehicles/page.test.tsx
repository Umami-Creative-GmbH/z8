import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
vi.mock("@/components/settings/vehicles/vehicle-settings", () => ({
	VehicleSettings: () => <p>Vehicle list loaded</p>,
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
vi.mock("@/components/settings/vehicles/vehicle-settings-tabs", () => ({
	VehicleSettingsTabs: ({ panels }: { panels: Record<string, ReactNode> }) => (
		<>{Object.values(panels)}</>
	),
}));

import VehiclesPage from "./page";

async function content(page: ReturnType<typeof VehiclesPage>) {
	return page.props.children.type();
}
beforeEach(() => {
	vi.clearAllMocks();
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
describe("combined Vehicles page", () => {
	it("includes vehicle management, recording and assignments after the org-admin guard", async () => {
		const html = renderToStaticMarkup(await content(VehiclesPage()));
		expect(mocks.requireAdmin).toHaveBeenCalledOnce();
		expect(html).toContain("Vehicle list loaded");
		expect(html).toContain("Recording controls loaded");
		expect(html).toContain("Assignments loaded");
	});
	it("keeps the vehicle list usable when recording settings fail to load", async () => {
		mocks.use.mockResolvedValue({ success: false, code: "failed" });
		const html = renderToStaticMarkup(await content(VehiclesPage()));
		expect(html).toContain("Vehicle list loaded");
		expect(html).toContain("The vehicle use settings could not be loaded.");
		// The failure offers an in-place retry of the route's server data.
		expect(html).toContain('data-retry="route-refresh"');
	});
	it("keeps recording controls usable when the vehicle list fails to load", async () => {
		mocks.vehicles.mockResolvedValue({ success: false, error: "failed" });
		const html = renderToStaticMarkup(await content(VehiclesPage()));
		expect(html).toContain("Vehicles could not be loaded.");
		expect(html).toContain('data-retry="route-refresh"');
		expect(html).toContain("Recording controls loaded");
	});
	it("does not load either data set when admin access is refused", async () => {
		mocks.requireAdmin.mockRejectedValue(new Error("forbidden"));
		await expect(content(VehiclesPage())).rejects.toThrow("forbidden");
		expect(mocks.vehicles).not.toHaveBeenCalled();
		expect(mocks.use).not.toHaveBeenCalled();
	});
});
