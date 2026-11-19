// @vitest-environment jsdom

import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { VehicleSettingsData } from "@/app/[locale]/(app)/settings/vehicles/actions";
import type { OrganizationVehicleView } from "@/lib/organization/vehicles/vehicles";
import { render } from "@/test/render-with-translations";
import { VehicleSettings } from "./vehicle-settings";

vi.mock("@/app/[locale]/(app)/settings/vehicles/actions", () => ({
	changeVehicles: vi.fn(),
}));
vi.mock("@/app/[locale]/(app)/settings/vehicles/photo-actions", () => ({
	listVehiclePhotos: vi.fn(),
	initiateVehiclePhotoUpload: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/components/employee-select", () => ({
	EmployeeMultiSelect: ({ label }: { label: string }) => <p>{label}</p>,
}));

function vehicle(id: string, archived = false): OrganizationVehicleView {
	return {
		id,
		name: `Vehicle ${id}`,
		licencePlate: `M-${id}`,
		archived,
		drivers: { employees: [], teams: [] },
	};
}

function data(vehicles: OrganizationVehicleView[]): VehicleSettingsData {
	return { vehicles, employees: [], teams: [] };
}

describe("VehicleSettings toolbar", () => {
	afterEach(cleanup);

	it("counts every vehicle instead of repeating the page title, beside the add action", () => {
		render(<VehicleSettings initialData={data([vehicle("a"), vehicle("b", true)])} />);

		const count = screen.getByText("2 vehicles");
		expect(count.className).toContain("tabular-nums");
		expect(screen.queryByText("Vehicles")).toBeNull();
		expect(screen.getByRole("button", { name: "Add vehicle" })).toBeTruthy();
		// Active and archived vehicles stay listed apart.
		expect(screen.getByRole("list", { name: "Active vehicles" })).toBeTruthy();
		expect(screen.getByRole("list", { name: "Archived vehicles" })).toBeTruthy();
	});

	it("uses the singular for one vehicle and counts zero", () => {
		const { unmount } = render(<VehicleSettings initialData={data([vehicle("a")])} />);
		expect(screen.getByText("1 vehicle")).toBeTruthy();
		unmount();

		render(<VehicleSettings initialData={data([])} />);
		expect(screen.getByText("0 vehicles")).toBeTruthy();
		expect(screen.getByText("No vehicles yet.")).toBeTruthy();
	});
});
