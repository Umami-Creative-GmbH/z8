// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IntendedDriverAdminData } from "@/lib/organization/driving-licence/intended-driver-rules";

const api = vi.hoisted(() => ({
	set: vi.fn(),
	remove: vi.fn(),
	previewSet: vi.fn(),
	previewRemove: vi.fn(),
	refresh: vi.fn(),
	invalidate: vi.fn(),
	toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: Record<string, string>) =>
			Object.entries(params ?? {}).reduce(
				(text, [key, value]) => text.replace(`{${key}}`, value),
				fallback,
			),
	}),
}));
vi.mock("@tanstack/react-query", () => ({
	useQueryClient: () => ({ invalidateQueries: api.invalidate }),
}));
vi.mock("next/navigation", () => ({
	useRouter: () => ({ refresh: api.refresh }),
}));
vi.mock("sonner", () => ({ toast: api.toast }));
vi.mock("@/lib/organization/driving-licence/intended-driver-actions", () => ({
	setDrivingLicenceIntendedDriverAssignmentAction: api.set,
	removeDrivingLicenceIntendedDriverAssignmentAction: api.remove,
	previewDrivingLicenceIntendedDriverAssignmentAction: api.previewSet,
	previewDrivingLicenceIntendedDriverRemovalAction: api.previewRemove,
}));
vi.mock("@/components/employee-select", () => ({
	EmployeeSingleSelect: ({
		value,
		onChange,
		label,
		employees,
	}: {
		value: string | null;
		onChange: (id: string | null) => void;
		label: string;
		employees: { id: string; user: { name: string | null } }[];
	}) => (
		<select
			aria-label={label}
			value={value ?? ""}
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

import { IntendedDriverSettings } from "./intended-driver-settings";

const teamId = "d1423000-0000-4000-8000-0000000000a1";
const employeeId = "d1423000-0000-4000-8000-000000000004";
function adminData(overrides: Partial<IntendedDriverAdminData> = {}): IntendedDriverAdminData {
	return {
		assignments: [],
		teams: [{ id: teamId, name: "Delivery" }],
		employees: [{ id: employeeId, name: "Dana Driver" }],
		...overrides,
	};
}
const nobodyEnds = { success: true, data: { employees: [], previewToken: "0".repeat(64) } };
const token = "a".repeat(64);
const danaEnds = {
	success: true,
	data: {
		employees: [{ employeeId, name: "Dana Driver", classCodes: ["B", "CE"] }],
		previewToken: token,
	},
};
const stamp = {
	createdAt: "2026-01-15T08:30:00.000Z",
	createdBy: "owner",
	updatedAt: "2026-01-15T08:30:00.000Z",
	updatedBy: "owner",
};

describe("IntendedDriverSettings", () => {
	beforeEach(() => {
		api.set.mockReset().mockResolvedValue({ success: true, data: { assignmentId: "a" } });
		api.remove.mockReset().mockResolvedValue({ success: true, data: { assignmentId: "a" } });
		api.previewSet.mockReset().mockResolvedValue(nobodyEnds);
		api.previewRemove.mockReset().mockResolvedValue(nobodyEnds);
		api.refresh.mockReset();
		api.invalidate.mockReset();
		api.toast.success.mockReset();
		api.toast.error.mockReset();
	});

	it("shows organization, team and employee cards, and that nobody is an intended driver yet", () => {
		render(<IntendedDriverSettings data={adminData()} />);
		expect(screen.getByRole("heading", { name: "Intended drivers" })).toBeTruthy();
		expect(screen.getByText(/Nobody is an intended driver until you assign them/)).toBeTruthy();
		expect(screen.getByText("No organization default set")).toBeTruthy();
		expect(screen.getByText("No team-specific settings")).toBeTruthy();
		expect(screen.getByText("No employee-specific settings")).toBeTruthy();
		expect(screen.queryByRole("checkbox")).toBeNull();
	});

	it.each(["organization", "team", "employee"] as const)(
		"adds a %s assignment as Required or Not required",
		async (scope) => {
			render(<IntendedDriverSettings data={adminData()} />);
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
				await userEvent.click(await screen.findByRole("option", { name: "Delivery" }));
			} else if (scope === "employee") {
				await userEvent.selectOptions(
					screen.getByRole("combobox", { name: "Employee" }),
					employeeId,
				);
			}
			await userEvent.click(screen.getByRole("combobox", { name: "Driving licence checks" }));
			await userEvent.click(await screen.findByRole("option", { name: "Not required (excluded)" }));
			await userEvent.click(screen.getByRole("button", { name: "Save" }));

			expect(api.set).toHaveBeenCalledWith({
				target:
					scope === "organization"
						? { type: "organization" }
						: scope === "team"
							? { type: "team", teamId }
							: { type: "employee", employeeId },
				value: "not_required",
				// The empty preview's token is confirmed too.
				previewToken: nobodyEnds.data.previewToken,
			});
			await waitFor(() => expect(api.refresh).toHaveBeenCalled());
			expect(api.toast.success).toHaveBeenCalledWith("Intended drivers saved");
		},
	);

	it("changes and removes listed assignments", async () => {
		render(
			<IntendedDriverSettings
				data={adminData({
					assignments: [
						{
							id: "a0",
							assignmentType: "organization",
							teamId: null,
							employeeId: null,
							value: "required",
							...stamp,
						},
						{
							id: "a1",
							assignmentType: "team",
							teamId,
							employeeId: null,
							value: "not_required",
							...stamp,
						},
					],
				})}
			/>,
		);
		const organization = screen.getByRole("list", { name: "Organization Default" });
		const teams = screen.getByRole("list", { name: "Team Overrides" });
		expect(within(organization).getByText("Whole organization")).toBeTruthy();
		expect(within(organization).getByRole("combobox").textContent).toContain("Required");
		expect(within(teams).getByText("Delivery")).toBeTruthy();
		expect(within(teams).getByRole("combobox").textContent).toContain("Not required (excluded)");

		fireEvent.click(
			within(organization).getByRole("combobox", {
				name: "Driving licence checks for Whole organization",
			}),
		);
		await userEvent.click(await screen.findByRole("option", { name: "Not required (excluded)" }));
		expect(api.set).toHaveBeenCalledWith({
			target: { type: "organization" },
			value: "not_required",
			previewToken: nobodyEnds.data.previewToken,
		});

		await userEvent.click(within(teams).getByRole("button", { name: "Remove Delivery" }));
		await waitFor(() =>
			expect(api.remove).toHaveBeenCalledWith({
				assignmentId: "a1",
				previewToken: nobodyEnds.data.previewToken,
			}),
		);
		await waitFor(() =>
			expect(api.toast.success).toHaveBeenCalledWith("Intended driver assignment removed"),
		);
	});

	it("shows who loses which classes before a save that ends authorizations, and saves on confirmation", async () => {
		api.previewSet.mockResolvedValue(danaEnds);
		render(<IntendedDriverSettings data={adminData()} />);
		await userEvent.click(screen.getByRole("button", { name: "Set Organization Default" }));
		await userEvent.click(screen.getByRole("combobox", { name: "Driving licence checks" }));
		await userEvent.click(await screen.findByRole("option", { name: "Not required (excluded)" }));
		await userEvent.click(screen.getByRole("button", { name: "Save" }));

		const dialog = await screen.findByRole("alertdialog", { name: "End driving authorizations?" });
		const list = within(dialog).getByRole("list", { name: "Driving authorizations that end" });
		expect(within(list).getByText("Dana Driver")).toBeTruthy();
		expect(within(list).getByText("B, CE")).toBeTruthy();
		expect(api.previewSet).toHaveBeenCalledWith({
			target: { type: "organization" },
			value: "not_required",
		});
		expect(api.set).not.toHaveBeenCalled();

		await userEvent.click(
			within(dialog).getByRole("button", { name: "Save and end authorizations" }),
		);
		await waitFor(() =>
			expect(api.set).toHaveBeenCalledWith({
				target: { type: "organization" },
				value: "not_required",
				previewToken: token,
			}),
		);
		await waitFor(() => expect(api.refresh).toHaveBeenCalled());
	});

	it("saves nothing when the admin cancels the ending", async () => {
		api.previewRemove.mockResolvedValue(danaEnds);
		render(
			<IntendedDriverSettings
				data={adminData({
					assignments: [
						{
							id: "a1",
							assignmentType: "team",
							teamId,
							employeeId: null,
							value: "required",
							...stamp,
						},
					],
				})}
			/>,
		);
		const teams = screen.getByRole("list", { name: "Team Overrides" });
		await userEvent.click(within(teams).getByRole("button", { name: "Remove Delivery" }));
		const dialog = await screen.findByRole("alertdialog");
		await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
		await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
		expect(api.previewRemove).toHaveBeenCalledWith({ assignmentId: "a1" });
		expect(api.remove).not.toHaveBeenCalled();
		expect(api.refresh).not.toHaveBeenCalled();
	});

	it("removes on confirmation with the confirmed preview", async () => {
		api.previewRemove.mockResolvedValue(danaEnds);
		render(
			<IntendedDriverSettings
				data={adminData({
					assignments: [
						{
							id: "a1",
							assignmentType: "team",
							teamId,
							employeeId: null,
							value: "required",
							...stamp,
						},
					],
				})}
			/>,
		);
		const teams = screen.getByRole("list", { name: "Team Overrides" });
		await userEvent.click(within(teams).getByRole("button", { name: "Remove Delivery" }));
		const dialog = await screen.findByRole("alertdialog");
		await userEvent.click(
			within(dialog).getByRole("button", { name: "Save and end authorizations" }),
		);
		await waitFor(() =>
			expect(api.remove).toHaveBeenCalledWith({ assignmentId: "a1", previewToken: token }),
		);
	});

	it("asks for a fresh review when the ending changed before the save", async () => {
		api.previewSet.mockResolvedValue(danaEnds);
		api.set.mockResolvedValue({ success: false, error: "stale_preview" });
		render(<IntendedDriverSettings data={adminData()} />);
		await userEvent.click(screen.getByRole("button", { name: "Set Organization Default" }));
		await userEvent.click(screen.getByRole("button", { name: "Save" }));
		const dialog = await screen.findByRole("alertdialog");
		await userEvent.click(
			within(dialog).getByRole("button", { name: "Save and end authorizations" }),
		);
		await waitFor(() =>
			expect(api.toast.error).toHaveBeenCalledWith(
				"Who this change affects has changed in the meantime. Review it and save again.",
			),
		);
		expect(api.refresh).not.toHaveBeenCalled();
	});

	it("explains a refusal by its code", async () => {
		api.set.mockResolvedValue({ success: false, error: "not_enabled" });
		render(<IntendedDriverSettings data={adminData()} />);
		await userEvent.click(screen.getByRole("button", { name: "Set Organization Default" }));
		await userEvent.click(screen.getByRole("button", { name: "Save" }));
		await waitFor(() =>
			expect(api.toast.error).toHaveBeenCalledWith(
				"Switch on driving licence control before assigning intended drivers.",
			),
		);
		expect(api.refresh).not.toHaveBeenCalled();
	});
});
