// @vitest-environment jsdom

import {
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { VehicleUseAdminData } from "@/app/[locale]/(app)/settings/vehicle-use/actions";
import { VehicleUseSettings } from "./vehicle-use-settings";

const {
	saveMock,
	setAssignmentMock,
	removeAssignmentMock,
	refreshMock,
	toastMock,
} = vi.hoisted(() => ({
	saveMock: vi.fn(),
	setAssignmentMock: vi.fn(),
	removeAssignmentMock: vi.fn(),
	refreshMock: vi.fn(),
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
vi.mock("@/app/[locale]/(app)/settings/vehicle-use/actions", () => ({
	saveVehicleUseSettingsAction: saveMock,
	setVehicleUseAssignmentAction: setAssignmentMock,
	removeVehicleUseAssignmentAction: removeAssignmentMock,
}));
vi.mock("next/navigation", () => ({
	useRouter: () => ({ refresh: refreshMock }),
}));
vi.mock("sonner", () => ({ toast: toastMock }));
vi.mock("@/components/employee-select", () => ({
	EmployeeSingleSelect: ({
		value,
		onChange,
		label,
		disabled,
		employees,
	}: {
		value: string | null;
		onChange: (id: string | null) => void;
		label: string;
		disabled: boolean;
		employees: { id: string; user: { name: string | null } }[];
	}) => (
		<select
			aria-label={label}
			value={value ?? ""}
			disabled={disabled}
			onChange={(event) => onChange(event.target.value)}
		>
			<option value="">Select an employee</option>
			{employees.map((employee) => (
				<option key={employee.id} value={employee.id}>
					{employee.user.name}
				</option>
			))}
		</select>
	),
}));

const teamId = "d1119000-0000-4000-8000-0000000000a1";
const employeeId = "d1119000-0000-4000-8000-000000000004";

function adminData(
	overrides: Partial<VehicleUseAdminData> = {},
): VehicleUseAdminData {
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
		saveMock
			.mockReset()
			.mockResolvedValue({ success: true, data: { enabled: true } });
		setAssignmentMock
			.mockReset()
			.mockResolvedValue({ success: true, data: { assignmentId: "a" } });
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

		await userEvent.click(
			screen.getByRole("switch", { name: "Record vehicle use" }),
		);

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
			screen
				.getByRole("switch", { name: "Record vehicle use" })
				.getAttribute("aria-checked"),
		).toBe("false");
		rerender(
			<VehicleUseSettings data={adminData({ settings: { enabled: true } })} />,
		);
		expect(
			screen
				.getByRole("switch", { name: "Record vehicle use" })
				.getAttribute("aria-checked"),
		).toBe("true");
	});

	it.each(["organization", "team", "employee"] as const)(
		"adds a %s assignment with its mode",
		async (scope) => {
			render(<VehicleUseSettings data={adminData()} />);

			await userEvent.click(screen.getByRole("tab", { name: "Assignments" }));
			expect(screen.getByText("No organization default set")).toBeTruthy();
			expect(screen.getByText("No team-specific settings")).toBeTruthy();
			expect(screen.getByText("No employee-specific settings")).toBeTruthy();
			await userEvent.click(
				screen.getByRole("button", {
					name:
						scope === "organization"
							? "Set Organization Default"
							: scope === "team"
								? "Add Team"
								: "Add Employee",
				}),
			);
			if (scope === "team") {
				await userEvent.click(screen.getByRole("combobox", { name: "Team" }));
				await userEvent.click(
					await screen.findByRole("option", { name: "Drivers" }),
				);
			} else if (scope === "employee") {
				await userEvent.selectOptions(
					screen.getByRole("combobox", { name: "Employee" }),
					employeeId,
				);
			}
			await userEvent.click(screen.getByRole("combobox", { name: "Mode" }));
			await userEvent.click(
				await screen.findByRole("option", { name: "Vehicle use expected" }),
			);
			await userEvent.click(screen.getByRole("button", { name: "Save" }));

			expect(setAssignmentMock).toHaveBeenCalledWith({
				target:
					scope === "organization"
						? { type: "organization" }
						: scope === "team"
							? { type: "team", teamId }
							: { type: "employee", employeeId },
				mode: "expected",
			});
			await waitFor(() => expect(refreshMock).toHaveBeenCalled());
		},
	);

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

		await userEvent.click(screen.getByRole("tab", { name: "Assignments" }));
		const items = [
			screen.getByRole("list", { name: "Organization Default" }),
			screen.getByRole("list", { name: "Employee Overrides" }),
		];
		expect(within(items[0]).getByText("Whole organization")).toBeTruthy();
		expect(within(items[0]).getByRole("combobox").textContent).toContain(
			"Asked",
		);
		expect(within(items[1]).getByText("Dana Driver")).toBeTruthy();
		expect(within(items[1]).getByRole("combobox").textContent).toContain(
			"Off (excluded)",
		);

		fireEvent.click(
			within(items[0]).getByRole("combobox", {
				name: "Mode for Whole organization",
			}),
		);
		await userEvent.click(
			await screen.findByRole("option", { name: "Vehicle use expected" }),
		);
		expect(setAssignmentMock).toHaveBeenCalledWith({
			target: { type: "organization" },
			mode: "expected",
		});

		await userEvent.click(
			within(items[1]).getByRole("button", {
				name: "Remove Dana Driver",
			}),
		);
		expect(removeAssignmentMock).toHaveBeenCalledWith({ assignmentId: "a1" });
	});
});
