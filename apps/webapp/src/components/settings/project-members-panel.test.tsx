/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectWithDetails } from "@/app/[locale]/(app)/settings/projects/actions";
import { ProjectMembersPanel } from "./project-members-panel";

const actions = vi.hoisted(() => ({
	addProjectAssignment: vi.fn(),
	removeProjectAssignment: vi.fn(),
	addProjectManager: vi.fn(),
	removeProjectManager: vi.fn(),
	getTeamsForSelection: vi.fn(),
	getEmployeesForSelection: vi.fn(),
}));

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));

vi.mock("@/app/[locale]/(app)/settings/projects/actions", () => actions);

vi.mock("sonner", () => ({ toast }));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: Record<string, unknown>) =>
			params
				? fallback.replace(/\{(\w+)\}/g, (match, name: string) => String(params[name] ?? match))
				: fallback,
	}),
}));

// Radix Select needs pointer APIs jsdom lacks; a native select keeps the same contract.
vi.mock("@/components/ui/select", () => {
	const SelectTrigger = (_props: { id?: string; "aria-label"?: string; children?: ReactNode }) =>
		null;
	const SelectValue = (_props: { placeholder?: string }) => null;
	const SelectContent = ({ children }: { children: ReactNode }) => <>{children}</>;
	const SelectItem = ({ value, children }: { value: string; children: ReactNode }) => (
		<option value={value}>{children}</option>
	);
	const Select = ({
		value,
		onValueChange,
		disabled,
		children,
	}: {
		value?: string;
		onValueChange?: (value: string) => void;
		disabled?: boolean;
		children: ReactNode;
	}) => {
		const parts = Children.toArray(children).filter(isValidElement) as ReactElement<{
			id?: string;
			"aria-label"?: string;
			children?: ReactNode;
		}>[];
		const trigger = parts.find((part) => part.type === SelectTrigger);
		const content = parts.find((part) => part.type === SelectContent);
		return (
			<select
				id={trigger?.props.id}
				aria-label={trigger?.props["aria-label"]}
				value={value}
				disabled={disabled}
				onChange={(event) => onValueChange?.(event.target.value)}
			>
				<option value="" />
				{content?.props.children}
			</select>
		);
	};
	return { Select, SelectContent, SelectItem, SelectTrigger, SelectValue };
});

function project(overrides: Partial<ProjectWithDetails> = {}): ProjectWithDetails {
	return {
		id: "project-1",
		organizationId: "org-1",
		name: "Apollo",
		description: null,
		status: "active",
		icon: null,
		color: null,
		budgetHours: null,
		deadline: null,
		customerId: null,
		customerName: null,
		isActive: true,
		createdAt: new Date("2026-01-01T00:00:00Z"),
		createdBy: "user-1",
		updatedAt: new Date("2026-01-01T00:00:00Z"),
		updatedBy: null,
		managers: [{ id: "pm-row-1", employeeId: "emp-pm", employeeName: "Pat Manager" }],
		assignments: [
			{
				id: "assignment-team",
				type: "team",
				teamId: "team-1",
				teamName: "Design",
				employeeId: null,
				employeeName: null,
			},
			{
				id: "assignment-employee",
				type: "employee",
				teamId: null,
				teamName: null,
				employeeId: "emp-1",
				employeeName: "Avery Employee",
			},
		],
		totalHoursBooked: 0,
		...overrides,
	};
}

function renderPanel(props: Partial<Parameters<typeof ProjectMembersPanel>[0]> = {}): {
	onChanged: ReturnType<typeof vi.fn>;
} {
	const onChanged = vi.fn();
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	render(
		<QueryClientProvider client={client}>
			<ProjectMembersPanel
				organizationId="org-1"
				project={project()}
				open
				onOpenChange={vi.fn()}
				canManageProjectManagers
				onChanged={onChanged}
				{...props}
			/>
		</QueryClientProvider>,
	);
	return { onChanged };
}

describe("ProjectMembersPanel", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		actions.getTeamsForSelection.mockResolvedValue({
			success: true,
			data: [
				{ id: "team-1", name: "Design" },
				{ id: "team-2", name: "Engineering" },
			],
		});
		actions.getEmployeesForSelection.mockResolvedValue({
			success: true,
			data: [
				{ id: "emp-1", name: "Avery Employee", role: "employee" },
				{ id: "emp-2", name: "Blake Builder", role: "employee" },
				{ id: "emp-pm", name: "Pat Manager", role: "manager" },
			],
		});
	});

	it("lists assigned teams, assigned employees and project managers in separate groups", () => {
		renderPanel();

		const teams = screen.getByRole("region", { name: "Teams" });
		const employees = screen.getByRole("region", { name: "Employees" });
		const managers = screen.getByRole("region", { name: "Project managers" });

		expect(within(teams).getByText("Design")).toBeTruthy();
		expect(within(teams).queryByText("Avery Employee")).toBeNull();
		expect(within(employees).getByText("Avery Employee")).toBeTruthy();
		expect(within(employees).queryByText("Design")).toBeNull();
		expect(within(managers).getByText("Pat Manager")).toBeTruthy();
	});

	it("adds an unassigned team and refreshes the project", async () => {
		const user = userEvent.setup();
		actions.addProjectAssignment.mockResolvedValue({ success: true, data: undefined });
		const { onChanged } = renderPanel();

		const teams = screen.getByRole("region", { name: "Teams" });
		const picker = within(teams).getByRole("combobox", { name: "Team to assign" });
		await within(picker).findByRole("option", { name: "Engineering" });
		expect(within(picker).queryByRole("option", { name: "Design" })).toBeNull();

		await user.selectOptions(picker, "team-2");
		await user.click(within(teams).getByRole("button", { name: "Assign team" }));

		expect(actions.addProjectAssignment).toHaveBeenCalledWith("project-1", "team", "team-2");
		expect(toast.success).toHaveBeenCalledWith("Team assigned");
		expect(onChanged).toHaveBeenCalledTimes(1);
	});

	it("removes an employee assignment and refreshes the project", async () => {
		const user = userEvent.setup();
		actions.removeProjectAssignment.mockResolvedValue({ success: true, data: undefined });
		const { onChanged } = renderPanel();

		const employees = screen.getByRole("region", { name: "Employees" });
		await user.click(within(employees).getByRole("button", { name: "Remove Avery Employee" }));

		expect(actions.removeProjectAssignment).toHaveBeenCalledWith("assignment-employee");
		expect(toast.success).toHaveBeenCalledWith("Avery Employee removed");
		expect(onChanged).toHaveBeenCalledTimes(1);
	});

	it("reports a rejected employee assignment without refreshing", async () => {
		const user = userEvent.setup();
		actions.addProjectAssignment.mockResolvedValue({
			success: false,
			error: "Employee not found in this organization",
		});
		const { onChanged } = renderPanel();

		const employees = screen.getByRole("region", { name: "Employees" });
		const picker = within(employees).getByRole("combobox", { name: "Employee to assign" });
		await within(picker).findByRole("option", { name: "Blake Builder" });
		expect(within(picker).queryByRole("option", { name: "Avery Employee" })).toBeNull();

		await user.selectOptions(picker, "emp-2");
		await user.click(within(employees).getByRole("button", { name: "Assign employee" }));

		expect(actions.addProjectAssignment).toHaveBeenCalledWith("project-1", "employee", "emp-2");
		expect(toast.error).toHaveBeenCalledWith("Employee not found in this organization");
		expect(onChanged).not.toHaveBeenCalled();
	});

	it("lets an org admin add and remove project managers", async () => {
		const user = userEvent.setup();
		actions.addProjectManager.mockResolvedValue({ success: true, data: undefined });
		actions.removeProjectManager.mockResolvedValue({ success: true, data: undefined });
		const { onChanged } = renderPanel({ canManageProjectManagers: true });

		const managers = screen.getByRole("region", { name: "Project managers" });
		const picker = within(managers).getByRole("combobox", { name: "Project manager to add" });
		await within(picker).findByRole("option", { name: "Blake Builder" });
		expect(within(picker).queryByRole("option", { name: "Pat Manager" })).toBeNull();

		await user.selectOptions(picker, "emp-2");
		await user.click(within(managers).getByRole("button", { name: "Add project manager" }));
		expect(actions.addProjectManager).toHaveBeenCalledWith("project-1", "emp-2");
		expect(toast.success).toHaveBeenCalledWith("Project manager added");

		await user.click(within(managers).getByRole("button", { name: "Remove Pat Manager" }));
		expect(actions.removeProjectManager).toHaveBeenCalledWith("project-1", "emp-pm");
		expect(onChanged).toHaveBeenCalledTimes(2);
	});

	it("shows project managers read-only to a manager-tier viewer", () => {
		renderPanel({ canManageProjectManagers: false });

		const managers = screen.getByRole("region", { name: "Project managers" });
		expect(within(managers).getByText("Pat Manager")).toBeTruthy();
		expect(within(managers).queryByRole("button")).toBeNull();
		expect(within(managers).queryByRole("combobox")).toBeNull();
		expect(
			within(managers).getByText("Only organization admins can change project managers."),
		).toBeTruthy();

		// Assignments stay editable for managers of the project.
		const employees = screen.getByRole("region", { name: "Employees" });
		expect(within(employees).getByRole("button", { name: "Remove Avery Employee" })).toBeTruthy();
	});
});
