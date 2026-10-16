// @vitest-environment jsdom

import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VehicleSettingsData } from "@/app/[locale]/(app)/settings/vehicles/actions";
import type { OrganizationVehicleView } from "@/lib/organization/vehicles/vehicles";
import { VehicleSettings } from "./vehicle-settings";

const { changeMock, toastMock } = vi.hoisted(() => ({
	changeMock: vi.fn(),
	toastMock: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: Record<string, unknown>) => {
			let translated = fallback;
			for (const [key, value] of Object.entries(params ?? {})) {
				translated = translated.replace(`{${key}}`, String(value));
			}
			return translated;
		},
	}),
}));
vi.mock("@/app/[locale]/(app)/settings/vehicles/actions", () => ({
	changeVehicles: changeMock,
}));
vi.mock("@/app/[locale]/(app)/settings/vehicles/photo-actions", () => ({
	listVehiclePhotos: vi.fn(),
	initiateVehiclePhotoUpload: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: toastMock }));
// The real picker loads selected employees through React Query.
vi.mock("@/components/employee-select", () => ({
	EmployeeMultiSelect: ({ label }: { label: string }) => <p>{label}</p>,
}));

function vehicle(overrides: Partial<OrganizationVehicleView> = {}): OrganizationVehicleView {
	return {
		id: "v-1",
		name: "Van",
		licencePlate: "M-AB 1234",
		archived: false,
		drivers: { employees: [], teams: [] },
		...overrides,
	};
}

function data(vehicles: OrganizationVehicleView[]): VehicleSettingsData {
	return {
		vehicles,
		employees: [
			{
				id: "e-1",
				name: "Max Member",
				email: "max@example.test",
				isActive: true,
			},
		],
		teams: [{ id: "t-1", name: "Field service" }],
	};
}

describe("VehicleSettings", () => {
	beforeEach(() => {
		changeMock.mockReset();
		toastMock.success.mockReset();
		toastMock.error.mockReset();
	});

	afterEach(cleanup);

	it("says that Z8 is not a tax-compliant logbook", () => {
		render(<VehicleSettings initialData={data([])} />);

		expect(screen.getByText("Not a tax logbook")).toBeTruthy();
		expect(screen.getByText(/not a tax-compliant logbook \(Fahrtenbuch\)/)).toBeTruthy();
	});

	it("lists active vehicles with their drivers and archived vehicles apart", () => {
		render(
			<VehicleSettings
				initialData={data([
					vehicle({
						id: "a",
						name: "Van",
						drivers: {
							employees: [{ id: "e-1", name: "Max Member" }],
							teams: [{ id: "t-1", name: "Field service" }],
						},
					}),
					vehicle({
						id: "b",
						name: "Old car",
						licencePlate: "B-X 1",
						archived: true,
					}),
				])}
			/>,
		);

		const active = screen.getByRole("list", { name: "Active vehicles" });
		expect(within(active).getByText("Van")).toBeTruthy();
		expect(within(active).getByText("M-AB 1234")).toBeTruthy();
		expect(within(active).getByText("Max Member, Field service")).toBeTruthy();
		const archived = screen.getByRole("list", { name: "Archived vehicles" });
		expect(within(archived).getByText("Old car")).toBeTruthy();
		expect(within(archived).getByRole("button", { name: "Restore Old car" })).toBeTruthy();
	});

	it("refreshes the saved list while preserving an open vehicle draft", async () => {
		const { rerender } = render(<VehicleSettings initialData={data([vehicle()])} />);
		await userEvent.click(screen.getByRole("button", { name: "Edit Van" }));
		const input = screen.getByLabelText("Name");
		await userEvent.clear(input);
		await userEvent.type(input, "Unsaved van name");
		rerender(<VehicleSettings initialData={data([vehicle({ name: "Renamed elsewhere" })])} />);
		expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("Unsaved van name");
		expect(screen.getByRole("dialog")).toBeTruthy();
		await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
		expect(
			within(screen.getByRole("list", { name: "Active vehicles" })).getByText("Renamed elsewhere"),
		).toBeTruthy();
	});

	it("creates a vehicle from the dialog", async () => {
		const created = vehicle({
			id: "new",
			name: "Van 2",
			licencePlate: "M-XY 2",
		});
		changeMock.mockResolvedValue({
			success: true,
			data: { ok: true, vehicles: [created] },
		});
		render(<VehicleSettings initialData={data([])} />);

		await userEvent.click(screen.getByRole("button", { name: "Add vehicle" }));
		const name = screen.getByLabelText("Name");
		await waitFor(() => expect(document.activeElement).toBe(name));
		await userEvent.type(name, "Van 2");
		await userEvent.type(screen.getByLabelText("Licence plate"), "m-xy 2");
		await userEvent.click(screen.getByRole("switch", { name: "Field service" }));
		await userEvent.click(screen.getByRole("button", { name: "Create vehicle" }));

		await waitFor(() =>
			expect(changeMock).toHaveBeenCalledWith({
				kind: "create",
				name: "Van 2",
				licencePlate: "m-xy 2",
				drivers: { employeeIds: [], teamIds: ["t-1"] },
			}),
		);
		await waitFor(() =>
			expect(
				within(screen.getByRole("list", { name: "Active vehicles" })).getByText("Van 2"),
			).toBeTruthy(),
		);
	});

	it("shows why the server refused a change", async () => {
		changeMock.mockResolvedValue({
			success: true,
			data: { ok: false, reason: "licence_plate_taken" },
		});
		render(<VehicleSettings initialData={data([vehicle({ archived: true })])} />);

		await userEvent.click(screen.getByRole("button", { name: "Restore Van" }));

		await waitFor(() =>
			expect(toastMock.error).toHaveBeenCalledWith(
				"Another vehicle of your organization already has this licence plate.",
			),
		);
	});

	it("offers archiving when a vehicle recorded on work cannot be deleted", async () => {
		changeMock
			.mockResolvedValueOnce({
				success: true,
				data: { ok: false, reason: "vehicle_used" },
			})
			.mockResolvedValueOnce({
				success: true,
				data: { ok: true, vehicles: [vehicle({ archived: true })] },
			});
		render(<VehicleSettings initialData={data([vehicle()])} />);

		await userEvent.click(screen.getByRole("button", { name: "Delete Van" }));
		await userEvent.click(screen.getByRole("button", { name: "Delete vehicle" }));

		expect(changeMock).toHaveBeenCalledWith({
			kind: "delete",
			vehicleId: "v-1",
		});
		await userEvent.click(await screen.findByRole("button", { name: "Archive instead" }));

		expect(changeMock).toHaveBeenLastCalledWith({
			kind: "archive",
			vehicleId: "v-1",
		});
		await waitFor(() =>
			expect(
				within(screen.getByRole("list", { name: "Archived vehicles" })).getByText("Van"),
			).toBeTruthy(),
		);
	});
});
