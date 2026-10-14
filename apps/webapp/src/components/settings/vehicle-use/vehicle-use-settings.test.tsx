// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { VehicleUseAdminData } from "@/app/[locale]/(app)/settings/vehicle-use/actions";
import { VehicleUseSettings } from "./vehicle-use-settings";

const { saveMock, setAssignmentMock, removeAssignmentMock, refreshMock, toastMock } = vi.hoisted(
	() => ({
		saveMock: vi.fn(),
		setAssignmentMock: vi.fn(),
		removeAssignmentMock: vi.fn(),
		refreshMock: vi.fn(),
		toastMock: { success: vi.fn(), error: vi.fn() },
	}),
);

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
vi.mock("@/app/[locale]/(app)/settings/vehicle-use/actions", () => ({
	saveVehicleUseSettingsAction: saveMock,
	setVehicleUseAssignmentAction: setAssignmentMock,
	removeVehicleUseAssignmentAction: removeAssignmentMock,
}));
vi.mock("next/navigation", () => ({
	useRouter: () => ({ refresh: refreshMock }),
}));
vi.mock("sonner", () => ({ toast: toastMock }));

const teamId = "d1119000-0000-4000-8000-0000000000a1";
const employeeId = "d1119000-0000-4000-8000-000000000004";

function adminData(overrides: Partial<VehicleUseAdminData> = {}): VehicleUseAdminData {
	return {
		settings: { enabled: false },
		assignments: [],
		teams: [{ id: teamId, name: "Drivers" }],
		employees: [{ id: employeeId, name: "Dana Driver" }],
		...overrides,
	};
}

describe("VehicleUseSettings", () => {
	beforeEach(() => {
		saveMock.mockReset().mockResolvedValue({ success: true, data: { enabled: true } });
		setAssignmentMock.mockReset().mockResolvedValue({ success: true, data: { assignmentId: "a" } });
		removeAssignmentMock
			.mockReset()
			.mockResolvedValue({ success: true, data: { assignmentId: "a" } });
		refreshMock.mockReset();
		toastMock.success.mockReset();
		toastMock.error.mockReset();
	});

	it("switches vehicle use on for the organization", async () => {
		render(<VehicleUseSettings data={adminData()} />);

		const toggle = screen.getByRole("switch", { name: "Record vehicle use" });
		expect(toggle.getAttribute("aria-checked")).toBe("false");
		await userEvent.click(toggle);

		expect(saveMock).toHaveBeenCalledWith({ enabled: true });
		await waitFor(() => expect(refreshMock).toHaveBeenCalled());
	});

	it("translates a refusal by its code and never shows the server's text", async () => {
		saveMock.mockResolvedValue({
			success: false,
			error: "diagnostic",
			code: "admin_only",
		});
		render(<VehicleUseSettings data={adminData()} />);

		await userEvent.click(screen.getByRole("switch", { name: "Record vehicle use" }));

		await waitFor(() =>
			expect(toastMock.error).toHaveBeenCalledWith(
				"Only organization owners and admins can manage vehicle use.",
			),
		);
		expect(refreshMock).not.toHaveBeenCalled();
	});

	it("uses refreshed organization settings after a server-side change", () => {
		const { rerender } = render(<VehicleUseSettings data={adminData()} />);
		expect(
			screen.getByRole("switch", { name: "Record vehicle use" }).getAttribute("aria-checked"),
		).toBe("false");
		rerender(<VehicleUseSettings data={adminData({ settings: { enabled: true } })} />);
		expect(
			screen.getByRole("switch", { name: "Record vehicle use" }).getAttribute("aria-checked"),
		).toBe("true");
	});

	it("adds an assignment with its mode", async () => {
		render(<VehicleUseSettings data={adminData()} />);

		expect(
			screen.getByText("Nobody is assigned. Vehicle use applies to nobody until you assign it."),
		).toBeTruthy();
		await userEvent.click(screen.getByRole("combobox", { name: "Team" }));
		await userEvent.click(await screen.findByRole("option", { name: "Drivers" }));
		await userEvent.click(screen.getByRole("combobox", { name: "Mode" }));
		await userEvent.click(await screen.findByRole("option", { name: "Vehicle use expected" }));
		await userEvent.click(screen.getByRole("button", { name: "Add assignment" }));

		expect(setAssignmentMock).toHaveBeenCalledWith({
			target: { type: "team", teamId },
			mode: "expected",
		});
		await waitFor(() => expect(refreshMock).toHaveBeenCalled());
	});

	it("lists assignments with their mode and lets admins change and remove them", async () => {
		render(
			<VehicleUseSettings
				data={adminData({
					settings: { enabled: true },
					assignments: [
						{
							id: "a0",
							assignmentType: "organization",
							teamId: null,
							employeeId: null,
							mode: "asked",
						},
						{
							id: "a1",
							assignmentType: "employee",
							teamId: null,
							employeeId,
							mode: "off",
						},
					],
				})}
			/>,
		);

		const list = screen.getByRole("list", { name: "Vehicle use assignments" });
		const items = within(list).getAllByRole("listitem");
		expect(within(items[0]).getByText("Whole organization")).toBeTruthy();
		expect(within(items[0]).getByRole("combobox").textContent).toContain("Asked");
		expect(within(items[1]).getByText("Employee: Dana Driver")).toBeTruthy();
		expect(within(items[1]).getByRole("combobox").textContent).toContain("Off (excluded)");

		fireEvent.click(
			within(items[0]).getByRole("combobox", {
				name: "Mode for Whole organization",
			}),
		);
		await userEvent.click(await screen.findByRole("option", { name: "Vehicle use expected" }));
		expect(setAssignmentMock).toHaveBeenCalledWith({
			target: { type: "organization" },
			mode: "expected",
		});

		await userEvent.click(
			within(items[1]).getByRole("button", {
				name: "Remove Employee: Dana Driver",
			}),
		);
		expect(removeAssignmentMock).toHaveBeenCalledWith({ assignmentId: "a1" });
	});
});
