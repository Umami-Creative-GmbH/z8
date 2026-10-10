/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
	ProjectTemplate,
	ProjectTemplateSummary,
} from "@/lib/projects/project-template-model";
import { ProjectTemplateManagement } from "./project-template-management";

const templateActions = vi.hoisted(() => ({
	getProjectTemplates: vi.fn(),
	getProjectTemplateDetails: vi.fn(),
	createProjectTemplate: vi.fn(),
	updateProjectTemplate: vi.fn(),
	deleteProjectTemplate: vi.fn(),
}));

const projectActions = vi.hoisted(() => ({
	getTeamsForSelection: vi.fn(),
	getEmployeesForSelection: vi.fn(),
}));

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));

vi.mock("@/app/[locale]/(app)/settings/projects/template-actions", () => templateActions);
vi.mock("@/app/[locale]/(app)/settings/projects/actions", () => projectActions);

vi.mock("sonner", () => ({ toast }));

vi.mock("next-intl", () => ({ useLocale: () => "en" }));

// Renders defaults with their parameters, including `{count, plural, one {…} other {…}}`.
vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: Record<string, unknown>) =>
			params
				? fallback
						.replace(
							/\{(\w+), plural, one \{([^}]*)\} other \{([^}]*)\}\}/g,
							(_match, name: string, one: string, other: string) =>
								(params[name] === 1 ? one : other).replace("#", String(params[name])),
						)
						.replace(/\{(\w+)\}/g, (match, name: string) => String(params[name] ?? match))
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
		children,
	}: {
		value?: string;
		onValueChange?: (value: string) => void;
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
				onChange={(event) => onValueChange?.(event.target.value)}
			>
				<option value="" />
				{content?.props.children}
			</select>
		);
	};
	return { Select, SelectContent, SelectItem, SelectTrigger, SelectValue };
});

function summary(overrides: Partial<ProjectTemplateSummary> = {}): ProjectTemplateSummary {
	return {
		id: "template-1",
		name: "Website relaunch",
		description: "Our standard relaunch",
		icon: null,
		color: "#3b82f6",
		budgetHours: "120.00",
		deadlineOffsetDays: 30,
		taskCount: 2,
		managerCount: 1,
		assignmentCount: 3,
		updatedAt: new Date("2026-01-01T00:00:00Z"),
		...overrides,
	};
}

function details(overrides: Partial<ProjectTemplate> = {}): ProjectTemplate {
	return {
		id: "template-1",
		organizationId: "org-1",
		name: "Website relaunch",
		description: "Our standard relaunch",
		icon: null,
		color: "#3b82f6",
		budgetHours: "120.00",
		deadlineOffsetDays: 30,
		createdAt: new Date("2026-01-01T00:00:00Z"),
		updatedAt: new Date("2026-01-01T00:00:00Z"),
		tasks: [{ id: "tt-1", name: "Design", description: "Wireframes", estimateHours: "12.50" }],
		managers: [{ id: "tm-1", employeeId: "emp-left", name: "Lee Left", availability: "departed" }],
		assignments: [
			{
				id: "ta-1",
				type: "team",
				teamId: "team-1",
				employeeId: null,
				name: "Design team",
				availability: "available",
			},
			{
				id: "ta-2",
				type: "team",
				teamId: null,
				employeeId: null,
				name: "Old team",
				availability: "removed",
			},
		],
		...overrides,
	};
}

function renderManagement() {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	render(
		<QueryClientProvider client={client}>
			<ProjectTemplateManagement organizationId="org-1" />
		</QueryClientProvider>,
	);
}

describe("ProjectTemplateManagement", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		templateActions.getProjectTemplates.mockResolvedValue({ success: true, data: [summary()] });
		templateActions.getProjectTemplateDetails.mockResolvedValue({ success: true, data: details() });
		templateActions.createProjectTemplate.mockResolvedValue({ success: true, data: { id: "new" } });
		templateActions.updateProjectTemplate.mockResolvedValue({ success: true, data: undefined });
		templateActions.deleteProjectTemplate.mockResolvedValue({ success: true, data: undefined });
		projectActions.getTeamsForSelection.mockResolvedValue({
			success: true,
			data: [
				{ id: "team-1", name: "Design team" },
				{ id: "team-2", name: "Build team" },
			],
		});
		projectActions.getEmployeesForSelection.mockResolvedValue({
			success: true,
			data: [
				{ id: "emp-1", name: "Avery Employee", role: "employee" },
				{ id: "emp-2", name: "Pat Manager", role: "manager" },
			],
		});
	});

	it("lists the templates with what they hold", async () => {
		renderManagement();

		const row = await screen.findByRole("row", { name: /Website relaunch/ });
		expect(within(row).getByText("Our standard relaunch")).toBeTruthy();
		expect(within(row).getByText("2 tasks")).toBeTruthy();
		expect(within(row).getByText("120 h")).toBeTruthy();
		expect(within(row).getByText("30 days after creation")).toBeTruthy();
		expect(within(row).getByText("4 people and teams")).toBeTruthy();
	});

	it("creates a template with a task, a budget, a deadline offset, a manager and assignments", async () => {
		const user = userEvent.setup();
		renderManagement();

		await user.click(await screen.findByRole("button", { name: "Create template" }));
		const form = await screen.findByRole("form", { name: "Create project template" });
		await user.type(within(form).getByLabelText(/^Name/), "Retainer");
		await user.type(within(form).getByLabelText("Budget (hours)"), "40");
		await user.type(within(form).getByLabelText("Deadline (days after creation)"), "14");
		await user.click(within(form).getByRole("button", { name: "Add task" }));
		await user.type(within(form).getByLabelText("Task 1 name"), "Support");
		await user.type(within(form).getByLabelText("Task 1 estimate (hours)"), "8");

		const managerPicker = within(form).getByRole("combobox", { name: "Project manager to add" });
		await within(managerPicker).findByRole("option", { name: "Pat Manager" });
		await user.selectOptions(managerPicker, "emp-2");
		await user.selectOptions(
			within(form).getByRole("combobox", { name: "Team to assign" }),
			"team-2",
		);
		await user.selectOptions(
			within(form).getByRole("combobox", { name: "Employee to assign" }),
			"emp-1",
		);
		expect(within(form).getByRole("listitem", { name: "Pat Manager" })).toBeTruthy();

		await user.click(within(form).getByRole("button", { name: "Create template" }));

		expect(templateActions.createProjectTemplate).toHaveBeenCalledWith({
			name: "Retainer",
			description: null,
			icon: null,
			color: null,
			budgetHours: 40,
			deadlineOffsetDays: 14,
			tasks: [{ name: "Support", description: null, estimateHours: 8 }],
			managerEmployeeIds: ["emp-2"],
			assignments: [
				{ type: "team", targetId: "team-2" },
				{ type: "employee", targetId: "emp-1" },
			],
		});
		expect(toast.success).toHaveBeenCalledWith("Template created");
	});

	it("does not submit a template without a name", async () => {
		const user = userEvent.setup();
		renderManagement();

		await user.click(await screen.findByRole("button", { name: "Create template" }));
		const form = await screen.findByRole("form", { name: "Create project template" });
		await user.click(within(form).getByRole("button", { name: "Create template" }));

		expect(templateActions.createProjectTemplate).not.toHaveBeenCalled();
		expect(within(form).getByText("Enter a template name")).toBeTruthy();
	});

	it("edits a template, keeping a departed manager and dropping a removed team", async () => {
		const user = userEvent.setup();
		renderManagement();

		await user.click(await screen.findByRole("button", { name: "Edit Website relaunch" }));
		const form = await screen.findByRole("form", { name: "Edit Website relaunch" });
		expect(await within(form).findByDisplayValue("Design")).toBeTruthy();
		const departed = within(form).getByRole("listitem", { name: "Lee Left" });
		expect(within(departed).getByText("Left the organization")).toBeTruthy();
		const removed = within(form).getByRole("listitem", { name: "Old team" });
		expect(within(removed).getByText("No longer exists")).toBeTruthy();

		const name = within(form).getByLabelText(/^Name/);
		await user.clear(name);
		await user.type(name, "Relaunch");
		await user.click(within(form).getByRole("button", { name: "Save changes" }));

		expect(templateActions.updateProjectTemplate).toHaveBeenCalledWith("template-1", {
			name: "Relaunch",
			description: "Our standard relaunch",
			icon: null,
			color: "#3b82f6",
			budgetHours: 120,
			deadlineOffsetDays: 30,
			tasks: [{ name: "Design", description: "Wireframes", estimateHours: 12.5 }],
			managerEmployeeIds: ["emp-left"],
			assignments: [{ type: "team", targetId: "team-1" }],
		});
		expect(toast.success).toHaveBeenCalledWith("Template updated");
	});

	it("reports a refused template", async () => {
		const user = userEvent.setup();
		templateActions.createProjectTemplate.mockResolvedValue({
			success: false,
			error: "A project template with this name already exists",
		});
		renderManagement();

		await user.click(await screen.findByRole("button", { name: "Create template" }));
		const form = await screen.findByRole("form", { name: "Create project template" });
		await user.type(within(form).getByLabelText(/^Name/), "Website relaunch");
		await user.click(within(form).getByRole("button", { name: "Create template" }));

		expect(toast.error).toHaveBeenCalledWith("A project template with this name already exists");
	});

	it("deletes a template only after confirmation", async () => {
		const user = userEvent.setup();
		renderManagement();

		await user.click(await screen.findByRole("button", { name: "Delete Website relaunch" }));
		expect(templateActions.deleteProjectTemplate).not.toHaveBeenCalled();
		await user.click(screen.getByRole("button", { name: "Confirm deleting Website relaunch" }));

		expect(templateActions.deleteProjectTemplate).toHaveBeenCalledWith("template-1");
		expect(toast.success).toHaveBeenCalledWith("Website relaunch deleted");
	});
});
